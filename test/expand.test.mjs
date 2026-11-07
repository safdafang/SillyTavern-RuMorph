import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegex, expandKey, getForms, normalizeKey, rewriteEntryKeys, shouldExpand } from '../src/expand.js';
import { parseRegexFromString } from '../src/st-compat.js';
import { WorldInfoBufferStub } from './st-matchkeys.js';
import { getMorph } from './helpers.mjs';

const morph = await getMorph();
const buffer = new WorldInfoBufferStub();

function matcher(key, entry = {}, opts = {}) {
    const regex = expandKey(key, { morph, caseSensitive: entry.caseSensitive === true, boundaries: true, ...opts });
    const needle = regex ?? key;
    return { regex, match: (text) => buffer.matchKeys(text, needle, entry) };
}

const TABLE = [
    { key: 'кот', yes: ['кот спит', 'с котом', 'котов', 'Кот!'], no: ['котлета', 'скот', 'котёнок'] },
    { key: 'дракон', yes: ['драконом', 'о драконе', 'драконы'], no: ['драконовский'] },
    { key: 'тёмный лес', yes: ['в тёмном лесу', 'темного леса', 'Тёмный  лес'], no: ['тёмный лесник'] },
    { key: 'Морвенна', yes: ['Морвенне', 'Морвенну', 'Морвенной', 'Морвенною', 'Я подошёл к Морвенне'], no: ['Морвенный'] },
    { key: 'Элдрин', yes: ['Элдрином', 'Элдрина', 'Элдрину'], no: ['Элдринка'] },
    { key: 'Мария', yes: ['Марии', 'Марию', 'Марией'], no: [] },
    { key: 'Орден Серебряного Клинка', yes: ['Ордену Серебряного Клинка'], no: [] },
    { key: 'Эльдорадо', yes: ['в Эльдорадо'], no: [] },
];

for (const row of TABLE) {
    test(`key «${row.key}» through ST matchKeys`, () => {
        const { regex, match } = matcher(row.key);
        assert.ok(regex, 'key must be expanded');
        for (const t of row.yes) assert.ok(match(t), `«${row.key}» should match «${t}»; regex: ${regex}`);
        for (const t of row.no) assert.ok(!match(t), `«${row.key}» must NOT match «${t}»; regex: ${regex}`);
    });
}

test('regex keys are left unchanged', () => {
    assert.equal(shouldExpand('/драк.н/i'), false);
    assert.equal(expandKey('/драк.н/i', { morph }), null);
});

test('keys with macros are left unchanged', () => {
    assert.equal(expandKey('{{char}}', { morph }), null);
    assert.equal(expandKey('друг {{user}}', { morph }), null);
});

test('latin / numeric / empty keys are left unchanged', () => {
    for (const k of ['Excalibur', '42', '', '   ']) assert.equal(expandKey(k, { morph }), null, k);
});

test('override gender "f" for Элдрин removes masculine forms', () => {
    const overrides = { 'элдрин': { gender: 'f', indeclinable: false, extraForms: [], excludeForms: [] } };
    const { forms } = getForms('Элдрин', { morph, overrides });
    assert.deepEqual(forms, ['Элдрин']);
    const { match } = matcher('Элдрин', {}, { overrides });
    assert.ok(match('с Элдрин'));
    assert.ok(!match('с Элдрином'));
});

test('override indeclinable / extraForms / excludeForms', () => {
    assert.deepEqual(getForms('Морвенна', { morph, overrides: { 'морвенна': { indeclinable: true } } }).forms, ['Морвенна']);
    const f = getForms('Морвенна', { morph, overrides: { 'морвенна': { extraForms: ['Морви'], excludeForms: ['Морвенн'] } } }).forms;
    assert.ok(f.includes('Морви'));
    assert.ok(!f.includes('Морвенн'));
});

test('caseSensitive entry does not get the i flag', () => {
    const r = expandKey('Морвенна', { morph, caseSensitive: true });
    assert.match(r, /\/u$/);
    const re = parseRegexFromString(r);
    assert.ok(re.test('к Морвенне'));
    assert.ok(!re.test('к морвенне'));
    const ri = expandKey('Морвенна', { morph, caseSensitive: false });
    assert.match(ri, /\/iu$/);
});

