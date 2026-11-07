import {
    CASES, CASE_FALLBACK, NUMBERS, addForms, adjectivalEnding, fixedTable,
    guessParadigms, mergeTables, newTable, slotKey, tableForms,
} from './paradigms.js';
import { escapeRegexUnicode, parseRegexFromString } from './st-compat.js';

// Bump whenever generated keys change, so persisted caches are dropped.
export const ALGORITHM_VERSION = 3;

const CYRILLIC = /[а-яё]/i;
const GENDER = { m: 'masc', f: 'femn', n: 'neut' };
const GENDER_HINT = { masc: 'm', femn: 'f', neut: 'n' };
const PROPER = /\b(Name|Surn|Patr|Geox|Orgn|Trad)\b/;
const MAX_COMBOS_PER_SLOT = 64;

export function normalizeWord(word) {
    return String(word).toLowerCase().replace(/ё/g, 'е').trim();
}

export function normalizeKey(key) {
    return normalizeWord(key).split(/\s+/).filter(Boolean).join(' ');
}

export function shouldExpand(key) {
    if (typeof key !== 'string') return false;
    const k = key.trim();
    // Macros are substituted by ST after the event, right before matching.
    if (!k || k.includes('{{')) return false;
    if (parseRegexFromString(k)) return false;
    return CYRILLIC.test(k);
}

export function applyCase(form, original) {
    if (form.includes('-') && original.includes('-')) {
        const fp = form.split('-');
        const op = original.split('-');
        if (fp.length === op.length) return fp.map((f, i) => applyCase(f, op[i])).join('-');
    }
    if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) {
        return form.toUpperCase();
    }
    const first = original.charAt(0);
    if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
        return form.charAt(0).toUpperCase() + form.slice(1);
    }
    return form;
}

export function getOverride(overrides, word) {
    const o = overrides?.[normalizeKey(word)];
    return o && typeof o === 'object' ? o : null;
}

export function relevantOverrides(overrides, key) {
    const out = {};
    if (!overrides) return out;
    const nk = normalizeKey(key);
    const names = new Set([nk, ...nk.split(/[\s-]+/)]);
    for (const n of [...names].sort()) {
        if (overrides[n]) out[n] = overrides[n];
    }
    return out;
}

function mapTable(table, fn) {
    const out = newTable();
    for (const [k, set] of table) out.set(k, new Set([...set].map(fn)));
    return out;
}

function slotForms(table, c, n) {
    return table.get(slotKey(c, n)) ?? (CASE_FALLBACK[c] ? table.get(slotKey(CASE_FALLBACK[c], n)) : undefined);
}

function cartesian(options, sep, cap) {
    let acc = [''];
    for (let i = 0; i < options.length; i++) {
        const next = [];
        outer: for (const a of acc) {
            for (const o of options[i]) {
                next.push(i === 0 ? o : a + sep + o);
                if (next.length >= cap) break outer;
            }
        }
        acc = next;
    }
    return acc;
}

// Plural forms of a proper name that are words of their own are dropped:
// the genitive plural of «Света» is «Свет».
function dropForeignPlurals(table, word, lemma, morph) {
    for (const [key, set] of table) {
        if (!key.endsWith(':plur')) continue;
        for (const f of [...set]) {
            if (f !== word && morph.isForeignWord(f, lemma.toLowerCase())) set.delete(f);
        }
        if (!set.size) table.delete(key);
    }
}

