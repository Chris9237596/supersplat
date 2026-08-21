import { readFileSync } from 'fs';
import { patchViewerBundle } from '../src/sca/export/patch-viewer-bundle.ts';

const source = readFileSync('node_modules/@playcanvas/supersplat-viewer/public/index.js', 'utf8');
const needle = `constructor(global, bbox, collision = null) {
        const { events, settings, state } = global;
        const walkAllowed = isWalkAllowed(bbox, collision);`;

console.log('includes', source.includes(needle));
patchViewerBundle(source);
console.log('patch ok');
