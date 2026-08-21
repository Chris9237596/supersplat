import { Events } from '../../events';

import { ScaHistoryController } from '../edit/register-sca-history';
import { HotspotStore } from '../store/hotspot-store';
import { mimeTypeForFilename, ScaAssetStore } from '../store/sca-asset-store';
import {
    ScaCameraPose,
    ScaNavigationMode,
    ScaTurntableAnimation,
    ScaViewerBackground,
    ScaViewerConfig
} from '../types/project';
import {
    backgroundAssetPath,
    inferBackgroundFilename,
    normalizeBackground,
    normalizeHexColor
} from '../viewer/viewer-background';

import { AnimationPreviewController } from './animation-preview-controller';
import { captureCurrentView } from './viewer-camera-controller';
import { createDefaultViewerConfig } from './viewer-config';
import { ViewerPreviewController } from './viewer-preview-controller';

const BACKGROUND_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const registerScaViewerEvents = (
    events: Events,
    store: HotspotStore,
    history: ScaHistoryController,
    assetStore: ScaAssetStore
): void => {
    const previewController = new ViewerPreviewController();
    const animationPreviewController = new AnimationPreviewController();

    const stopAnimationPreview = () => {
        if (animationPreviewController.isActive) {
            animationPreviewController.stop(events);
            notifyAnimationPreviewChanged();
        }
    };

    const notifyAnimationPreviewChanged = () => {
        events.fire('sca.viewer.animation.preview.changed');
    };

    const notifyViewerChanged = () => {
        events.fire('sca.project.changed', store.getProject());
    };

    const notifyPreviewChanged = () => {
        events.fire('sca.viewer.preview.changed');
    };

    events.function('sca.viewer.get', () => {
        return store.getViewerConfig();
    });

    events.function('sca.viewer.background.get', () => {
        return store.getViewerBackground();
    });

    events.function('sca.viewer.preview.active', () => {
        return previewController.isActive;
    });

    events.function('sca.viewer.animation.preview.active', () => {
        return animationPreviewController.isActive;
    });

    events.on('sca.viewer.captureCurrentView', () => {
        history.record(() => {
            const initial = captureCurrentView(events);
            store.ensureViewerConfig(initial);
            store.updateViewerCameraInitial(initial);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.resetInitialView', () => {
        history.record(() => {
            store.updateViewerConfig(createDefaultViewerConfig());
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.camera.initial.update', (patch: Partial<ScaCameraPose>) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerCameraInitial(patch);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.navigation.update', (patch: Partial<ScaViewerConfig['navigation']>) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerNavigation(patch);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.navigation.allowedMode.set', (payload: { mode: ScaNavigationMode; enabled: boolean }) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.setViewerAllowedMode(payload.mode, payload.enabled);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.camera.animation.update', (patch: Partial<ScaViewerConfig['camera']['animation']>) => {
        stopAnimationPreview();
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerAnimation(patch);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.camera.animation.turntable.update', (patch: Partial<ScaTurntableAnimation>) => {
        stopAnimationPreview();
        history.record(() => {
            store.ensureViewerConfig();
            const current = store.getViewerConfig();
            store.updateViewerAnimation({
                turntable: {
                    ...current.camera.animation.turntable!,
                    ...patch
                }
            });
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.interaction.update', (patch: Partial<ScaViewerConfig['interaction']>) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerInteraction(patch);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.hotspots.update', (patch: Partial<NonNullable<ScaViewerConfig['hotspots']>>) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerHotspots(patch);
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.background.update', (background: ScaViewerBackground) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerBackground(normalizeBackground(background));
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.background.type.set', (type: ScaViewerBackground['type']) => {
        history.record(() => {
            store.ensureViewerConfig();
            const current = store.getViewerBackground();

            if (type === 'transparent') {
                store.updateViewerBackground({ type: 'transparent' });
            } else if (type === 'image' || type === 'panorama') {
                const filename = (current.type === 'image' || current.type === 'panorama') ?
                    current.image?.filename :
                    undefined;
                store.updateViewerBackground({
                    type,
                    image: {
                        assetId: 'background',
                        ...(filename ? { filename } : {})
                    }
                });
            } else {
                store.updateViewerBackground({
                    type: 'color',
                    color: current.color ?? '#000000'
                });
            }

            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.background.color.set', (color: string) => {
        history.record(() => {
            store.ensureViewerConfig();
            store.updateViewerBackground({
                type: 'color',
                color: normalizeHexColor(color)
            });
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.background.image.remove', () => {
        history.record(() => {
            store.ensureViewerConfig();
            const current = store.getViewerBackground();
            const filename = current.image?.filename;
            if (filename) {
                assetStore.delete(backgroundAssetPath(filename));
            }
            store.updateViewerBackground({
                type: 'color',
                color: current.color ?? '#000000'
            });
            notifyViewerChanged();
        });
    });

    events.on('sca.viewer.background.image.import', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = BACKGROUND_IMAGE_ACCEPT;

        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) {
                return;
            }

            const filename = inferBackgroundFilename(file.name);
            const assetPath = backgroundAssetPath(filename);
            const data = new Uint8Array(await file.arrayBuffer());
            const mimeType = file.type || mimeTypeForFilename(filename);

            history.record(() => {
                for (const entry of assetStore.list()) {
                    if (entry.path.startsWith('assets/background.')) {
                        assetStore.delete(entry.path);
                    }
                }

                assetStore.set(assetPath, data, mimeType);
                store.ensureViewerConfig();
                const current = store.getViewerBackground();
                const nextType = current.type === 'panorama' ? 'panorama' : 'image';
                store.updateViewerBackground({
                    type: nextType,
                    image: {
                        assetId: 'background',
                        filename
                    }
                });
                notifyViewerChanged();
            });
        }, { once: true });

        input.click();
    });

    events.on('sca.viewer.preview.enter', () => {
        stopAnimationPreview();
        const viewer = store.getViewerConfig();
        previewController.enter(events, viewer);
        notifyPreviewChanged();
    });

    events.on('sca.viewer.preview.exit', () => {
        previewController.exit(events);
        notifyPreviewChanged();
    });

    events.on('sca.viewer.animation.preview.start', () => {
        if (previewController.isActive) {
            previewController.exit(events);
            notifyPreviewChanged();
        }

        const viewer = store.getViewerConfig();
        animationPreviewController.start(events);
        notifyAnimationPreviewChanged();
    });

    events.on('sca.viewer.animation.preview.stop', () => {
        stopAnimationPreview();
    });
};

export { registerScaViewerEvents };
