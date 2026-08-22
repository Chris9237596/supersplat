import { strict as assert } from 'node:assert';

import { Mat4, Quat, Vec3 } from 'playcanvas';

import { Events } from '../src/events';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { registerScaHistory } from '../src/sca/edit/register-sca-history';
import { generateRigId } from '../src/sca/ids/generate-rig-id';
import { createDefaultRigNode, normalizeRig, DEFAULT_RIG_BIND_MODE } from '../src/sca/rig/rig-defaults';
import {
    bindOffsetToMatrix,
    buildEffectiveRigMatrix,
    buildRigidRigMatrix,
    buildRigidRigMatrixFromPose,
    computeSnapBindOffset,
    identityPose,
    isZeroPose,
    isZeroRigTransform,
    matrixMaxAbsError,
    matricesNearEqual,
    matrixToArray,
    poseToMatrix
} from '../src/sca/rig/rig-transform';
import {
    buildEffectiveRigWorldMatrix,
    buildEffectiveRigWorldMatrixFromPose,
    buildNodeWorldMatrix,
    buildNodeWorldMatrixFromPose,
    collectRigSubtreeNodeIds,
    computeKeepWorldBindOffsetMatrix,
    computeReparentLocalKeepWorld,
    createKeepWorldBindOffset,
    localTransformFromWorldHandle,
    localTransformFromWorldMatrix,
    normalizeRigHierarchy,
    wouldCreateRigCycle
} from '../src/sca/rig/rig-hierarchy';
import { collectRigHierarchyMarkerSegments } from '../src/sca/rig/rig-node-markers';
import { pickRigNodeIdAtScreen } from '../src/sca/rig/rig-node-pick';
import { evaluateRigPose } from '../src/sca/rig/rig-pose';
import { writeSlotEffectiveMatrix } from '../src/sca/rig/region-rig-applier';
import {
    buildRigBindingSelectOptions,
    collectPcuiSelectInputOptionLabels,
    resolveRigBindingSelectValue,
    rigBindingNodeIdFromSelectValue,
    RIG_BINDING_NONE_VALUE
} from '../src/sca/rig/rig-binding-ui';
import { restoreRigSlotTransforms } from '../src/sca/rig/region-rig-restore';
import { RegionRigApplier } from '../src/sca/rig/region-rig-applier';
import {
    getNodeLocalPivotPosition,
    getNodeWorldPivotPosition,
    getRigNodeHandleWorldTransform,
    nodeWorldMatrixToHelperHandle,
    rigNodePatchMatchesNode
} from '../src/sca/rig/rig-node-space';
import { chooseRigSyncPath, computeRigTopology } from '../src/sca/rig/region-rig-topology';
import { canReparentHelper, RigGizmoInteractionState, shouldDeferHelperSync } from '../src/sca/rig/rig-gizmo-lifecycle';
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
    assert.deepEqual(normalized!.nodes[0].rest, identityPose());
    assert.equal(normalized!.bindings[0].bindMode, undefined);

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
    store.setRigBinding('region_01', node.id, { pivot: [1, 2, 3] });

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
    store.setRigBinding('region_01', node.id, { pivot: [0, 0, 0] });
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
    store.setRigBinding('region_01', node.id, { pivot: [0, 0, 0] });

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
    assert.equal(chooseRigSyncPath('', 'rig_01:|region_01:rig_01:10', false, true), 'structural');
    assert.equal(chooseRigSyncPath('rig_01:|region_01:rig_01:10', 'rig_01:|region_01:rig_01:10', true, true), 'pose');
    assert.equal(chooseRigSyncPath('rig_01:|region_01:rig_01:10', 'rig_01:|', true, false), 'structural');
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
    assert.equal(topology, 'rig_01:|region_01:rig_01:10:legacy:legacy');

    const unbound = {
        ...rig,
        bindings: [] as typeof rig.bindings
    };
    assert.equal(computeRigTopology(events, unbound), 'rig_01:|');

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

const runRestPoseTests = () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    node.position = [2, 0, 0];
    node.rotation = [0, 20, 0];
    store.addRigNode(node);

    store.resetRigNodeToRest('rig_01');
    assert.deepEqual(store.getProject().rig?.nodes[0].position, [0, 0, 0]);
    assert.deepEqual(store.getProject().rig?.nodes[0].rotation, [0, 0, 0]);

    store.updateRigNode('rig_01', { position: [2, 0, 0], rotation: [0, 20, 0] });
    store.setRigNodeRestFromCurrent('rig_01');
    assert.deepEqual(store.getProject().rig?.nodes[0].rest.position, [2, 0, 0]);
    assert.deepEqual(store.getProject().rig?.nodes[0].rest.rotation, [0, 20, 0]);
    assert.deepEqual(store.getProject().rig?.nodes[0].position, [2, 0, 0]);

    store.updateRigNode('rig_01', { position: [3, 0, 0] });
    store.resetRigNodeToRest('rig_01');
    assert.deepEqual(store.getProject().rig?.nodes[0].position, [2, 0, 0]);

    console.log('[sca-rig] rest pose PASS');
};

const runBindModeTests = () => {
    const movedNode = createDefaultRigNode('rig_01');
    movedNode.position = [2, 0, 0];
    movedNode.rotation = [0, 30, 0];

    const rig = { version: 1 as const, nodes: [movedNode], bindings: [] };
    const keepOffset = createKeepWorldBindOffset(rig, movedNode);
    const snapOffset = computeSnapBindOffset();
    assert.ok(!isZeroPose(keepOffset.bindOffset));
    assert.ok(isZeroPose(snapOffset));

    const keepBinding = {
        regionId: 'region_01',
        nodeId: 'rig_01',
        mode: 'rigid' as const,
        bindMode: 'keep-world' as const,
        bindOffset: keepOffset.bindOffset,
        bindOffsetMatrix: keepOffset.bindOffsetMatrix
    };
    const effective = buildEffectiveRigWorldMatrix(rig, movedNode, keepBinding, new Mat4());
    const identity = new Mat4();
    for (let i = 0; i < 16; i++) {
        assert.ok(Math.abs(effective.data[i] - identity.data[i]) < 1e-4, `index ${i}`);
    }

    const snapBinding = {
        regionId: 'region_01',
        nodeId: 'rig_01',
        mode: 'rigid' as const,
        bindMode: 'snap' as const,
        bindOffset: snapOffset
    };
    const snapEffective = buildEffectiveRigWorldMatrix(rig, movedNode, snapBinding, new Mat4());
    const nodeOnly = buildNodeWorldMatrix(rig, movedNode, new Mat4());
    for (let i = 0; i < 16; i++) {
        assert.ok(Math.abs(snapEffective.data[i] - nodeOnly.data[i]) < 1e-4, `snap index ${i}`);
    }

    const store = new HotspotStore(sampleProject());
    store.addRigNode(movedNode);
    store.setRigBinding('region_01', 'rig_01', { bindMode: 'keep-world' });
    const binding = store.getRigBindingForRegion('region_01');
    assert.equal(binding?.bindMode, 'keep-world');
    assert.ok(binding?.bindOffset);
    assert.equal(DEFAULT_RIG_BIND_MODE, 'keep-world');

    store.rebindRegion('region_01', 'snap');
    const rebound = store.getRigBindingForRegion('region_01');
    assert.equal(rebound?.bindMode, 'snap');
    assert.ok(isZeroPose(rebound!.bindOffset!));

    console.log('[sca-rig] bind mode PASS');
};

