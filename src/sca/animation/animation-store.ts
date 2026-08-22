import {
    ScaAnimationClip,
    ScaAnimationTrack,
    ScaRigNodeAnimationProperty,
    ScaRigNodeAnimationTrack
} from '../types/animation';
import { ScaProject } from '../types/project';
import { ScaRigVec3 } from '../types/rig';

import {
    DEFAULT_ANIMATION_DURATION,
    KEYFRAME_TIME_EPSILON,
    normalizeDuration,
    pruneAnimationTargets,
    sortKeyframesByTime
} from '../animation/animation-defaults';
import { generateAnimationId, generateKeyframeId, generateTrackId } from '../ids/generate-animation-id';

const ensureAnimations = (project: ScaProject): ScaAnimationClip[] => {
    if (!project.animations) {
        project.animations = [];
    }

    return project.animations;
};

const findAnimationClip = (project: ScaProject, clipId: string): ScaAnimationClip | null => {
    return project.animations?.find((clip) => clip.id === clipId) ?? null;
};

const findAnimationClipsForTrigger = (
    project: ScaProject,
    targetType: 'hotspot' | 'region',
    targetId: string
): ScaAnimationClip[] => {
    return (project.animations ?? []).filter((clip) =>
        clip.trigger?.type === targetType &&
        clip.trigger.targetId === targetId
    );
};

const findAnimationTrack = (clip: ScaAnimationClip, trackId: string): ScaAnimationTrack | null => {
    return clip.tracks.find((track) => track.id === trackId) ?? null;
};

const trackKey = (track: ScaAnimationTrack): string => {
    if (track.targetType === 'rig-node') {
        return `rig:${track.nodeId}:${track.property}`;
    }

    return `region:${track.regionId}:${track.property}`;
};

const cloneClip = (clip: ScaAnimationClip): ScaAnimationClip => structuredClone(clip);

const addAnimationClip = (
    project: ScaProject,
    name: string,
    duration = DEFAULT_ANIMATION_DURATION
): ScaAnimationClip => {
    const animations = ensureAnimations(project);
    const clip: ScaAnimationClip = {
        id: generateAnimationId(project),
        name: name.trim() || 'Animation',
        duration: normalizeDuration(duration),
        tracks: []
    };
    animations.push(clip);
    return cloneClip(clip);
};

const updateAnimationClip = (
    project: ScaProject,
    clipId: string,
    patch: Partial<Pick<ScaAnimationClip, 'name' | 'duration' | 'autoplay' | 'loop' | 'trigger'>>
): ScaAnimationClip => {
    const clip = findAnimationClip(project, clipId);
    if (!clip) {
        throw new Error(`[SCA] unknown animation clip id: ${clipId}`);
    }

    if (typeof patch.name === 'string' && patch.name.trim().length > 0) {
        clip.name = patch.name.trim();
    }

    if (typeof patch.duration === 'number') {
        clip.duration = normalizeDuration(patch.duration);
    }

    if (typeof patch.autoplay === 'boolean') {
        clip.autoplay = patch.autoplay;
    }

    if (typeof patch.loop === 'boolean') {
        clip.loop = patch.loop;
    }

    if (patch.trigger !== undefined) {
        if (patch.trigger === null || patch.trigger.type === 'none') {
            delete clip.trigger;
        } else if (patch.trigger.targetId) {
            clip.trigger = {
                type: patch.trigger.type,
                targetId: patch.trigger.targetId
            };
        }
    }

    return cloneClip(clip);
};

const deleteAnimationClip = (project: ScaProject, clipId: string): void => {
    if (!project.animations) {
        return;
    }

    project.animations = project.animations.filter((clip) => clip.id !== clipId);
    if (project.animations.length === 0) {
        delete project.animations;
    }
};

const getOrCreateRigTrack = (
    clip: ScaAnimationClip,
    nodeId: string,
    property: ScaRigNodeAnimationProperty
): ScaRigNodeAnimationTrack => {
    const existing = clip.tracks.find((track): track is ScaRigNodeAnimationTrack => {
        return track.targetType === 'rig-node' &&
            track.nodeId === nodeId &&
            track.property === property;
    });

    if (existing) {
        return existing;
    }

    const track: ScaRigNodeAnimationTrack = property === 'position' ?
        {
            id: generateTrackId(clip),
            targetType: 'rig-node',
            nodeId,
            property: 'position',
            keyframes: []
        } :
        {
            id: generateTrackId(clip),
            targetType: 'rig-node',
            nodeId,
            property: 'rotation',
            keyframes: []
        };

    clip.tracks.push(track);
    return track;
};

const getOrCreateRegionOpacityTrack = (clip: ScaAnimationClip, regionId: string) => {
    const existing = clip.tracks.find((track) => {
        return track.targetType === 'region' &&
            track.regionId === regionId &&
            track.property === 'opacity';
    });

    if (existing && existing.targetType === 'region') {
        return existing;
    }

    const track = {
        id: generateTrackId(clip),
        targetType: 'region' as const,
        regionId,
        property: 'opacity' as const,
        keyframes: [] as { id: string; time: number; value: number }[]
    };

    clip.tracks.push(track);
    return track;
};

const findKeyframeAtTime = <T extends { time: number }>(
    keyframes: T[],
    time: number,
    epsilon = KEYFRAME_TIME_EPSILON
): T | null => {
    return keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= epsilon) ?? null;
};