function analyzeWord(text, ctx) {
    const w = text.toLowerCase();
    const ov = getOverride(ctx.overrides, w);
    const base = { text, adjForms: [], adjParses: [], genders: [], anims: [], bestIsNomn: true, types: [] };
    if (!CYRILLIC.test(w)) return { ...base, kind: 'fixed', source: 'latin', table: fixedTable(w) };
    if (ov?.indeclinable) return { ...base, kind: 'fixed', source: 'override', table: fixedTable(w), types: ['indeclinable'] };
    if (w.length < ctx.minWordLength) return { ...base, kind: 'fixed', source: 'short', table: fixedTable(w) };

    const gender = ov?.gender ? GENDER[ov.gender] : null;
    const cls = ctx.morph.classify(text);

    if (cls.dictionary) {
        let nouns = cls.nouns;
        if (gender) {
            const byGender = nouns.filter((p) => p.gender === gender || p.gender === 'ms-f');
            if (byGender.length) nouns = byGender;
        }
        const table = newTable();
        for (const p of nouns) mergeTables(table, ctx.morph.nounTable(p));
        if (nouns.length && nouns.every((p) => PROPER.test(p.tag))) {
            dropForeignPlurals(table, w, nouns[0].lemma || w, ctx.morph);
        }
        const adjForms = new Set();
        for (const p of cls.adjs) for (const f of ctx.morph.adjForms(p)) adjForms.add(f);
        const kind = nouns.length ? 'noun' : cls.adjs.length ? 'adj' : 'fixed';
        if (kind === 'fixed' || !table.size) mergeTables(table, fixedTable(w));
        return {
            ...base,
            kind,
            source: 'dictionary',
            table,
            adjForms: [...adjForms],
            adjParses: cls.adjs,
            genders: [...new Set(nouns.map((p) => p.gender).filter(Boolean))],
            anims: [...new Set(nouns.map((p) => p.anim).filter(Boolean))],
            bestIsNomn: cls.bestIsNomn,
            types: [...new Set([...nouns, ...cls.adjs].map((p) => `${p.lemma} (${p.tag})`))],
        };
    }

    const hint = ov?.gender ?? ctx.genderHint ?? null;
    const guess = guessParadigms(w, { gender: hint });
    const table = guess.table;
    const adjLike = guess.types.includes('adjectival');
    if (!adjLike && !guess.types.every((t) => t === 'indeclinable')) {
        const g = hint ? GENDER[hint] : null;
        for (const p of cls.nouns) {
            if (g && p.gender !== g && p.gender !== 'ms-f') continue;
            const t = ctx.morph.nounTable(p);
            if (tableForms(t).includes(w)) mergeTables(table, t);
        }
    }
    dropForeignPlurals(table, w, w, ctx.morph);
    return {
        ...base,
        kind: adjLike ? 'adjGuess' : 'unknown',
        source: 'guess',
        table,
        types: guess.types,
        genders: gender ? [gender] : [],
        anims: ['anim', 'inan'],
    };
}

function analyzeToken(text, ctx) {
    const m = text.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    if (m && (m[1] || m[3]) && m[2]) {
        const inner = analyzeToken(m[2], ctx);
        const wrap = (f) => m[1] + f + m[3];
        return { ...inner, text, table: mapTable(inner.table, wrap), adjForms: inner.adjForms.map(wrap), wrap };
    }

    const parts = text.split('-');
    if (parts.length < 2 || parts.some((p) => !p)) return analyzeWord(text, ctx);
    const whole = analyzeWord(text, ctx);
    if (whole.source === 'dictionary' || whole.source === 'override') return whole;

    // «Жан-Полем» (last part only) and «Анной-Марией» (every part).
    const infos = parts.map((p) => analyzeWord(p, ctx));
    const last = infos[infos.length - 1];
    const prefix = parts.slice(0, -1).join('-').toLowerCase();
    const table = newTable();
    for (const n of NUMBERS) {
        for (const c of CASES) {
            const lastForms = slotForms(last.table, c, n);
            if (!lastForms) continue;
            addForms(table, c, n, [...lastForms].map((f) => `${prefix}-${f}`));
            const options = infos.map((i) => [...(slotForms(i.table, c, n) ?? [i.text.toLowerCase()])]);
            addForms(table, c, n, cartesian(options, '-', MAX_COMBOS_PER_SLOT));
        }
    }
    return { ...last, text, table, types: ['hyphenated', ...last.types] };
}