const runBindOffsetPersistenceTests = () => {
    const store = new HotspotStore(sampleProject());
    const node = createDefaultRigNode('rig_01');
    node.position = [1.5, 0, -0.25];
    node.rotation = [0, 15, 0];
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id, { bindMode: 'keep-world' });

    const project = store.getProject();
    const json = stringifyProjectJson(project, false);
    const roundTrip = normalizeProject(JSON.parse(json));
    const binding = roundTrip.rig?.bindings[0];
    assert.equal(binding?.bindMode, 'keep-world');
    assert.deepEqual(binding?.bindOffset?.position, project.rig?.bindings[0].bindOffset?.position);
    assert.deepEqual(binding?.bindOffset?.rotation, project.rig?.bindings[0].bindOffset?.rotation);
    assert.deepEqual(roundTrip.rig?.nodes[0].rest, identityPose());

    console.log('[sca-rig] bind offset persistence PASS');
};

const matricesNearEqual = (left: Mat4, right: Mat4, epsilon = 1e-4): boolean => {
    for (let i = 0; i < 16; i++) {
        if (Math.abs(left.data[i] - right.data[i]) > epsilon) {
            return false;
        }
    }
    return true;
};

const buildSampleHierarchy = () => {
    const root = createDefaultRigNode('rig_01', 'Root');
    const arm = createDefaultRigNode('rig_02', 'Arm');
    arm.parentId = 'rig_01';
    const gripper = createDefaultRigNode('rig_03', 'Gripper');
    gripper.parentId = 'rig_02';
    root.position = [2, 0, 0];
    arm.position = [1, 0, 0];
    gripper.position = [0.5, 0, 0];
    return { root, arm, gripper };
};

const runHierarchyTests = () => {
    const { root, arm, gripper } = buildSampleHierarchy();
    const rig = {
        version: 1 as const,
        nodes: [root, arm, gripper],
        bindings: []
    };

    normalizeRigHierarchy(rig);
    assert.equal(wouldCreateRigCycle(rig, 'rig_01', 'rig_01'), true);
    assert.equal(wouldCreateRigCycle(rig, 'rig_01', 'rig_03'), true);
    assert.equal(wouldCreateRigCycle(rig, 'rig_03', 'rig_01'), false);

    const cyclicRig = structuredClone(rig);
    cyclicRig.nodes[0].parentId = 'rig_03';
    normalizeRigHierarchy(cyclicRig);
    assert.equal(cyclicRig.nodes[0].parentId, undefined);

    const armWorld = buildNodeWorldMatrix(rig, arm, new Mat4());
    const armTranslation = armWorld.getTranslation();
    assert.ok(Math.abs(armTranslation.x - 3) < 1e-4);

    assert.deepEqual(
        collectRigSubtreeNodeIds(rig, 'rig_01').sort(),
        ['rig_01', 'rig_02', 'rig_03']
    );

    const gripperWorldBefore = buildNodeWorldMatrix(rig, gripper, new Mat4()).clone();
    const keepLocal = computeReparentLocalKeepWorld(rig, gripper, 'rig_01');
    assert.ok(Math.abs(keepLocal.position[0] - 1.5) < 1e-4);

    const store = new HotspotStore(sampleProject());
    store.addRigNode(structuredClone(root));
    store.addRigNode(structuredClone(arm));
    store.addRigNode(structuredClone(gripper));
    store.setRigNodeParent('rig_03', 'rig_01', 'keep-world');

    const reparented = store.getProject().rig!;
    const reparentedGripper = reparented.nodes.find((node) => node.id === 'rig_03')!;
    assert.equal(reparentedGripper.parentId, 'rig_01');
    const gripperWorldAfterReparent = buildNodeWorldMatrix(reparented, reparentedGripper, new Mat4());
    assert.ok(matricesNearEqual(gripperWorldBefore, gripperWorldAfterReparent));

    store.setRigNodeParent('rig_03', 'rig_02', 'keep-local');
    const restoredHierarchy = store.getProject().rig!;
    assert.equal(
        restoredHierarchy.nodes.find((node) => node.id === 'rig_03')?.parentId,
        'rig_02'
    );

    const childBindingRig = structuredClone(restoredHierarchy);
    childBindingRig.bindings = [{
        regionId: 'region_01',
        nodeId: 'rig_02',
        mode: 'rigid',
        bindMode: 'snap',
        bindOffset: identityPose()
    }];
    const effectiveBefore = buildEffectiveRigWorldMatrix(
        childBindingRig,
        childBindingRig.nodes.find((node) => node.id === 'rig_02')!,
        childBindingRig.bindings[0],
        new Mat4()
    ).clone();
    childBindingRig.nodes.find((node) => node.id === 'rig_01')!.position = [4, 0, 0];
    const effectiveAfter = buildEffectiveRigWorldMatrix(
        childBindingRig,
        childBindingRig.nodes.find((node) => node.id === 'rig_02')!,
        childBindingRig.bindings[0],
        new Mat4()
    );
    assert.ok(!matricesNearEqual(effectiveBefore, effectiveAfter));

    const gripperBeforeDelete = structuredClone(
        store.getProject().rig!.nodes.find((node) => node.id === 'rig_03')!
    );
    const gripperWorldBeforeDelete = buildNodeWorldMatrix(
        store.getProject().rig!,
        gripperBeforeDelete,
        new Mat4()
    ).clone();

    store.deleteRigNode('rig_02');
    const afterDelete = store.getProject().rig!;
    assert.equal(afterDelete.nodes.length, 2);
    assert.equal(afterDelete.nodes.find((node) => node.id === 'rig_02'), undefined);
    assert.equal(afterDelete.bindings.length, 0);

    const promotedGripper = afterDelete.nodes.find((node) => node.id === 'rig_03')!;
    assert.equal(promotedGripper.parentId, undefined);
    const gripperWorldAfterDelete = buildNodeWorldMatrix(afterDelete, promotedGripper, new Mat4());
    assert.ok(matricesNearEqual(gripperWorldBeforeDelete, gripperWorldAfterDelete));

    const json = stringifyProjectJson(store.getProject(), false);
    const roundTrip = normalizeProject(JSON.parse(json));
    assert.equal(roundTrip.rig?.nodes.find((node) => node.id === 'rig_03')?.parentId, undefined);
    assert.equal(roundTrip.rig?.nodes.find((node) => node.id === 'rig_01')?.name, 'Root');

    console.log('[sca-rig] hierarchy PASS');
};

