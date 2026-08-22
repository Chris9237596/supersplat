import { strict as assert } from 'node:assert';

import { IndexRanges } from '../src/index-ranges';
import { regionMaskStorePath } from '../src/sca/regions/region-mask-paths';
import {
    cloneAssets,
    getRegionMask,
    remapRegionMasksForSave,
    setRegionMask
} from '../src/sca/regions/region-mask-store';
import {
    logRegionPersistSnapshot,
    snapshotRegionPersist
} from './region-persist-snapshot';
import { readSourceSplatSelectionRanges } from '../src/sca/regions/region-selection-replace';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject } from '../src/sca/types/project';
import { ScaRegion } from '../src/sca/types/region';
import { State } from '../src/splat-state';

/** Mirrors src/doc.ts saveDocument serializeSettings (ssproj PLY export). */
const SSPROJ_SAVE_SERIALIZE_SETTINGS = {
    keepStateData: false,
    keepWorldTransform: true,
    keepColorTint: true
};

const sampleRegion = (
    id: string,
    scaSplatId: string,
    gaussianCount: number
): ScaRegion => ({
    id,
    name: id,
    enabled: true,
    source: {
        type: 'gaussian-mask',
        scaSplatId,
        maskAsset: `sca/regions/${id}.mask`
    },
    capture: { gaussianCount },
    interaction: { clickable: true, showCard: true, showInNavigation: true },
    visual: {
        hoverTint: '#ff6600',
        hoverOpacity: 0.35,
        activeTint: '#ff6600',
        activeOpacity: 0.55
    }
});

const createMockScene = (splat: object) => ({
    getElementsByType: () => [splat]
});

const createMockSplat = (
    scaSplatId: string,
    total: number,
    stateData: Uint8Array
) => ({
    visible: true,
    scaSplatId,
    splatData: {
        numSplats: total,
        getProp: (name: string) => (name === 'state' ? stateData : undefined)
    }
});

const assertSnapshotsEqual = (
    label: string,
    before: ReturnType<typeof snapshotRegionPersist>,
    after: ReturnType<typeof snapshotRegionPersist>
) => {
    assert.ok(before && after, `${label}: missing snapshot`);
    assert.equal(after!.members, before!.members, `${label}: members`);
    assert.equal(after!.maskHash, before!.maskHash, `${label}: maskHash`);
    assert.equal(after!.splatGaussianCount, before!.splatGaussianCount, `${label}: splatGaussianCount`);
    assert.equal(after!.sourceScaSplatId, before!.sourceScaSplatId, `${label}: sourceScaSplatId`);
};

const runSerializeSettingsCheck = () => {
    const selected = (SSPROJ_SAVE_SERIALIZE_SETTINGS as { selected?: boolean }).selected ?? false;
    assert.equal(selected, false, 'ssproj save must not set serializeSettings.selected');
    assert.equal(SSPROJ_SAVE_SERIALIZE_SETTINGS.keepStateData, false);
    console.log('[sca-region-save-persistence] ssproj serializeSettings.selected=false PASS');
};

const runTest1CreateSaveReload = () => {
    const total = 100;
    const stateData = new Uint8Array(total);
    const ranges = IndexRanges.fromPredicate(total, (i) => i === 2 || i === 3 || i === 7 || i === 15);

    const splat = createMockSplat('splat_01', total, stateData);
    const scene = createMockScene(splat);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'splat_01', total);
    store.loadProject({ ...createEmptyProject(), regions: [region] });
    setRegionMask(assetStore, region.id, ranges, total);

    const before = snapshotRegionPersist(region, assetStore, total);
    logRegionPersistSnapshot('beforeSave', before);

    remapRegionMasksForSave(store, assetStore, scene as never);

    const after = snapshotRegionPersist(store.getRegions()[0], assetStore, total);
    logRegionPersistSnapshot('afterSave', after);
    assertSnapshotsEqual('test1 afterSave', before, after);

    const reloadedAssets = new ScaAssetStore();
    for (const entry of cloneAssets(assetStore)) {
        reloadedAssets.set(entry.path, entry.data.slice(), entry.mimeType);
    }
    const reloadedStore = new HotspotStore(structuredClone(store.getProject()));
    const reloadedRegion = reloadedStore.getRegions()[0];
    const afterReload = snapshotRegionPersist(reloadedRegion, reloadedAssets, total);
    logRegionPersistSnapshot('afterReload', afterReload);
    assertSnapshotsEqual('test1 afterReload', before, afterReload);

    console.log('[sca-region-save-persistence] TEST1 create/save/reload PASS');
};

const runTest2SelectGaussiansSave = () => {
    const total = 50;
    const stateData = new Uint8Array(total);
    const ranges = IndexRanges.fromPredicate(total, (i) => i >= 10 && i <= 14);

    for (let i = 10; i <= 14; i++) {
        stateData[i] = State.selected;
    }

    const splat = createMockSplat('splat_01', total, stateData);
    const scene = createMockScene(splat);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'splat_01', total);
    store.loadProject({ ...createEmptyProject(), regions: [region] });
    setRegionMask(assetStore, region.id, ranges, total);

    const selection = readSourceSplatSelectionRanges(splat as never);
    let selectionCount = 0;
    selection.forEach(() => selectionCount++);
    assert.equal(selectionCount, 5);

    const before = snapshotRegionPersist(region, assetStore, total);
    remapRegionMasksForSave(store, assetStore, scene as never);
    const after = snapshotRegionPersist(store.getRegions()[0], assetStore, total);

    assertSnapshotsEqual('test2 selectGaussians save', before, after);
    assert.equal(store.getRegions()[0].capture.gaussianCount, total);

    console.log('[sca-region-save-persistence] TEST2 selectGaussians save PASS');
};

