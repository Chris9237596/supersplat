import { strict as assert } from 'node:assert';

import { Mat4 } from 'playcanvas';

import { Events } from '../src/events';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { generateRigId } from '../src/sca/ids/generate-rig-id';
import { createDefaultRigNode, normalizeRig } from '../src/sca/rig/rig-defaults';
import {
    buildRigBindingSelectOptions,
    collectPcuiSelectInputOptionLabels,
    resolveRigBindingSelectValue,
    rigBindingNodeIdFromSelectValue,
    RIG_BINDING_NONE_VALUE
} from '../src/sca/rig/rig-binding-ui';
import { buildRigidRigMatrix, isZeroRigTransform } from '../src/sca/rig/rig-transform';
import { restoreRigSlotTransforms } from '../src/sca/rig/region-rig-restore';
import { RegionRigApplier } from '../src/sca/rig/region-rig-applier';
import { chooseRigSyncPath, computeRigTopology } from '../src/sca/rig/region-rig-topology';
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

const runSelectionTests = () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);

    store.selectRigNode(node.id);
    assert.equal(store.getSelectedRigNodeId(), node.id);

    store.selectRigNode(null);
    assert.equal(store.getSelectedRigNodeId(), null);

    store.selectRigNode(node.id);
    store.deleteRigNode(node.id);
    assert.equal(store.getSelectedRigNodeId(), null);

    store.loadProject(sampleProject());
    assert.equal(store.getSelectedRigNodeId(), null);

    console.log('[sca-rig] selection PASS');
};

const runSelectionExclusivityTests = () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);

    events.on('sca.region.select', (id: string | null) => {
        store.selectRegion(id);
        if (id) {
            store.selectRigNode(null);
        }
    });

    events.on('sca.rig.node.select', (id: string | null) => {
        store.selectRigNode(id);
        if (id) {
            store.selectRegion(null);
        }
    });

    store.selectRegion('region_01');
    events.fire('sca.rig.node.select', node.id);
    assert.equal(store.getSelectedRigNodeId(), node.id);
    assert.equal(store.getSelectedRegionId(), null);

    events.fire('sca.region.select', 'region_01');
    assert.equal(store.getSelectedRegionId(), 'region_01');
    assert.equal(store.getSelectedRigNodeId(), null);

    console.log('[sca-rig] selection exclusivity PASS');
};

const runHistoryBatchingTests = () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);

    const before = store.getProject();
    store.updateRigNode(node.id, { position: [0.1, 0, 0] });
    store.updateRigNode(node.id, { position: [0.2, 0, 0] });
    store.updateRigNode(node.id, { position: [0.3, 0, 0] });
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
        null,
        null,
        emptyAssets,
        emptyAssets,
        applying
    );

    assert.deepEqual(after.rig?.nodes[0].position, [0.3, 0, 0]);
    assert.notEqual(JSON.stringify(before.rig), JSON.stringify(after.rig));

    void op.undo();
    assert.deepEqual(store.getProject().rig?.nodes[0].position, [0, 0, 0]);

    console.log('[sca-rig] history batching PASS');
};

const runSelectionPersistenceTests = () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.selectRigNode(node.id);

    store.updateRigNode(node.id, { rotation: [0, 25, 0] });
    assert.equal(store.getSelectedRigNodeId(), node.id);

    store.updateRigNode(node.id, { name: 'Rig Node Renamed' });
    assert.equal(store.getSelectedRigNodeId(), node.id);

    const loaded = structuredClone(store.getProject());
    store.loadProject(loaded);
    assert.equal(store.getSelectedRigNodeId(), node.id);

    store.deleteRigNode(node.id);
    assert.equal(store.getSelectedRigNodeId(), null);

    console.log('[sca-rig] selection persistence PASS');
};

