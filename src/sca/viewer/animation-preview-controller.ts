import { Events } from '../../events';
import { ScaCameraPose, ScaNavigationMode, ScaTurntableAnimation, ScaViewerConfig } from '../types/project';

import {
    computeFlyToPose,
    computeFlyToStartPose,
    computeTurntablePose,
    isTurntableComplete
} from './camera-animation';
import { applyCameraPose, captureCurrentView } from './viewer-camera-controller';
import { clonePose } from './viewer-config';

type AnimationPreviewSnapshot = {
    pose: ScaCameraPose;
    controlMode: ScaNavigationMode;
};

const cloneTurntableConfig = (config: ScaTurntableAnimation): ScaTurntableAnimation => ({
    duration: config.duration,
    direction: config.direction,
    degrees: config.degrees,
    loop: config.loop
});

class AnimationPreviewController {
    private snapshot: AnimationPreviewSnapshot | null = null;
    private frameHandler: (() => void) | null = null;
    private startTime = 0;
    private mode: 'flyTo' | 'turntable' | null = null;
    private flyFrom: ScaCameraPose | null = null;
    private flyTo: ScaCameraPose | null = null;
    private flyDuration = 0;
    private turntableBase: ScaCameraPose | null = null;
    private turntableConfig: ScaTurntableAnimation | null = null;

    get isActive(): boolean {
        return this.snapshot !== null;
    }

    start(events: Events): void {
        this.stop(events);

        const viewer = events.invoke('sca.viewer.get') as ScaViewerConfig | null;
        if (!viewer) {
            return;
        }

        const animation = viewer.camera.animation;
        if (animation.type === 'none') {
            return;
        }

        const controlMode = events.invoke('camera.controlMode') as ScaNavigationMode;
        this.snapshot = {
            pose: captureCurrentView(events),
            controlMode: controlMode === 'fly' ? 'fly' : 'orbit'
        };

        this.startTime = performance.now();
        const initial = clonePose(viewer.camera.initial);

        if (animation.type === 'flyTo') {
            this.mode = 'flyTo';
            this.flyFrom = computeFlyToStartPose(initial);
            this.flyTo = clonePose(initial);
            this.flyDuration = animation.duration;
            applyCameraPose(events, this.flyFrom, 0);
            events.fire('camera.setFov', this.flyFrom.fov);
        } else if (animation.type === 'turntable') {
            this.mode = 'turntable';
            this.turntableBase = initial;
            this.turntableConfig = cloneTurntableConfig(animation.turntable!);
            applyCameraPose(events, initial, 0);
            events.fire('camera.setFov', initial.fov);
        } else {
            this.snapshot = null;
            return;
        }

        this.frameHandler = () => {
            this.onFrame(events);
        };
        events.on('postrender', this.frameHandler);
    }

    stop(events: Events): void {
        if (!this.snapshot) {
            return;
        }

        if (this.frameHandler) {
            events.off('postrender', this.frameHandler);
            this.frameHandler = null;
        }

        const { pose, controlMode } = this.snapshot;
        this.snapshot = null;
        this.mode = null;
        this.flyFrom = null;
        this.flyTo = null;
        this.turntableBase = null;
        this.turntableConfig = null;

        applyCameraPose(events, pose, 0);
        events.fire('camera.setFov', pose.fov);

        if (events.invoke('camera.controlMode') !== controlMode) {
            events.fire('camera.setControlMode', controlMode);
        }
    }

    private onFrame(events: Events): void {
        if (!this.snapshot || !this.mode) {
            return;
        }

        const elapsed = (performance.now() - this.startTime) / 1000;

        if (this.mode === 'flyTo' && this.flyFrom && this.flyTo) {
            const pose = computeFlyToPose(this.flyFrom, this.flyTo, elapsed, this.flyDuration);
            applyCameraPose(events, pose, 0);

            if (elapsed >= this.flyDuration) {
                this.stop(events);
            }
            return;
        }

        if (this.mode === 'turntable' && this.turntableBase && this.turntableConfig) {
            const pose = computeTurntablePose(this.turntableBase, elapsed, this.turntableConfig);
            applyCameraPose(events, pose, 0);

            if (isTurntableComplete(elapsed, this.turntableConfig)) {
                this.stop(events);
            }
        }
    }
}

export { AnimationPreviewController };
