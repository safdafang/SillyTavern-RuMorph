// Reports UI strings missing from i18n/ru-ru.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const keys = new Set();
const BT = String.fromCharCode(96);
const tagRe = new RegExp(String.raw`\bt${BT}((?:[^${BT}\\]|\\.)*)${BT}`, 'g');
for (const m of read('index.js').matchAll(tagRe)) {
    let i = 0;
    keys.add(m[1].replace(/\$\{[^}]*\}/g, () => '${' + i++ + '}'));
}
for (const f of ['templates/settings.html', 'templates/preview.html']) {
    for (const m of read(f).matchAll(/data-i18n="(?:\[[a-z]+\])?([^"]+)"/g)) keys.add(m[1]);
}

const ru = JSON.parse(read('i18n/ru-ru.json'));
const missing = [...keys].filter((k) => !(k in ru));
const unused = Object.keys(ru).filter((k) => !keys.has(k));
if (missing.length) console.log('Missing:\n' + missing.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
if (unused.length) console.log('Unused:\n' + unused.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
if (!missing.length && !unused.length) console.log(`OK: ${keys.size} strings translated.`);
process.exitCode = missing.length ? 1 : 0;