const runBindingDropdownTests = () => {
    const nodeA = createDefaultRigNode('rig_01', 'Rig Node 01');
    const nodeB = createDefaultRigNode('rig_02', 'Rig Node 02');
    const options = buildRigBindingSelectOptions([nodeA, nodeB]);

    assert.equal(options.length, 3);
    assert.equal(options[0].v, RIG_BINDING_NONE_VALUE);
    assert.equal(options[0].t, 'None');
    assert.equal(options[1].v, 'rig_01');
    assert.equal(options[1].t, 'Rig Node 01');
    assert.equal(options[2].v, 'rig_02');
    assert.equal(options[2].t, 'Rig Node 02');

    assert.equal(resolveRigBindingSelectValue('rig_02', [nodeA, nodeB]), 'rig_02');
    assert.equal(resolveRigBindingSelectValue('rig_missing', [nodeA, nodeB]), RIG_BINDING_NONE_VALUE);
    assert.equal(resolveRigBindingSelectValue(null, [nodeA, nodeB]), RIG_BINDING_NONE_VALUE);
    assert.equal(rigBindingNodeIdFromSelectValue(RIG_BINDING_NONE_VALUE), null);
    assert.equal(rigBindingNodeIdFromSelectValue('rig_01'), 'rig_01');

    const legacyBrokenOptions = [{ v: '', t: 'None' }, ...options.slice(1)];
    assert.deepEqual(collectPcuiSelectInputOptionLabels(legacyBrokenOptions), []);
    assert.deepEqual(collectPcuiSelectInputOptionLabels(options), [
        'None',
        'Rig Node 01',
        'Rig Node 02'
    ]);

    console.log('[sca-rig] binding dropdown PASS');
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
    store.selectRigNode(node.id);
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
        null,
        node.id,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.undo();
    assert.equal(store.getProject().rig, undefined);
    assert.equal(store.getSelectedRigNodeId(), null);

    await op.do();
    assert.equal(store.getProject().rig?.nodes[0].id, 'rig_01');
    assert.equal(store.getSelectedRigNodeId(), node.id);

    console.log('[sca-rig] undo/redo PASS');
};

type MockTransformPalette = {
    nextIndex: number;
    matrices: Map<number, Mat4>;
    alloc: () => number;
    free: (count?: number) => void;
    setTransform: (index: number, transform: Mat4) => void;
};

const createMockTransformPalette = (): MockTransformPalette => {
    const matrices = new Map<number, Mat4>();
    const state = { nextIndex: 1 };

    return {
        get nextIndex() {
            return state.nextIndex;
        },
        matrices,
        alloc: () => state.nextIndex++,
        free: (count = 1) => {
            state.nextIndex -= count;
        },
        setTransform: (index, transform) => {
            matrices.set(index, transform.clone());
        }
    };
};

type MockSplat = {
    uid: number;
    transformIndices: Uint16Array;
    transformTexture: {
        lock: () => Uint16Array;
        unlock: () => void;
    };
    transformPalette: MockTransformPalette;
    sortCenterUpdates: number[][];
    updateSortCentersForIndices: (indices: Iterable<number>) => Promise<void>;
};

const createMockSplat = (gaussianCount: number, uid: number): MockSplat => {
    const transformIndices = new Uint16Array(gaussianCount);
    const sortCenterUpdates: number[][] = [];
    const transformPalette = createMockTransformPalette();

    return {
        uid,
        transformIndices,
        transformTexture: {
            lock: () => transformIndices,
            unlock: () => {}
        },
        transformPalette,
        sortCenterUpdates,
        updateSortCentersForIndices: async (indices) => {
            sortCenterUpdates.push([...indices]);
        }
    };
};

const runRestoreTests = () => {
    const splat = createMockSplat(8, 1);
    splat.transformIndices.set([0, 0, 2, 2, 0, 0, 0, 0]);

    const paletteIndex = splat.transformPalette.alloc();
    splat.transformIndices[0] = paletteIndex;
    splat.transformIndices[1] = paletteIndex;
    splat.transformIndices[4] = paletteIndex;
    splat.transformPalette.setTransform(paletteIndex, buildRigidRigMatrix({
        ...createDefaultRigNode('rig_01'),
        position: [5, 0, 0],
        rotation: [0, 45, 0]
    }));

    const restore = restoreRigSlotTransforms([{
        splat: splat as unknown as import('../src/splat').Splat,
        nodeId: 'rig_01',
        paletteIndex,
        saved: [
            { gaussianIndex: 0, transformIndex: 0 },
            { gaussianIndex: 1, transformIndex: 0 },
            { gaussianIndex: 4, transformIndex: 0 }
        ]
    }]);

    assert.equal(splat.transformIndices[0], 0);
    assert.equal(splat.transformIndices[1], 0);
    assert.equal(splat.transformIndices[2], 2);
    assert.equal(splat.transformIndices[4], 0);
    assert.equal(restore.restoredGaussianCount, 3);
    assert.deepEqual(restore.removedNodeIds, ['rig_01']);
    assert.equal(restore.freedPaletteCount, 1);
    assert.equal(splat.transformPalette.nextIndex, 1);

    console.log('[sca-rig] restore palette indices PASS');
};

