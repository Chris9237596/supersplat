import { strict as assert } from 'node:assert';

import { Events } from '../src/events';
import { IndexRanges } from '../src/index-ranges';
import { decodeRuntimePickPixel } from '../src/sca/runtime/runtime-webgpu-picker';
import {
    buildRegionPresentationEntry,
    buildRegionPresentationState,
    computeRegionAnchorFromBitset,
    createCentersAccessorFromFloat32,
    getVisitedPresentationEntries,
    layoutRegionCard,
    parseRegionActiveColor,
    parseRegionHoverColor,
    resolveEntryState,
    resolveRegionVisual,
    resolveRegionPulse,
    resolveRegionPulsePreview,
    normalizeRegionPulse,
    shouldPlayAuthoredRegionPulse,
    shouldStopPulseOnRegionInteraction
} from '../src/sca/presentation';
import { resolveRegion, isClickableRegion, ScaRegionInteractionCore } from '../src/sca/interaction/sca-region-core';
import { createStorageRegionMaskLookup } from '../src/sca/interaction/sca-storage-mask-lookup';
import { ScaRegionMembershipOp } from '../src/sca/edit/sca-region-ops';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { generateRegionId } from '../src/sca/ids/generate-region-id';
import { generateSplatId } from '../src/sca/ids/generate-splat-id';
import { createDefaultRegion, normalizeRegions } from '../src/sca/region-defaults';
import {
    decodeRegionMask,
    encodeRegionMask,
    remapIndexRanges,
    buildCompactionMap
} from '../src/sca/regions/region-mask-format';
import {
    indexRangesToSelectionMask,
    resolveRegionGaussianSelection
} from '../src/sca/regions/region-selection-apply';
import {
    readSourceSplatSelectionRanges,
    resolveRegionReplaceContext
} from '../src/sca/regions/region-selection-replace';
import { getRegionMask, cloneAssets, setRegionMask } from '../src/sca/regions/region-mask-store';
import { regionMaskStorePath } from '../src/sca/regions/region-mask-paths';
import { SelectOp } from '../src/edit-ops';
import { remapRegionMaskToRuntime } from '../src/sca/regions/region-mask-runtime-export';
import {
    deserializeSsprojScaBlock,
    serializeSsprojScaBlock
} from '../src/sca/persistence/sca-project-persistence';
import { ExportGaussianMap } from '../src/splat-serialize';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import { ScaRegion } from '../src/sca/types/region';
import { State } from '../src/splat-state';

const sampleRegion = (
    id: string,
    name: string,
    scaSplatId: string,
    gaussianCount: number
): ScaRegion => ({
    id,
    name,
    enabled: true,
    source: {
        type: 'gaussian-mask',
        scaSplatId,
        maskAsset: `sca/regions/${id}.mask`
    },
    capture: {
        gaussianCount
    },
    interaction: {
        clickable: true,
        showCard: true
    },
    visual: {
        hoverTint: '#ff6600',
        hoverOpacity: 0.35,
        activeTint: '#ff6600',
        activeOpacity: 0.55
    }
});

const runIdTests = () => {
    const empty = createEmptyProject();
    assert.equal(generateRegionId(empty), 'region_01');
    assert.equal(generateSplatId(new Set()), 'splat_01');
    assert.equal(generateSplatId(new Set(['splat_01'])), 'splat_02');
    console.log('[sca-regions] id allocation PASS');
};

const runMaskFormatTests = () => {
    const ranges = IndexRanges.fromPredicate(10, (i) => i === 2 || i === 3 || i === 7);
    const encoded = encodeRegionMask(ranges, 10);
    const decoded = decodeRegionMask(encoded);

    assert.equal(decoded.header.gaussianCount, 10);
    const members: number[] = [];
    decoded.ranges.forEach((index) => members.push(index));
    assert.deepEqual(members, [2, 3, 7]);

    console.log('[sca-regions] mask encode/decode PASS');
};

