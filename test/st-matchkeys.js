// WorldInfoBuffer.matchKeys and #transformString copied from SillyTavern.
// https://github.com/SillyTavern/SillyTavern/blob/ad29cbda62e92f145e44d7a10398a38af22ca986/public/scripts/world-info.js#L268-L366
// Only the module globals world_info_case_sensitive and world_info_match_whole_words
// became constructor options.

import { escapeRegex, parseRegexFromString } from '../src/st-compat.js';

export class WorldInfoBufferStub {
    constructor({ caseSensitive = false, matchWholeWords = false } = {}) {
        this.world_info_case_sensitive = caseSensitive;
        this.world_info_match_whole_words = matchWholeWords;
    }

    #transformString(str, entry) {
        const caseSensitive = entry.caseSensitive ?? this.world_info_case_sensitive;
        return caseSensitive ? str : str.toLowerCase();
    }

    /**
     * Matches the given string against the buffer.
     * @param {string} haystack The string to search in
     * @param {string} needle The string to search for
     * @param {object} entry The entry that triggered the scan
     * @returns {boolean} True if the string was found in the buffer
     */
    matchKeys(haystack, needle, entry) {
        // If the needle is a regex, we do regex pattern matching and override all the other options
        const keyRegex = parseRegexFromString(needle);
        if (keyRegex) {
            return keyRegex.test(haystack);
        }

        // Otherwise we do normal matching of plaintext with the chosen entry settings
        haystack = this.#transformString(haystack, entry);
        const transformedString = this.#transformString(needle, entry);
        const matchWholeWords = entry.matchWholeWords ?? this.world_info_match_whole_words;

        if (matchWholeWords) {
            const keyWords = transformedString.split(/\s+/);

            if (keyWords.length > 1) {
                return haystack.includes(transformedString);
            } else {
                // Use custom boundaries to include punctuation and other non-alphanumeric characters
                const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`);
                if (regex.test(haystack)) {
                    return true;
                }
            }
        } else {
            return haystack.includes(transformedString);
        }

        return false;
    }

    // Primary key loop of checkWorldInfo, without substituteParams.
    entryMatches(text, entry) {
        return entry.key.some((key) => key && this.matchKeys(text, key.trim(), entry));
    }
}