const runRestoreFlowTests = async () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id, [0, 0, 0]);

    store.updateRigNode(node.id, { position: [3, 0, 0], rotation: [0, 90, 0] });
    const transformed = structuredClone(store.getProject());
    assert.notDeepEqual(transformed.rig?.nodes[0].position, [0, 0, 0]);

    store.setRigBinding('region_01', null);
    assert.equal(store.getProject().rig?.bindings.length, 0);
    assert.deepEqual(
        store.getProject().regions[0].source,
        sampleProject().regions[0].source
    );

    store.deleteRigNode(node.id);
    assert.equal(store.getProject().rig, undefined);

    store.loadProject(transformed);
    assert.deepEqual(store.getProject().rig?.nodes[0].position, [3, 0, 0]);

    store.setRigBinding('region_01', null);
    store.deleteRigNode('rig_01');
    assert.equal(store.getProject().rig, undefined);
    assert.deepEqual(
        store.getProject().regions[0].source,
        sampleProject().regions[0].source
    );

    const events = new Events();
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const before = sampleProject();
    const rigNode = createDefaultRigNode('rig_01');
    rigNode.position = [2, 0, 0];
    const rigStore = new HotspotStore(before);
    rigStore.addRigNode(rigNode);
    rigStore.setRigBinding('region_01', rigNode.id);

    const op = new ScaProjectOp(
        events,
        rigStore,
        assetStore,
        before,
        rigStore.getProject(),
        null,
        null,
        null,
        null,
        null,
        null,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.do();
    assert.deepEqual(rigStore.getProject().rig?.nodes[0].position, [2, 0, 0]);

    await op.undo();
    assert.equal(rigStore.getProject().rig, undefined);
    assert.deepEqual(
        rigStore.getProject().regions[0].source,
        before.regions[0].source
    );

    await op.do();
    assert.deepEqual(rigStore.getProject().rig?.nodes[0].position, [2, 0, 0]);

    console.log('[sca-rig] restore metadata flow PASS');
};

const runSortCenterRestoreContractTests = async () => {
    const splat = createMockSplat(4, 2);
    const paletteIndex = splat.transformPalette.alloc();
    const rigIndices = [1, 2];

    for (const index of rigIndices) {
        splat.transformIndices[index] = paletteIndex;
    }

    const restore = restoreRigSlotTransforms([{
        splat: splat as unknown as import('../src/splat').Splat,
        nodeId: 'rig_02',
        paletteIndex,
        saved: rigIndices.map((gaussianIndex) => ({
            gaussianIndex,
            transformIndex: 0
        }))
    }]);

    assert.equal(splat.transformIndices[1], 0);
    assert.equal(splat.transformIndices[2], 0);

    for (const [restoredSplat, indices] of restore.restoredBySplat) {
        await restoredSplat.updateSortCentersForIndices(indices);
    }

    assert.equal(splat.sortCenterUpdates.length, 1);
    assert.deepEqual(splat.sortCenterUpdates[0], rigIndices);

    console.log('[sca-rig] sort-center restore contract PASS');
};