test('generated regex is parsable by ST and never has the g flag', () => {
    for (const k of ['кот', 'тёмный лес', 'Морвенна', 'Жан-Поль', 'Кира Морвенна', 'кот/кошка', 'Сэр (Рыцарь)', 'ум']) {
        const r = expandKey(k, { morph });
        assert.ok(r, k);
        const re = parseRegexFromString(r);
        assert.ok(re, `${k}: ${r}`);
        assert.ok(!re.flags.includes('g'), k);
        assert.ok(re.flags.includes('u'), k);
    }
});

test('hyphenated keys (ST escapeRegex would break the u flag)', () => {
    const { match, regex } = matcher('Жан-Поль');
    assert.ok(match('с Жан-Полем'), regex);
    assert.ok(match('Жан-Поль'), regex);
});

test('special characters in keys are escaped', () => {
    const { match } = matcher('кот/кошка');
    assert.ok(match('кот/кошка'));
    assert.ok(!match('котXкошка'));
});

test('short words are not inflected but get word boundaries', () => {
    const { regex, match } = matcher('ум');
    assert.ok(regex);
    assert.ok(match('острый ум'));
    assert.ok(!match('умный'));
    assert.ok(!match('ума'));
});

test('ё/е are interchangeable', () => {
    const { match } = matcher('тёмный лес');
    assert.ok(match('в темном лесу'));
    const { match: m2 } = matcher('темный лес');
    assert.ok(m2('в тёмном лесу'));
});

test('multi-word: name chain declines every word in the same case', () => {
    const { forms } = getForms('Кира Морвенна', { morph });
    for (const f of ['Киры Морвенны', 'Кире Морвенне', 'Киру Морвенну', 'Кирой Морвенной']) assert.ok(forms.includes(f), f);
});

test('multi-word: adjective agrees by gender/number/animacy', () => {
    const { forms } = getForms('тёмный лес', { morph });
    assert.ok(forms.includes('тёмный лес'));
    assert.ok(!forms.includes('тёмного лес'));
    const anim = getForms('чёрный кот', { morph }).forms;
    assert.ok(anim.includes('чёрного кота'));
    assert.ok(!anim.includes('чёрного кот'));
});

test('multi-word: dependent genitive stays frozen', () => {
    const { forms } = getForms('Орден Серебряного Клинка', { morph });
    assert.ok(forms.includes('Ордену Серебряного Клинка'));
    assert.ok(!forms.some((f) => f.includes('Серебряному')));
});

test('proper-name homonym guard: «Света» does not produce «свет»', () => {
    const { match } = matcher('Света');
    assert.ok(match('со Светой'));
    assert.ok(!match('яркий свет'));
});

test('strict boundaries off → plain alternation (substring semantics)', () => {
    const r = expandKey('кот', { morph, boundaries: false });
    assert.ok(!r.includes('(?<!'));
    assert.ok(parseRegexFromString(r).test('котлета'));
});

test('determinism: same input → identical output', () => {
    const keys = ['кот', 'тёмный лес', 'Морвенна', 'Орден Серебряного Клинка', 'Кира Морвенна'];
    const a = keys.map((k) => expandKey(k, { morph }));
    const b = keys.map((k) => expandKey(k, { morph }));
    assert.deepEqual(a, b);
});

test('buildRegex sorts by length, dedupes and folds ё', () => {
    const r = buildRegex(['кот', 'котом', 'кот', 'тёмный', 'темный']);
    assert.equal(r, '/(?<![\\p{L}\\p{N}])(?:т[её]мный|котом|кот)(?![\\p{L}\\p{N}])/iu');
});

test('normalizeKey', () => {
    assert.equal(normalizeKey('  Тёмный   Лес '), 'темный лес');
});

test('rewriteEntryKeys assigns new arrays and keeps non-expandable keys', () => {
    const original = ['кот', '/x/i', 'Excalibur'];
    const entry = { key: original, keysecondary: [] };
    const n = rewriteEntryKeys(entry, (k) => expandKey(k, { morph }));
    assert.equal(n, 1);
    assert.notEqual(entry.key, original);
    assert.deepEqual(original, ['кот', '/x/i', 'Excalibur']);
    assert.equal(entry.key[1], '/x/i');
    assert.equal(entry.key[2], 'Excalibur');
});
