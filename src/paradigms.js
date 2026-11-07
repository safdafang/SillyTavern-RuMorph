// Declension of words that are not in the dictionary, mostly invented names.
// A guessed word gets the union of every paradigm that fits its ending: an
// invented stem is unique, so extra forms never match anything by accident,
// while a missing form breaks activation.

export const CASES = ['nomn', 'gent', 'gen2', 'datv', 'accs', 'ablt', 'loct', 'loc2', 'voct'];
export const NUMBERS = ['sing', 'plur'];
export const CASE_FALLBACK = { gen2: 'gent', loc2: 'loct', voct: 'nomn' };

const VELAR = 'гкх';
const HUSHING = 'жшщч';
const VOWELS = 'аеёиоуыэюя';

export const slotKey = (c, n) => `${c}:${n}`;

export function newTable() {
    return new Map();
}

export function addForms(table, c, n, ...forms) {
    const key = slotKey(c, n);
    let set = table.get(key);
    if (!set) {
        set = new Set();
        table.set(key, set);
    }
    for (const f of forms.flat()) {
        if (f) set.add(f);
    }
}

export function mergeTables(dst, src) {
    for (const [key, set] of src) {
        let d = dst.get(key);
        if (!d) {
            d = new Set();
            dst.set(key, d);
        }
        for (const f of set) d.add(f);
    }
    return dst;
}

export function tableForms(table) {
    const out = new Set();
    for (const set of table.values()) for (const f of set) out.add(f);
    return [...out];
}

export function fixedTable(word) {
    const t = newTable();
    for (const n of NUMBERS) for (const c of CASES) addForms(t, c, n, word);
    return t;
}

function fill(table, rows) {
    for (const [slot, forms] of Object.entries(rows)) {
        const [c, n] = slot.split(':');
        addForms(table, c, n, forms);
    }
}

const last = (s) => s.charAt(s.length - 1);
const afterHushing = (s) => HUSHING.includes(last(s));
const yi = (s) => (VELAR.includes(last(s)) || afterHushing(s) ? 'и' : 'ы');
// After ж ш щ ч ц the vowel depends on stress, which is unknown: keep both.
const oe = (s, o, e) => ('жшщчц'.includes(last(s)) ? [s + o, s + e] : [s + o]);

function masculineHard(word, table) {
    const stems = [word];
    const fleeting = word.match(/^(.*[бвгджзклмнпрстфхцчшщ])[оёе]([кц])$/);
    if (fleeting && word.length >= 4) stems.push(fleeting[1] + fleeting[2]);

    fill(table, { 'nomn:sing': word, 'voct:sing': word });
    for (const s of stems) {
        const plNom = s + yi(s);
        const plGen = afterHushing(s) ? [s + 'ей'] : oe(s, 'ов', 'ев');
        fill(table, {
            'gent:sing': s + 'а', 'gen2:sing': s + 'у', 'datv:sing': s + 'у', 'accs:sing': [s + 'а', word],
            'ablt:sing': oe(s, 'ом', 'ем'), 'loct:sing': s + 'е', 'loc2:sing': s + 'у',
            'nomn:plur': plNom, 'gent:plur': plGen, 'datv:plur': s + 'ам', 'accs:plur': [...plGen, plNom],
            'ablt:plur': s + 'ами', 'loct:plur': s + 'ах',
        });
    }
}

function masculineJ(word, table) {
    const s = word.slice(0, -1);
    fill(table, {
        'nomn:sing': word, 'voct:sing': word, 'gent:sing': s + 'я', 'gen2:sing': s + 'ю', 'datv:sing': s + 'ю',
        'accs:sing': [s + 'я', word], 'ablt:sing': [s + 'ем', s + 'ём'], 'loct:sing': s + (last(s) === 'и' ? 'и' : 'е'),
        'loc2:sing': s + 'ю',
        'nomn:plur': s + 'и', 'gent:plur': s + 'ев', 'datv:plur': s + 'ям', 'accs:plur': [s + 'ев', s + 'и'],
        'ablt:plur': s + 'ями', 'loct:plur': s + 'ях',
    });
}

