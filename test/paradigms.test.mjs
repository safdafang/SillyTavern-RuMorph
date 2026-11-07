import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessParadigms, tableForms, slotKey } from '../src/paradigms.js';

const forms = (w, h) => tableForms(guessParadigms(w, h).table);
const slot = (w, c, n, h) => [...(guessParadigms(w, h).table.get(slotKey(c, n)) ?? [])];
const has = (w, list, h) => {
    const f = forms(w, h);
    for (const x of list) assert.ok(f.includes(x), `${w}: missing ${x} in [${f.join(', ')}]`);
};
const hasNot = (w, list, h) => {
    const f = forms(w, h);
    for (const x of list) assert.ok(!f.includes(x), `${w}: unexpected ${x}`);
};

test('consonant: masculine, surname type and indeclinable', () => {
    has('элдрин', ['элдрина', 'элдрину', 'элдрином', 'элдрине', 'элдрины', 'элдринов', 'элдринам', 'элдринами', 'элдринах']);
    has('элдрин', ['элдриным', 'элдриных', 'элдриными']);
    hasNot('элдрин', ['элдринка', 'элдрином-']);
    assert.ok(guessParadigms('элдрин').types.includes('indeclinable'));
});

test('surname type only for possessive suffixes', () => {
    hasNot('торак', ['тораким', 'торакых']);
    has('торак', ['торака', 'тораком', 'тораки']);
});

test('consonant with gender f is indeclinable', () => {
    assert.deepEqual(forms('элдрин', { gender: 'f' }), ['элдрин']);
});

test('consonant with gender m has no indeclinable reading', () => {
    assert.ok(!guessParadigms('элдрин', { gender: 'm' }).types.includes('indeclinable'));
    assert.deepEqual(slot('элдрин', 'datv', 'sing', { gender: 'm' }), ['элдрину']);
});

test('hushing consonants: и instead of ы, ей in gen. pl., ом/ем', () => {
    has('коваш', ['коваши', 'ковашей', 'ковашом', 'ковашем']);
    hasNot('коваш', ['ковашы']);
    has('тарец', ['тарцы', 'тарцом', 'тарцем', 'тарца']);
});

test('-а: first declension with -ою and zero genitive plural', () => {
    has('морвенна', ['морвенны', 'морвенне', 'морвенну', 'морвенной', 'морвенною', 'морвенн', 'морвеннам', 'морвеннами', 'морвеннах']);
    hasNot('морвенна', ['морвенный', 'морвенном']);
});

test('-а after hushing/velar consonants', () => {
    has('миша', ['миши', 'мишей', 'мишею', 'мишой']);
    has('лирка', ['лирки']);
    hasNot('лирка', ['лиркы']);
});

test('-ия: Марии, Марию, Марией', () => {
    has('мирия', ['мирии', 'мирию', 'мирией', 'мириею', 'мирий', 'мириям']);
    assert.deepEqual(slot('мирия', 'datv', 'sing'), ['мирии']);
});

test('-я after a vowel and after a consonant', () => {
    has('лея', ['леи', 'лее', 'лею', 'леей', 'лей']);
    has('таня', ['тани', 'тане', 'таню', 'таней', 'тань']);
});

test('-ь: masculine and feminine 3rd declension, narrowed by gender', () => {
    has('каэль', ['каэля', 'каэлю', 'каэлем', 'каэле', 'каэли', 'каэлью', 'каэлей']);
    hasNot('каэль', ['каэлью'], { gender: 'm' });
    hasNot('каэль', ['каэлем', 'каэля'], { gender: 'f' });
});

test('-й and -ий', () => {
    has('тарвей', ['тарвея', 'тарвею', 'тарвеем', 'тарвее', 'тарвеи', 'тарвеев']);
    assert.ok(slot('арий', 'loct', 'sing').includes('арии'));
});

test('vowel endings are indeclinable', () => {
    for (const w of ['эльдорадо', 'кали', 'шиту', 'сюзю', 'рене', 'бонэ']) assert.deepEqual(forms(w), [w], w);
});

test('adjectival names decline as adjectives', () => {
    has('зеленоглазая', ['зеленоглазой', 'зеленоглазую', 'зеленоглазою', 'зеленоглазые', 'зеленоглазых']);
    has('мудрый', ['мудрого', 'мудрому', 'мудрым', 'мудром', 'мудрые']);
    has('синий', ['синего', 'синему', 'синим', 'синем', 'синие', 'синих']);
});

test('indeclinable hint and latin input', () => {
    assert.deepEqual(forms('морвенна', { indeclinable: true }), ['морвенна']);
    assert.deepEqual(forms('excalibur'), ['excalibur']);
});
