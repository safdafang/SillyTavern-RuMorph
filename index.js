import { KeyCache } from './src/cache.js';
import { compileWorld, restoreWorld } from './src/compile.js';
import { buildRegex, getForms, normalizeKey, shouldExpand } from './src/expand.js';
import { acquireAz } from './src/loader.js';
import { Morph, initAz, loadAzBrowser } from './src/morph.js';
import { createLoreHandler, withTimeout } from './src/runtime.js';
import { parseRegexFromString } from './src/st-compat.js';

const MODULE = 'rumorph';
const LOG = '[RuMorph]';
const VERSION = '0.1.0';
const BASE_URL = new URL('.', import.meta.url);
// Works for both per-user (data/<user>/extensions) and global (third-party) installs.
const EXT_PATH = decodeURIComponent(new URL(import.meta.url).pathname)
    .match(/\/scripts\/extensions\/(.+)\/index\.js$/)?.[1] ?? 'third-party/SillyTavern-RuMorph';

const DEFAULTS = Object.freeze({
    enabled: true,
    minWordLength: 3,
    strictBoundaries: true,
    debug: false,
    overrides: {},
});

const ctx = () => SillyTavern.getContext();
const $id = (id) => document.getElementById(id);
const t = (strings, ...values) => {
    const tag = ctx().t;
    if (typeof tag === 'function') return tag(strings, ...values);
    return strings.reduce((acc, s, i) => acc + s + (i < values.length ? values[i] : ''), '');
};

const log = (...args) => console.log(LOG, ...args);
const debug = (...args) => {
    if (getSettings().debug) console.debug(LOG, ...args);
};

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE] || typeof extensionSettings[MODULE] !== 'object') {
        extensionSettings[MODULE] = structuredClone(DEFAULTS);
    }
    const s = extensionSettings[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (!(k in s)) s[k] = structuredClone(v);
    }
    if (!s.overrides || typeof s.overrides !== 'object') s.overrides = {};
    return s;
}

function save() {
    ctx().saveSettingsDebounced();
}

let morphPromise = null;
let morphState = 'idle';

function ensureMorph() {
    if (!morphPromise) {
        morphState = 'loading';
        updateStatus();
        const started = performance.now();
        // One Az per page, shared with RuInflect.
        const core = acquireAz({
            owner: 'RuMorph',
            load: async () => {
                const Az = await loadAzBrowser(new URL('vendor/az/az.min.js', BASE_URL).href);
                await initAz(Az, new URL('dicts', BASE_URL).href);
                log(`dictionaries loaded in ${Math.round(performance.now() - started)} ms`);
                return Az;
            },
        });
        morphPromise = core.promise.then((Az) => {
            morphState = 'ready';
            if (core.owner !== 'RuMorph') log(`dictionaries shared with ${core.owner}`);
            updateStatus();
            return new Morph(Az);
        }).catch((e) => {
            morphState = 'failed';
            morphPromise = null;
            console.error(LOG, 'failed to load Az.js', e);
            updateStatus();
            throw e;
        });
    }
    return morphPromise;
}

const cache = new KeyCache({ storage: SillyTavern.libs?.localforage ?? null });

// Global World Info settings, used when an entry has them set to "default".
function getGlobals() {
    return {
        caseSensitive: !!$id('world_info_case_sensitive')?.checked,
        matchWholeWords: !!$id('world_info_match_whole_words')?.checked,
    };
}

function flagsFor(entry) {
    const s = getSettings();
    const g = getGlobals();
    return {
        caseSensitive: (entry?.caseSensitive ?? g.caseSensitive) === true,
        boundaries: !!s.strictBoundaries || (entry?.matchWholeWords ?? g.matchWholeWords) === true,
        minWordLength: Number(s.minWordLength) || 3,
    };
}

const onEntriesLoaded = createLoreHandler({
    ensureMorph,
    getSettings,
    cache,
    getGlobals,
    timeoutMs: 5000,
    debug,
    onUnavailable: (e) => {
        console.warn(LOG, 'dictionaries are not ready, keys are used as is', e);
        toastr.warning(t`Russian dictionaries are still loading or failed to load. Lorebook keys are used as is for now.`, 'RuMorph');
    },
});

async function prewarmWorld(data) {
    const s = getSettings();
    if (!s.enabled || morphState !== 'ready' || !data?.entries) return;
    const morph = await ensureMorph();
    const entries = Object.values(data.entries);
    const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));
    let i = 0;
    const step = () => {
        for (const end = Math.min(i + 50, entries.length); i < end; i++) {
            const e = entries[i];
            for (const k of [...(e.key ?? []), ...(e.keysecondary ?? [])]) {
                if (shouldExpand(k)) cache.expand(k, flagsFor(e), { morph, overrides: s.overrides });
            }
        }
        if (i < entries.length) idle(step);
    };
    idle(step);
}

