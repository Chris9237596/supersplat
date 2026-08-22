import { strict as assert } from 'node:assert';

import { Events } from '../src/events';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { generateStateLayerId } from '../src/sca/ids/generate-state-layer-id';
import { normalizeRegions } from '../src/sca/region-defaults';
import {
    createDefaultPlaceholderLayer,
    createDefaultRegionOverlayLayer,
    mergeVisualStateContent,
    normalizeVisualStateContent,
    PHASE0_LAYER_TYPE,
    REGION_OVERLAY_LAYER_TYPE
} from '../src/sca/region-state-content';
import {
    parseRegionOverlayColor,
    resolveFirstEnabledRegionOverlayLayer
} from '../src/sca/presentation/region-state-overlay';
import { DEFAULT_REGION_OVERLAY_COLOR, DEFAULT_REGION_OVERLAY_OPACITY } from '../src/sca/region-defaults';
import {
    deserializeSsprojScaBlock,
    serializeSsprojScaBlock
} from '../src/sca/persistence/sca-project-persistence';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject, ScaProject, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import { ScaRegion } from '../src/sca/types/region';
import { stringifyProjectJson } from '../src/sca/serialize/project-json';

const sampleRegion = (id: string, scaSplatId: string): ScaRegion => ({
    id,
    name: id,
    enabled: true,
    source: {
        type: 'gaussian-mask',
        scaSplatId,
        maskAsset: `sca/regions/${id}.mask`
    },
    capture: { gaussianCount: 100 },
    interaction: { clickable: true, showCard: true, showInNavigation: true },
    visual: {
        hoverTint: '#ff6600',
        hoverOpacity: 0.35,
        activeTint: '#ff6600',
        activeOpacity: 0.55,
        visited: {
            enabled: true,
            color: '#224466',
            opacity: 0.4
        }
    }
});

const runNormalizationTests = () => {
    const normalized = normalizeVisualStateContent({
        visited: {
            layers: [
                { id: 'state_layer_01', type: 'placeholder', enabled: true, name: 'Visited Overlay' },
                { id: 'bad_id', type: 'placeholder', enabled: true },
                { id: 'state_layer_02', type: 'splat', enabled: false, name: 'Future Layer' }
            ]
        }
    });

    assert.ok(normalized?.visited);
    assert.equal(normalized!.visited!.layers.length, 2);
    assert.equal(normalized!.visited!.layers[0].id, 'state_layer_01');
    assert.equal(normalized!.visited!.layers[0].type, PHASE0_LAYER_TYPE);
    assert.equal(normalized!.visited!.layers[1].type, 'splat');

    const empty = normalizeVisualStateContent({ visited: { layers: [] } });
    assert.equal(empty, undefined);

    console.log('[sca-state-content] normalization PASS');
};

const runRegionOverlayNormalizationTests = () => {
    const normalized = normalizeVisualStateContent({
        visited: {
            layers: [
                {
                    id: 'state_layer_01',
                    type: 'region-overlay',
                    enabled: true,
                    name: 'Visited Overlay',
                    color: '#00aaff',
                    opacity: 0.4
                },
                {
                    id: 'state_layer_02',
                    type: 'region-overlay',
                    enabled: true,
                    color: 'bad',
                    opacity: 99
                }
            ]
        }
    });

    assert.ok(normalized?.visited);
    assert.equal(normalized!.visited!.layers.length, 2);
    assert.equal(normalized!.visited!.layers[0].type, REGION_OVERLAY_LAYER_TYPE);
    assert.equal((normalized!.visited!.layers[0] as { color: string }).color, '#00aaff');
    assert.equal((normalized!.visited!.layers[1] as { color: string }).color, DEFAULT_REGION_OVERLAY_COLOR);
    assert.equal((normalized!.visited!.layers[1] as { opacity: number }).opacity, 1);

    const defaultLayer = createDefaultRegionOverlayLayer('state_layer_03');
    assert.equal(defaultLayer.type, 'region-overlay');
    assert.equal(defaultLayer.color, DEFAULT_REGION_OVERLAY_COLOR);
    assert.equal(defaultLayer.opacity, DEFAULT_REGION_OVERLAY_OPACITY);

    const region = {
        ...sampleRegion('region_01', 'splat_01'),
        visual: {
            ...sampleRegion('region_01', 'splat_01').visual,
            stateContent: {
                visited: {
                    layers: [
                        createDefaultPlaceholderLayer('state_layer_01'),
                        createDefaultRegionOverlayLayer('state_layer_02', 'Overlay A'),
                        createDefaultRegionOverlayLayer('state_layer_03', 'Overlay B')
                    ]
                }
            }
        }
    };

    const firstOverlay = resolveFirstEnabledRegionOverlayLayer(region);
    assert.ok(firstOverlay);
    assert.equal(firstOverlay!.id, 'state_layer_02');

    const tint = parseRegionOverlayColor(firstOverlay!);
    assert.equal(tint.a, DEFAULT_REGION_OVERLAY_OPACITY);

    console.log('[sca-state-content] region-overlay normalization PASS');
};

const runIdGenerationTests = () => {
    const project = createEmptyProject();
    project.regions = [
        {
            ...sampleRegion('region_01', 'splat_01'),
            visual: {
                ...sampleRegion('region_01', 'splat_01').visual,
                stateContent: {
                    visited: {
                        layers: [createDefaultPlaceholderLayer('state_layer_01')]
                    }
                }
            }
        }
    ];

    assert.equal(generateStateLayerId(project), 'state_layer_02');

    console.log('[sca-state-content] id generation PASS');
};