const runRemapTests = () => {
    const state = new Uint8Array(6);
    state[1] = State.deleted;
    state[4] = State.deleted;

    const { map, survivorCount } = buildCompactionMap(state);
    assert.equal(survivorCount, 4);

    const ranges = IndexRanges.fromPredicate(6, (i) => i === 0 || i === 1 || i === 2 || i === 5);
    const remapped = remapIndexRanges(ranges, map, survivorCount);

    const members: number[] = [];
    remapped.forEach((index) => members.push(index));
    assert.deepEqual(members, [0, 1, 3]);

    const roundTrip = encodeRegionMask(remapped, survivorCount);
    const decoded = decodeRegionMask(roundTrip);
    assert.equal(decoded.header.gaussianCount, survivorCount);

    console.log('[sca-regions] mask remapping PASS');
};

const runStoreTests = () => {
    const store = new HotspotStore(createEmptyProject());
    const region = createDefaultRegion(store.getProject(), 'splat_01', 1000, 'Kitchen');

    store.addRegion(region);
    assert.equal(store.getRegions()[0].source.type, 'gaussian-mask');
    assert.equal(store.getRegions()[0].source.scaSplatId, 'splat_01');
    assert.equal(store.getRegions()[0].capture.gaussianCount, 1000);

    store.deleteRegion('region_01');
    assert.equal(store.getRegions().length, 0);

    console.log('[sca-regions] store CRUD PASS');
};

const runLegacyRejectTests = () => {
    const normalized = normalizeRegions([
        sampleRegion('region_01', 'Valid', 'splat_01', 10),
        {
            id: 'legacy_01',
            name: 'Legacy',
            enabled: true,
            source: { type: 'splat-object', splatId: 'region_01' },
            interaction: { clickable: true },
            visual: sampleRegion('x', 'x', 'splat_01', 1).visual
        }
    ]);

    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].id, 'region_01');

    console.log('[sca-regions] legacy region rejection PASS');
};

const runPersistenceTests = () => {
    const source = {
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [
            sampleRegion('region_01', 'Alpha', 'splat_01', 100),
            sampleRegion('region_02', 'Beta', 'splat_01', 100)
        ],
        viewer: undefined
    };

    const block = serializeSsprojScaBlock(source);
    const restored = deserializeSsprojScaBlock(block);

    assert.equal(restored.regions[0].source.type, 'gaussian-mask');
    assert.equal(restored.regions[0].source.scaSplatId, 'splat_01');
    assert.equal(restored.regions[0].capture.gaussianCount, 100);

    console.log('[sca-regions] ssproj round-trip PASS');
};

/**
 * Runtime region mask decode and lookup tests (Node).
 * Full browser runtime is covered by sca-smoke-test.mjs.
 */
const runRuntimeLookupTests = () => {
    const regions = [
        sampleRegion('region_01', 'Alpha', 'splat_01', 10),
        sampleRegion('region_02', 'Beta', 'splat_01', 10)
    ];

    const maskA = encodeRegionMask(IndexRanges.fromPredicate(10, (i) => i === 2), 10);
    const maskB = encodeRegionMask(IndexRanges.fromPredicate(10, (i) => i === 2 || i === 5), 10);

    const maskBytesByRegionId = new Map([
        ['region_01', maskA],
        ['region_02', maskB]
    ]);

    // Simulate browser buildRegionLookup
    const buildMembershipBitset = (payload: Uint32Array, gaussianCount: number) => {
        const SINGLE_BIT = 0x80000000;
        const INDEX_MASK = 0x7fffffff;
        const bitset = new Uint8Array(gaussianCount);
        let r = 0;
        while (r < payload.length) {
            if (payload[r] & SINGLE_BIT) {
                const index = payload[r] & INDEX_MASK;
                if (index >= 0 && index < gaussianCount) {
                    bitset[index] = 1;
                }
                r += 1;
            } else {
                const start = payload[r];
                const count = payload[r + 1];
                for (let i = start, end = start + count; i < end; i++) {
                    if (i >= 0 && i < gaussianCount) {
                        bitset[i] = 1;
                    }
                }
                r += 2;
            }
        }
        return bitset;
    };

    const bySplatId = new Map<string, { gaussianCount: number; entries: { regionId: string; bitset: Uint8Array }[] }>();
    const unified = { gaussianCount: 10, entries: [] as { regionId: string; bitset: Uint8Array }[] };
    for (const region of regions) {
        const decoded = decodeRegionMask(maskBytesByRegionId.get(region.id)!);
        const bitset = buildMembershipBitset(decoded.ranges.data, decoded.header.gaussianCount);
        unified.entries.push({ regionId: region.id, bitset });
    }

    const resolve = (index: number) => {
        for (const entry of unified.entries) {
            if (entry.bitset[index]) {
                return entry.regionId;
            }
        }
        return null;
    };

    assert.equal(resolve(2), 'region_01', 'overlap uses first project region order');
    assert.equal(resolve(5), 'region_02');
    assert.equal(resolve(0), null);

    console.log('[sca-regions] runtime lookup overlap PASS');
};

