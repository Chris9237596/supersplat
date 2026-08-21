import { Events } from '../../events';

import { HotspotStore } from '../store/hotspot-store';
import {
    ScaCameraPose,
    ScaNavigationMode,
    ScaViewerConfig
} from '../types/project';

import { captureCurrentView } from './viewer-camera-controller';
import { createDefaultViewerConfig } from './viewer-config';
import { ViewerPreviewController } from './viewer-preview-controller';

const registerScaViewerEvents = (events: Events, store: HotspotStore): void => {
    const previewController = new ViewerPreviewController();

    const notifyViewerChanged = () => {
        events.fire('sca.project.changed', store.getProject());
    };

    const notifyPreviewChanged = () => {
        events.fire('sca.viewer.preview.changed');
    };

    events.function('sca.viewer.get', () => {
        return store.getViewerConfig();
    });

    events.function('sca.viewer.preview.active', () => {
        return previewController.isActive;
    });

    events.on('sca.viewer.captureCurrentView', () => {
        const initial = captureCurrentView(events);
        store.ensureViewerConfig(initial);
        store.updateViewerCameraInitial(initial);
        notifyViewerChanged();
    });

    events.on('sca.viewer.resetInitialView', () => {
        store.updateViewerConfig(createDefaultViewerConfig());
        notifyViewerChanged();
    });

    events.on('sca.viewer.camera.initial.update', (patch: Partial<ScaCameraPose>) => {
        store.ensureViewerConfig();
        store.updateViewerCameraInitial(patch);
        notifyViewerChanged();
    });

    events.on('sca.viewer.navigation.update', (patch: Partial<ScaViewerConfig['navigation']>) => {
        store.ensureViewerConfig();
        store.updateViewerNavigation(patch);
        notifyViewerChanged();
    });

    events.on('sca.viewer.navigation.allowedMode.set', (payload: { mode: ScaNavigationMode; enabled: boolean }) => {
        store.ensureViewerConfig();
        store.setViewerAllowedMode(payload.mode, payload.enabled);
        notifyViewerChanged();
    });

    events.on('sca.viewer.camera.animation.update', (patch: Partial<ScaViewerConfig['camera']['animation']>) => {
        store.ensureViewerConfig();
        store.updateViewerAnimation(patch);
        notifyViewerChanged();
    });

    events.on('sca.viewer.interaction.update', (patch: Partial<ScaViewerConfig['interaction']>) => {
        store.ensureViewerConfig();
        store.updateViewerInteraction(patch);
        notifyViewerChanged();
    });

    events.on('sca.viewer.preview.enter', () => {
        const viewer = store.getViewerConfig();
        previewController.enter(events, viewer);
        notifyPreviewChanged();
    });

    events.on('sca.viewer.preview.exit', () => {
        previewController.exit(events);
        notifyPreviewChanged();
    });
};

export { registerScaViewerEvents };