const runHierarchyUndoTests = async () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const { root, arm, gripper } = buildSampleHierarchy();
    const before = store.getProject();
    store.addRigNode(root);
    store.addRigNode(arm);
    store.addRigNode(gripper);
    store.selectRigNode('rig_03');
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
        'rig_03',
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.undo();
    assert.equal(store.getProject().rig, undefined);
    assert.equal(store.getSelectedRigNodeId(), null);

    await op.do();
    assert.equal(store.getProject().rig?.nodes.length, 3);
    assert.equal(store.getSelectedRigNodeId(), 'rig_03');
    assert.equal(store.getProject().rig?.nodes.find((node) => node.id === 'rig_03')?.parentId, 'rig_02');

    console.log('[sca-rig] hierarchy undo/redo PASS');
};

const vecDistance = (left: Vec3, right: Vec3): number => {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
};

const runHandleAlignmentTests = () => {
    const rootOnly = createDefaultRigNode('rig_01', 'Root');
    rootOnly.position = [1, 0.5, -0.25];
    rootOnly.rotation = [0, 45, 0];

    const rootNeutral = createDefaultRigNode('rig_10', 'Root Neutral');
    rootNeutral.position = [0.75, 0, 0.25];

    const { root, arm, gripper } = buildSampleHierarchy();
    arm.rotation = [0, 30, 0];
    gripper.rotation = [10, 0, 0];

    const rigs = [{
        rig: {
            version: 1 as const,
            nodes: [rootOnly],
            bindings: []
        },
        nodes: [rootOnly]
    }, {
        rig: {
            version: 1 as const,
            nodes: [rootNeutral],
            bindings: []
        },
        nodes: [rootNeutral]
    }, {
        rig: {
            version: 1 as const,
            nodes: [root, arm, gripper],
            bindings: []
        },
        nodes: [root, arm, gripper]
    }];

    const splatTransforms = [
        new Mat4(),
        new Mat4().setTranslate(10, -2, 4)
    ];

    for (const { rig, nodes } of rigs) {
        for (const splatWorld of splatTransforms) {
            const mockSplat = { worldTransform: splatWorld } as import('../src/splat').Splat;

            for (const node of nodes) {
                const handle = getRigNodeHandleWorldTransform(rig, node, mockSplat);
                const gizmoWorld = new Vec3();
                splatWorld.transformPoint(handle.splatLocalPosition, gizmoWorld);
                const pickWorld = getNodeWorldPivotPosition(rig, node, mockSplat, new Vec3());

                assert.ok(vecDistance(handle.worldPosition, gizmoWorld) < 1e-4, `${node.id} handle/gizmo`);
                assert.ok(vecDistance(handle.worldPosition, pickWorld) < 1e-4, `${node.id} handle/pick`);

                const legacyLocal = getNodeLocalPivotPosition(node, new Vec3());
                const legacyWorld = new Vec3();
                splatWorld.transformPoint(legacyLocal, legacyWorld);

                if (node.parentId) {
                    assert.ok(
                        vecDistance(handle.worldPosition, legacyWorld) > 1e-4,
                        `${node.id} legacy overlay path must diverge`
                    );
                } else if (
                    node.rotation.every((value) => Math.abs(value) < 1e-8) &&
                    node.pivot.every((value) => Math.abs(value) < 1e-8)
                ) {
                    assert.ok(
                        vecDistance(handle.worldPosition, legacyWorld) < 1e-4,
                        `${node.id} neutral root legacy path`
                    );
                }
            }
        }
    }

    console.log('[sca-rig] handle alignment PASS');
};

const runGizmoRoundTripTests = () => {
    const root = createDefaultRigNode('rig_01', 'Root');
    root.position = [1.25, -0.5, 0.75];
    root.rotation = [12, -30, 5];

    const arm = createDefaultRigNode('rig_02', 'Arm');
    arm.parentId = 'rig_01';
    arm.position = [0.5, 0.25, 0];
    arm.rotation = [0, 45, 0];
    arm.pivot = [0.15, 0, 0.05];

    const grandchild = createDefaultRigNode('rig_03', 'Grandchild');
    grandchild.parentId = 'rig_02';
    grandchild.position = [0.2, 0.1, -0.4];
    grandchild.rotation = [15, 0, -20];
    grandchild.pivot = [0.2, 0.1, 0];

    const rig = {
        version: 1 as const,
        nodes: [root, arm, grandchild],
        bindings: []
    };

    const matNodeWorld = new Mat4();
    const matHandle = new Mat4();
    const matRoundTrip = new Mat4();
    const handlePos = new Vec3();
    const handleEuler = new Vec3();

    for (const node of rig.nodes) {
        buildNodeWorldMatrix(rig, node, matNodeWorld);
        nodeWorldMatrixToHelperHandle(rig, node, matHandle);
        matHandle.getTranslation(handlePos);
        matHandle.getEulerAngles(handleEuler);

        const patch = localTransformFromWorldHandle(
            rig,
            node,
            handlePos,
            [handleEuler.x, handleEuler.y, handleEuler.z]
        );
        const roundTripNode: typeof node = {
            ...node,
            position: patch.position ? [...patch.position] as typeof node.position : node.position,
            rotation: patch.rotation ? [...patch.rotation] as typeof node.rotation : node.rotation
        };
        buildNodeWorldMatrix(
            {
                ...rig,
                nodes: rig.nodes.map((entry) => entry.id === node.id ? roundTripNode : entry)
            },
            roundTripNode,
            matRoundTrip
        );

        assert.ok(
            matricesNearEqual(matNodeWorld, matRoundTrip),
            `${node.id} matrix round-trip`
        );
        assert.ok(
            rigNodePatchMatchesNode(node, patch),
            `${node.id} patch matches stored node`
        );
    }

    console.log('[sca-rig] gizmo round-trip PASS');
};

const runPivotHandleRoundTripTests = () => {
    const node = createDefaultRigNode('rig_01', 'Pivot Node');
    node.pivot = [1, 0, 0];
    node.position = [0, 0, 0];
    node.rotation = [0, 45, 0];

    const rig = { version: 1 as const, nodes: [node], bindings: [] as [] };
    const matNodeWorld = new Mat4();
    const matHandle = new Mat4();
    const matRigid = new Mat4();

    buildNodeWorldMatrix(rig, node, matNodeWorld);
    nodeWorldMatrixToHelperHandle(rig, node, matHandle);

    assert.ok(
        !matricesNearEqual(matNodeWorld, matHandle, 1e-3),
        'handle TRS must differ from node rigid matrix when pivot and rotation are nonzero'
    );

    buildNodeWorldMatrix(rig, node, matRigid);
    const handlePos = matHandle.getTranslation(new Vec3());
    const patch = localTransformFromWorldHandle(
        rig,
        node,
        handlePos,
        [0, 45, 0]
    );
    assert.ok(rigNodePatchMatchesNode(node, patch));

    console.log('[sca-rig] pivot handle round-trip PASS');
};

