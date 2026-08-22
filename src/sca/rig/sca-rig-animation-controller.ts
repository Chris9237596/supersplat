import { Events } from '../../events';
import { Scene } from '../../scene';

import {
    clearAnimationEditOverride,
    setAnimationEditMode
} from '../animation/animation-edit-state';
import { navigateClipKeyframeTime } from '../animation/animation-keyframe-nav';
import { applyRegionAnimationOverrides } from '../animation/region-animation-presentation';
import { cloneClip, findAnimationClip, findAnimationClipsForTrigger } from '../animation/animation-store';
import { ScaProject } from '../types/project';
import { ScaAnimationPlaybackState } from '../types/animation';

import { clipTargetsExist, collectAnimatedNodeIds } from './rig-animation';
import { RegionRigApplier } from './region-rig-applier';
import {
    resolveActiveClip,
    setAnimationPlaybackState
} from './rig-pose';

const createIdlePlaybackState = (): ScaAnimationPlaybackState => ({
    activeClipId: null,
    clip: null,
    playing: false,
    previewActive: false,
    currentTime: 0,
    selectedTrackId: null,
    selectedKeyframeId: null,
    editMode: false
});

class ScaRigAnimationController {
    private playback: ScaAnimationPlaybackState = createIdlePlaybackState();
    private updateAttached = false;
    /** User explicitly chose "No animation"; skip auto-select until scene clears. */
    private userDeselectedClip = false;
    private triggerPreviewEnabled = false;

    constructor(
        private events: Events,
        private scene: Scene,
        private applier: RegionRigApplier
    ) {
        setAnimationPlaybackState(this.playback);

        events.function('sca.rig.animation.getState', () => this.clonePlaybackState());
        events.function('sca.animation.getState', () => this.clonePlaybackState());
        events.function('sca.animation.getEditMode', () => this.playback.editMode);

        events.on('sca.rig.animation.play', () => this.play());
        events.on('sca.animation.play', () => this.play());
        events.on('sca.rig.animation.stop', () => this.stop());
        events.on('sca.animation.stop', () => this.stop());
        events.on('sca.rig.animation.reset', () => this.disablePreview(true));
        events.on('sca.animation.reset', () => this.resetToStart());
        events.on('sca.animation.disablePreview', () => this.disablePreview(true));

        events.on('sca.animation.setEditMode', (enabled: boolean) => {
            this.setEditMode(enabled);
        });

        events.on('sca.animation.setActiveClip', (clipId: string | null) => {
            this.setActiveClip(clipId);
        });

        events.on('sca.animation.setCurrentTime', (time: number) => {
            this.setCurrentTime(time, true);
        });

        events.on('sca.animation.selectTrack', (trackId: string | null) => {
            this.playback.selectedTrackId = trackId;
            this.syncPlaybackState();
            this.notifyChanged();
        });

        events.on('sca.animation.selectKeyframe', (keyframeId: string | null) => {
            this.playback.selectedKeyframeId = keyframeId;
            this.syncPlaybackState();
            this.notifyChanged();
        });

        events.on('sca.animation.navigateKeyframe', (direction: 'previous' | 'next') => {
            this.navigateKeyframe(direction);
        });

        events.on('sca.animation.testTrigger', () => {
            this.testTriggerPreview();
        });

        events.function('sca.animation.triggerPreview.enabled', () => this.triggerPreviewEnabled);

        events.on('sca.animation.triggerPreview.setEnabled', (enabled: boolean) => {
            this.triggerPreviewEnabled = !!enabled;
        });

        events.on('sca.animation.previewTriggerFromTarget', (
            targetType: 'hotspot' | 'region',
            targetId: string
        ) => {
            this.previewTriggerFromTarget(targetType, targetId);
        });

        events.on('sca.rig.node.selected', () => this.notifyChanged());
        events.on('sca.region.selected', () => this.notifyChanged());

        events.on('sca.animation.updated', () => {
            void this.applyAnimatedPresentation();
        });

        events.on('sca.project.changed', () => {
            const preservedTime = this.playback.currentTime;
            this.syncClipFromProject();
            this.playback.currentTime = preservedTime;
            this.validateClipTargets();
            this.syncPlaybackState();
        });

        events.on('scene.clear', () => {
            this.playback = createIdlePlaybackState();
            this.userDeselectedClip = false;
            this.triggerPreviewEnabled = false;
            setAnimationEditMode(false);
            clearAnimationEditOverride();
            this.syncPlaybackState();
            this.detachUpdateLoop();
            applyRegionAnimationOverrides(null, 0, false);
            this.notifyChanged();
        });
    }

