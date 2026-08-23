import { ScaAnimationClip } from '../types/animation';
import { ScaProject } from '../types/project';
import { ScaRig } from '../types/rig';

import { applyRegionAnimationOverrides } from '../animation/region-animation-presentation';
import { maybeLogRigMatrixCheck, resetRuntimeRigMatrixCheckDiagnostic } from '../rig/rig-matrix-check';
import {
    maybeLogRuntimeTransformOrderCheck,
    TARGET_REGION_ID
} from '../rig/rig-transform-order-check';
import { maybeLogRuntimeRigDataParity } from '../rig/rig-data-parity-check';

import { evaluateRuntimeRigPose } from './runtime-rig-pose';
import { RuntimeRigApplier } from './runtime-rig-applier';

type RuntimeAnimationPlayback = {
    clipId: string;
    clip: ScaAnimationClip;
    playing: boolean;
    currentTime: number;
    loop: boolean;
};

type RuntimeAnimationHost = {
    getProject: () => ScaProject;
    requestRender: () => void;
    refreshRegionPresentation: () => void;
    rigApplier: RuntimeRigApplier;
};

const findClip = (project: ScaProject, clipId: string): ScaAnimationClip | null => {
    return project.animations?.find((clip) => clip.id === clipId) ?? null;
};

const findTriggeredClips = (
    project: ScaProject,
    targetType: 'hotspot' | 'region',
    targetId: string
): ScaAnimationClip[] => {
    return (project.animations ?? []).filter((clip) =>
        clip.trigger?.type === targetType &&
        clip.trigger.targetId === targetId
    );
};

class ScaRuntimeAnimationController {
    private playback: RuntimeAnimationPlayback | null = null;
    private rafId: number | null = null;
    private lastFrameTime = 0;

    constructor(private host: RuntimeAnimationHost) {}

    getActiveClipId(): string | null {
        return this.playback?.clipId ?? null;
    }

    getCurrentTime(): number {
        return this.playback?.currentTime ?? 0;
    }

    isPlaying(): boolean {
        return this.playback?.playing ?? false;
    }

    playAnimation(clipId: string): boolean {
        const project = this.host.getProject();
        const clip = findClip(project, clipId);
        if (!clip) {
            console.warn(`[SCA ANIM] unknown animation clip: ${clipId}`);
            console.log('[SCA RUNTIME ANIM] play', { clipId, started: false });
            return false;
        }

        this.stopAnimationInternal(false);
        resetRuntimeRigMatrixCheckDiagnostic();
        this.playback = {
            clipId: clip.id,
            clip,
            playing: true,
            currentTime: 0,
            loop: clip.loop === true
        };
        this.applyAtCurrentTime(project);
        this.startLoop();
        console.log('[SCA RUNTIME ANIM] play', { clipId: clip.id, started: true });
        return true;
    }

    stopAnimation(clipId?: string): void {
        if (clipId && this.playback?.clipId !== clipId) {
            return;
        }

        this.stopAnimationInternal(true);
    }

    resetAnimation(clipId?: string): void {
        if (!this.playback) {
            return;
        }

        if (clipId && this.playback.clipId !== clipId) {
            return;
        }

        this.playback.currentTime = 0;
        this.applyAtCurrentTime(this.host.getProject());
    }

    triggerAnimationForTarget(targetType: 'hotspot' | 'region', targetId: string): void {
        const clips = findTriggeredClips(this.host.getProject(), targetType, targetId);
        const matchedClipId = clips[0]?.id ?? null;
        console.log('[SCA RUNTIME ANIM] trigger match', {
            type: targetType,
            targetId,
            matchedClipId
        });

        if (!matchedClipId) {
            return;
        }

        this.playAnimation(matchedClipId);
    }

    initAutoplay(): void {
        const clips = (this.host.getProject().animations ?? []).filter((clip) => clip.autoplay === true);
        if (clips.length === 0) {
            return;
        }

        this.playAnimation(clips[0].id);
    }

