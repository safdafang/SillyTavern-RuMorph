import { KeyCache } from '../src/cache.js';
import { createLoreHandler } from '../src/runtime.js';
import { getMorph } from './helpers.mjs';

const t0 = performance.now();
const morph = await getMorph();
console.log(`Az init (Node, local files): ${(performance.now() - t0).toFixed(0)} ms`);

// 60% dictionary words, 30% invented names, 10% phrases.
const dictWords = ['кот', 'дракон', 'меч', 'замок', 'лес', 'река', 'гора', 'ведьма', 'король', 'королева', 'магия', 'кровь', 'тень', 'звезда', 'башня', 'корабль', 'город', 'храм', 'книга', 'кольцо'];
const syl = ['мор', 'вен', 'эл', 'дрин', 'ка', 'ра', 'тал', 'ис', 'ан', 'ор', 'ве', 'ли', 'са', 'нор', 'ет'];
const ends = ['', 'а', 'я', 'ь', 'ия', 'ин', 'он', 'ей', 'о'];
let seed = 42;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const name = () => {
    const s = syl[rnd(syl.length)] + syl[rnd(syl.length)] + ends[rnd(ends.length)];
    return s.charAt(0).toUpperCase() + s.slice(1);
};
const keys = [];
for (let i = 0; i < 5000; i++) {
    const r = rnd(10);
    if (r < 6) keys.push(dictWords[rnd(dictWords.length)]);
    else if (r < 9) keys.push(name());
    else keys.push(`${['тёмный', 'старый', 'великий'][rnd(3)]} ${dictWords[rnd(dictWords.length)]}`);
}
const unique = new Set(keys).size;
const entries = [];
for (let i = 0; i < 1000; i++) entries.push({ uid: i, key: keys.slice(i * 5, i * 5 + 5), keysecondary: [] });

const settings = { enabled: true, minWordLength: 3, strictBoundaries: true, overrides: {} };
const cache = new KeyCache();
const handler = createLoreHandler({ ensureMorph: async () => morph, getSettings: () => settings, cache });
const pass = async () => {
    const lore = entries.map((e) => ({ ...e }));
    const t = performance.now();
    await handler({ globalLore: lore, characterLore: [], chatLore: [], personaLore: [] });
    return performance.now() - t;
};
const first = await pass();
console.log(`1000 entries × 5 keys (${unique} unique): first pass (cold cache) ${first.toFixed(0)} ms`);
const runs = [];
for (let i = 0; i < 20; i++) runs.push(await pass());
runs.sort((a, b) => a - b);
console.log(`cached pass: median ${runs[10].toFixed(2)} ms, best ${runs[0].toFixed(2)} ms, worst ${runs[19].toFixed(2)} ms`);

cache.invalidateHot();
console.log(`after override change (persistent hit): ${(await pass()).toFixed(2)} ms`);
