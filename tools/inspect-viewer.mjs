import fs from 'fs';

const path = process.argv[2] || 'node_modules/@playcanvas/splat-transform/dist/index.mjs';
const s = fs.readFileSync(path, 'utf8');

const markers = [
  'class CameraManager',
  "events.on('annotation.activate'",
  'class NavCursor',
  "events.on('pick'",
  'class OrbitController',
  'this.cameraManager = new CameraManager',
];

for (const m of markers) {
  const i = s.indexOf(m);
  console.log('\n===', m, 'at', i, '===');
  if (i >= 0) console.log(s.slice(i, i + 1200));
}