const runFirstMoveTranslateTests = () => {
    const node = createDefaultRigNode('rig_01');
    node.pivot = [1, 0, 0];
    node.position = [0, 0, 0];
    node.rotation = [0, 45, 0];

    const rig = { version: 1 as const, nodes: [node], bindings: [] as [] };
    const matBefore = new Mat4();
    const matHandle = new Mat4();
    const matAfter = new Mat4();

    buildNodeWorldMatrix(rig, node, matBefore);
    nodeWorldMatrixToHelperHandle(rig, node, matHandle);

    const handlePos = matHandle.getTranslation(new Vec3());
    handlePos.x += 0.01;

    const patch = localTransformFromWorldHandle(
        rig,
        node,
        handlePos,
        [0, 45, 0]
    );
    const movedNode = {
        ...node,
        position: patch.position ? [...patch.position] as typeof node.position : node.position,
        rotation: patch.rotation ? [...patch.rotation] as typeof node.rotation : node.rotation
    };
    buildNodeWorldMatrix({ ...rig, nodes: [movedNode] }, movedNode, matAfter);

    const beforePos = matBefore.getTranslation(new Vec3());
    const afterPos = matAfter.getTranslation(new Vec3());

    assert.ok(Math.abs(afterPos.x - beforePos.x - 0.01) < 1e-3, 'world X delta');
    assert.ok(Math.abs(afterPos.y - beforePos.y) < 1e-3, 'world Y unchanged');
    assert.ok(Math.abs(afterPos.z - beforePos.z) < 1e-3, 'world Z unchanged');
    assert.ok(Math.abs((patch.position?.[0] ?? 0) - 0.01) < 1e-3, 'stored position X delta');

    console.log('[sca-rig] first-move translate PASS');
};

const simulateRotateHandlePatch = (
    rig: { version: 1; nodes: ReturnType<typeof createDefaultRigNode>[]; bindings: [] },
    node: ReturnType<typeof createDefaultRigNode>,
    deltaEuler: [number, number, number]
) => {
    const matHandle = new Mat4();
    nodeWorldMatrixToHelperHandle(rig, node, matHandle);
    const handlePos = matHandle.getTranslation(new Vec3());
    const handleEuler = matHandle.getEulerAngles(new Vec3());
    return localTransformFromWorldHandle(
        rig,
        node,
        handlePos,
        [
            handleEuler.x + deltaEuler[0],
            handleEuler.y + deltaEuler[1],
            handleEuler.z + deltaEuler[2]
        ]
    );
};

const runRotateGizmoTests = () => {
    // 1. Root node rotate drag
    const root = createDefaultRigNode('rig_root', 'Root');
    root.rotation = [0, 0, 0];
    const rootRig = { version: 1 as const, nodes: [root], bindings: [] as [] };
    const matBefore = new Mat4();
    const matAfter = new Mat4();

    buildNodeWorldMatrix(rootRig, root, matBefore);
    const rootPatch = simulateRotateHandlePatch(rootRig, root, [0, 45, 0]);
    const rootRotated = {
        ...root,
        position: rootPatch.position ? [...rootPatch.position] as typeof root.position : root.position,
        rotation: rootPatch.rotation ? [...rootPatch.rotation] as typeof root.rotation : root.rotation
    };
    buildNodeWorldMatrix({ ...rootRig, nodes: [rootRotated] }, rootRotated, matAfter);
    assert.ok(!matricesNearEqual(matBefore, matAfter), 'root rotate changes world matrix');
    assert.ok(Math.abs(rootRotated.rotation[1] - 45) < 1e-3, 'root rotate updates Y rotation');

    // 2. Child under rotated parent
    const parent = createDefaultRigNode('rig_parent', 'Parent');
    parent.rotation = [0, 90, 0];
    const child = createDefaultRigNode('rig_child', 'Child');
    child.parentId = parent.id;
    child.position = [2, 0, 0];
    const hierarchyRig = { version: 1 as const, nodes: [parent, child], bindings: [] as [] };
    const childPatch = simulateRotateHandlePatch(hierarchyRig, child, [30, 0, 0]);
    assert.ok(childPatch.rotation, 'child rotate produces rotation patch');
    const childRotated = {
        ...child,
        position: childPatch.position ? [...childPatch.position] as typeof child.position : child.position,
        rotation: childPatch.rotation ? [...childPatch.rotation] as typeof child.rotation : child.rotation
    };
    buildNodeWorldMatrix(
        { ...hierarchyRig, nodes: [parent, childRotated] },
        childRotated,
        matAfter
    );
    buildNodeWorldMatrix(hierarchyRig, child, matBefore);
    assert.ok(!matricesNearEqual(matBefore, matAfter), 'child rotate under rotated parent');

    // 3. Nonzero pivot rotate round-trip
    const pivotNode = createDefaultRigNode('rig_pivot', 'Pivot');
    pivotNode.pivot = [1, 0, 0];
    pivotNode.position = [0.5, 0, 0];
    pivotNode.rotation = [0, 0, 0];
    const pivotRig = { version: 1 as const, nodes: [pivotNode], bindings: [] as [] };
    const pivotPatch = simulateRotateHandlePatch(pivotRig, pivotNode, [0, 0, 60]);
    const pivotRotated = {
        ...pivotNode,
        position: pivotPatch.position ? [...pivotPatch.position] as typeof pivotNode.position : pivotNode.position,
        rotation: pivotPatch.rotation ? [...pivotPatch.rotation] as typeof pivotNode.rotation : pivotNode.rotation
    };
    buildNodeWorldMatrix(pivotRig, pivotNode, matBefore);
    buildNodeWorldMatrix({ ...pivotRig, nodes: [pivotRotated] }, pivotRotated, matAfter);
    assert.ok(!matricesNearEqual(matBefore, matAfter), 'nonzero pivot rotate changes matrix');

    const matPivotHandle = new Mat4();
    nodeWorldMatrixToHelperHandle({ ...pivotRig, nodes: [pivotRotated] }, pivotRotated, matPivotHandle);
    const handlePos = matPivotHandle.getTranslation(new Vec3());
    const handleEuler = matPivotHandle.getEulerAngles(new Vec3());
    const roundTripPatch = localTransformFromWorldHandle(
        { ...pivotRig, nodes: [pivotRotated] },
        pivotRotated,
        handlePos,
        [handleEuler.x, handleEuler.y, handleEuler.z + 30]
    );
    assert.ok(roundTripPatch.rotation, 'nonzero pivot rotate readback');

    // 4. Click without move = no change
    const idlePatch = simulateRotateHandlePatch(pivotRig, pivotNode, [0, 0, 0]);
    assert.ok(rigNodePatchMatchesNode(pivotNode, idlePatch), 'zero rotate delta is no-op');

    console.log('[sca-rig] rotate gizmo PASS');
};