function getWorldNames() {
    const c = ctx();
    if (typeof c.getWorldInfoNames === 'function') return c.getWorldInfoNames();
    return [...document.querySelectorAll('#world_editor_select option')]
        .filter((o) => o.getAttribute('value') !== '')
        .map((o) => o.textContent?.trim())
        .filter(Boolean);
}

function refreshWorldSelect() {
    const select = $id('rumorph_world');
    if (!select) return;
    const current = select.value;
    select.replaceChildren(...getWorldNames().map((name) => new Option(name, name)));
    if ([...select.options].some((o) => o.value === current)) select.value = current;
}

async function reloadEditor(name) {
    try {
        ctx().reloadWorldInfoEditor?.(name, false);
    } catch (e) {
        debug('could not reload the World Info editor', e);
    }
}

async function onCompile() {
    const name = $id('rumorph_world').value;
    if (!name) return toastr.info(t`Select a lorebook first.`, 'RuMorph');
    const c = ctx();
    let morph;
    try {
        morph = await withTimeout(ensureMorph(), 30000);
    } catch {
        return toastr.error(t`Could not load the Russian dictionaries.`, 'RuMorph');
    }
    const data = await c.loadWorldInfo(name);
    if (!data?.entries) return toastr.error(t`Could not load the lorebook.`, 'RuMorph');
    const { overrides } = getSettings();
    // A compiled lorebook must work on its own, so boundaries are always on.
    const expand = (k, e) => (shouldExpand(k) ? cache.expand(k, { ...flagsFor(e), boundaries: true }, { morph, overrides }) : null);
    const { changed, total } = compileWorld(data, expand);
    if (!changed) return toastr.info(t`Nothing to compile: no Cyrillic keys or already compiled.`, 'RuMorph');
    const ok = await c.Popup.show.confirm(
        t`Compile lorebook «${name}»?`,
        t`${changed} of ${total} entries will get regex keys with all word forms. The original keys are kept and can be restored with the "Restore" button.`,
    );
    if (!ok) return;
    compileWorld(data, expand, { apply: true, version: VERSION });
    await c.saveWorldInfo(name, data, true);
    await reloadEditor(name);
    toastr.success(t`Compiled ${changed} entries.`, 'RuMorph');
}

async function onRestore() {
    const name = $id('rumorph_world').value;
    if (!name) return toastr.info(t`Select a lorebook first.`, 'RuMorph');
    const c = ctx();
    const data = await c.loadWorldInfo(name);
    if (!data?.entries) return toastr.error(t`Could not load the lorebook.`, 'RuMorph');
    const { restored } = restoreWorld(data);
    if (!restored) return toastr.info(t`This lorebook has no compiled entries.`, 'RuMorph');
    const ok = await c.Popup.show.confirm(t`Restore lorebook «${name}»?`, t`Original keys will be restored in ${restored} entries.`);
    if (!ok) return;
    restoreWorld(data, { apply: true });
    await c.saveWorldInfo(name, data, true);
    await reloadEditor(name);
    toastr.success(t`Restored ${restored} entries.`, 'RuMorph');
}

function sourceLabel(source) {
    return {
        dictionary: t`dictionary`,
        guess: t`guessed`,
        short: t`too short, not inflected`,
        latin: t`not Cyrillic`,
        override: t`manual: indeclinable`,
    }[source] ?? source;
}

function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

async function renderPreview() {
    const input = $id('rumorph_preview_key');
    const out = $id('rumorph_preview_out');
    if (!input || !out) return;
    const key = input.value.trim();
    loadHintEditor(key);
    out.classList.toggle('displayNone', !key);
    if (!key) return;

    const wordsEl = $id('rumorph_preview_words');
    const formsEl = $id('rumorph_preview_forms');
    const regexEl = $id('rumorph_preview_regex');
    if (!shouldExpand(key)) {
        wordsEl.textContent = t`This key is left unchanged (regex, macro, or no Cyrillic letters).`;
        formsEl.replaceChildren();
        regexEl.textContent = key;
        testPhrase();
        return;
    }

    let morph;
    try {
        wordsEl.textContent = t`Loading dictionaries…`;
        morph = await withTimeout(ensureMorph(), 30000);
    } catch {
        wordsEl.textContent = t`Could not load the Russian dictionaries.`;
        return;
    }
    if (input.value.trim() !== key) return;

    const s = getSettings();
    const { forms, words } = getForms(key, { morph, minWordLength: Number(s.minWordLength) || 3, overrides: s.overrides });
    wordsEl.replaceChildren(...words.map((w) => {
        const role = w.role && w.role !== 'single' ? ` · ${w.role}` : '';
        const span = element('span', `rumorph-word rumorph-src-${w.source}`, `${w.text}: ${sourceLabel(w.source)}${role}`);
        span.title = (w.types ?? []).join('\n');
        return span;
    }));
    formsEl.replaceChildren(...forms.map((f) => element('span', 'rumorph-chip', f)));
    $id('rumorph_preview_count').textContent = String(forms.length);
    regexEl.textContent = buildRegex(forms);
    testPhrase();
}

