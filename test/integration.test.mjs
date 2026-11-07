// Simulates getSortedEntries() from ST world-info.js @ ad29cbd and scans
// text through the copy of matchKeys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyCache } from '../src/cache.js';
import { createLoreHandler } from '../src/runtime.js';
import { compileWorld, restoreWorld } from '../src/compile.js';
import { expandKey } from '../src/expand.js';
import { WorldInfoBufferStub } from './st-matchkeys.js';
import { getMorph } from './helpers.mjs';

const morph = await getMorph();

// getStringHash from ST public/scripts/utils.js @ ad29cbd
function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') {
        return 0;
    }
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

class EventSource {
    listeners = [];
    on(fn) { this.listeners.push(fn); }
    async emit(payload) { for (const fn of this.listeners) await fn(payload); }
}

function makeWorld() {
    const entries = {
        0: { uid: 0, key: ['Морвенна'], keysecondary: [], content: 'Морвенна, ведьма.', comment: 'Morwenna' },
        1: { uid: 1, key: ['кот'], keysecondary: [], content: 'Кот учёный.', comment: 'Cat' },
        2: { uid: 2, key: ['тёмный лес'], keysecondary: ['/ночь|сумерки/i'], content: 'Лес.', comment: 'Forest', selective: true },
        3: { uid: 3, key: ['{{char}}', 'Excalibur'], keysecondary: [], content: 'Меч.', comment: 'Sword' },
        4: { uid: 4, key: ['Элдрин'], keysecondary: [], content: 'Элдрин.', caseSensitive: true },
    };
    return { entries };
}

async function getSortedEntries(cacheData, eventSource) {
    // Shallow copies, exactly like getGlobalLore: key arrays stay shared with the cache.
    const globalLore = Object.keys(cacheData.entries).map((x) => cacheData.entries[x]).map(({ uid, ...rest }) => ({ uid, world: 'test', ...rest }));
    await eventSource.emit({ globalLore, characterLore: [], chatLore: [], personaLore: [] });
    return globalLore.map((entry) => ({ ...entry, hash: getStringHash(JSON.stringify(entry)) }));
}

function activated(entries, text, opts) {
    const buffer = new WorldInfoBufferStub(opts);
    return entries.filter((e) => buffer.entryMatches(text, e)).map((e) => e.uid);
}

function setup(settingsPatch = {}, extra = {}) {
    const settings = { enabled: true, minWordLength: 3, strictBoundaries: true, overrides: {}, ...settingsPatch };
    const cache = new KeyCache();
    const eventSource = new EventSource();
    const warnings = [];
    const handler = createLoreHandler({
        ensureMorph: async () => morph,
        getSettings: () => settings,
        cache,
        onUnavailable: (m) => warnings.push(m),
        ...extra,
    });
    eventSource.on(handler);
    return { settings, cache, eventSource, warnings, handler };
}

test('Морвенна activates on «Я подошёл к Морвенне», кот does not activate on «котлете»', async () => {
    const { eventSource } = setup();
    const entries = await getSortedEntries(makeWorld(), eventSource);
    assert.deepEqual(activated(entries, 'Я подошёл к Морвенне'), [0]);
    assert.deepEqual(activated(entries, 'На столе лежала котлета, и я съел котлету'), []);
    assert.deepEqual(activated(entries, 'Я погладил кота'), [1]);
    assert.deepEqual(activated(entries, 'Мы вошли в тёмный лес'), [2]);
    assert.deepEqual(activated(entries, 'Мы стояли у края темного леса'), [2]);
});

test('without the extension ST misses inflected forms and whole-words mode is broken for Cyrillic', async () => {
    const entries = await getSortedEntries(makeWorld(), new EventSource());
    assert.deepEqual(activated(entries, 'Я подошёл к Морвенне'), []);
    assert.deepEqual(activated(entries, 'котлета', { matchWholeWords: true }), [1]);
});

test('case-sensitive entry: no i flag', async () => {
    const { eventSource } = setup();
    const entries = await getSortedEntries(makeWorld(), eventSource);
    const e4 = entries.find((e) => e.uid === 4);
    assert.match(e4.key[0], /\/u$/);
    assert.deepEqual(activated(entries, 'с Элдрином'), [4]);
    assert.deepEqual(activated(entries, 'с элдрином'), []);
});

test('regex, macro and latin keys are untouched', async () => {
    const { eventSource } = setup();
    const entries = await getSortedEntries(makeWorld(), eventSource);
    assert.deepEqual(entries.find((e) => e.uid === 3).key, ['{{char}}', 'Excalibur']);
    assert.deepEqual(entries.find((e) => e.uid === 2).keysecondary, ['/ночь|сумерки/i']);
});

