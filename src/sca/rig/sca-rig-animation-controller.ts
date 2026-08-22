import { Events } from '../../events';
import { Scene } from '../../scene';

import { ScaProject } from '../types/project';
import { ScaRig } from '../types/rig';

import { clipTargetNodeExists, createTestAnimationClip } from './rig-animation';
import { ScaRigAnimationPlaybackState } from './rig-animation-types';
import { RegionRigApplier } from './region-rig-applier';
import { setRigAnimationPlaybackState } from './rig-pose';

const createIdlePlaybackState = (): ScaRigAnimationPlaybackState => ({
    clip: null,
    playing: false,
    influenceActive: false,
    currentTime: 0
});

class ScaRigAnimationController {
    private playback: ScaRigAnimationPlaybackState = createIdlePlaybackState();
    private updateAttached = false;

    constructor(
        private events: Events,
        private scene: Scene,
        private applier: RegionRigApplier
    ) {
        setRigAnimationPlaybackState(this.playback);

        events.function('sca.rig.animation.getState', () => ({
            ...this.playback,
            clip: this.playback.clip ? {
                ...this.playback.clip,
                tracks: this.playback.clip.tracks.map((track) => ({
                    ...track,
                    keyframes: track.keyframes.map((keyframe) => ({
                        ...keyframe,
                        rotation: [...keyframe.rotation] as typeof keyframe.rotation
                    }))
                }))
            } : null
        }));

        events.on('sca.rig.animation.createTest', () => {
            this.createTestClip();
        });

        events.on('sca.rig.animation.play', () => {
            this.play();
        });

        events.on('sca.rig.animation.stop', () => {
            this.stop();
        });

        events.on('sca.rig.animation.reset', () => {
            this.reset();
        });

        events.on('sca.rig.node.selected', () => {
            this.notifyChanged();
        });

        events.on('sca.project.changed', () => {
            this.validateClipTargets();
        });

        events.on('scene.clear', () => {
            this.reset();
            this.playback = createIdlePlaybackState();
            setRigAnimationPlaybackState(this.playback);
            this.notifyChanged();
        });
    }

    private attachUpdateLoop() {
        if (this.updateAttached) {
            return;
        }

        this.updateAttached = true;
        this.scene.app.on('update', this.onUpdate);
    }

    private detachUpdateLoop() {
        if (!this.updateAttached) {
            return;
        }

        this.updateAttached = false;
        this.scene.app.off('update', this.onUpdate);
    }

    private onUpdate = (deltaTime: number) => {
        if (!this.playback.playing || !this.playback.clip) {
            return;
        }

        this.playback.currentTime += deltaTime;

        if (this.playback.currentTime >= this.playback.clip.duration) {
            this.playback.currentTime = this.playback.clip.duration;
            this.playback.playing = false;
            this.detachUpdateLoop();
        }

        void this.applyAnimatedPose();
        this.notifyChanged();
    };

    private getRig(): ScaRig | undefined {
        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        return project?.rig;
    }

    private createTestClip() {
        const selectedNodeId = this.events.invoke('sca.rig.getSelected') as string | null;
        if (!selectedNodeId) {
            return;
        }

        const rig = this.getRig();
        const node = rig?.nodes.find((entry) => entry.id === selectedNodeId);
        if (!node) {
            return;
        }

        this.playback = {
            clip: createTestAnimationClip(node.id, node.rotation),
            playing: false,
            influenceActive: false,
            currentTime: 0
        };
        setRigAnimationPlaybackState(this.playback);
        this.detachUpdateLoop();
        this.notifyChanged();
    }

    private play() {
        if (!this.playback.clip || !clipTargetNodeExists(this.getRig(), this.playback.clip)) {
            return;
        }

        this.playback.playing = true;
        this.playback.influenceActive = true;
        this.playback.currentTime = 0;
        setRigAnimationPlaybackState(this.playback);
        this.attachUpdateLoop();
        void this.applyAnimatedPose();
        this.notifyChanged();
    }

    private stop() {
        if (!this.playback.clip) {
            return;
        }

        this.playback.playing = false;
        this.playback.influenceActive = true;
        setRigAnimationPlaybackState(this.playback);
        this.detachUpdateLoop();
        void this.applyAnimatedPose();
        this.notifyChanged();
    }

    private reset() {
        this.playback.playing = false;
        this.playback.influenceActive = false;
        this.playback.currentTime = 0;
        setRigAnimationPlaybackState(this.playback);
        this.detachUpdateLoop();
        void this.applyAnimatedPose();
        this.notifyChanged();
    }

    private validateClipTargets() {
        if (!this.playback.clip) {
            return;
        }

        if (!clipTargetNodeExists(this.getRig(), this.playback.clip)) {
            this.playback = createIdlePlaybackState();
            setRigAnimationPlaybackState(this.playback);
            this.detachUpdateLoop();
            this.notifyChanged();
        }
    }

    private async applyAnimatedPose() {
        const rig = this.getRig();
        if (!rig) {
            return;
        }

        if (this.playback.influenceActive && this.playback.clip) {
            const nodeIds = this.playback.clip.tracks.map((track) => track.nodeId);
            await this.applier.updateNodePoses(this.events, this.scene, rig, nodeIds);
        } else {
            await this.applier.updateNodePoses(this.events, this.scene, rig);
        }

        this.events.fire('sca.rig.animation.updated');
        this.scene.forceRender = true;
    }

    private notifyChanged() {
        this.events.fire('sca.rig.animation.changed');
    }
}

export { ScaRigAnimationController };