const runInteractionDefaultsTests = () => {
    const normalized = normalizeRegions([{
        ...sampleRegion('region_01', 'Alpha', 'splat_01', 10),
        interaction: { clickable: true }
    }]);

    assert.equal(normalized[0].interaction.showCard, true);
    assert.equal(normalized[0].interaction.showInNavigation, true);

    const created = createDefaultRegion(createEmptyProject(), 'splat_01', 10);
    assert.equal(created.interaction.showCard, true);
    assert.equal(created.interaction.showInNavigation, true);

    console.log('[sca-regions] interaction defaults PASS');
};

const runHistoryTests = async () => {
    const events = new Events();
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const before = store.getProject();
    const region = createDefaultRegion(before, 'splat_01', 50, 'Lobby');
    const after = {
        ...before,
        regions: [region]
    };

    const op = new ScaProjectOp(
        events,
        store,
        assetStore,
        before,
        after,
        null,
        null,
        null,
        region.id,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.do();
    assert.equal(store.getRegions().length, 1);

    await op.undo();
    assert.equal(store.getRegions().length, 0);

    const ranges = IndexRanges.fromPredicate(20, (i) => i < 5);
    const maskBytes = encodeRegionMask(ranges, 20);
    const beforeAssets = emptyAssets;
    const afterAssets = [{
        path: 'regions/region_01.mask',
        data: maskBytes,
        mimeType: 'application/x-sca-region-mask'
    }];

    const createOp = new ScaRegionMembershipOp(
        'createRegion',
        events,
        store,
        assetStore,
        applying,
        before,
        after,
        null,
        null,
        beforeAssets,
        afterAssets,
        null,
        null
    );

    await createOp.do();
    assert.equal(store.getRegions().length, 1);
    assert.ok(assetStore.get('regions/region_01.mask'));

    await createOp.undo();
    assert.equal(store.getRegions().length, 0);
    assert.equal(assetStore.get('regions/region_01.mask'), undefined);

    console.log('[sca-regions] membership op undo/redo PASS');
};

const runIndexRangeSetOpsTests = () => {
    const total = 12;
    const a = IndexRanges.fromPredicate(total, (i) => i < 6);
    const b = IndexRanges.fromPredicate(total, (i) => i >= 4 && i < 9);

    const union = IndexRanges.union(a, b, total);
    const unionMembers: number[] = [];
    union.forEach((index) => unionMembers.push(index));
    assert.deepEqual(unionMembers, [0, 1, 2, 3, 4, 5, 6, 7, 8]);

    const subtract = IndexRanges.subtract(a, IndexRanges.fromPredicate(total, (i) => i >= 2 && i < 4), total);
    const subtractMembers: number[] = [];
    subtract.forEach((index) => subtractMembers.push(index));
    assert.deepEqual(subtractMembers, [0, 1, 4, 5]);

    console.log('[sca-regions] IndexRanges union/subtract PASS');
};

const runRuntimeExportRemapTests = () => {
    const exportMap: ExportGaussianMap = {
        exportCount: 4,
        runtimeGaussianCount: 4,
        splatOf: new Uint32Array([0, 0, 0, 0]),
        localOf: new Uint32Array([0, 2, 3, 5]),
        storageToExportRowBySplatId: new Map([
            ['splat_01', new Int32Array([0, -1, 1, 2, -1, 3])]
        ]),
        exportRowToRuntime: new Uint32Array([3, 1, 0, 2])
    };

    const sourceMask = encodeRegionMask(
        IndexRanges.fromPredicate(6, (i) => i === 0 || i === 2 || i === 5),
        6
    );
    const region = sampleRegion('region_01', 'Alpha', 'splat_01', 6);

    const remapped = remapRegionMaskToRuntime(sourceMask, region, exportMap, false);
    const decoded = decodeRegionMask(remapped.bytes);

    assert.equal(decoded.header.gaussianCount, 4);

    const members: number[] = [];
    decoded.ranges.forEach((index) => members.push(index));
    members.sort((a, b) => a - b);
    assert.deepEqual(members, [1, 2, 3]);

    console.log('[sca-regions] runtime export mask remap PASS');
};

const runRegionCoreTests = () => {
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const scaSplatId = 'splat_01';

    const regionA = sampleRegion('region_01', 'Alpha', scaSplatId, 10);
    const regionB = sampleRegion('region_02', 'Beta', scaSplatId, 10);
    store.addRegion(regionA);
    store.addRegion(regionB);

    assetStore.set(
        'regions/region_01.mask',
        encodeRegionMask(IndexRanges.fromPredicate(10, (i) => i === 2), 10),
        'application/x-sca-region-mask'
    );
    assetStore.set(
        'regions/region_02.mask',
        encodeRegionMask(IndexRanges.fromPredicate(10, (i) => i === 2 || i === 5), 10),
        'application/x-sca-region-mask'
    );

    const lookup = createStorageRegionMaskLookup(store, assetStore);

    assert.equal(resolveRegion(2, scaSplatId, lookup)?.regionId, 'region_01');
    assert.equal(resolveRegion(5, scaSplatId, lookup)?.regionId, 'region_02');
    assert.equal(resolveRegion(0, scaSplatId, lookup), null);
    assert.equal(resolveRegion(null, scaSplatId, lookup), null);

    const nonClickable = {
        ...regionA,
        interaction: { clickable: false }
    };
    assert.equal(isClickableRegion(nonClickable), false);
    assert.equal(isClickableRegion(regionA), true);

    let selectedRegionId: string | null = null;
    const core = new ScaRegionInteractionCore(lookup, {
        getRegion: (regionId) => {
            if (regionId === regionA.id) {
                return regionA;
            }
            if (regionId === regionB.id) {
                return regionB;
            }
            return null;
        },
        getSelectedRegionId: () => selectedRegionId,
        onHoverChange: () => {},
        onSelectionChange: (regionId) => {
            selectedRegionId = regionId;
        }
    });

    core.activateRegion('region_01', 'click');
    assert.equal(selectedRegionId, 'region_01');

    core.activateRegion('region_01', 'click');
    assert.equal(selectedRegionId, null);

    core.activateRegion('region_01', 'click');
    assert.equal(selectedRegionId, 'region_01');

    core.activateRegion(null, 'click');
    assert.equal(selectedRegionId, null);

    core.activateRegion('region_02', 'nav');
    assert.equal(selectedRegionId, 'region_02');

    core.activateRegion('region_02', 'nav');
    assert.equal(selectedRegionId, 'region_02');

    console.log('[sca-regions] shared region core PASS');
};

const runPresentationTests = () => {
    const region = sampleRegion('region_01', 'Region 1', 'splat_01', 4);
    const hoverVisual = resolveRegionVisual(region, 'hover');
    const activeVisual = resolveRegionVisual(region, 'selected');

    assert.ok(hoverVisual);
    assert.ok(activeVisual);
    assert.equal(parseRegionHoverColor(region.visual.hoverTint, region.visual.hoverOpacity).a, 0.35);
    assert.equal(parseRegionActiveColor(region.visual.activeTint, region.visual.activeOpacity).a, 0.55);

    const centers = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0
    ]);
    const bitset = new Uint8Array([1, 0, 1, 0]);
    const accessor = createCentersAccessorFromFloat32(centers, 4);
    const anchor = computeRegionAnchorFromBitset(bitset, accessor);
    assert.ok(anchor);
    assert.equal(anchor!.x, 0);
    assert.equal(anchor!.y, 0.5);
    assert.equal(anchor!.z, 0);

    const entry = buildRegionPresentationEntry(region, null, region.id, anchor);
    assert.equal(entry.cardVisible, true);
    assert.equal(entry.state, 'selected');

    const state = buildRegionPresentationState([region], region.id, region.id, new Map([[region.id, anchor!]]));
    assert.equal(state.selectedRegionId, region.id);
    assert.equal(state.regions[region.id].name, 'Region 1');

    const layout = layoutRegionCard({
        screenX: 100,
        screenY: 100,
        cardWidth: 120,
        cardHeight: 80,
        viewportWidth: 800,
        viewportHeight: 600
    });
    assert.ok(layout.left >= 8);
    assert.ok(layout.top >= 8);

    console.log('[sca-regions] shared presentation PASS');
};