function surname(word, table) {
    fill(table, {
        'nomn:sing': word, 'gent:sing': word + 'а', 'datv:sing': word + 'у', 'accs:sing': word + 'а',
        'ablt:sing': word + 'ым', 'loct:sing': word + 'е',
        'nomn:plur': word + 'ы', 'gent:plur': word + 'ых', 'datv:plur': word + 'ым', 'accs:plur': word + 'ых',
        'ablt:plur': word + 'ыми', 'loct:plur': word + 'ых',
    });
}

function firstA(word, table) {
    const s = word.slice(0, -1);
    const ablt = [s + 'ой', s + 'ою'];
    if ('жшщчц'.includes(last(s))) ablt.push(s + 'ей', s + 'ею');
    fill(table, {
        'nomn:sing': word, 'gent:sing': s + yi(s), 'datv:sing': s + 'е', 'accs:sing': s + 'у', 'ablt:sing': ablt,
        'loct:sing': s + 'е', 'voct:sing': [word, s],
        'nomn:plur': s + yi(s), 'gent:plur': s, 'datv:plur': s + 'ам', 'accs:plur': [s, s + yi(s)],
        'ablt:plur': s + 'ами', 'loct:plur': s + 'ах',
    });
}

function firstYa(word, table) {
    const s = word.slice(0, -1);
    const ls = last(s);
    fill(table, {
        'nomn:sing': word, 'accs:sing': s + 'ю', 'ablt:sing': [s + 'ей', s + 'ею'], 'gent:sing': s + 'и',
        'nomn:plur': s + 'и', 'datv:plur': s + 'ям', 'ablt:plur': s + 'ями', 'loct:plur': s + 'ях',
    });
    if (ls === 'и') {
        // Мария: Марии, Марию, Марией
        fill(table, { 'datv:sing': s + 'и', 'loct:sing': s + 'и', 'voct:sing': word, 'gent:plur': s + 'й', 'accs:plur': [s + 'й', s + 'и'] });
    } else if (VOWELS.includes(ls)) {
        // Лея: Леи, Лее, Лею
        fill(table, { 'datv:sing': s + 'е', 'loct:sing': s + 'е', 'voct:sing': word, 'gent:plur': s + 'й', 'accs:plur': [s + 'й', s + 'и'] });
    } else {
        // Таня: Тани, Тане, Тань
        fill(table, {
            'datv:sing': s + 'е', 'loct:sing': s + 'е', 'voct:sing': [word, s + 'ь'],
            'gent:plur': [s + 'ь', s + 'ей'], 'accs:plur': [s + 'ь', s + 'ей', s + 'и'],
        });
    }
}

function softMasculine(word, table) {
    const s = word.slice(0, -1);
    fill(table, {
        'nomn:sing': word, 'voct:sing': word, 'gent:sing': s + 'я', 'gen2:sing': s + 'ю', 'datv:sing': s + 'ю',
        'accs:sing': [s + 'я', word], 'ablt:sing': [s + 'ем', s + 'ём'], 'loct:sing': s + 'е',
        'nomn:plur': s + 'и', 'gent:plur': s + 'ей', 'datv:plur': s + 'ям', 'accs:plur': [s + 'ей', s + 'и'],
        'ablt:plur': s + 'ями', 'loct:plur': s + 'ях',
    });
}

function softFeminine(word, table) {
    const s = word.slice(0, -1);
    const a = afterHushing(s) ? 'а' : 'я';
    fill(table, {
        'nomn:sing': word, 'voct:sing': word, 'gent:sing': s + 'и', 'datv:sing': s + 'и', 'accs:sing': word,
        'ablt:sing': s + 'ью', 'loct:sing': s + 'и', 'loc2:sing': s + 'и',
        'nomn:plur': s + 'и', 'gent:plur': s + 'ей', 'datv:plur': s + a + 'м', 'accs:plur': [s + 'ей', s + 'и'],
        'ablt:plur': s + a + 'ми', 'loct:plur': s + a + 'х',
    });
}

const ADJ_ENDINGS = {
    'ый': { g: 'masc', hard: true },
    'ой': { g: 'masc', hard: true },
    'ая': { g: 'femn', hard: true },
    'ое': { g: 'neut', hard: true },
    'ий': { g: 'masc', hard: false },
    'яя': { g: 'femn', hard: false },
    'ее': { g: 'neut', hard: false },
};

