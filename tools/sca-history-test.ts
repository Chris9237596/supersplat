import { strict as assert } from 'node:assert';

import { Events } from '../src/events';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject, ScaHotspot, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import { createDefaultViewerConfig } from '../src/sca/viewer/viewer-config';

const sampleHotspot = (id: string, name: string): ScaHotspot => ({
    id,
    name,
    text: `${name} text`,
    position: [0, 0, 0],
    enabled: true,
    visual: { type: 'annotation', visible: true },
    hover: { enabled: true },
    click: {
        enabled: true,
        action: { type: 'event', eventName: 'hotspotClicked' }
    },
    camera: {
        initial: {
            position: [0, 1, -1],
            target: [0, 0, 0],
            fov: 55
        }
    }
});

const runHistoryTests = async () => {
    const events = new Events();
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };
    const emptyAssets: [] = [];

    const empty = store.getProject();
    const withHotspot = {
        version: SCA_PROJECT_VERSION,
        hotspots: [sampleHotspot('hs_1', 'First')],
        regions: [],
        viewer: createDefaultViewerConfig()
    };

    const op = new ScaProjectOp(
        events,
        store,
        assetStore,
        empty,
        withHotspot,
        null,
        'hs_1',
        null,
        null,
        emptyAssets,
        emptyAssets,
        applying
    );

    await op.do();
    assert.equal(store.getHotspots().length, 1);
    assert.equal(store.getHotspots()[0].id, 'hs_1');
    assert.equal(store.getSelectedHotspotId(), 'hs_1');

    await op.undo();
    assert.equal(store.getHotspots().length, 0);
    assert.equal(store.getSelectedHotspotId(), null);

    await op.do();
    assert.equal(store.getHotspots().length, 1);
    assert.equal(store.getHotspots()[0].id, 'hs_1');

    const viewerBefore = createDefaultViewerConfig();
    const viewerAfter = createDefaultViewerConfig();
    viewerAfter.interaction.homeTransition.duration = 2.5;

    const viewerOp = new ScaProjectOp(
        events,
        store,
        assetStore,
        withHotspot,
        {
            ...withHotspot,
            viewer: viewerAfter
        },
        'hs_1',
        'hs_1',
        null,
        null,
        emptyAssets,
        emptyAssets,
        applying
    );

    await viewerOp.do();
    assert.equal(store.getViewerConfig().interaction.homeTransition.duration, 2.5);

    await viewerOp.undo();
    assert.equal(store.getViewerConfig().interaction.homeTransition.duration, viewerBefore.interaction.homeTransition.duration);

    console.log('[sca-history] ScaProjectOp undo/redo PASS');
};

async function main() {
    await runHistoryTests();
    console.log('\n========== SCA HISTORY TEST REPORT ==========');
    console.log('Hotspot add undo/redo: PASS');
    console.log('Viewer config undo/redo: PASS');
    console.log('============================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