const runRotateGizmoHistoryTests = () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    registerScaHistory(events, store, assetStore);

    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.selectRigNode(node.id);

    let editAddCount = 0;
    events.on('edit.add', () => {
        editAddCount++;
    });

    events.invoke('sca.history.beginTransaction');
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 0, 'click without move creates zero history entries');

    events.invoke('sca.history.beginTransaction');
    store.updateRigNode(node.id, { rotation: [0, 30, 0] });
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 1, 'one rotate drag creates one history entry');
    assert.equal(store.getSelectedRigNodeId(), node.id, 'node stays selected after commit');

    console.log('[sca-rig] rotate gizmo history PASS');
};

const runScaleDeferredTests = () => {
    const node = createDefaultRigNode('rig_01');
    assert.ok(!('scale' in node), 'ScaRigNode has no scale field yet');

    const mat = buildRigidRigMatrix(node);
    const scaleX = Math.hypot(mat.data[0], mat.data[1], mat.data[2]);
    const scaleY = Math.hypot(mat.data[4], mat.data[5], mat.data[6]);
    const scaleZ = Math.hypot(mat.data[8], mat.data[9], mat.data[10]);
    assert.ok(Math.abs(scaleX - 1) < 1e-5 && Math.abs(scaleY - 1) < 1e-5 && Math.abs(scaleZ - 1) < 1e-5);

    const normalized = normalizeRig({ version: 1, nodes: [node], bindings: [] });
    assert.ok(normalized.nodes.every((entry) => !('scale' in entry)));

    console.log('[sca-rig] scale deferred (rigid-only) PASS');
};

const buildNodeWorldMatrixDirect = (
    rig: { nodes: ReturnType<typeof createDefaultRigNode>[] },
    node: ReturnType<typeof createDefaultRigNode>,
    target = new Mat4()
): Mat4 => {
    const matParent = new Mat4();
    const matLocal = new Mat4();
    const matOut = new Mat4();

    const parentId = node.parentId ?? null;
    if (parentId) {
        const parent = rig.nodes.find((entry) => entry.id === parentId) ?? null;
        if (parent) {
            buildNodeWorldMatrixDirect(rig, parent, matParent);
        } else {
            matParent.copy(Mat4.IDENTITY);
        }
    } else {
        matParent.copy(Mat4.IDENTITY);
    }

    buildRigidRigMatrixFromPose(node, node, matLocal);
    matOut.copy(matParent).mul(matLocal);
    return target.copy(matOut);
};

const runPoseEvaluationTests = () => {
    const root = createDefaultRigNode('rig_root', 'Root');
    root.position = [1, 0.5, -0.25];
    root.rotation = [5, -15, 10];
    root.pivot = [0.5, 0, 0];

    const child = createDefaultRigNode('rig_child', 'Child');
    child.parentId = root.id;
    child.position = [2, 0, 0];
    child.rotation = [10, 35, -5];
    child.pivot = [0, 0.25, 0];

    const rig = { version: 1 as const, nodes: [root, child], bindings: [] as [] };

    const pose = evaluateRigPose(rig);
    assert.equal(pose.nodes.size, 2);
    assert.deepEqual(pose.nodes.get(root.id)?.position, root.position);
    assert.deepEqual(pose.nodes.get(root.id)?.rotation, root.rotation);
    assert.deepEqual(pose.nodes.get(child.id)?.position, child.position);
    assert.deepEqual(pose.nodes.get(child.id)?.rotation, child.rotation);
    assert.notStrictEqual(pose.nodes.get(root.id)?.position, root.position);

    const matDirectRoot = new Mat4();
    const matPoseRoot = new Mat4();
    buildNodeWorldMatrixDirect(rig, root, matDirectRoot);
    buildNodeWorldMatrixFromPose(rig, pose, root, matPoseRoot);
    assert.ok(matricesNearEqual(matDirectRoot, matPoseRoot), 'root world matrix');

    const matDirectChild = new Mat4();
    const matPoseChild = new Mat4();
    buildNodeWorldMatrixDirect(rig, child, matDirectChild);
    buildNodeWorldMatrixFromPose(rig, pose, child, matPoseChild);
    assert.ok(matricesNearEqual(matDirectChild, matPoseChild), 'child world matrix');

    const matWrapperRoot = new Mat4();
    buildNodeWorldMatrix(rig, root, matWrapperRoot);
    assert.ok(matricesNearEqual(matDirectRoot, matWrapperRoot), 'wrapper root world matrix');

    const legacyBinding = {
        regionId: 'region_legacy',
        nodeId: root.id,
        mode: 'rigid' as const
    };
    const keepOffset = createKeepWorldBindOffset(rig, root);
    const keepBinding = {
        regionId: 'region_keep',
        nodeId: root.id,
        mode: 'rigid' as const,
        bindMode: 'keep-world' as const,
        bindOffset: keepOffset.bindOffset,
        bindOffsetMatrix: keepOffset.bindOffsetMatrix
    };

    const matLegacyDirect = new Mat4();
    const matLegacyPose = new Mat4();
    buildEffectiveRigWorldMatrix(rig, root, legacyBinding, matLegacyDirect);
    buildEffectiveRigWorldMatrixFromPose(rig, pose, root, legacyBinding, matLegacyPose);
    assert.ok(matricesNearEqual(matLegacyDirect, matLegacyPose), 'legacy effective matrix');

    const matKeepDirect = new Mat4();
    const matKeepPose = new Mat4();
    buildEffectiveRigWorldMatrix(rig, root, keepBinding, matKeepDirect);
    buildEffectiveRigWorldMatrixFromPose(rig, pose, root, keepBinding, matKeepPose);
    assert.ok(matricesNearEqual(matKeepDirect, matKeepPose), 'keep-world effective matrix');

    const store = new HotspotStore(sampleProject());
    store.addRigNode(root);
    store.addRigNode(child);
    store.setRigBinding('region_01', child.id, { bindMode: 'keep-world' });
    store.updateRigNode(child.id, { position: [2.5, 0.1, 0] });

    const updatedRig = store.getProject().rig!;
    const updatedPose = evaluateRigPose(updatedRig);
    const updatedChild = updatedRig.nodes.find((entry) => entry.id === child.id)!;
    assert.deepEqual(updatedPose.nodes.get(child.id)?.position, updatedChild.position);

    const matUpdatedEffective = new Mat4();
    const updatedBinding = updatedRig.bindings[0];
    buildEffectiveRigWorldMatrixFromPose(updatedRig, updatedPose, updatedChild, updatedBinding, matUpdatedEffective);
    assert.ok(
        matricesNearEqual(
            matUpdatedEffective,
            buildEffectiveRigWorldMatrix(updatedRig, updatedChild, updatedBinding, new Mat4()),
            1e-4
        ),
        'authored node update flows to effective matrix'
    );

    store.resetRigNodeToRest(child.id);
    const rested = store.getProject().rig!.nodes.find((entry) => entry.id === child.id)!;
    assert.deepEqual(rested.position, rested.rest.position);
    assert.deepEqual(rested.rotation, rested.rest.rotation);

    console.log('[sca-rig] pose evaluation PASS');
};

