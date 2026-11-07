import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Morph, initAz } from '../src/morph.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));

let morphPromise = null;

// Uses the vendored Az.js and dictionaries, the same files users get.
export function getMorph() {
    if (!morphPromise) {
        morphPromise = (async () => {
            const Az = require(path.join(root, 'vendor/az/az.min.js'));
            await initAz(Az, path.join(root, 'dicts'));
            return new Morph(Az);
        })();
    }
    return morphPromise;
}