export function adjectivalEnding(word) {
    if (word.length < 4) return null;
    const info = ADJ_ENDINGS[word.slice(-2)];
    return info ? { ...info, stem: word.slice(0, -2) } : null;
}

function adjectival(word, table, gender) {
    const a = adjectivalEnding(word);
    if (!a) return;
    const s = a.stem;
    const soft = !a.hard;
    const hushing = afterHushing(s);
    const i = soft || hushing || VELAR.includes(last(s)) ? 'и' : 'ы';
    const end = (o, e) => (hushing ? [s + o, s + e] : [s + (soft ? e : o)]);
    const g = gender ?? a.g;

    if (g === 'masc' || g === 'neut') {
        const nom = g === 'masc' ? word : s + (soft || hushing ? 'ее' : 'ое');
        fill(table, {
            'nomn:sing': nom, 'voct:sing': nom, 'gent:sing': end('ого', 'его'), 'datv:sing': end('ому', 'ему'),
            'accs:sing': [...end('ого', 'его'), nom], 'ablt:sing': s + i + 'м', 'loct:sing': end('ом', 'ем'),
        });
    }
    if (g === 'femn') {
        const nom = s + (soft ? 'яя' : 'ая');
        fill(table, {
            'nomn:sing': nom, 'voct:sing': nom, 'gent:sing': end('ой', 'ей'), 'datv:sing': end('ой', 'ей'),
            'accs:sing': s + (soft ? 'юю' : 'ую'), 'ablt:sing': [...end('ой', 'ей'), ...end('ою', 'ею')],
            'loct:sing': end('ой', 'ей'),
        });
    }
    fill(table, {
        'nomn:plur': s + i + 'е', 'gent:plur': s + i + 'х', 'datv:plur': s + i + 'м',
        'accs:plur': [s + i + 'х', s + i + 'е'], 'ablt:plur': s + i + 'ми', 'loct:plur': s + i + 'х',
    });
}

/**
 * @param {string} word lower-case, single word
 * @param {{gender?: 'm'|'f'|'n'|null, indeclinable?: boolean}} [hints]
 * @returns {{table: Map<string, Set<string>>, types: string[]}}
 */
export function guessParadigms(word, hints = {}) {
    const gender = hints.gender ?? null;
    if (hints.indeclinable || !/[а-яё]/.test(word) || word.length < 2) {
        return { table: fixedTable(word), types: ['indeclinable'] };
    }

    const table = newTable();
    const types = [];
    addForms(table, 'nomn', 'sing', word);
    const l = last(word);
    const adj = adjectivalEnding(word);

    // Short words in -ая (Рая, Тая) are names, not adjectives.
    if (adj && !(adj.g === 'femn' && word.length <= 4)) {
        adjectival(word, table, { m: 'masc', f: 'femn', n: 'neut' }[gender] ?? null);
        types.push('adjectival');
        // Ной, Арий
        if (l === 'й' && gender !== 'f' && gender !== 'n') {
            masculineJ(word, table);
            types.push('masc-j');
        }
        return { table, types };
    }

    if (l === 'а') {
        firstA(word, table);
        types.push('1st-a');
    } else if (l === 'я') {
        firstYa(word, table);
        types.push('1st-ya');
    } else if (l === 'ь') {
        if (gender !== 'f') {
            softMasculine(word, table);
            types.push('masc-soft');
        }
        if (gender !== 'm') {
            softFeminine(word, table);
            types.push('3rd-fem');
        }
    } else if (l === 'й') {
        if (gender === 'f' || gender === 'n') types.push('indeclinable');
        else {
            masculineJ(word, table);
            types.push('masc-j');
        }
    } else if (VOWELS.includes(l) || l === 'ъ') {
        types.push('indeclinable');
    } else if (gender === 'f' || gender === 'n') {
        // Feminine names ending in a consonant do not decline: «с Элдрин».
        types.push('indeclinable');
    } else {
        masculineHard(word, table);
        types.push('masc-hard');
        if (/(ов|ев|ёв|ин|ын)$/.test(word)) {
            surname(word, table);
            types.push('surname');
        }
        if (gender !== 'm') types.push('indeclinable');
    }

    if (types.includes('indeclinable')) mergeTables(table, fixedTable(word));
    return { table, types };
}
