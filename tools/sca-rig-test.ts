import { strict as assert } from 'node:assert';

import { Events } from '../src/events';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { generateRigId } from '../src/sca/ids/generate-rig-id';
import { createDefaultRigNode, normalizeRig } from '../src/sca/rig/rig-defaults';
import { buildRigidRigMatrix, isZeroRigTransform } from '../src/sca/rig/rig-transform';
import {
    deserializeSsprojScaBlock,
    serializeSsprojScaBlock
} from '../src/sca/persistence/sca-project-persistence';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject, ScaProject, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import { stringifyProjectJson } from '../src/sca/serialize/project-json';
import { normalizeProject } from '../src/sca/viewer/viewer-config';

const sampleProject = (): ScaProject => ({
    version: SCA_PROJECT_VERSION,
    hotspots: [],
    regions: [{
        id: 'region_01',
        name: 'Region A',
        enabled: true,
        source: {
            type: 'gaussian-mask',
            scaSplatId: 'splat_01',
            maskAsset: 'sca/regions/region_01.mask'
        },
        capture: { gaussianCount: 10 },
        interaction: { clickable: true },
        visual: {
            hoverTint: '#ff6600',
            hoverOpacity: 0.35,
            activeTint: '#ff6600',
            activeOpacity: 0.55
        }
    }]
});

const runNormalizationTests = () => {
    const normalized = normalizeRig({
        version: 1,
        nodes: [{
            id: 'rig_01',
            name: 'Rig Node 1',
            position: [1, 2, 3],
            rotation: [0, 45, 0],
            pivot: [0.5, 0.5, 0.5]
        }],
        bindings: [{
            regionId: 'region_01',
            nodeId: 'rig_01',
            mode: 'rigid'
        }, {
            regionId: 'region_01',
            nodeId: 'rig_01',
            mode: 'rigid'
        }]
    });

    assert.ok(normalized);
    assert.equal(normalized!.nodes.length, 1);
    assert.equal(normalized!.bindings.length, 1);
    assert.equal(normalized!.bindings[0].mode, 'rigid');

    console.log('[sca-rig] normalization PASS');
};

const runTransformTests = () => {
    const restNode = createDefaultRigNode('rig_01');
    restNode.pivot = [1, 2, 3];
    assert.equal(isZeroRigTransform(restNode), true);

    const movedNode = { ...restNode, position: [0.5, 0, 0] as [number, number, number] };
    assert.equal(isZeroRigTransform(movedNode), false);

    const matrix = buildRigidRigMatrix(restNode);
    assert.ok(Math.abs(matrix.data[12] - 0) < 1e-5);
    assert.ok(Math.abs(matrix.data[13] - 0) < 1e-5);
    assert.ok(Math.abs(matrix.data[14] - 0) < 1e-5);

    console.log('[sca-rig] transform PASS');
};

const runStoreTests = () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode(generateRigId(store.getProject()), 'Rig Node 1');
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id, [1, 2, 3]);

    let project = store.getProject();
    assert.equal(project.rig?.nodes.length, 1);
    assert.equal(project.rig?.bindings.length, 1);
    assert.deepEqual(project.rig?.nodes[0].pivot, [1, 2, 3]);

    store.updateRigNode(node.id, { position: [0.25, 0, 0] });
    project = store.getProject();
    assert.deepEqual(project.rig?.nodes[0].position, [0.25, 0, 0]);

    store.setRigBinding('region_01', null);
    project = store.getProject();
    assert.equal(project.rig?.bindings.length, 0);
    assert.equal(project.rig?.nodes.length, 1);

    store.deleteRigNode(node.id);
    project = store.getProject();
    assert.equal(project.rig, undefined);

    console.log('[sca-rig] store PASS');
};

const runPersistenceTests = () => {
    const project = sampleProject();
    const node = createDefaultRigNode('rig_01');
    node.position = [0.3, 0, 0];
    node.pivot = [1, 1, 1];
    project.rig = {
        version: 1,
        nodes: [node],
        bindings: [{ regionId: 'region_01', nodeId: 'rig_01', mode: 'rigid' }]
    };

    const restored = deserializeSsprojScaBlock(serializeSsprojScaBlock(project));
    assert.equal(restored.rig?.nodes[0].id, 'rig_01');
    assert.equal(restored.rig?.bindings[0].regionId, 'region_01');

    const normalized = normalizeProject(restored);
    assert.deepEqual(normalized.rig?.nodes[0].position, [0.3, 0, 0]);

    const exported = JSON.parse(stringifyProjectJson(structuredClone(project)));
    assert.equal(exported.rig.bindings[0].nodeId, 'rig_01');

    console.log('[sca-rig] persistence PASS');
};

const runUndoRedoTests = async () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const before = store.getProject();
    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id, [0, 0, 0]);
    const after = store.getProject();

    const op = new ScaProjectOp(
        events,
        store,
        assetStore,
        before,
        after,
        null,
        null,
        null,
        null,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.undo();
    assert.equal(store.getProject().rig, undefined);

    await op.do();
    assert.equal(store.getProject().rig?.nodes[0].id, 'rig_01');

    console.log('[sca-rig] undo/redo PASS');
};

async function main() {
    runNormalizationTests();
    runTransformTests();
    runStoreTests();
    runPersistenceTests();
    await runUndoRedoTests();

    console.log('\n========== SCA RIG PHASE 1 TEST REPORT ==========');
    console.log('Normalization: PASS');
    console.log('Zero-transform rest pose: PASS');
    console.log('Store bind/unbind: PASS');
    console.log('Ssproj persistence: PASS');
    console.log('Undo/redo: PASS');
    console.log('Runtime animation: deferred (editor-only Phase 1)');
    console.log('================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
