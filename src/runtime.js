import { rewriteEntryKeys } from './expand.js';

export const LORE_FIELDS = ['globalLore', 'characterLore', 'chatLore', 'personaLore'];

export function withTimeout(promise, ms, message = 'timeout') {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Creates the WORLDINFO_ENTRIES_LOADED listener. It never throws: if anything
 * goes wrong the keys stay as they are and the scan continues.
 */
export function createLoreHandler({
    ensureMorph,
    getSettings,
    cache,
    getGlobals = () => ({ caseSensitive: false, matchWholeWords: false }),
    timeoutMs = 5000,
    onUnavailable,
    debug,
}) {
    let warned = false;

    return async function onEntriesLoaded(payload) {
        try {
            const settings = getSettings();
            if (!settings?.enabled || !payload || typeof payload !== 'object') return null;

            let morph;
            try {
                morph = await withTimeout(ensureMorph(), timeoutMs, `Az.js did not load in ${timeoutMs} ms`);
            } catch (e) {
                if (!warned) {
                    warned = true;
                    onUnavailable?.(e);
                }
                return null;
            }

            const started = performance.now();
            const globals = getGlobals();
            const minWordLength = Number(settings.minWordLength) || 3;
            const overrides = settings.overrides ?? {};
            const expand = (key, entry) => cache.expand(key, {
                caseSensitive: (entry.caseSensitive ?? globals.caseSensitive) === true,
                boundaries: !!settings.strictBoundaries || (entry.matchWholeWords ?? globals.matchWholeWords) === true,
                minWordLength,
            }, { morph, overrides, onError: (e) => debug?.('failed to expand', key, e) });

            let changed = 0;
            for (const field of LORE_FIELDS) {
                if (!Array.isArray(payload[field])) continue;
                for (const entry of payload[field]) {
                    if (!entry || typeof entry !== 'object') continue;
                    try {
                        changed += rewriteEntryKeys(entry, expand);
                    } catch (e) {
                        debug?.('entry skipped', entry.uid, e);
                    }
                }
            }
            const ms = performance.now() - started;
            debug?.(`${changed} keys expanded in ${ms.toFixed(1)} ms`);
            return { changed, ms };
        } catch (e) {
            console.error('[RuMorph] Keys left unchanged', e);
            return null;
        }
    };
}