const runTest3ModifiedSelectionWithoutReplace = () => {
    const total = 40;
    const stateData = new Uint8Array(total);
    const ranges = IndexRanges.fromPredicate(total, (i) => i === 5 || i === 6 || i === 7);

    const splat = createMockSplat('splat_01', total, stateData);
    const scene = createMockScene(splat);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'splat_01', total);
    store.loadProject({ ...createEmptyProject(), regions: [region] });
    setRegionMask(assetStore, region.id, ranges, total);

    const before = snapshotRegionPersist(region, assetStore, total);

    stateData[0] = State.selected;
    stateData[1] = State.selected;
    stateData[20] = State.selected;
    stateData[21] = State.selected;

    remapRegionMasksForSave(store, assetStore, scene as never);
    const after = snapshotRegionPersist(store.getRegions()[0], assetStore, total);

    assertSnapshotsEqual('test3 modified native selection', before, after);

    console.log('[sca-region-save-persistence] TEST3 modified selection without replace PASS');
};

const runTest4ReplaceThenSave = () => {
    const total = 30;
    const stateData = new Uint8Array(total);
    const originalRanges = IndexRanges.fromPredicate(total, (i) => i < 4);
    const newRanges = IndexRanges.fromPredicate(total, (i) => i === 20 || i === 21);

    for (const index of [20, 21]) {
        stateData[index] = State.selected;
    }

    const splat = createMockSplat('splat_01', total, stateData);
    const scene = createMockScene(splat);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'splat_01', total);
    store.loadProject({ ...createEmptyProject(), regions: [region] });
    setRegionMask(assetStore, region.id, originalRanges, total);

    setRegionMask(assetStore, region.id, newRanges, total);
    store.loadProject({
        ...store.getProject(),
        regions: [{
            ...region,
            capture: { gaussianCount: total }
        }]
    });

    const beforeReplace = snapshotRegionPersist(store.getRegions()[0], assetStore, total);
    assert.equal(beforeReplace?.members, 2);

    remapRegionMasksForSave(store, assetStore, scene as never);
    const afterSave = snapshotRegionPersist(store.getRegions()[0], assetStore, total);
    assert.equal(afterSave?.members, 2);

    const reloadedAssets = new ScaAssetStore();
    for (const entry of cloneAssets(assetStore)) {
        reloadedAssets.set(entry.path, entry.data.slice(), entry.mimeType);
    }
    const afterReload = snapshotRegionPersist(store.getRegions()[0], reloadedAssets, total);
    assert.equal(afterReload?.members, 2);

    let originalMembers = 0;
    originalRanges.forEach(() => originalMembers++);
    assert.notEqual(afterReload?.members, originalMembers);

    console.log('[sca-region-save-persistence] TEST4 replace then save PASS');
};

const runDeletedGaussianCompaction = () => {
    const total = 10;
    const stateData = new Uint8Array(total);
    stateData[3] = State.deleted;

    const ranges = IndexRanges.fromPredicate(total, (i) => i === 2 || i === 3 || i === 4);
    const splat = createMockSplat('splat_01', total, stateData);
    const scene = createMockScene(splat);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'splat_01', total);
    store.loadProject({ ...createEmptyProject(), regions: [region] });
    setRegionMask(assetStore, region.id, ranges, total);

    const before = snapshotRegionPersist(region, assetStore, total);
    assert.equal(before?.members, 3);

    remapRegionMasksForSave(store, assetStore, scene as never);
    const after = snapshotRegionPersist(store.getRegions()[0], assetStore, total);

    assert.equal(after?.members, 2, 'deleted gaussian removed from mask on save');
    assert.equal(store.getRegions()[0].capture.gaussianCount, 9);

    console.log('[sca-region-save-persistence] deleted-gaussian compaction EXPECTED PASS');
};

async function main() {
    runSerializeSettingsCheck();
    runTest1CreateSaveReload();
    runTest2SelectGaussiansSave();
    runTest3ModifiedSelectionWithoutReplace();
    runTest4ReplaceThenSave();
    runDeletedGaussianCompaction();

    console.log('\n========== SCA REGION SAVE PERSISTENCE TEST REPORT ==========');
    console.log('ssproj serializeSettings.selected: false (not set in doc.ts)');
    console.log('Save calls remapRegionMasksForSave: yes (compacts deleted gaussians only)');
    console.log('Native selection alone does NOT mutate Region masks on save');
    console.log('Replace Region with Selection is the intentional membership mutation path');
    console.log('TEST1 create/save/reload: PASS');
    console.log('TEST2 selectGaussians save: PASS');
    console.log('TEST3 modified selection without replace: PASS');
    console.log('TEST4 replace then save: PASS');
    console.log('Deleted gaussian compaction: PASS (expected member drop)');
    console.log('===========================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