function agreeTable(w, agreement, ctx) {
    const t = newTable();
    for (const p of w.adjParses) mergeTables(t, ctx.morph.adjAgreeTable(p, agreement));
    if (!t.size) return fixedTable(w.text.toLowerCase());
    return w.wrap ? mapTable(t, w.wrap) : t;
}

function ownGenderTable(w, ctx) {
    const t = newTable();
    for (const p of w.adjParses) {
        const genders = p.gender ? [p.gender] : ['masc', 'femn', 'neut'];
        mergeTables(t, ctx.morph.adjAgreeTable(p, { genders, anims: ['anim', 'inan'] }));
    }
    if (!t.size) return fixedTable(w.text.toLowerCase());
    return w.wrap ? mapTable(t, w.wrap) : t;
}

const isAdj = (kind) => kind === 'adj' || kind === 'adjGuess';

function phraseForms(tokens, words, ctx) {
    const n = words.length;
    const kinds = words.map((w, i) => {
        // «учёный» is both a noun and an adjective; before a noun it is the adjective.
        if (w.kind === 'noun' && w.adjParses.length && i < n - 1 && ['noun', 'unknown'].includes(words[i + 1].kind)) return 'adj';
        return w.kind;
    });

    let head = kinds.findIndex((k) => k === 'noun' || k === 'unknown');
    if (head === -1) head = kinds.findIndex(isAdj);
    if (head === -1) return [tokens.join(' ').toLowerCase()];

    const roles = kinds.map((k, i) => (i < head && isAdj(k) ? 'agree' : 'frozen'));
    roles[head] = 'head';
    // After the head: agreeing adjectives and name chains until the first word
    // that is not in the nominative («Орден Серебряного Клинка», «Кот в сапогах»).
    for (let i = head + 1; i < n; i++) {
        const w = words[i];
        if (kinds[i] === 'fixed' || (w.source === 'dictionary' && !w.bestIsNomn)) break;
        roles[i] = isAdj(kinds[i]) ? 'agree' : 'chain';
    }
    words.forEach((w, i) => { w.role = roles[i]; });

    const hw = words[head];
    let genders = hw.genders.filter((g) => g !== 'ms-f');
    if (hw.genders.includes('ms-f')) genders.push('masc', 'femn');
    if (!genders.length) {
        // An unknown head takes the gender its adjectives are written in.
        const adjGenders = new Set();
        words.forEach((w, i) => {
            if (roles[i] !== 'agree') return;
            for (const p of w.adjParses) if (p.case === 'nomn' && p.number === 'sing' && p.gender) adjGenders.add(p.gender);
            if (w.kind === 'adjGuess') adjGenders.add(adjectivalEnding(tokens[i].toLowerCase())?.g);
        });
        adjGenders.delete(undefined);
        if (adjGenders.size === 1 && hw.source === 'guess' && !ctx.genderHint && !getOverride(ctx.overrides, tokens[head])?.gender) {
            ctx.genderHint = GENDER_HINT[[...adjGenders][0]];
        }
        genders = adjGenders.size ? [...adjGenders] : ['masc', 'femn', 'neut'];
    }
    const anims = hw.anims.length ? hw.anims : ['anim', 'inan'];
    const headTable = kinds[head] === 'adj' ? ownGenderTable(hw, ctx) : hw.table;

    const tables = words.map((w, i) => {
        if (i === head) return headTable;
        const lower = tokens[i].toLowerCase();
        switch (roles[i]) {
            case 'agree':
                return w.source === 'guess' ? w.table : agreeTable(w, { genders, anims }, ctx);
            case 'chain':
                // An unknown word after the head may also be a genitive dependent.
                return w.source === 'guess' ? mergeTables(fixedTable(lower), w.table) : w.table;
            default:
                return fixedTable(lower);
        }
    });

    const out = new Set([tokens.join(' ').toLowerCase()]);
    for (const num of NUMBERS) {
        for (const c of CASES) {
            if (!headTable.has(slotKey(c, num))) continue;
            const options = tables.map((t, i) => [...(slotForms(t, c, num) ?? [tokens[i].toLowerCase()])]);
            for (const p of cartesian(options, ' ', MAX_COMBOS_PER_SLOT)) out.add(p);
        }
    }
    return [...out];
}

