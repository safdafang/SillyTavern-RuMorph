// Shared with RuInflect, keep both copies identical.
// https://github.com/safdafang/SillyTavern-RuInflect/blob/main/src/core/loader.js

export const CORE_KEY = '__ruMorphCore';
export const CORE_PROTOCOL = 1;
export const AZ_VERSION = '0.2.3';

export function acquireAz({ owner, load, global = globalThis }) {
    const existing = global[CORE_KEY];
    if (existing && existing.protocol === CORE_PROTOCOL && existing.state !== 'failed' && existing.promise) {
        if (!existing.users.includes(owner)) existing.users.push(owner);
        return existing;
    }
    const core = {
        protocol: CORE_PROTOCOL,
        azVersion: AZ_VERSION,
        owner,
        users: [owner],
        state: 'loading',
        Az: null,
        promise: null,
    };
    // Published before load() runs, so a second caller in the same tick finds it.
    global[CORE_KEY] = core;
    core.promise = Promise.resolve().then(load).then((Az) => {
        core.Az = Az;
        core.state = 'ready';
        return Az;
    }, (e) => {
        core.state = 'failed';
        if (global[CORE_KEY] === core) delete global[CORE_KEY];
        throw e;
    });
    return core;
}

export function peekAz(global = globalThis) {
    const core = global[CORE_KEY];
    return core?.protocol === CORE_PROTOCOL && core.state === 'ready' ? core.Az : null;
}