test('the cached lorebook is not mutated (arrays are replaced, not edited)', async () => {
    const world = makeWorld();
    const before = JSON.stringify(world);
    const { eventSource } = setup();
    await getSortedEntries(world, eventSource);
    assert.equal(JSON.stringify(world), before);
});

test('disabled extension does not change anything (same hashes as without it)', async () => {
    const { eventSource } = setup({ enabled: false });
    const a = await getSortedEntries(makeWorld(), eventSource);
    const b = await getSortedEntries(makeWorld(), new EventSource());
    assert.deepEqual(a.map((e) => e.hash), b.map((e) => e.hash));
    assert.deepEqual(a.map((e) => e.key), b.map((e) => e.key));
});

test('determinism: two passes (and a fresh cache) give identical hashes', async () => {
    const s1 = setup();
    const a = await getSortedEntries(makeWorld(), s1.eventSource);
    const b = await getSortedEntries(makeWorld(), s1.eventSource);
    const s2 = setup();
    const c = await getSortedEntries(makeWorld(), s2.eventSource);
    assert.deepEqual(a.map((e) => e.hash), b.map((e) => e.hash));
    assert.deepEqual(a.map((e) => e.hash), c.map((e) => e.hash));
});

test('Az failure: keys unchanged, no exception, a single warning', async () => {
    const { eventSource, warnings } = setup({}, { ensureMorph: async () => { throw new Error('boom'); } });
    const plain = await getSortedEntries(makeWorld(), new EventSource());
    const a = await getSortedEntries(makeWorld(), eventSource);
    await getSortedEntries(makeWorld(), eventSource);
    assert.deepEqual(a.map((e) => e.hash), plain.map((e) => e.hash));
    assert.equal(warnings.length, 1);
});

test('Az timeout: keys unchanged, generation continues', async () => {
    const { eventSource, warnings } = setup({}, { ensureMorph: () => new Promise(() => {}), timeoutMs: 50 });
    const a = await getSortedEntries(makeWorld(), eventSource);
    assert.deepEqual(a.find((e) => e.uid === 0).key, ['Морвенна']);
    assert.equal(warnings.length, 1);
});

test('exception inside morphology does not escape', async () => {
    const broken = { classify() { throw new Error('kaboom'); } };
    const { eventSource } = setup({}, { ensureMorph: async () => broken });
    const a = await getSortedEntries(makeWorld(), eventSource);
    assert.deepEqual(a.find((e) => e.uid === 0).key, ['Морвенна']);
});

test('compile → works without the extension → restore', () => {
    const world = makeWorld();
    const original = JSON.parse(JSON.stringify(world));
    const expand = (k, e) => expandKey(k, { morph, caseSensitive: e.caseSensitive === true, boundaries: true });
    const dry = compileWorld(world, expand);
    assert.equal(dry.changed, 4);
    assert.equal(JSON.stringify(world), JSON.stringify(original), 'dry run must not modify');

    compileWorld(world, expand, { apply: true, version: '0.1.0' });
    assert.deepEqual(world.entries[0].extensions.rumorph.originalKeys.key, ['Морвенна']);
    const reloaded = JSON.parse(JSON.stringify(world));
    const plainEntries = Object.values(reloaded.entries);
    assert.deepEqual(activated(plainEntries, 'Я подошёл к Морвенне'), [0]);
    assert.deepEqual(activated(plainEntries, 'котлета'), []);

    assert.equal(compileWorld(reloaded, expand).changed, 0);

    assert.equal(restoreWorld(reloaded, { apply: true }).restored, 4);
    assert.deepEqual(reloaded, original);
});

test('performance: 1000 entries × 5 keys, cached pass < 20 ms', async () => {
    const words = ['кот', 'дракон', 'тёмный лес', 'Морвенна', 'Элдрин', 'Мария', 'Орден Серебряного Клинка', 'Кира Морвенна', 'меч', 'замок'];
    const entries = {};
    for (let i = 0; i < 1000; i++) {
        entries[i] = { uid: i, key: Array.from({ length: 5 }, (_, j) => words[(i + j) % words.length]), keysecondary: [] };
    }
    const world = { entries };
    const { eventSource } = setup();
    const t0 = performance.now();
    await getSortedEntries(world, eventSource);
    const first = performance.now() - t0;
    const runs = [];
    for (let r = 0; r < 5; r++) {
        const lore = Object.values(world.entries).map((e) => ({ ...e }));
        const t = performance.now();
        await eventSource.emit({ globalLore: lore, characterLore: [], chatLore: [], personaLore: [] });
        runs.push(performance.now() - t);
    }
    const best = Math.min(...runs);
    console.log(`[perf] first pass ${first.toFixed(1)} ms, cached pass best ${best.toFixed(2)} ms, all: ${runs.map((x) => x.toFixed(2)).join(', ')}`);
    assert.ok(best < 20, `cached pass took ${best} ms`);
});