const runRegionSelectionApplyTests = () => {
    const total = 20;
    const ranges = IndexRanges.fromPredicate(total, (i) => i === 2 || i === 5 || i === 6 || i === 7);
    const mask = indexRangesToSelectionMask(ranges, total);

    assert.equal(mask[2], 255);
    assert.equal(mask[5], 255);
    assert.equal(mask[6], 255);
    assert.equal(mask[0], 0);
    assert.equal(mask[19], 0);

    const stateData = new Uint8Array(total);
    stateData[0] = State.selected;
    stateData[1] = State.selected;

    const splatState = {
        data: stateData,
        setBits: (range: IndexRanges, bit: number) => {
            range.forEach((index) => {
                stateData[index] |= bit;
            });
        },
        clearBits: (range: IndexRanges, bit: number) => {
            range.forEach((index) => {
                stateData[index] &= ~bit;
            });
        },
        toggleBits: (range: IndexRanges, bit: number) => {
            range.forEach((index) => {
                stateData[index] ^= bit;
            });
        },
        flush: () => {}
    };

    const mockSplat = {
        visible: true,
        scaSplatId: 'splat_01',
        splatData: {
            numSplats: total,
            getProp: (name: string) => (name === 'state' ? stateData : undefined)
        },
        state: splatState,
        updateState: async () => {}
    };

    const selectOp = new SelectOp(mockSplat as never, 'set', mask);
    void selectOp.do();

    assert.equal(stateData[2] & State.selected, State.selected);
    assert.equal(stateData[5] & State.selected, State.selected);
    assert.equal(stateData[6] & State.selected, State.selected);
    assert.equal(stateData[7] & State.selected, State.selected);
    assert.equal(stateData[0] & State.selected, 0);
    assert.equal(stateData[1] & State.selected, 0);

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'Region 1', 'splat_01', total);
    store.loadProject({
        ...createEmptyProject(),
        regions: [region]
    });
    assetStore.set(regionMaskStorePath(region.id), encodeRegionMask(ranges, total), 'application/x-sca-region-mask');

    const otherSplat = {
        visible: true,
        scaSplatId: 'splat_02',
        splatData: { numSplats: total }
    };

    const scene = {
        getElementsByType: () => [mockSplat, otherSplat]
    };

    const resolved = resolveRegionGaussianSelection(store, assetStore, scene as never, region.id);
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
        assert.equal(resolved.splat.scaSplatId, 'splat_01');
        assert.equal(resolved.gaussianCount, total);
    }

    const missingSplat = resolveRegionGaussianSelection(
        store,
        assetStore,
        { getElementsByType: () => [otherSplat] } as never,
        region.id
    );
    assert.equal(missingSplat.ok, false);

    const beforeProject = JSON.stringify(store.getProject());
    const beforeAssets = assetStore.get(regionMaskStorePath(region.id))!.data.slice();
    assert.equal(stateData[2] & State.selected, State.selected);
    assert.equal(beforeProject.includes('region_01'), true);
    assert.equal(beforeAssets.length > 0, true);

    console.log('[sca-regions] region selection apply PASS');
};

