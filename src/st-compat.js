// Copied from SillyTavern so that generated keys are parsed exactly like ST does.
// https://github.com/SillyTavern/SillyTavern/blob/ad29cbda62e92f145e44d7a10398a38af22ca986/public/scripts/world-info.js
// https://github.com/SillyTavern/SillyTavern/blob/ad29cbda62e92f145e44d7a10398a38af22ca986/public/scripts/utils.js

export function parseRegexFromString(input) {
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    let [, pattern, flags] = match;

    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }

    pattern = pattern.replace('\\/', '/');

    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}

export function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

// ST's escapeRegex turns "-" into "\-", which is a syntax error under the u flag.
export function escapeRegexUnicode(string) {
    return string.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
}