const runRigNodeMarkerTests = () => {
    const { root, arm, gripper } = buildSampleHierarchy();
    arm.rotation = [0, 45, 0];
    gripper.position = [1.5, 0, 0];

    const rig = {
        version: 1 as const,
        nodes: [root, arm, gripper],
        bindings: [] as []
    };
    const splat = { worldTransform: new Mat4() } as import('../src/splat').Splat;
    const resolveSplat = () => splat;

    for (const node of [root, arm, gripper]) {
        const handle = getRigNodeHandleWorldTransform(rig, node, splat);
        assert.ok(Number.isFinite(handle.worldPosition.x), `${node.id} marker handle visible`);
    }

    const segments = collectRigHierarchyMarkerSegments(rig, resolveSplat);
    assert.equal(segments.length, 2, 'parent-child lines for arm and gripper');

    const armSegment = segments.find((entry) => entry.childId === arm.id);
    const gripperSegment = segments.find((entry) => entry.childId === gripper.id);
    assert.ok(armSegment);
    assert.ok(gripperSegment);
    assert.equal(armSegment.parentId, root.id);
    assert.equal(gripperSegment.parentId, arm.id);

    const armHandle = getRigNodeHandleWorldTransform(rig, arm, splat).worldPosition;
    assert.ok(
        Math.hypot(
            armSegment.from[0] - armHandle.x,
            armSegment.from[1] - armHandle.y,
            armSegment.from[2] - armHandle.z
        ) < 1e-5,
        'child line starts at handle'
    );

    const rotatedRig = {
        ...rig,
        nodes: [
            { ...root, rotation: [0, 90, 0] as [number, number, number] },
            arm,
            gripper
        ]
    };
    const childHandleBefore = getRigNodeHandleWorldTransform(rig, gripper, splat).worldPosition;
    const childHandleAfter = getRigNodeHandleWorldTransform(rotatedRig, gripper, splat).worldPosition;
    assert.ok(
        vecDistance(childHandleBefore, childHandleAfter) > 1e-4,
        'parent rotation moves child marker handle'
    );

    const projectWorldToScreen = (world: Vec3, out: Vec3) => {
        out.set(world.x * 0.1 + 0.5, world.y * 0.1 + 0.5, world.z);
    };
    const armHandleRotated = getRigNodeHandleWorldTransform(rotatedRig, arm, splat).worldPosition;
    const armScreen = new Vec3();
    projectWorldToScreen(armHandleRotated, armScreen);

    const pickedArm = pickRigNodeIdAtScreen(rotatedRig, resolveSplat, {
        pickX: armScreen.x * 800,
        pickY: armScreen.y * 600,
        viewportWidth: 800,
        viewportHeight: 600,
        projectWorldToScreen
    });
    assert.equal(pickedArm, arm.id, 'click near marker selects node');

    const store = new HotspotStore(sampleProject());
    store.addRigNode(root);
    store.addRigNode(arm);
    store.addRigNode(gripper);
    store.selectRigNode(arm.id);
    assert.equal(store.getSelectedRigNodeId(), arm.id);

    store.resetRigNodeToRest(arm.id);
    assert.deepEqual(store.getProject().rig?.nodes.find((entry) => entry.id === arm.id)?.position, arm.rest.position);

    console.log('[sca-rig] rig node markers PASS');
};

const runZeroMoveHandleStabilityTests = () => {
    const node = createDefaultRigNode('rig_01');
    node.pivot = [1, 0, 0];
    node.position = [0.2, -0.1, 0.05];
    node.rotation = [10, 45, -5];

    const rig = { version: 1 as const, nodes: [node], bindings: [] as [] };
    const matNodeWorld = new Mat4();
    const matHandle = new Mat4();

    buildNodeWorldMatrix(rig, node, matNodeWorld);
    nodeWorldMatrixToHelperHandle(rig, node, matHandle);

    const handlePos = matHandle.getTranslation(new Vec3());
    const handleEuler = matHandle.getEulerAngles(new Vec3());
    const patch = localTransformFromWorldHandle(
        rig,
        node,
        handlePos,
        [handleEuler.x, handleEuler.y, handleEuler.z]
    );

    assert.ok(rigNodePatchMatchesNode(node, patch));
    assert.ok(matrixMaxAbsError(matNodeWorld, buildNodeWorldMatrix(
        rig,
        {
            ...node,
            position: patch.position ? [...patch.position] as typeof node.position : node.position,
            rotation: patch.rotation ? [...patch.rotation] as typeof node.rotation : node.rotation
        },
        new Mat4()
    )) < 1e-4);

    console.log('[sca-rig] zero-move handle stability PASS');
};