const addRigKeyframe = (
    project: ScaProject,
    clipId: string,
    nodeId: string,
    property: ScaRigNodeAnimationProperty,
    time: number,
    value: ScaRigVec3
): ScaAnimationClip => {
    const clip = findAnimationClip(project, clipId);
    if (!clip) {
        throw new Error(`[SCA] unknown animation clip id: ${clipId}`);
    }

    const track = getOrCreateRigTrack(clip, nodeId, property);
    const clampedTime = Math.max(0, Math.min(time, clip.duration));
    const existing = findKeyframeAtTime(track.keyframes, clampedTime);
    if (existing) {
        existing.value = [...value] as ScaRigVec3;
    } else {
        track.keyframes.push({
            id: generateKeyframeId(track),
            time: clampedTime,
            value: [...value] as ScaRigVec3
        });
        track.keyframes = sortKeyframesByTime(track.keyframes);
    }

    return cloneClip(clip);
};

const addRegionOpacityKeyframe = (
    project: ScaProject,
    clipId: string,
    regionId: string,
    time: number,
    value: number
): ScaAnimationClip => {
    const clip = findAnimationClip(project, clipId);
    if (!clip) {
        throw new Error(`[SCA] unknown animation clip id: ${clipId}`);
    }

    const track = getOrCreateRegionOpacityTrack(clip, regionId);
    const clampedTime = Math.max(0, Math.min(time, clip.duration));
    const clampedValue = Math.min(1, Math.max(0, value));
    const existing = findKeyframeAtTime(track.keyframes, clampedTime);
    if (existing) {
        existing.value = clampedValue;
    } else {
        track.keyframes.push({
            id: generateKeyframeId(track),
            time: clampedTime,
            value: clampedValue
        });
        track.keyframes = sortKeyframesByTime(track.keyframes);
    }

    return cloneClip(clip);
};

const deleteAnimationKeyframe = (
    project: ScaProject,
    clipId: string,
    trackId: string,
    keyframeId: string
): ScaAnimationClip => {
    const clip = findAnimationClip(project, clipId);
    if (!clip) {
        throw new Error(`[SCA] unknown animation clip id: ${clipId}`);
    }

    const track = findAnimationTrack(clip, trackId);
    if (!track) {
        throw new Error(`[SCA] unknown animation track id: ${trackId}`);
    }

    if (track.targetType === 'rig-node') {
        track.keyframes = track.keyframes.filter((keyframe) => keyframe.id !== keyframeId);
    } else {
        track.keyframes = track.keyframes.filter((keyframe) => keyframe.id !== keyframeId);
    }

    if (track.keyframes.length === 0) {
        clip.tracks = clip.tracks.filter((entry) => entry.id !== trackId);
    }

    return cloneClip(clip);
};

const toggleRigKeyframeAtTime = (
    project: ScaProject,
    clipId: string,
    nodeId: string,
    property: ScaRigNodeAnimationProperty,
    time: number,
    value: ScaRigVec3
): { clip: ScaAnimationClip; added: boolean } => {
    const clip = findAnimationClip(project, clipId);
    if (!clip) {
        throw new Error(`[SCA] unknown animation clip id: ${clipId}`);
    }

    const track = clip.tracks.find((entry): entry is ScaRigNodeAnimationTrack => {
        return entry.targetType === 'rig-node' &&
            entry.nodeId === nodeId &&
            entry.property === property;
    });

    const clampedTime = Math.max(0, Math.min(time, clip.duration));
    const existing = track ? findKeyframeAtTime(track.keyframes, clampedTime) : null;
    if (existing && track) {
        track.keyframes = track.keyframes.filter((keyframe) => keyframe.id !== existing.id);
        if (track.keyframes.length === 0) {
            clip.tracks = clip.tracks.filter((entry) => entry.id !== track.id);
        }
        return { clip: cloneClip(clip), added: false };
    }

    return { clip: addRigKeyframe(project, clipId, nodeId, property, clampedTime, value), added: true };
};

const syncAnimationTriggers = (
    clips: ScaAnimationClip[] | undefined,
    hotspotIds: Set<string>,
    regionIds: Set<string>
): void => {
    if (!clips) {
        return;
    }

    for (const clip of clips) {
        const trigger = clip.trigger;
        if (!trigger || trigger.type === 'none') {
            continue;
        }

        const targetId = trigger.targetId ?? '';
        if (trigger.type === 'hotspot' && !hotspotIds.has(targetId)) {
            delete clip.trigger;
        } else if (trigger.type === 'region' && !regionIds.has(targetId)) {
            delete clip.trigger;
        }
    }
};

const syncAnimationTargets = (project: ScaProject): void => {
    const nodeIds = new Set(project.rig?.nodes.map((node) => node.id) ?? []);
    const regionIds = new Set(project.regions.map((region) => region.id));
    const hotspotIds = new Set(project.hotspots.map((hotspot) => hotspot.id));
    const pruned = pruneAnimationTargets(project.animations, nodeIds, regionIds);
    if (pruned && pruned.length > 0) {
        project.animations = pruned;
        syncAnimationTriggers(project.animations, hotspotIds, regionIds);
    } else {
        delete project.animations;
    }
};

export {
    KEYFRAME_TIME_EPSILON,
    addAnimationClip,
    addRegionOpacityKeyframe,
    addRigKeyframe,
    cloneClip,
    deleteAnimationClip,
    deleteAnimationKeyframe,
    findAnimationClip,
    findAnimationClipsForTrigger,
    findAnimationTrack,
    getOrCreateRegionOpacityTrack,
    getOrCreateRigTrack,
    syncAnimationTargets,
    toggleRigKeyframeAtTime,
    trackKey,
    updateAnimationClip
};