const runRegionReplaceSelectionTests = async () => {
    const total = 20;
    const originalRanges = IndexRanges.fromPredicate(total, (i) => i < 4);
    const newSelectionRanges = IndexRanges.fromPredicate(total, (i) => i === 10 || i === 11 || i === 12);

    const stateData = new Uint8Array(total);
    for (const index of [10, 11, 12]) {
        stateData[index] = State.selected;
    }

    const mockSplat = {
        visible: true,
        scaSplatId: 'splat_01',
        splatData: {
            numSplats: total,
            getProp: (name: string) => (name === 'state' ? stateData : undefined)
        }
    };

    const otherSplat = {
        visible: true,
        scaSplatId: 'splat_02',
        splatData: { numSplats: total }
    };

    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const region = sampleRegion('region_01', 'Region 1', 'splat_01', total);
    region.name = 'Keep This Name';
    region.text = 'Keep This Text';
    store.loadProject({
        ...createEmptyProject(),
        regions: [region]
    });
    setRegionMask(assetStore, region.id, originalRanges, total);

    const scene = {
        getElementsByType: () => [mockSplat, otherSplat]
    };

    const context = resolveRegionReplaceContext(store, scene as never, region.id);
    assert.equal(context.ok, true);
    if (context.ok) {
        assert.equal(context.splat.scaSplatId, 'splat_01');
    }

    const selection = readSourceSplatSelectionRanges(mockSplat as never);
    const selectedIndices: number[] = [];
    selection.forEach((index) => selectedIndices.push(index));
    assert.deepEqual(selectedIndices, [10, 11, 12]);

    const beforeProject = structuredClone(store.getProject());
    const beforeAssets = cloneAssets(assetStore);
    const afterProject = structuredClone(beforeProject);
    afterProject.regions[0].capture.gaussianCount = total;

    setRegionMask(assetStore, region.id, newSelectionRanges, total);
    const afterAssets = cloneAssets(assetStore);

    const events = new Events();
    const applying = { value: false };

    const replaceOp = new ScaRegionMembershipOp(
        'replaceRegionSelection',
        events,
        store,
        assetStore,
        applying,
        beforeProject,
        afterProject,
        region.id,
        region.id,
        beforeAssets,
        afterAssets,
        null,
        null
    );

    await replaceOp.do();

    const replacedMask = getRegionMask(assetStore, region.id);
    assert.ok(replacedMask);
    const replacedIndices: number[] = [];
    replacedMask!.forEach((index) => replacedIndices.push(index));
    assert.deepEqual(replacedIndices, [10, 11, 12]);
    assert.equal(store.getRegions()[0].name, 'Keep This Name');
    assert.equal(store.getRegions()[0].text, 'Keep This Text');

    await replaceOp.undo();
    const restoredMask = getRegionMask(assetStore, region.id);
    const restoredIndices: number[] = [];
    restoredMask!.forEach((index) => restoredIndices.push(index));
    assert.deepEqual(restoredIndices, [0, 1, 2, 3]);
    assert.equal(store.getRegions()[0].name, 'Keep This Name');

    await replaceOp.do();
    const redoMask = getRegionMask(assetStore, region.id);
    const redoIndices: number[] = [];
    redoMask!.forEach((index) => redoIndices.push(index));
    assert.deepEqual(redoIndices, [10, 11, 12]);

    console.log('[sca-regions] region replace selection PASS');
};

