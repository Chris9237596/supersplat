import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(root, '../node_modules/@playcanvas/splat-transform/dist/cli.mjs');
const s = fs.readFileSync(cliPath, 'utf8');

// Find viewer JS: writeHtml encodes `index` variable - locate assignment before writeHtml
// Pattern in bundle: const index = "..."  or similar - search for annotationNav in JS
const navIdx = s.indexOf('annotationNav');
console.log('annotationNav in cli.mjs at:', navIdx);

// Walk backwards from writeHtml to find `index` string assignment used for JS
const writeHtmlIdx = s.indexOf('const writeHtml = async');
const beforeWriteHtml = s.slice(Math.max(0, writeHtmlIdx - 500000), writeHtmlIdx);

// Find last occurrence of a huge string assignment before writeHtml
const jsVarMatch = beforeWriteHtml.match(/const index\$3 = "([\s\S]{100,})"/);
if (jsVarMatch) {
    console.log('Found index$3 JS bundle, length:', jsVarMatch[1].length);
} else {
    // try finding var index = with import { main
    const patterns = ['index$3', 'index$4', 'const index = "\\nimport'];
    for (const p of patterns) {
        const idx = beforeWriteHtml.lastIndexOf(p);
        console.log(`Pattern "${p}" last at:`, idx);
    }
}

// Search all index$N variables
for (let n = 1; n <= 5; n++) {
    const marker = `var index$${n} = `;
    const idx = s.indexOf(marker);
    if (idx >= 0) {
        const end = s.indexOf('";', idx + marker.length + 5);
        const len = end > idx ? end - idx : 0;
        const preview = s.slice(idx + marker.length + 1, idx + marker.length + 80).replace(/\\n/g, ' ');
        console.log(`index$${n}: offset=${idx}, approxLen=${len}, preview="${preview.slice(0, 70)}..."`);
    }
}

const editorJsSize = fs.statSync(path.join(root, '../dist/index.js')).size;
console.log('\nEditor dist/index.js:', editorJsSize, 'bytes (~', (editorJsSize/1024/1024).toFixed(1), 'MB)');

// Check if editor bundle contains unique strings
const editorJs = fs.readFileSync(path.join(root, '../dist/index.js'), 'utf8');
console.log('Editor has registerSca:', editorJs.includes('registerSca'));
console.log('Editor has sca-panel:', editorJs.includes('sca-panel'));
console.log('Editor has annotationNav:', editorJs.includes('annotationNav'));

console.log('cli.mjs has registerSca:', s.includes('registerSca'));
console.log('cli.mjs has sca-panel:', s.includes('sca-panel'));

// Viewer JS bundle sits between index$2 (CSS) and index$1 (HTML)
const htmlVarMarker = 'var index$1 = ';
const cssVarMarker = 'var index$2 = ';
const htmlVarIdx = s.indexOf(htmlVarMarker);
const cssVarIdx = s.indexOf(cssVarMarker);
const between = s.slice(cssVarIdx, htmlVarIdx);
const jsVarIdx = between.indexOf('var index = ');
console.log('\n--- Viewer JS bundle (var index) ---');
if (jsVarIdx >= 0) {
    const rest = between.slice(jsVarIdx + 'var index = '.length);
    if (rest[0] === '"') {
        const end = rest.indexOf('";');
        console.log('Viewer JS bundle length:', end, 'chars (~', (end / 1024 / 1024).toFixed(2), 'MB)');
        console.log('Starts with:', rest.slice(1, 100).replace(/\\n/g, ' '));
        console.log('Contains export main:', rest.slice(1, end).includes('export') && rest.slice(1, end).includes('main'));
    }
}

console.log('\n--- Diagnostic rule ---');
console.log('If served index.js is ~9.5 MB → EDITOR bundle (export/serving bug or wrong folder)');
console.log('If served index.js is ~1-3 MB → VIEWER bundle (correct export)');
console.log('If served index.html title is "SuperSplat" → EDITOR html (wrong folder)');
console.log('If served index.html title is "SuperSplat Viewer" → VIEWER html (correct export)');