    private clonePlaybackState(): ScaAnimationPlaybackState {
        return {
            ...this.playback,
            clip: this.playback.clip ? cloneClip(this.playback.clip) : null
        };
    }

    private getProject(): ScaProject | null {
        return this.events.invoke('sca.project.get') as ScaProject | null;
    }

    private syncClipFromProject(): void {
        const project = this.getProject();
        const animations = project?.animations ?? [];

        if (!this.playback.activeClipId) {
            if (!this.userDeselectedClip && animations.length > 0) {
                this.playback.activeClipId = animations[0].id;
                this.playback.clip = cloneClip(animations[0]);
            } else {
                this.playback.clip = null;
            }
            return;
        }

        const resolved = resolveActiveClip(project);
        this.playback.clip = resolved ? cloneClip(resolved) : null;

        if (!this.playback.clip && animations.length > 0) {
            this.playback.activeClipId = animations[0].id;
            this.playback.clip = cloneClip(animations[0]);
        } else if (!this.playback.clip) {
            this.playback.activeClipId = null;
        }
    }

    private syncPlaybackState(): void {
        setAnimationPlaybackState(this.playback);
        setAnimationEditMode(this.playback.editMode);
    }

    private setEditMode(enabled: boolean): void {
        if (!this.playback.clip) {
            this.playback.editMode = false;
            setAnimationEditMode(false);
            clearAnimationEditOverride();
            this.syncPlaybackState();
            this.notifyChanged();
            return;
        }

        this.playback.editMode = enabled;
        if (enabled) {
            this.playback.previewActive = true;
        } else {
            clearAnimationEditOverride();
        }

        this.syncPlaybackState();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private setActiveClip(clipId: string | null): void {
        this.userDeselectedClip = clipId === null;
        this.playback.playing = false;
        this.playback.currentTime = 0;
        this.playback.activeClipId = clipId;
        this.playback.editMode = false;
        clearAnimationEditOverride();
        this.syncClipFromProject();
        this.detachUpdateLoop();

        if (this.playback.clip) {
            this.playback.previewActive = true;
            void this.applyAnimatedPresentation();
        } else {
            this.playback.previewActive = false;
            applyRegionAnimationOverrides(null, 0, false);
        }

        this.syncPlaybackState();
        this.notifyChanged();
    }

    private setCurrentTime(time: number, enablePreview: boolean): void {
        if (!this.playback.clip) {
            return;
        }

        this.playback.currentTime = Math.max(0, Math.min(time, this.playback.clip.duration));
        if (enablePreview) {
            this.playback.previewActive = true;
        }

        this.syncPlaybackState();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private play(): void {
        const project = this.getProject();
        if (!this.playback.clip || !clipTargetsExist(project ?? undefined, this.playback.clip)) {
            return;
        }

        if (this.playback.currentTime >= this.playback.clip.duration) {
            this.playback.currentTime = 0;
        }

        this.playback.playing = true;
        this.playback.previewActive = true;
        this.syncPlaybackState();
        this.attachUpdateLoop();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private testTriggerPreview(): void {
        const project = this.getProject();
        const clipId = this.playback.activeClipId;
        const clip = clipId && project ? findAnimationClip(project, clipId) : null;

        if (!clip || !project) {
            console.log('[SCA ANIM TEST]', {
                clipId: clipId ?? null,
                triggerType: 'none',
                targetId: undefined,
                matched: false,
                started: false
            });
            return;
        }

        const trigger = clip.trigger;
        const triggerType = trigger?.type ?? 'none';
        const targetId = trigger?.targetId;
        let matched = false;
        let started = false;

        if (trigger?.type === 'hotspot' || trigger?.type === 'region') {
            if (!targetId) {
                console.log('[SCA ANIM TEST]', {
                    clipId: clip.id,
                    triggerType,
                    targetId,
                    matched: false,
                    started: false
                });
                return;
            }

            const triggeredClips = findAnimationClipsForTrigger(project, trigger.type, targetId);
            matched = triggeredClips.some((entry) => entry.id === clip.id);

            if (triggeredClips.length > 0) {
                started = this.playFirstTriggeredClip(project, triggeredClips[0].id);
            }
        } else {
            matched = true;
            this.playback.playing = false;
            this.playback.currentTime = 0;
            this.detachUpdateLoop();
            this.syncPlaybackState();
            started = this.startPreviewPlayback(project);
        }

        console.log('[SCA ANIM TEST]', {
            clipId: clip.id,
            triggerType,
            targetId,
            matched,
            started
        });
    }

    private previewTriggerFromTarget(
        targetType: 'hotspot' | 'region',
        targetId: string
    ): void {
        if (!this.triggerPreviewEnabled || !targetId) {
            return;
        }

        const project = this.getProject();
        if (!project) {
            return;
        }

        const triggeredClips = findAnimationClipsForTrigger(project, targetType, targetId);
        const matchedClipId = triggeredClips[0]?.id ?? null;
        const started = matchedClipId ?
            this.playFirstTriggeredClip(project, matchedClipId) :
            false;

        console.log('[SCA ANIM PREVIEW TRIGGER]', {
            type: targetType,
            targetId,
            matchedClipId,
            started
        });
    }

    private playFirstTriggeredClip(project: ScaProject, clipId: string): boolean {
        if (clipId !== this.playback.activeClipId) {
            this.setActiveClip(clipId);
        } else {
            this.playback.playing = false;
            this.playback.currentTime = 0;
            this.detachUpdateLoop();
            this.syncPlaybackState();
        }

        return this.startPreviewPlayback(project);
    }

    private startPreviewPlayback(project: ScaProject): boolean {
        if (!this.playback.clip || !clipTargetsExist(project, this.playback.clip)) {
            return false;
        }

        this.play();
        return this.playback.playing;
    }

    private stop(): void {
        if (!this.playback.clip) {
            return;
        }

        this.playback.playing = false;
        this.playback.previewActive = true;
        this.syncPlaybackState();
        this.detachUpdateLoop();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private resetToStart(): void {
        this.playback.playing = false;
        this.playback.previewActive = true;
        this.playback.currentTime = 0;
        clearAnimationEditOverride();
        this.syncPlaybackState();
        this.detachUpdateLoop();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private disablePreview(resetTime: boolean): void {
        if (this.playback.editMode) {
            return;
        }

        this.playback.playing = false;
        this.playback.previewActive = false;
        if (resetTime) {
            this.playback.currentTime = 0;
        }
        clearAnimationEditOverride();
        this.syncPlaybackState();
        this.detachUpdateLoop();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private navigateKeyframe(direction: 'previous' | 'next'): void {
        const clip = this.playback.clip;
        if (!clip) {
            return;
        }

        const selectedNodeId = this.events.invoke('sca.rig.getSelected') as string | null;
        const selectedRegionId = this.events.invoke('sca.region.getSelected') as string | null;
        const result = navigateClipKeyframeTime(
            clip,
            this.playback.currentTime,
            direction,
            selectedNodeId,
            selectedRegionId
        );

        if (!result) {
            return;
        }

        this.playback.currentTime = result.time;
        this.playback.previewActive = true;
        this.playback.selectedTrackId = result.trackId;
        this.playback.selectedKeyframeId = result.keyframeId;
        this.syncPlaybackState();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    }

    private attachUpdateLoop(): void {
        if (this.updateAttached) {
            return;
        }

        this.updateAttached = true;
        this.scene.app.on('update', this.onUpdate);
    }

    private detachUpdateLoop(): void {
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

        this.syncPlaybackState();
        void this.applyAnimatedPresentation();
        this.notifyChanged();
    };

    private validateClipTargets(): void {
        const project = this.getProject();
        if (!this.playback.clip) {
            applyRegionAnimationOverrides(null, 0, false);
            return;
        }

        if (!clipTargetsExist(project ?? undefined, this.playback.clip)) {
            this.syncClipFromProject();
            if (!this.playback.clip) {
                this.playback = createIdlePlaybackState();
                setAnimationEditMode(false);
                clearAnimationEditOverride();
                this.syncPlaybackState();
                this.detachUpdateLoop();
                applyRegionAnimationOverrides(null, 0, false);
                this.notifyChanged();
            }
        }
    }

    private async applyAnimatedPresentation(): Promise<void> {
        const project = this.getProject();
        const rig = project?.rig;
        applyRegionAnimationOverrides(
            this.playback.clip,
            this.playback.currentTime,
            this.playback.previewActive
        );

        if (rig) {
            if (this.playback.previewActive && this.playback.clip) {
                const nodeIds = collectAnimatedNodeIds(this.playback.clip);
                await this.applier.updateNodePoses(this.events, this.scene, rig, nodeIds);
            } else {
                await this.applier.updateNodePoses(this.events, this.scene, rig);
            }
        }

        this.events.fire('sca.region.highlight.refresh');
        this.events.fire('sca.rig.animation.updated');
        this.scene.forceRender = true;
    }

    private notifyChanged(): void {
        this.events.fire('sca.rig.animation.changed');
        this.events.fire('sca.animation.changed');
    }
}

export { ScaRigAnimationController };