const runRuntimePickDecodeTests = () => {
    const miss = decodeRuntimePickPixel([0, 0, 0, 0]);
    assert.equal(miss.gaussianIndex, null);

    const encoded = 33961;
    const r = encoded & 0xff;
    const g = (encoded >> 8) & 0xff;
    const b = (encoded >> 16) & 0xff;
    const a = (encoded >> 24) & 0xff;
    const hit = decodeRuntimePickPixel([r, g, b, a]);
    assert.equal(hit.gaussianIndex, 33960);

    console.log('[sca-regions] runtime pick decode PASS');
};

const runRegionPulseTests = () => {
    const withoutPulse = normalizeRegions([sampleRegion('region_01', 'Alpha', 'splat_01', 10)])[0];
    assert.equal(withoutPulse.visual.pulse, undefined);

    const withPulse = normalizeRegions([{
        ...sampleRegion('region_01', 'Alpha', 'splat_01', 10),
        visual: {
            ...sampleRegion('region_01', 'Alpha', 'splat_01', 10).visual,
            pulse: {
                enabled: true,
                color: '#112233',
                strength: 0.75,
                speed: 2,
                mode: 'once'
            }
        }
    }])[0];

    assert.equal(withPulse.visual.pulse?.enabled, true);
    assert.equal(withPulse.visual.pulse?.color, '#112233');
    assert.equal(withPulse.visual.pulse?.strength, 0.75);
    assert.equal(withPulse.visual.pulse?.speed, 2);
    assert.equal(withPulse.visual.pulse?.mode, 'once');

    const block = serializeSsprojScaBlock({
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [withPulse],
        viewer: undefined
    });
    const restored = deserializeSsprojScaBlock(block);
    assert.equal(restored.regions[0].visual.pulse?.enabled, true);
    assert.equal(restored.regions[0].visual.pulse?.mode, 'once');

    const resolved = resolveRegionPulse(withPulse);
    assert.ok(resolved);
    assert.equal(resolved!.strength, 0.75);
    assert.equal(resolved!.mode, 'once');

    const disabled = resolveRegionPulse({
        ...withPulse,
        visual: {
            ...withPulse.visual,
            pulse: { ...withPulse.visual.pulse!, enabled: false }
        }
    });
    assert.equal(disabled, null);

    const preview = resolveRegionPulsePreview(withoutPulse);
    assert.ok(preview);
    assert.equal(preview!.mode, 'loop');

    const normalizedPulse = normalizeRegionPulse({
        enabled: true,
        color: '#aabbcc',
        strength: 2,
        speed: 99,
        mode: 'loop'
    }, '#ff6600');
    assert.equal(normalizedPulse?.color, '#aabbcc');
    assert.equal(normalizedPulse?.strength, 1);
    assert.equal(normalizedPulse?.speed, 8);

    const stopOnInteractionRegion = normalizeRegions([{
        ...sampleRegion('region_01', 'Alpha', 'splat_01', 10),
        visual: {
            ...sampleRegion('region_01', 'Alpha', 'splat_01', 10).visual,
            pulse: {
                enabled: true,
                color: '#ff6600',
                strength: 0.5,
                speed: 1,
                mode: 'loop',
                stopOnInteraction: true
            }
        }
    }])[0];

    assert.equal(stopOnInteractionRegion.visual.pulse?.stopOnInteraction, true);

    const stopBlock = serializeSsprojScaBlock({
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [stopOnInteractionRegion],
        viewer: undefined
    });
    const stopRestored = deserializeSsprojScaBlock(stopBlock);
    assert.equal(stopRestored.regions[0].visual.pulse?.stopOnInteraction, true);

    const loopPulse = stopOnInteractionRegion;
    assert.equal(
        shouldPlayAuthoredRegionPulse(loopPulse, { regionVisited: false }),
        true
    );
    assert.equal(
        shouldPlayAuthoredRegionPulse(loopPulse, { regionVisited: true }),
        false
    );
    assert.equal(
        shouldPlayAuthoredRegionPulse(loopPulse, { pulseStoppedByInteraction: false }),
        true
    );
    assert.equal(
        shouldPlayAuthoredRegionPulse(loopPulse, { pulseStoppedByInteraction: true }),
        false
    );
    assert.equal(shouldStopPulseOnRegionInteraction(loopPulse), true);
    assert.equal(
        shouldStopPulseOnRegionInteraction({
            ...loopPulse,
            visual: {
                ...loopPulse.visual,
                pulse: { ...loopPulse.visual.pulse!, stopOnInteraction: false }
            }
        }),
        false
    );

    console.log('[sca-regions] region pulse PASS');
};

