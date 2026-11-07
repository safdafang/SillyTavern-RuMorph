import { CASES, CASE_FALLBACK, NUMBERS, addForms, newTable } from './paradigms.js';

const DECLINABLE_POS = new Set(['NOUN', 'ADJF', 'PRTF']);

// Az puts the parent grammeme into CAse (loc2 is reported as loct).
export function caseOf(tag) {
    if (tag.gen2) return 'gen2';
    if (tag.loc2) return 'loc2';
    if (tag.voct) return 'voct';
    return tag.CAse;
}

// az.min.js is a UMD bundle and cannot be imported as an ES module.
export function loadAzBrowser(scriptUrl) {
    const g = globalThis;
    if (g.Az?.Morph) return Promise.resolve(g.Az);
    if (!loadAzBrowser.pending) {
        loadAzBrowser.pending = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptUrl;
            script.async = true;
            script.onload = () => (g.Az?.Morph ? resolve(g.Az) : reject(new Error('window.Az is missing after loading Az.js')));
            script.onerror = () => reject(new Error(`Failed to load ${scriptUrl}`));
            document.head.appendChild(script);
        }).catch((e) => {
            loadAzBrowser.pending = null;
            throw e;
        });
    }
    return loadAzBrowser.pending;
}

export function initAz(Az, dictsPath) {
    return new Promise((resolve, reject) => {
        try {
            Az.Morph.init(dictsPath.replace(/\/+$/, ''), (err) => (err ? reject(err) : resolve()));
        } catch (e) {
            reject(e);
        }
    });
}

export class Morph {
    constructor(Az) {
        this.Az = Az;
        this.parseCache = new Map();
        this.paradigmCache = new Map();
    }

    parse(word) {
        const cached = this.parseCache.get(word);
        if (cached) return cached;
        let parses;
        try {
            parses = this.Az.Morph(word, { typos: 0, stutter: 0 }) || [];
        } catch {
            parses = [];
        }
        const out = parses.map((p) => {
            let lemma = '';
            try {
                lemma = String(p.normalize()?.word ?? '');
            } catch {
                // some guessed parses cannot be normalized
            }
            return {
                raw: p,
                dictionary: p.parser === 'Dictionary' && !p.stutterCnt && !p.typosCnt,
                score: Number(p.score) || 0,
                pos: p.tag?.POST,
                gender: p.tag?.GNdr,
                number: p.tag?.NMbr,
                case: p.tag?.CAse,
                anim: p.tag?.ANim,
                lemma,
                tag: String(p.tag),
            };
        });
        this.parseCache.set(word, out);
        return out;
    }

    paradigm(info) {
        const p = info.raw;
        const key = `${p.paradigmIdx}|${info.lemma}|${p.prefix ?? ''}|${p.parser}`;
        const cached = this.paradigmCache.get(key);
        if (cached) return cached;
        const out = [];
        const count = Number(p.formCnt) || 0;
        for (let i = 0; i < count; i++) {
            try {
                const f = p.inflect(i);
                if (f) out.push({ word: String(f).toLowerCase(), tag: f.tag });
            } catch {
                // skip forms Az cannot build
            }
        }
        if (!out.length) out.push({ word: String(p).toLowerCase(), tag: p.tag });
        this.paradigmCache.set(key, out);
        return out;
    }

    nounTable(info) {
        const table = newTable();
        // Name lexemes include patronymics (Гарри, Гарриевич).
        const patr = !!info.raw.tag?.Patr;
        for (const f of this.paradigm(info)) {
            if (f.tag.POST !== 'NOUN' || !!f.tag.Patr !== patr) continue;
            // Informal vocatives («Свет!», «Маш!») collide with common words.
            if (f.tag.voct && f.tag.Infr) continue;
            const c = caseOf(f.tag);
            const n = f.tag.NMbr;
            if (c && n) addForms(table, c, n, f.word);
        }
        return table;
    }

    #adjFilter(info) {
        const t = info.raw.tag;
        if (info.pos === 'PRTF') {
            return (tag) => tag.POST === 'PRTF' && tag.TEns === t.TEns && tag.VOic === t.VOic && tag.ASpc === t.ASpc;
        }
        // Superlatives share the paradigm with the positive degree.
        const supr = !!t.Supr;
        return (tag) => tag.POST === 'ADJF' && !!tag.Supr === supr;
    }

    adjForms(info) {
        const ok = this.#adjFilter(info);
        return [...new Set(this.paradigm(info).filter((f) => ok(f.tag)).map((f) => f.word))];
    }

    adjAgreeTable(info, { genders, anims }) {
        const ok = this.#adjFilter(info);
        const forms = this.paradigm(info).filter((f) => ok(f.tag));
        const table = newTable();
        for (const n of NUMBERS) {
            for (const c of CASES) {
                const cc = CASE_FALLBACK[c] ?? c;
                for (const { word, tag } of forms) {
                    if (tag.CAse !== cc || tag.NMbr !== n) continue;
                    if (n === 'sing' && !genders.includes(tag.GNdr)) continue;
                    if (tag.ANim && !anims.includes(tag.ANim)) continue;
                    addForms(table, c, n, word);
                }
            }
        }
        return table;
    }

    // True when `form` is the nominative of a different dictionary lexeme.
    isForeignWord(form, lemma) {
        const l = lemma.replace(/ё/g, 'е');
        return this.parse(form).some((p) => p.dictionary
            && p.lemma.toLowerCase().replace(/ё/g, 'е') !== l
            && (p.case === 'nomn' || !!p.raw.tag?.Fixd));
    }

    classify(word) {
        // Proper names are only found when capitalized.
        const lower = word.toLowerCase();
        const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
        let all = this.parse(word === lower || word === word.toUpperCase() ? lower : word);
        if (!all.some((p) => p.dictionary) && cap !== word) {
            const capParses = this.parse(cap);
            if (capParses.some((p) => p.dictionary)) all = capParses;
        }
        const dict = all.filter((p) => p.dictionary);
        const dictionary = dict.length > 0;
        const pool = dictionary ? dict : all;
        const isNomn = (p) => p.case === 'nomn' || (p.pos === 'NOUN' && p.raw.tag?.Fixd);
        let nouns = pool.filter((p) => p.pos === 'NOUN' && isNomn(p));
        let adjs = pool.filter((p) => (p.pos === 'ADJF' || p.pos === 'PRTF') && p.case === 'nomn');
        if (dictionary && !nouns.length && !adjs.length) {
            const max = Math.max(...dict.map((p) => p.score));
            const good = dict.filter((p) => DECLINABLE_POS.has(p.pos) && p.score >= max * 0.1);
            nouns = good.filter((p) => p.pos === 'NOUN');
            adjs = good.filter((p) => p.pos !== 'NOUN');
        }
        const best = dictionary ? dict.reduce((a, b) => (b.score > a.score ? b : a)) : null;
        return {
            dictionary,
            nouns,
            adjs,
            bestIsNomn: !!best && (best.case === 'nomn' || !!best.raw.tag?.Fixd),
        };
    }
}