const runStoreMergeTests = () => {
    const store = new HotspotStore(createEmptyProject());
    store.addRegion(sampleRegion('region_01', 'splat_01'));

    store.updateRegion('region_01', {
        visual: {
            stateContent: {
                visited: {
                    layers: [createDefaultPlaceholderLayer('state_layer_01', 'Layer A')]
                }
            }
        }
    });

    let region = store.getProject().regions[0];
    assert.equal(region.visual.stateContent?.visited?.layers.length, 1);
    assert.equal(region.visual.stateContent?.visited?.layers[0].name, 'Layer A');
    assert.equal(region.visual.visited?.enabled, true);

    store.updateRegion('region_01', {
        visual: {
            stateContent: {
                visited: {
                    layers: [
                        {
                            ...region.visual.stateContent!.visited!.layers[0],
                            enabled: false,
                            name: 'Renamed Layer'
                        }
                    ]
                }
            }
        }
    });

    region = store.getProject().regions[0];
    assert.equal(region.visual.stateContent?.visited?.layers[0].enabled, false);
    assert.equal(region.visual.stateContent?.visited?.layers[0].name, 'Renamed Layer');

    store.updateRegion('region_01', {
        visual: {
            stateContent: {
                visited: { layers: [] }
            }
        }
    });

    region = store.getProject().regions[0];
    assert.equal(region.visual.stateContent, undefined);

    console.log('[sca-state-content] store merge PASS');
};

const runPersistenceTests = () => {
    const project: ScaProject = {
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [{
            ...sampleRegion('region_01', 'splat_01'),
            visual: {
                ...sampleRegion('region_01', 'splat_01').visual,
                stateContent: {
                    visited: {
                        layers: [{
                            id: 'state_layer_01',
                            type: 'placeholder',
                            enabled: true,
                            name: 'Visited Overlay'
                        }]
                    }
                }
            }
        }]
    };

    const restored = deserializeSsprojScaBlock(serializeSsprojScaBlock(project));
    const layer = restored.regions[0].visual.stateContent?.visited?.layers[0];
    assert.ok(layer);
    assert.equal(layer!.id, 'state_layer_01');
    assert.equal(layer!.name, 'Visited Overlay');

    const normalized = normalizeRegions(restored.regions);
    assert.equal(normalized[0].visual.stateContent?.visited?.layers[0].type, 'placeholder');
    assert.equal(normalized[0].visual.visited?.enabled, true);

    console.log('[sca-state-content] persistence PASS');
};

const runExportPreservationTests = () => {
    const project: ScaProject = {
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [{
            ...sampleRegion('region_01', 'splat_01'),
            visual: {
                ...sampleRegion('region_01', 'splat_01').visual,
                stateContent: {
                    visited: {
                        layers: [createDefaultPlaceholderLayer('state_layer_01')]
                    }
                }
            }
        }]
    };

    const exported = JSON.parse(stringifyProjectJson(structuredClone(project)));
    assert.equal(
        exported.regions[0].visual.stateContent.visited.layers[0].id,
        'state_layer_01'
    );

    console.log('[sca-state-content] export preservation PASS');
};

const runMergeHelperTests = () => {
    const merged = mergeVisualStateContent(undefined, {
        visited: {
            layers: [createDefaultPlaceholderLayer('state_layer_01')]
        }
    });
    assert.equal(merged?.visited?.layers.length, 1);

    const cleared = mergeVisualStateContent(merged, { visited: { layers: [] } });
    assert.equal(cleared, undefined);

    console.log('[sca-state-content] merge helper PASS');
};

const runUndoRedoTests = async () => {
    const events = new Events();
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    store.addRegion(sampleRegion('region_01', 'splat_01'));
    const before = store.getProject();

    const layer = createDefaultPlaceholderLayer(generateStateLayerId(before), 'Undo Layer');
    store.updateRegion('region_01', {
        visual: {
            stateContent: {
                visited: { layers: [layer] }
            }
        }
    });

    const after = store.getProject();
    assert.equal(after.regions[0].visual.stateContent?.visited?.layers.length, 1);

    const op = new ScaProjectOp(
        events,
        store,
        assetStore,
        before,
        after,
        null,
        null,
        null,
        'region_01',
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.undo();
    assert.equal(store.getProject().regions[0].visual.stateContent, undefined);

    await op.do();
    assert.equal(
        store.getProject().regions[0].visual.stateContent?.visited?.layers[0].name,
        'Undo Layer'
    );

    console.log('[sca-state-content] undo/redo PASS');
};

async function main() {
    runNormalizationTests();
    runRegionOverlayNormalizationTests();
    runIdGenerationTests();
    runStoreMergeTests();
    runPersistenceTests();
    runExportPreservationTests();
    runMergeHelperTests();
    await runUndoRedoTests();

    console.log('\n========== SCA STATE CONTENT PHASE 0 TEST REPORT ==========');
    console.log('Normalization: PASS');
    console.log('Region-overlay normalization: PASS');
    console.log('Stable IDs: PASS');
    console.log('Store merge / delete: PASS');
    console.log('Ssproj persistence: PASS');
    console.log('Export preservation: PASS');
    console.log('Merge helper: PASS');
    console.log('Undo/redo: PASS');
    console.log('Transition schema: deferred (no enter/exit metadata in Phase 0)');
    console.log('Runtime rendering: intentionally inert');
    console.log('===========================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