const runRegionVisitedTests = () => {
    const base = sampleRegion('region_01', 'Alpha', 'splat_01', 10);
    const withoutVisited = normalizeRegions([base])[0];
    assert.equal(withoutVisited.visual.visited, undefined);

    const withVisited = normalizeRegions([{
        ...base,
        visual: {
            ...base.visual,
            visited: {
                enabled: true,
                color: '#224466',
                opacity: 0.4
            }
        }
    }])[0];

    assert.equal(withVisited.visual.visited?.enabled, true);
    assert.equal(withVisited.visual.visited?.color, '#224466');
    assert.equal(withVisited.visual.visited?.opacity, 0.4);

    const block = serializeSsprojScaBlock({
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [withVisited],
        viewer: undefined
    });
    const restored = deserializeSsprojScaBlock(block);
    assert.equal(restored.regions[0].visual.visited?.enabled, true);
    assert.equal(restored.regions[0].visual.visited?.color, '#224466');

    assert.equal(resolveEntryState('region_01', null, null, new Set(['region_01'])), 'visited');
    assert.equal(resolveEntryState('region_01', 'region_01', null, new Set(['region_01'])), 'hover');
    assert.equal(resolveEntryState('region_01', null, 'region_01', new Set(['region_01'])), 'selected');

    const visitedVisual = resolveRegionVisual(withVisited, 'visited');
    assert.ok(visitedVisual);
    assert.equal(visitedVisual!.state, 'visited');

    const disabledVisitedVisual = resolveRegionVisual({
        ...withVisited,
        visual: {
            ...withVisited.visual,
            visited: { enabled: false, color: '#224466', opacity: 0.4 }
        }
    }, 'visited');
    assert.equal(disabledVisitedVisual, null);

    const implicitEnabledVisitedVisual = resolveRegionVisual({
        ...withVisited,
        visual: {
            ...withVisited.visual,
            visited: { color: '#224466', opacity: 0.4 }
        }
    }, 'visited');
    assert.ok(implicitEnabledVisitedVisual);
    assert.equal(implicitEnabledVisitedVisual!.state, 'visited');

    const presentation = buildRegionPresentationState(
        [withVisited],
        null,
        null,
        new Map(),
        new Set(['region_01'])
    );
    const visitedEntries = getVisitedPresentationEntries(presentation);
    assert.equal(visitedEntries.length, 1);
    assert.equal(visitedEntries[0].state, 'visited');

    console.log('[sca-regions] region visited PASS');
};

