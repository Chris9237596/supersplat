import { Container } from '@playcanvas/pcui';

import { Events } from '../../events';

import { ScaAssetStore } from '../store/sca-asset-store';
import { backgroundAssetPath, normalizeBackground } from '../viewer/viewer-background';

const CHECKERBOARD_CLASS = 'sca-viewer-background-checkerboard';

const registerScaBackgroundPreview = (
    events: Events,
    canvasContainer: Container,
    assetStore: ScaAssetStore
): void => {
    const layer = document.createElement('div');
    layer.id = 'sca-viewer-background-preview';
    layer.className = 'sca-viewer-background-preview';
    layer.style.pointerEvents = 'none';
    layer.style.userSelect = 'none';

    const canvas = canvasContainer.dom.querySelector('#canvas');
    if (canvas?.parentElement) {
        canvas.parentElement.insertBefore(layer, canvas);
    } else {
        canvasContainer.dom.prepend(layer);
    }

    let objectUrl: string | null = null;

    const revokeObjectUrl = () => {
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    };

    const applyBackground = () => {
        revokeObjectUrl();

        const project = events.invoke('sca.project.get') as { viewer?: { background?: unknown } } | null;
        const background = normalizeBackground(project?.viewer?.background);

        layer.classList.remove(CHECKERBOARD_CLASS);
        layer.style.backgroundColor = '';
        layer.style.backgroundImage = '';
        layer.style.backgroundSize = '';
        layer.style.backgroundPosition = '';
        layer.style.backgroundRepeat = '';

        switch (background.type) {
            case 'transparent':
                layer.classList.add(CHECKERBOARD_CLASS);
                break;
            case 'panorama':
                break;
            case 'image': {
                const filename = background.image?.filename;
                if (!filename) {
                    layer.classList.add(CHECKERBOARD_CLASS);
                    break;
                }

                const asset = assetStore.get(backgroundAssetPath(filename));
                if (!asset) {
                    layer.classList.add(CHECKERBOARD_CLASS);
                    break;
                }

                const blob = new Blob([new Uint8Array(asset.data)], { type: asset.mimeType });
                objectUrl = URL.createObjectURL(blob);
                layer.style.backgroundImage = `url("${objectUrl}")`;
                layer.style.backgroundSize = 'cover';
                layer.style.backgroundPosition = 'center';
                layer.style.backgroundRepeat = 'no-repeat';
                break;
            }
            default:
                layer.style.backgroundColor = background.color ?? '#000000';
                break;
        }
    };

    events.on('sca.project.changed', applyBackground);
    applyBackground();
};

export { registerScaBackgroundPreview };