function testPhrase() {
    const phrase = $id('rumorph_test_phrase')?.value ?? '';
    const result = $id('rumorph_test_result');
    const regexText = $id('rumorph_preview_regex')?.textContent ?? '';
    if (!result) return;
    result.replaceChildren();
    if (!phrase) return;

    const parsed = parseRegexFromString(regexText);
    if (!parsed) {
        result.textContent = phrase.toLowerCase().includes(regexText.toLowerCase()) ? t`✔ matches` : t`✘ no match`;
        return;
    }
    const re = new RegExp(parsed.source, parsed.flags + 'g');
    let last = 0;
    let found = false;
    for (const m of phrase.matchAll(re)) {
        if (!m[0]) break;
        found = true;
        result.append(phrase.slice(last, m.index), element('mark', '', m[0]));
        last = m.index + m[0].length;
    }
    result.append(phrase.slice(last), element('span', found ? 'rumorph-yes' : 'rumorph-no', ` ${found ? t`✔ matches` : t`✘ no match`}`));
}

const splitList = (v) => String(v || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function loadHintEditor(key) {
    const box = $id('rumorph_override_box');
    if (!box) return;
    const target = normalizeKey(key);
    box.classList.toggle('displayNone', !target);
    $id('rumorph_override_target').textContent = target;
    const o = getSettings().overrides[target] ?? {};
    $id('rumorph_ov_gender').value = o.gender ?? '';
    $id('rumorph_ov_indecl').checked = !!o.indeclinable;
    $id('rumorph_ov_extra').value = (o.extraForms ?? []).join(', ');
    $id('rumorph_ov_exclude').value = (o.excludeForms ?? []).join(', ');
}

function onHintsChanged() {
    cache.invalidateHot();
    save();
    renderHintList();
    renderPreview();
}

function saveHint() {
    const target = normalizeKey($id('rumorph_preview_key').value);
    if (!target) return;
    const hint = {
        gender: $id('rumorph_ov_gender').value || null,
        indeclinable: $id('rumorph_ov_indecl').checked,
        extraForms: splitList($id('rumorph_ov_extra').value),
        excludeForms: splitList($id('rumorph_ov_exclude').value),
    };
    const { overrides } = getSettings();
    if (hint.gender || hint.indeclinable || hint.extraForms.length || hint.excludeForms.length) overrides[target] = hint;
    else delete overrides[target];
    onHintsChanged();
    toastr.success(t`Hint saved for «${target}».`, 'RuMorph');
}

function deleteHint(target) {
    const { overrides } = getSettings();
    if (!(target in overrides)) return;
    delete overrides[target];
    onHintsChanged();
}

function renderHintList() {
    const list = $id('rumorph_override_list');
    if (!list) return;
    const genders = { m: t`masc.`, f: t`fem.`, n: t`neut.` };
    const rows = Object.entries(getSettings().overrides).sort(([a], [b]) => (a < b ? -1 : 1));
    list.replaceChildren(...rows.map(([word, o]) => {
        const link = element('a', '', word);
        link.href = '#';
        link.addEventListener('click', (ev) => {
            ev.preventDefault();
            $id('rumorph_preview_key').value = word;
            renderPreview();
        });
        const parts = [];
        if (o.gender) parts.push(genders[o.gender] ?? o.gender);
        if (o.indeclinable) parts.push(t`indeclinable`);
        if (o.extraForms?.length) parts.push(`+${o.extraForms.length}`);
        if (o.excludeForms?.length) parts.push(`−${o.excludeForms.length}`);
        const remove = element('i', 'fa-solid fa-trash-can menu_button rumorph-ov-del');
        remove.title = t`Delete hint`;
        remove.addEventListener('click', () => deleteHint(word));
        const row = element('div', 'rumorph-ov-row');
        row.append(link, element('small', '', ` ${parts.join(', ')}`), remove);
        return row;
    }));
}

function updateStatus() {
    const el = $id('rumorph_status');
    if (!el) return;
    const state = {
        idle: t`dictionaries not loaded yet`,
        loading: t`loading dictionaries…`,
        ready: t`dictionaries loaded`,
        failed: t`failed to load dictionaries`,
    }[morphState];
    el.textContent = `${state} · ${t`cache`}: ${cache.size}`;
}

function bindCheckbox(id, setting, after) {
    const s = getSettings();
    $id(id).checked = !!s[setting];
    $id(id).addEventListener('change', (e) => {
        s[setting] = e.target.checked;
        save();
        after?.();
    });
}

async function addSettingsUi() {
    const { renderExtensionTemplateAsync } = ctx();
    const wrapper = element('div');
    wrapper.id = 'rumorph_container';
    wrapper.innerHTML = await renderExtensionTemplateAsync(EXT_PATH, 'templates/settings');
    ($id('extensions_settings2') ?? $id('extensions_settings')).appendChild(wrapper);
    $id('rumorph_preview_slot').innerHTML = await renderExtensionTemplateAsync(EXT_PATH, 'templates/preview');

    const s = getSettings();
    const reportError = (e) => {
        console.error(LOG, e);
        toastr.error(String(e), 'RuMorph');
    };

    bindCheckbox('rumorph_enabled', 'enabled', () => s.enabled && ensureMorph().catch(() => {}));
    bindCheckbox('rumorph_strict', 'strictBoundaries', () => cache.invalidateHot());
    bindCheckbox('rumorph_debug', 'debug');

    $id('rumorph_min_len').value = String(s.minWordLength);
    $id('rumorph_min_len').addEventListener('change', (e) => {
        s.minWordLength = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 3));
        e.target.value = String(s.minWordLength);
        cache.invalidateHot();
        save();
        renderPreview();
    });

    $id('rumorph_clear_cache').addEventListener('click', async () => {
        await cache.clear();
        updateStatus();
        toastr.info(t`Cache cleared.`, 'RuMorph');
    });
    $id('rumorph_world').addEventListener('focus', refreshWorldSelect);
    $id('rumorph_refresh_worlds').addEventListener('click', refreshWorldSelect);
    $id('rumorph_compile').addEventListener('click', () => onCompile().catch(reportError));
    $id('rumorph_restore').addEventListener('click', () => onRestore().catch(reportError));

    let typing = null;
    $id('rumorph_preview_key').addEventListener('input', () => {
        clearTimeout(typing);
        typing = setTimeout(renderPreview, 250);
    });
    $id('rumorph_test_phrase').addEventListener('input', testPhrase);
    $id('rumorph_ov_save').addEventListener('click', saveHint);
    $id('rumorph_ov_delete').addEventListener('click', () => deleteHint(normalizeKey($id('rumorph_preview_key').value)));
    $id('rumorph_copy_regex').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($id('rumorph_preview_regex').textContent ?? '');
            toastr.info(t`Copied.`, 'RuMorph');
        } catch {
            // clipboard is unavailable on plain http
        }
    });

    refreshWorldSelect();
    renderHintList();
    updateStatus();
}

