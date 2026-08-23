import fs from 'node:fs';

import { Mat4 } from 'playcanvas';

import { buildEffectiveRigWorldMatrixFromPose } from '../src/sca/rig/rig-hierarchy';
import { evaluateRigPose } from '../src/sca/rig/rig-pose';
import { matrixMaxAbsError } from '../src/sca/rig/rig-transform';
import { stringifyProjectJson } from '../src/sca/serialize/project-json';
import { HotspotStore } from '../src/sca/store/hotspot-store';

const projectPath = process.argv[2];
const regionId = process.argv[3] ?? 'region_06';

if (!projectPath) {
    console.error('Usage: npx tsx tools/rebind-region-at-rest.ts <project.json> [regionId]');
    process.exit(1);
}

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const store = new HotspotStore(project);
store.rebindRegionAtAuthoredRest(regionId);

const updated = store.getProject();
const rig = updated.rig!;
const binding = rig.bindings.find((entry) => entry.regionId === regionId);
if (!binding) {
    throw new Error(`binding not found for ${regionId}`);
}

const node = rig.nodes.find((entry) => entry.id === binding.nodeId);
if (!node) {
    throw new Error(`node not found for ${binding.nodeId}`);
}

const effectiveAtAuthoredRest = buildEffectiveRigWorldMatrixFromPose(
    rig,
    evaluateRigPose(rig),
    node,
    binding,
    new Mat4()
);
const identityError = matrixMaxAbsError(effectiveAtAuthoredRest, new Mat4());

console.log('regionId:', regionId);
console.log('nodeId:', binding.nodeId);
console.log('bindMode:', binding.bindMode);
console.log('bindOffsetMatrix:', JSON.stringify(binding.bindOffsetMatrix));
console.log('bindOffset:', JSON.stringify(binding.bindOffset));
console.log('effectiveRigMatrix error vs identity at authored rest:', identityError);

fs.writeFileSync(projectPath, `${stringifyProjectJson(updated, true)}\n`, 'utf8');
console.log('Updated:', projectPath);
