// Compiled entries keep their original keys in entry.extensions.rumorph.
// ST saves unknown entry fields as is and copies `extensions` into embedded
// character books, so the originals survive export and import.

export const COMPILE_MARK = 'rumorph';

export function getOriginalKeys(entry) {
    const o = entry?.extensions?.[COMPILE_MARK]?.originalKeys;
    if (!o || !Array.isArray(o.key)) return null;
    return { key: [...o.key], keysecondary: Array.isArray(o.keysecondary) ? [...o.keysecondary] : [] };
}

// Already compiled entries are rebuilt from their originals, so new hints apply.
// Without `apply` nothing is modified and only the count is returned.
export function compileWorld(data, expand, { apply = false, version = '' } = {}) {
    let changed = 0;
    let total = 0;
    for (const entry of Object.values(data?.entries ?? {})) {
        if (!entry || typeof entry !== 'object') continue;
        total++;
        const originals = getOriginalKeys(entry) ?? {
            key: Array.isArray(entry.key) ? [...entry.key] : [],
            keysecondary: Array.isArray(entry.keysecondary) ? [...entry.keysecondary] : [],
        };
        const source = { ...entry, ...originals };
        const key = originals.key.map((k) => expand(k, source) ?? k);
        const keysecondary = originals.keysecondary.map((k) => expand(k, source) ?? k);
        const expanded = key.some((k, i) => k !== originals.key[i]) || keysecondary.some((k, i) => k !== originals.keysecondary[i]);
        const differs = JSON.stringify([key, keysecondary]) !== JSON.stringify([entry.key ?? [], entry.keysecondary ?? []]);
        if (!expanded || !differs) continue;
        changed++;
        if (!apply) continue;

        const hadExtensions = !!entry.extensions && typeof entry.extensions === 'object';
        entry.extensions = {
            ...(hadExtensions ? entry.extensions : {}),
            [COMPILE_MARK]: {
                originalKeys: originals,
                createdExtensions: hadExtensions ? !!entry.extensions[COMPILE_MARK]?.createdExtensions : true,
                version,
            },
        };
        entry.key = key;
        entry.keysecondary = keysecondary;
    }
    return { changed, total };
}

export function restoreWorld(data, { apply = false } = {}) {
    let restored = 0;
    for (const entry of Object.values(data?.entries ?? {})) {
        const originals = getOriginalKeys(entry);
        if (!originals) continue;
        restored++;
        if (!apply) continue;
        const created = !!entry.extensions[COMPILE_MARK].createdExtensions;
        entry.key = originals.key;
        entry.keysecondary = originals.keysecondary;
        delete entry.extensions[COMPILE_MARK];
        if (created && !Object.keys(entry.extensions).length) delete entry.extensions;
    }
    return { restored };
}