async function main() {
    runIdTests();
    runMaskFormatTests();
    runRemapTests();
    runStoreTests();
    runLegacyRejectTests();
    runPersistenceTests();
    runRuntimeLookupTests();
    runInteractionDefaultsTests();
    runIndexRangeSetOpsTests();
    runRuntimeExportRemapTests();
    runRegionCoreTests();
    runPresentationTests();
    runRegionSelectionApplyTests();
    await runRegionReplaceSelectionTests();
    runRuntimePickDecodeTests();
    runRegionPulseTests();
    runRegionVisitedTests();
    await runHistoryTests();

    console.log('\n========== SCA REGIONS PHASE 1 REWORK TEST REPORT ==========');
    console.log('ID allocation: PASS');
    console.log('Mask encode/decode: PASS');
    console.log('Mask remapping: PASS');
    console.log('Store CRUD: PASS');
    console.log('Legacy rejection: PASS');
    console.log('Ssproj round-trip: PASS');
    console.log('Runtime lookup overlap: PASS');
    console.log('Interaction defaults: PASS');
    console.log('IndexRanges union/subtract: PASS');
    console.log('Runtime export mask remap: PASS');
    console.log('Shared region core: PASS');
    console.log('Shared presentation: PASS');
    console.log('Region selection apply: PASS');
    console.log('Region replace selection: PASS');
    console.log('Runtime pick decode: PASS');
    console.log('Region pulse: PASS');
    console.log('Region visited: PASS');
    console.log('Membership op undo/redo: PASS');
    console.log('===========================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
