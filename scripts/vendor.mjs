// Copies Az.js and its dictionaries from node_modules: npm install && npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const az = path.join(root, 'node_modules', 'az');
const pkg = JSON.parse(fs.readFileSync(path.join(az, 'package.json'), 'utf8'));

fs.mkdirSync(path.join(root, 'vendor', 'az'), { recursive: true });
fs.mkdirSync(path.join(root, 'dicts'), { recursive: true });

// The source map is not shipped.
const min = fs.readFileSync(path.join(az, 'dist', 'az.min.js'), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/m, '\n');
fs.writeFileSync(path.join(root, 'vendor', 'az', 'az.min.js'), `/*! Az.js v${pkg.version} | MIT License | (c) Denis Olshin | https://github.com/deNULL/Az.js */\n${min}`);
fs.writeFileSync(path.join(root, 'vendor', 'az', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

const files = [
    'words.dawg', 'prediction-suffixes-0.dawg', 'prediction-suffixes-1.dawg', 'prediction-suffixes-2.dawg',
    'p_t_given_w.intdawg', 'grammemes.json', 'gramtab-opencorpora-int.json', 'gramtab-opencorpora-ext.json',
    'suffixes.json', 'paradigms.array', 'meta.json',
];
for (const f of files) fs.copyFileSync(path.join(az, 'dicts', f), path.join(root, 'dicts', f));
console.log(`Vendored az@${pkg.version} and ${files.length} dictionary files.`);