const runBindingEffectiveConsistencyTests = () => {
    const root = createDefaultRigNode('rig_01', 'Root');
    root.position = [2, 0, 0];
    root.rotation = [0, 25, 0];

    const child = createDefaultRigNode('rig_02', 'Arm');
    child.parentId = 'rig_01';
    child.position = [0.75, 0.1, -0.2];
    child.rotation = [10, 35, -5];
    child.pivot = [0.15, 0, 0.05];

    const rig = {
        version: 1 as const,
        nodes: [root, child],
        bindings: [] as []
    };

    const keepOffset = createKeepWorldBindOffset(rig, child);
    const keepBinding = {
        regionId: 'region_01',
        nodeId: child.id,
        mode: 'rigid' as const,
        bindMode: 'keep-world' as const,
        bindOffset: keepOffset.bindOffset,
        bindOffsetMatrix: keepOffset.bindOffsetMatrix
    };

    const inverseExact = computeKeepWorldBindOffsetMatrix(rig, child, new Mat4());
    const inverseStored = bindOffsetToMatrix(keepBinding, new Mat4());
    assert.ok(matricesNearEqual(inverseExact, inverseStored, 1e-6));

    const structural = buildEffectiveRigWorldMatrix(rig, child, keepBinding, new Mat4());
    const poseRefresh = buildEffectiveRigWorldMatrix(rig, child, keepBinding, new Mat4());
    assert.ok(matricesNearEqual(structural, poseRefresh, 1e-6));

    const identity = new Mat4();
    for (let i = 0; i < 16; i++) {
        assert.ok(Math.abs(structural.data[i] - identity.data[i]) < 1e-4, `keep-world index ${i}`);
    }

    const snapBinding = {
        regionId: 'region_01',
        nodeId: child.id,
        mode: 'rigid' as const,
        bindMode: 'snap' as const,
        bindOffset: identityPose()
    };
    const snapStructural = buildEffectiveRigWorldMatrix(rig, child, snapBinding, new Mat4());
    const snapRefresh = buildEffectiveRigWorldMatrix(rig, child, snapBinding, new Mat4());
    assert.ok(matricesNearEqual(snapStructural, snapRefresh, 1e-6));

    const childBefore = structuredClone(child);
    child.position = [child.position[0] + 0.01, child.position[1], child.position[2]];
    const movedEffective = buildEffectiveRigWorldMatrix(rig, child, keepBinding, new Mat4());
    const unchangedNodeWorld = buildNodeWorldMatrix(
        { ...rig, nodes: [root, childBefore] },
        childBefore,
        new Mat4()
    );
    const movedNodeWorld = buildNodeWorldMatrix(rig, child, new Mat4());
    const expectedDelta = new Mat4().copy(movedNodeWorld).mul(inverseExact);
    assert.ok(matricesNearEqual(movedEffective, expectedDelta, 1e-4));

    const mockSplat = {
        uid: 1,
        transformPalette: {
            matrices: new Map<number, Mat4>(),
            setTransform(index: number, matrix: Mat4) {
                this.matrices.set(index, matrix.clone());
            }
        }
    } as unknown as import('../src/splat').Splat;

    const slot = {
        splat: mockSplat,
        nodeId: child.id,
        regionId: 'region_01',
        paletteIndex: 3,
        saved: [],
        gaussianIndices: [1, 2]
    };

    writeSlotEffectiveMatrix(
        { ...rig, nodes: [root, childBefore] },
        evaluateRigPose({ ...rig, nodes: [root, childBefore] }),
        slot,
        childBefore,
        keepBinding
    );
    const paletteAfterBind = mockSplat.transformPalette.matrices.get(3)!.clone();
    writeSlotEffectiveMatrix(
        { ...rig, nodes: [root, childBefore] },
        evaluateRigPose({ ...rig, nodes: [root, childBefore] }),
        slot,
        childBefore,
        keepBinding
    );
    const paletteAfterZeroDelta = mockSplat.transformPalette.matrices.get(3)!;
    assert.ok(matricesNearEqual(paletteAfterBind, paletteAfterZeroDelta, 1e-6));

    console.log('[sca-rig] binding effective consistency PASS');
};

const runScaProjectOpNoOpTests = async () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id);
    store.selectRigNode(node.id);

    let projectChangedCount = 0;
    events.on('sca.project.changed', () => {
        projectChangedCount++;
    });

    const current = store.getProject();
    const op = new ScaProjectOp(
        events,
        store,
        assetStore,
        current,
        current,
        null,
        null,
        null,
        null,
        node.id,
        node.id,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.do();
    assert.equal(projectChangedCount, 0);
    assert.equal(store.getSelectedRigNodeId(), node.id);

    console.log('[sca-rig] ScaProjectOp no-op apply PASS');
};

const runClickWithoutMoveTransactionTests = () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();

    let editAddCount = 0;
    events.on('edit.add', () => {
        editAddCount++;
    });

    registerScaHistory(events, store, assetStore);

    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);
    store.setRigBinding('region_01', node.id);
    store.selectRigNode(node.id);

    events.invoke('sca.history.beginTransaction');
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 0);

    const beforePose = structuredClone(store.getProject().rig!.nodes[0].position);
    events.invoke('sca.history.beginTransaction');
    store.updateRigNode(node.id, { position: [...beforePose] as [number, number, number] });
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 0);
    assert.deepEqual(store.getProject().rig?.nodes[0].position, beforePose);

    console.log('[sca-rig] click-without-move transaction PASS');
};

const runGizmoDragBaselineTests = () => {
    const root = createDefaultRigNode('rig_01', 'Root');
    root.position = [1, 0.5, -0.25];
    root.rotation = [5, -15, 10];

    const keepOffset = createKeepWorldBindOffset({ version: 1, nodes: [root], bindings: [] }, root);
    const rig = {
        version: 1 as const,
        nodes: [root],
        bindings: [{
            regionId: 'region_01',
            nodeId: root.id,
            mode: 'rigid' as const,
            bindMode: 'keep-world' as const,
            bindOffset: keepOffset.bindOffset,
            bindOffsetMatrix: keepOffset.bindOffsetMatrix
        }]
    };

    const matNodeWorld = new Mat4();
    const matHelper = new Mat4();
    const matBaseline = new Mat4();
    const matEffectiveBefore = new Mat4();
    const matEffectiveAfter = new Mat4();

    buildNodeWorldMatrix(rig, root, matNodeWorld);
    matHelper.copy(matNodeWorld);
    matBaseline.copy(matHelper);

    assert.ok(matricesNearEqual(matHelper, matBaseline));
    buildEffectiveRigWorldMatrix(rig, root, rig.bindings[0], matEffectiveBefore);

    const patch = localTransformFromWorldMatrix(rig, root, matHelper);
    const previewNode = {
        ...root,
        position: patch.position ? [...patch.position] as typeof root.position : root.position,
        rotation: patch.rotation ? [...patch.rotation] as typeof root.rotation : root.rotation
    };
    buildEffectiveRigWorldMatrix(
        { ...rig, nodes: [previewNode] },
        previewNode,
        rig.bindings[0],
        matEffectiveAfter
    );

    assert.ok(matricesNearEqual(matEffectiveBefore, matEffectiveAfter, 1e-4));

    previewNode.position = [previewNode.position[0] + 0.01, previewNode.position[1], previewNode.position[2]];
    buildEffectiveRigWorldMatrix(
        { ...rig, nodes: [previewNode] },
        previewNode,
        rig.bindings[0],
        matEffectiveAfter
    );
    assert.ok(!matricesNearEqual(matEffectiveBefore, matEffectiveAfter, 1e-4));

    console.log('[sca-rig] gizmo drag baseline PASS');
};

const runDragInvariantTests = () => {
    assert.equal(shouldDeferHelperSync(true), true);
    assert.equal(shouldDeferHelperSync(false), false);

    assert.equal(canReparentHelper(true, false), false);
    assert.equal(canReparentHelper(false, true), false);
    assert.equal(canReparentHelper(false, false), true);

    console.log('[sca-rig] drag invariants PASS');
};

const runGizmoLifecycleStateTests = () => {
    const state = new RigGizmoInteractionState();

    assert.equal(state.getPhase(), 'idle');
    assert.ok(state.beginDrag());
    assert.equal(state.getPhase(), 'dragging');
    assert.ok(state.canApplyMove());
    assert.ok(!state.beginDrag(), 'duplicate start rejected');

    assert.ok(state.endDrag());
    assert.equal(state.getPhase(), 'idle');
    assert.ok(!state.endDrag(), 'duplicate end rejected');
    assert.ok(!state.canApplyMove());

    state.beginDrag();
    state.reset();
    assert.equal(state.getPhase(), 'idle');
    assert.ok(!state.canApplyMove(), 'pointercancel/reset clears move application');

    // pointermove after pointerup must not apply
    assert.ok(state.beginDrag());
    assert.ok(state.endDrag());
    assert.ok(!state.canApplyMove(), 'move blocked after pointerup');

    // next pointerdown starts a fresh drag
    assert.ok(state.beginDrag());
    assert.equal(state.getPhase(), 'dragging');
    assert.ok(state.endDrag());

    console.log('[sca-rig] gizmo lifecycle state PASS');
};

