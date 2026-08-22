import { strict as assert } from 'node:assert';

import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { HotspotStore } from '../src/sca/store/hotspot-store';
import { createEmptyProject, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import {
    backgroundAssetPath,
    inferBackgroundFilename,
    normalizeBackground,
    parseHexColor
} from '../src/sca/viewer/viewer-background';
import { createDefaultViewerConfig, normalizeViewerConfig } from '../src/sca/viewer/viewer-config';
import { ScaProjectOp } from '../src/sca/edit/sca-edit-ops';
import { Events } from '../src/events';

const runBackgroundTests = () => {
    assert.deepEqual(normalizeBackground(undefined), {
        type: 'color',
        color: '#000000'
    });

    assert.deepEqual(normalizeBackground({ type: 'transparent' }), {
        type: 'transparent'
    });

    assert.deepEqual(normalizeBackground({
        type: 'panorama',
        image: { filename: 'background.jpg' }
    }), {
        type: 'panorama',
        image: { assetId: 'background', filename: 'background.jpg' }
    });

    assert.deepEqual(normalizeBackground({ type: 'color', color: '#ffffff' }), {
        type: 'color',
        color: '#ffffff'
    });

    assert.deepEqual(parseHexColor('#ffffff'), {
        r: 1,
        g: 1,
        b: 1
    });

    assert.equal(inferBackgroundFilename('photo.JPG'), 'background.jpg');
    assert.equal(backgroundAssetPath('background.png'), 'assets/background.png');

    const normalized = normalizeViewerConfig({
        camera: createDefaultViewerConfig().camera,
        navigation: createDefaultViewerConfig().navigation,
        interaction: createDefaultViewerConfig().interaction,
        background: { type: 'color', color: '#ff0000' }
    });

    assert.equal(normalized.background?.type, 'color');
    assert.equal(normalized.background?.color, '#ff0000');

    console.log('[sca-background] normalization PASS');
};

const runBackgroundHistoryTests = async () => {
    const events = new Events();
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const applying = { value: false };

    const before = store.getProject();
    const after = {
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        viewer: normalizeViewerConfig({
            ...createDefaultViewerConfig(),
            background: { type: 'color', color: '#ffffff' }
        })
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
        null,
        [],
        [],
        applying
    );

    await op.do();
    assert.equal(store.getViewerBackground().color, '#ffffff');

    await op.undo();
    assert.equal(store.getViewerBackground().type, 'color');
    assert.equal(store.getViewerBackground().color, '#000000');

    const imageData = new Uint8Array([137, 80, 78, 71]);
    assetStore.set(backgroundAssetPath('background.png'), imageData, 'image/png');

    const withImage = {
        ...after,
        viewer: normalizeViewerConfig({
            ...createDefaultViewerConfig(),
            background: {
                type: 'image',
                image: { assetId: 'background', filename: 'background.png' }
            }
        })
    };

    const imageOp = new ScaProjectOp(
        events,
        store,
        assetStore,
        after,
        withImage,
        null,
        null,
        null,
        null,
        [],
        [{
            path: backgroundAssetPath('background.png'),
            data: imageData,
            mimeType: 'image/png'
        }],
        applying
    );

    await imageOp.do();
    assert.equal(store.getViewerBackground().type, 'image');
    assert.ok(assetStore.get(backgroundAssetPath('background.png')));

    await imageOp.undo();
    assert.equal(store.getViewerBackground().color, '#ffffff');
    assert.equal(assetStore.list().length, 0);

    console.log('[sca-background] history PASS');
};

async function main() {
    runBackgroundTests();
    await runBackgroundHistoryTests();

    console.log('\n========== SCA BACKGROUND TEST REPORT ==========');
    console.log('Normalization: PASS');
    console.log('Undo/redo: PASS');
    console.log('================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
