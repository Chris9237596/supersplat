import { Events } from '../../events';
import { ScaNavigationMode, ScaViewerConfig } from '../types/project';

import { applyCameraPose, captureCurrentView } from './viewer-camera-controller';

type PreviewSnapshot = {
    pose: ReturnType<typeof captureCurrentView>;
    controlMode: ScaNavigationMode;
    fov: number;
};

class ViewerPreviewController {
    private snapshot: PreviewSnapshot | null = null;

    get isActive(): boolean {
        return this.snapshot !== null;
    }

    enter(events: Events, viewer: ScaViewerConfig): void {
        if (this.snapshot) {
            return;
        }

        const controlMode = events.invoke('camera.controlMode') as ScaNavigationMode;
        this.snapshot = {
            pose: captureCurrentView(events),
            controlMode: controlMode === 'fly' ? 'fly' : 'orbit',
            fov: events.invoke('camera.fov') as number
        };

        applyCameraPose(events, viewer.camera.initial, 0);
        events.fire('camera.setFov', viewer.camera.initial.fov);

        const targetMode = viewer.navigation.defaultMode;
        if (events.invoke('camera.controlMode') !== targetMode) {
            events.fire('camera.setControlMode', targetMode);
        }
    }

    exit(events: Events): void {
        if (!this.snapshot) {
            return;
        }

        const { pose, controlMode } = this.snapshot;
        this.snapshot = null;

        applyCameraPose(events, pose, 0);
        events.fire('camera.setFov', pose.fov);

        if (events.invoke('camera.controlMode') !== controlMode) {
            events.fire('camera.setControlMode', controlMode);
        }
    }
}

export { PreviewSnapshot, ViewerPreviewController };