const runTopologySyncTests = () => {
    assert.equal(chooseRigSyncPath('', 'rig_01|region_01:rig_01:10', false, true), 'structural');
    assert.equal(chooseRigSyncPath('rig_01|region_01:rig_01:10', 'rig_01|region_01:rig_01:10', true, true), 'pose');
    assert.equal(chooseRigSyncPath('rig_01|region_01:rig_01:10', 'rig_01|', true, false), 'structural');
    assert.equal(chooseRigSyncPath('', '', false, false), 'none');

    const events = new Events();
    events.function('sca.region.getMask', (regionId: string) => {
        if (regionId === 'region_01') {
            return {
                empty: false,
                forEach(fn: (index: number) => void) {
                    for (let i = 0; i < 10; i++) {
                        fn(i);
                    }
                }
            };
        }
        return { empty: true, forEach() {} };
    });

    const rig = {
        version: 1 as const,
        nodes: [createDefaultRigNode('rig_01')],
        bindings: [{ regionId: 'region_01', nodeId: 'rig_01', mode: 'rigid' as const }]
    };

    const topology = computeRigTopology(events, rig);
    assert.equal(topology, 'rig_01|region_01:rig_01:10');

    const unbound = {
        ...rig,
        bindings: [] as typeof rig.bindings
    };
    assert.equal(computeRigTopology(events, unbound), 'rig_01|');

    console.log('[sca-rig] topology sync PASS');
};

const runPoseOnlyUpdateTests = async () => {
    const splat = createMockSplat(6, 3);
    const paletteIndex = splat.transformPalette.alloc();
    splat.transformIndices[1] = paletteIndex;
    splat.transformIndices[2] = paletteIndex;
    splat.transformIndices[3] = paletteIndex;

    const savedSnapshot = Uint16Array.from(splat.transformIndices);

    const applier = new RegionRigApplier();
    (applier as unknown as { slots: unknown[] }).slots = [{
        splat,
        nodeId: 'rig_01',
        paletteIndex,
        saved: [
            { gaussianIndex: 1, transformIndex: 0 },
            { gaussianIndex: 2, transformIndex: 0 },
            { gaussianIndex: 3, transformIndex: 0 }
        ],
        gaussianIndices: [1, 2, 3]
    }];

    const rig = {
        version: 1 as const,
        nodes: [{
            ...createDefaultRigNode('rig_01'),
            position: [2, 0, 0] as [number, number, number],
            rotation: [0, 45, 0] as [number, number, number]
        }],
        bindings: [{ regionId: 'region_01', nodeId: 'rig_01', mode: 'rigid' as const }]
    };

    await applier.updateNodePoses(
        { invoke() { return null; } } as Events,
        { forceRender: false } as import('../src/scene').Scene,
        rig
    );

    assert.deepEqual(Array.from(splat.transformIndices), Array.from(savedSnapshot));
    assert.equal(splat.transformIndices[1], paletteIndex);
    assert.equal(splat.sortCenterUpdates.length, 1);
    assert.deepEqual(splat.sortCenterUpdates[0], [1, 2, 3]);
    assert.ok(splat.transformPalette.matrices.has(paletteIndex));

    applier.clear();
    assert.equal(splat.transformIndices[1], 0);
    assert.equal(splat.transformIndices[2], 0);
    assert.equal(splat.transformIndices[3], 0);
    assert.equal(splat.transformPalette.nextIndex, 1);

    console.log('[sca-rig] pose-only update PASS');
};

async function main() {
    runNormalizationTests();
    runTransformTests();
    runStoreTests();
    runPersistenceTests();
    runSelectionTests();
    runSelectionExclusivityTests();
    runSelectionPersistenceTests();
    runBindingDropdownTests();
    runRestoreTests();
    await runRestoreFlowTests();
    await runSortCenterRestoreContractTests();
    runTopologySyncTests();
    await runPoseOnlyUpdateTests();
    runHistoryBatchingTests();
    await runUndoRedoTests();

    console.log('\n========== SCA RIG PHASE 1 TEST REPORT ==========');
    console.log('Normalization: PASS');
    console.log('Zero-transform rest pose: PASS');
    console.log('Store bind/unbind: PASS');
    console.log('Ssproj persistence: PASS');
    console.log('Selection exclusivity: PASS');
    console.log('Selection persistence: PASS');
    console.log('Binding dropdown options: PASS');
    console.log('Restore palette/index state: PASS');
    console.log('Restore unbind/delete/undo flow: PASS');
    console.log('Sort-center restore contract: PASS');
    console.log('Topology sync routing: PASS');
    console.log('Pose-only update path: PASS');
    console.log('History batching model: PASS');
    console.log('Undo/redo: PASS');
    console.log('Runtime animation: deferred (editor-only Phase 1)');
    console.log('================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
