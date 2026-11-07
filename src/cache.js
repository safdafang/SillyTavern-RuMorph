import { ALGORITHM_VERSION, expandKey, relevantOverrides } from './expand.js';

const STORAGE_KEY = 'rumorph_cache';
const MAX_ENTRIES = 50000;

export function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

// The key keeps its original casing: it ends up in the regex, and ST hashes
// entries (timed effects) by their content.
export function cacheKey(key, flags, overrides) {
    const ov = relevantOverrides(overrides, key);
    const ovHash = Object.keys(ov).length ? hashString(JSON.stringify(ov)) : '0';
    return `${ALGORITHM_VERSION}|${flags.minWordLength}|${flags.caseSensitive ? 1 : 0}${flags.boundaries ? 1 : 0}|${ovHash}|${key}`;
}

// `hot` maps a raw key to its result and is cleared when settings or hints
// change. `persistent` is keyed by everything that affects the result and is
// stored in IndexedDB through localforage.
export class KeyCache {
    constructor({ storage = null, persistDelay = 2000 } = {}) {
        this.storage = storage;
        this.persistDelay = persistDelay;
        this.hot = new Map();
        this.persistent = new Map();
        this.dirty = false;
        this.timer = null;
    }

    get size() {
        return this.persistent.size;
    }

    async load() {
        if (!this.storage) return;
        try {
            const data = await this.storage.getItem(STORAGE_KEY);
            if (data?.version !== ALGORITHM_VERSION || !Array.isArray(data.entries)) return;
            for (const [k, v] of data.entries) {
                if (!this.persistent.has(k)) this.persistent.set(k, v);
            }
        } catch (e) {
            console.warn('[RuMorph] Could not load cache', e);
        }
    }

    schedulePersist() {
        this.dirty = true;
        if (!this.storage || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.persist();
        }, this.persistDelay);
    }

    async persist() {
        if (!this.storage || !this.dirty) return;
        this.dirty = false;
        try {
            const entries = [...this.persistent].slice(-MAX_ENTRIES);
            await this.storage.setItem(STORAGE_KEY, { version: ALGORITHM_VERSION, entries });
        } catch (e) {
            console.warn('[RuMorph] Could not save cache', e);
        }
    }

    invalidateHot() {
        this.hot.clear();
    }

    async clear() {
        this.hot.clear();
        this.persistent.clear();
        this.dirty = false;
        try {
            await this.storage?.removeItem(STORAGE_KEY);
        } catch {
            // nothing to remove
        }
    }

    expand(key, flags, { morph, overrides, onError }) {
        if (typeof key !== 'string') return null;
        const hotKey = `${flags.caseSensitive ? 1 : 0}${flags.boundaries ? 1 : 0}${flags.minWordLength}\u0000${key}`;
        const hot = this.hot.get(hotKey);
        if (hot !== undefined) return hot;

        const trimmed = key.trim();
        const pk = cacheKey(trimmed, flags, overrides);
        let result = this.persistent.get(pk);
        if (result === undefined) {
            let failed = false;
            result = expandKey(trimmed, {
                ...flags,
                morph,
                overrides,
                onError: (e) => {
                    failed = true;
                    onError?.(e);
                },
            });
            if (failed) return result;
            this.persistent.set(pk, result);
            this.schedulePersist();
        }
        this.hot.set(hotKey, result);
        return result;
    }
}
