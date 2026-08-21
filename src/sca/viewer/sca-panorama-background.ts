import { LAYERID_SKYBOX } from 'playcanvas';

import { Events } from '../../events';
import { Scene } from '../../scene';
import { ScaAssetStore } from '../store/sca-asset-store';

import { backgroundAssetPath, normalizeBackground } from './viewer-background';
import { applyEquirectSkybox, clearPanoramaSkybox } from './panorama-skybox';

const registerScaPanoramaBackground = (
    events: Events,
    scene: Scene,
    assetStore: ScaAssetStore
): void => {
    let objectUrl: string | null = null;
    let loadingToken = 0;

    const revokeObjectUrl = () => {
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    };

    const ensureSkyboxLayer = () => {
        const layers = scene.camera.mainCamera.camera.layers;
        if (!layers.includes(LAYERID_SKYBOX)) {
            scene.camera.mainCamera.camera.layers = [...layers, LAYERID_SKYBOX];
        }
    };

    const applyPanorama = async () => {
        const token = ++loadingToken;
        revokeObjectUrl();
        clearPanoramaSkybox(scene.app);

        const project = events.invoke('sca.project.get') as { viewer?: { background?: unknown } } | null;
        const background = normalizeBackground(project?.viewer?.background);

        if (background.type !== 'panorama') {
            scene.forceRender = true;
            return;
        }

        const filename = background.image?.filename;
        if (!filename) {
            return;
        }

        const asset = assetStore.get(backgroundAssetPath(filename));
        if (!asset) {
            return;
        }

        const blob = new Blob([new Uint8Array(asset.data)], { type: asset.mimeType });
        objectUrl = URL.createObjectURL(blob);

        try {
            await applyEquirectSkybox(scene.app, objectUrl);
            if (token !== loadingToken) {
                return;
            }

            ensureSkyboxLayer();
            scene.forceRender = true;
        } catch (error) {
            console.warn('[SCA] failed to load panorama background:', error);
        }
    };

    events.on('sca.project.changed', () => {
        applyPanorama();
    });

    applyPanorama();
};

export { registerScaPanoramaBackground };