export function sortForms(forms) {
    return forms.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

export function getForms(key, opts) {
    const ctx = {
        morph: opts.morph,
        minWordLength: opts.minWordLength ?? 3,
        overrides: opts.overrides ?? {},
        genderHint: null,
    };
    const trimmed = String(key).trim();
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (!tokens.length) return { forms: [], words: [] };

    let words = tokens.map((t) => analyzeToken(t, ctx));
    let lower;
    if (tokens.length === 1) {
        words[0].role = 'single';
        lower = [...new Set([...tableForms(words[0].table), ...words[0].adjForms, tokens[0].toLowerCase()])];
    } else {
        lower = phraseForms(tokens, words, ctx);
        if (ctx.genderHint) {
            words = tokens.map((t) => analyzeToken(t, ctx));
            lower = phraseForms(tokens, words, ctx);
        }
    }

    const extra = new Set();
    const exclude = new Set();
    const overrides = [getOverride(ctx.overrides, trimmed)];
    if (tokens.length > 1) overrides.push(...tokens.map((t) => getOverride(ctx.overrides, t)));
    for (const ov of overrides) {
        for (const f of ov?.extraForms ?? []) if (String(f).trim()) extra.add(String(f).trim().toLowerCase());
        for (const f of ov?.excludeForms ?? []) if (String(f).trim()) exclude.add(normalizeWord(f));
    }
    const excluded = (f) => exclude.has(normalizeWord(f)) || (f.includes(' ') && f.split(' ').some((w) => exclude.has(normalizeWord(w))));

    let forms = [...lower.filter((f) => !excluded(f)), ...extra].map((f) => {
        const fw = f.split(' ');
        return fw.length === tokens.length ? fw.map((x, i) => applyCase(x, tokens[i])).join(' ') : f;
    });
    forms = [...new Set(forms)];
    const original = tokens.join(' ');
    if (!forms.includes(original) && !exclude.has(normalizeWord(original))) forms.push(original);
    return { forms: sortForms(forms), words };
}

export function buildRegex(forms, { caseSensitive = false, boundaries = true } = {}) {
    const alternatives = new Set();
    for (const f of sortForms([...new Set(forms.filter(Boolean))])) {
        alternatives.add(escapeRegexUnicode(f)
            .replace(/[её]/g, '[её]')
            .replace(/[ЕЁ]/g, '[ЕЁ]')
            .replace(/\s+/g, '\\s+'));
    }
    const body = `(?:${[...alternatives].join('|')})`;
    const pattern = boundaries ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body;
    return `/${pattern}/${caseSensitive ? 'u' : 'iu'}`;
}

export function expandKey(key, opts) {
    try {
        if (!shouldExpand(key)) return null;
        const { forms } = getForms(key, opts);
        if (!forms.length) return null;
        const regex = buildRegex(forms, opts);
        return parseRegexFromString(regex) ? regex : null;
    } catch (e) {
        opts?.onError?.(e);
        return null;
    }
}

// Always assigns new arrays: on a world info cache miss ST hands out entries
// whose key arrays are shared with the cached lorebook.
export function rewriteEntryKeys(entry, expand) {
    let changed = 0;
    for (const field of ['key', 'keysecondary']) {
        const keys = entry?.[field];
        if (!Array.isArray(keys) || !keys.length) continue;
        let touched = false;
        const next = keys.map((k) => {
            const r = expand(k, entry);
            if (!r || r === k) return k;
            touched = true;
            changed++;
            return r;
        });
        if (touched) entry[field] = next;
    }
    return changed;
}