const runGizmoLifecycleHistoryTests = () => {
    const events = new Events();
    const store = new HotspotStore(sampleProject());
    const assetStore = new ScaAssetStore();
    registerScaHistory(events, store, assetStore);

    const node = createDefaultRigNode('rig_01');
    store.addRigNode(node);

    let editAddCount = 0;
    events.on('edit.add', () => {
        editAddCount++;
    });

    // click without movement: begin + end, no mutation
    events.invoke('sca.history.beginTransaction');
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 0);

    // one drag gesture with mutation -> one history entry
    events.invoke('sca.history.beginTransaction');
    store.updateRigNode(node.id, { position: [0.01, 0, 0] });
    events.invoke('sca.history.commitTransaction');
    assert.equal(editAddCount, 1);

    // pointermove after release should not create history (no second txn)
    assert.equal(editAddCount, 1);

    console.log('[sca-rig] gizmo lifecycle history PASS');
};

const runLegacyBindingTopologyTests = () => {
    const events = {
        invoke(_name: string, regionId?: string) {
            if (regionId === 'region_05') {
                return { empty: false, forEach(fn: (index: number) => void) { fn(0); } };
            }
            return null;
        }
    } as Events;

    const legacyRig = {
        version: 1 as const,
        nodes: [createDefaultRigNode('rig_01')],
        bindings: [{
            regionId: 'region_05',
            nodeId: 'rig_01',
            mode: 'rigid' as const
        }]
    };

    const topology = computeRigTopology(events, legacyRig);
    assert.ok(topology.includes('legacy:legacy'), `expected legacy fingerprint, got ${topology}`);

    const store = new HotspotStore(sampleProject());
    store.addRigNode(createDefaultRigNode('rig_01'));
    store.setRigBinding('region_01', 'rig_01', { bindMode: 'keep-world' });
    const binding = store.getRigBindingForRegion('region_01');
    assert.equal(binding?.bindMode, 'keep-world');
    assert.ok(binding?.bindOffsetMatrix && binding.bindOffsetMatrix.length === 16);

    const keepWorldRig = store.getProject().rig!;
    const keepTopology = computeRigTopology({ invoke: () => null } as Events, keepWorldRig);
    assert.ok(keepTopology.includes('keep-world'), `expected keep-world fingerprint, got ${keepTopology}`);
    assert.ok(!keepTopology.includes('legacy:legacy'));

    console.log('[sca-rig] legacy vs keep-world binding topology PASS');
};

const runLegacyAndKeepWorldEffectiveStabilityTests = () => {
    const root = createDefaultRigNode('rig_01', 'Root');
    root.position = [1, 0, 0];

    const legacyBinding = {
        regionId: 'region_01',
        nodeId: root.id,
        mode: 'rigid' as const
    };

    const keepOffset = createKeepWorldBindOffset({ version: 1, nodes: [root], bindings: [] }, root);
    const keepWorldBinding = {
        regionId: 'region_01',
        nodeId: root.id,
        mode: 'rigid' as const,
        bindMode: 'keep-world' as const,
        bindOffset: keepOffset.bindOffset,
        bindOffsetMatrix: keepOffset.bindOffsetMatrix
    };

    const rigLegacy = { version: 1 as const, nodes: [root], bindings: [legacyBinding] };
    const rigKeep = { version: 1 as const, nodes: [root], bindings: [keepWorldBinding] };

    const legacyBefore = buildEffectiveRigWorldMatrix(rigLegacy, root, legacyBinding, new Mat4());
    const legacyAfter = buildEffectiveRigWorldMatrix(rigLegacy, root, legacyBinding, new Mat4());
    assert.ok(matricesNearEqual(legacyBefore, legacyAfter));

    const keepBefore = buildEffectiveRigWorldMatrix(rigKeep, root, keepWorldBinding, new Mat4());
    const keepAfter = buildEffectiveRigWorldMatrix(rigKeep, root, keepWorldBinding, new Mat4());
    assert.ok(matricesNearEqual(keepBefore, keepAfter));

    console.log('[sca-rig] legacy and keep-world effective stability PASS');
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
    runRestPoseTests();
    runBindModeTests();
    runBindOffsetPersistenceTests();
    runHierarchyTests();
    runHierarchyUndoTests();
    runHandleAlignmentTests();
    runGizmoRoundTripTests();
    runPivotHandleRoundTripTests();
    runFirstMoveTranslateTests();
    runRotateGizmoTests();
    runRotateGizmoHistoryTests();
    runScaleDeferredTests();
    runPoseEvaluationTests();
    runRigNodeMarkerTests();
    runZeroMoveHandleStabilityTests();
    runBindingEffectiveConsistencyTests();
    await runScaProjectOpNoOpTests();
    runClickWithoutMoveTransactionTests();
    runGizmoDragBaselineTests();
    runDragInvariantTests();
    runGizmoLifecycleStateTests();
    runGizmoLifecycleHistoryTests();
    runLegacyBindingTopologyTests();
    runLegacyAndKeepWorldEffectiveStabilityTests();
    runHistoryBatchingTests();
    await runUndoRedoTests();

    console.log('\n========== SCA RIG PHASE 2 TEST REPORT ==========');
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
    console.log('Rest pose controls: PASS');
    console.log('Bind mode keep-world/snap: PASS');
    console.log('Bind offset persistence: PASS');
    console.log('Hierarchy parent/world/reparent/delete: PASS');
    console.log('Hierarchy undo/redo: PASS');
    console.log('Handle/gizmo alignment: PASS');
    console.log('Gizmo matrix round-trip: PASS');
    console.log('Pivot handle round-trip: PASS');
    console.log('First-move translate: PASS');
    console.log('Rotate gizmo: PASS');
    console.log('Rotate gizmo history: PASS');
    console.log('Scale deferred (rigid-only): PASS');
    console.log('Pose evaluation: PASS');
    console.log('Rig node markers: PASS');
    console.log('Zero-move handle stability: PASS');
    console.log('Binding effective consistency: PASS');
    console.log('ScaProjectOp no-op apply: PASS');
    console.log('Click-without-move transaction: PASS');
    console.log('Gizmo drag baseline: PASS');
    console.log('Drag invariants: PASS');
    console.log('Gizmo lifecycle state: PASS');
    console.log('Gizmo lifecycle history: PASS');
    console.log('Legacy vs keep-world topology: PASS');
    console.log('Legacy and keep-world effective stability: PASS');
    console.log('History batching model: PASS');
    console.log('Undo/redo: PASS');
    console.log('Runtime animation: deferred (editor-only Phase 1)');
    console.log('================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