    destroy(): void {
        this.stopAnimationInternal(true);
    }

    private stopAnimationInternal(resetPose: boolean): void {
        this.stopLoop();

        if (resetPose) {
            const rig = this.host.getProject().rig;
            if (rig) {
                this.host.rigApplier.resetPose(rig);
            }
            applyRegionAnimationOverrides(null, 0, false);
            this.host.refreshRegionPresentation();
            this.host.requestRender();
        }

        this.playback = null;
        this.lastFrameTime = 0;
    }

    private startLoop(): void {
        if (this.rafId !== null || typeof requestAnimationFrame !== 'function') {
            return;
        }

        this.lastFrameTime = performance.now();
        const tick = (now: number) => {
            if (!this.playback?.playing) {
                this.rafId = null;
                return;
            }

            const deltaSeconds = Math.max(0, (now - this.lastFrameTime) / 1000);
            this.lastFrameTime = now;
            this.advanceTime(deltaSeconds);
            this.rafId = requestAnimationFrame(tick);
        };

        this.rafId = requestAnimationFrame(tick);
    }

    private stopLoop(): void {
        if (this.rafId === null || typeof cancelAnimationFrame !== 'function') {
            this.rafId = null;
            return;
        }

        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    private advanceTime(deltaSeconds: number): void {
        const playback = this.playback;
        if (!playback) {
            return;
        }

        playback.currentTime += deltaSeconds;

        if (playback.currentTime >= playback.clip.duration) {
            if (playback.loop) {
                playback.currentTime = playback.currentTime % playback.clip.duration;
            } else {
                playback.currentTime = playback.clip.duration;
                playback.playing = false;
                this.stopLoop();
            }
        }

        this.applyAtCurrentTime(this.host.getProject());
    }

    private applyAtCurrentTime(project: ScaProject): void {
        const playback = this.playback;
        if (!playback) {
            return;
        }

        applyRegionAnimationOverrides(playback.clip, playback.currentTime, true);
        this.host.refreshRegionPresentation();

        const rig = project.rig;
        if (rig) {
            maybeLogRuntimeRigDataParity(rig);
            const pose = evaluateRuntimeRigPose(rig, playback.clip, playback.currentTime);
            const primaryBinding = rig.bindings[0];
            const primaryNode = primaryBinding ?
                rig.nodes.find((node) => node.id === primaryBinding.nodeId) ?? null :
                null;
            if (primaryBinding && primaryNode) {
                maybeLogRigMatrixCheck(
                    'runtime',
                    playback.currentTime,
                    rig,
                    primaryNode,
                    primaryBinding,
                    (sampleTime) => evaluateRuntimeRigPose(rig, playback.clip, sampleTime)
                );
            }

            const region06Binding = rig.bindings.find((binding) => binding.regionId === TARGET_REGION_ID);
            const region06Node = region06Binding ?
                rig.nodes.find((node) => node.id === region06Binding.nodeId) ?? null :
                null;
            if (region06Binding && region06Node) {
                maybeLogRuntimeTransformOrderCheck(
                    playback.currentTime,
                    rig,
                    pose,
                    region06Node,
                    region06Binding
                );
            }

            this.host.rigApplier.applyPose(rig, pose);
            if (this.host.rigApplier.hasHost()) {
                console.log('[SCA RUNTIME RIG] apply', {
                    clipId: playback.clipId,
                    time: playback.currentTime,
                    bindingCount: this.host.rigApplier.getBindingCount()
                });
            }
        }

        this.host.requestRender();
    }
}

const createRuntimeAnimationController = (host: RuntimeAnimationHost): ScaRuntimeAnimationController => {
    return new ScaRuntimeAnimationController(host);
};

export {
    RuntimeAnimationHost,
    ScaRuntimeAnimationController,
    createRuntimeAnimationController,
    findTriggeredClips
};