function registerSlashCommand() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rumorph',
        helpString: t`Shows the word forms (or the regex) RuMorph generates for a lorebook key. Example: /rumorph Морвенна`,
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: t`lorebook key`,
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'format',
                description: t`forms (default), regex or json`,
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'forms',
                enumList: ['forms', 'regex', 'json'],
            }),
        ],
        returns: ARGUMENT_TYPE.STRING,
        callback: async (args, value) => {
            const key = String(value ?? '').trim();
            if (!key || !shouldExpand(key)) return key;
            const morph = await withTimeout(ensureMorph(), 30000);
            const s = getSettings();
            const { forms, words } = getForms(key, { morph, minWordLength: Number(s.minWordLength) || 3, overrides: s.overrides });
            const regex = buildRegex(forms);
            switch (String(args?.format ?? 'forms')) {
                case 'regex':
                    return regex;
                case 'json':
                    return JSON.stringify({ key, forms, regex, words: words.map(({ text, source, role }) => ({ text, source, role })) });
                default:
                    return forms.join(', ');
            }
        },
    }));
}

jQuery(async () => {
    const c = ctx();
    try {
        await addSettingsUi();
    } catch (e) {
        console.error(LOG, 'could not build the settings panel', e);
    }
    try {
        registerSlashCommand();
    } catch (e) {
        console.error(LOG, 'could not register /rumorph', e);
    }

    c.eventSource.on(c.event_types.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
    c.eventSource.on(c.event_types.WORLDINFO_UPDATED, (_name, data) => {
        prewarmWorld(data).catch((e) => debug('prewarm failed', e));
        refreshWorldSelect();
    });

    await cache.load();
    updateStatus();
    if (getSettings().enabled) ensureMorph().catch(() => {});
    log(`v${VERSION} loaded from ${EXT_PATH}`);
});
