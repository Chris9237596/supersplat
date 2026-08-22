import {
    ScaAnimationClip,
    ScaAnimationClipTrigger,
    ScaAnimationTriggerType,
    ScaAnimationKeyframeNumber,
    ScaAnimationKeyframeVec3,
    ScaAnimationTrack,
    ScaRegionOpacityAnimationTrack,
    ScaRigNodeAnimationProperty,
    ScaRigPositionAnimationTrack,
    ScaRigRotationAnimationTrack
} from '../types/animation';
import { ScaRigVec3 } from '../types/rig';

const DEFAULT_ANIMATION_DURATION = 2;
const MIN_ANIMATION_DURATION = 0.01;
const MAX_ANIMATION_DURATION = 3600;
const KEYFRAME_TIME_EPSILON = 1e-4;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const normalizeVec3 = (raw: unknown, fallback: ScaRigVec3 = [0, 0, 0]): ScaRigVec3 => {
    if (!Array.isArray(raw) || raw.length !== 3) {
        return [...fallback] as ScaRigVec3;
    }

    return raw.map((component, index) => {
        const value = typeof component === 'number' && Number.isFinite(component) ?
            component :
            fallback[index];
        return value;
    }) as ScaRigVec3;
};

const normalizeTime = (raw: unknown): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 0;
    }

    return Math.max(0, raw);
};

const normalizeOpacity = (raw: unknown): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 1;
    }

    return Math.min(1, Math.max(0, raw));
};

const normalizeDuration = (raw: unknown): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_ANIMATION_DURATION;
    }

    return Math.min(MAX_ANIMATION_DURATION, Math.max(MIN_ANIMATION_DURATION, raw));
};

const normalizeTrackId = (raw: unknown, index: number): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!/^track_\d+$/.test(trimmed)) {
        console.warn(`[SCA] ignoring invalid animation track id at index ${index}: ${raw}`);
        return null;
    }

    return trimmed;
};

const normalizeKeyframeId = (raw: unknown, index: number): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!/^keyframe_\d+$/.test(trimmed)) {
        console.warn(`[SCA] ignoring invalid animation keyframe id at index ${index}: ${raw}`);
        return null;
    }

    return trimmed;
};

const normalizeAnimationId = (raw: unknown, index: number): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!/^animation_\d+$/.test(trimmed)) {
        console.warn(`[SCA] ignoring invalid animation clip id at index ${index}: ${raw}`);
        return null;
    }

    return trimmed;
};

const normalizeVec3Keyframe = (raw: unknown, index: number): ScaAnimationKeyframeVec3 | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const id = normalizeKeyframeId(raw.id, index);
    if (!id) {
        return null;
    }

    return {
        id,
        time: normalizeTime(raw.time),
        value: normalizeVec3(raw.value),
        interpolation: raw.interpolation === 'linear' ? 'linear' : undefined
    };
};

const normalizeNumberKeyframe = (raw: unknown, index: number): ScaAnimationKeyframeNumber | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const id = normalizeKeyframeId(raw.id, index);
    if (!id) {
        return null;
    }

    return {
        id,
        time: normalizeTime(raw.time),
        value: normalizeOpacity(raw.value),
        interpolation: raw.interpolation === 'linear' ? 'linear' : undefined
    };
};

const sortKeyframesByTime = <T extends { time: number }>(keyframes: T[]): T[] => {
    return [...keyframes].sort((left, right) => left.time - right.time);
};

const normalizeRigNodeTrack = (
    raw: Record<string, unknown>,
    index: number,
    property: ScaRigNodeAnimationProperty
): ScaRigPositionAnimationTrack | ScaRigRotationAnimationTrack | null => {
    const id = normalizeTrackId(raw.id, index);
    const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId.trim() : '';
    if (!id || !nodeId) {
        return null;
    }

    const keyframes = Array.isArray(raw.keyframes) ?
        sortKeyframesByTime(
            raw.keyframes
                .map((entry, keyframeIndex) => normalizeVec3Keyframe(entry, keyframeIndex))
                .filter((entry): entry is ScaAnimationKeyframeVec3 => entry !== null)
        ) :
        [];

    return {
        id,
        targetType: 'rig-node',
        nodeId,
        property,
        keyframes
    };
};

const normalizeRegionOpacityTrack = (
    raw: Record<string, unknown>,
    index: number
): ScaRegionOpacityAnimationTrack | null => {
    const id = normalizeTrackId(raw.id, index);
    const regionId = typeof raw.regionId === 'string' ? raw.regionId.trim() : '';
    if (!id || !regionId) {
        return null;
    }

    const keyframes = Array.isArray(raw.keyframes) ?
        sortKeyframesByTime(
            raw.keyframes
                .map((entry, keyframeIndex) => normalizeNumberKeyframe(entry, keyframeIndex))
                .filter((entry): entry is ScaAnimationKeyframeNumber => entry !== null)
        ) :
        [];

    return {
        id,
        targetType: 'region',
        regionId,
        property: 'opacity',
        keyframes
    };
};

const normalizeAnimationTrack = (raw: unknown, index: number): ScaAnimationTrack | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const targetType = raw.targetType;
    const property = raw.property;

    if (targetType === 'rig-node' && property === 'position') {
        return normalizeRigNodeTrack(raw, index, 'position');
    }

    if (targetType === 'rig-node' && property === 'rotation') {
        return normalizeRigNodeTrack(raw, index, 'rotation');
    }

    if (targetType === 'region' && property === 'opacity') {
        return normalizeRegionOpacityTrack(raw, index);
    }

    // Legacy Phase 3A rig tracks without targetType/property.
    if (typeof raw.nodeId === 'string' && property === undefined) {
        return normalizeRigNodeTrack(raw, index, 'rotation');
    }

    console.warn(`[SCA] ignoring unsupported animation track at index ${index}`);
    return null;
};

const normalizeAnimationTriggerType = (raw: unknown): ScaAnimationTriggerType => {
    if (raw === 'hotspot' || raw === 'region') {
        return raw;
    }

    return 'none';
};

const normalizeAnimationClipTrigger = (raw: unknown): ScaAnimationClipTrigger | undefined => {
    if (!isRecord(raw)) {
        return undefined;
    }

    const type = normalizeAnimationTriggerType(raw.type);
    const targetId = typeof raw.targetId === 'string' && raw.targetId.trim().length > 0 ?
        raw.targetId.trim() :
        undefined;

    if (type === 'none') {
        return { type: 'none' };
    }

    if (!targetId) {
        return undefined;
    }

    return { type, targetId };
};

const normalizeAnimationClip = (raw: unknown, index: number): ScaAnimationClip | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const id = normalizeAnimationId(raw.id, index);
    if (!id) {
        return null;
    }

    const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ?
        raw.name.trim() :
        'Animation';

    const tracks = Array.isArray(raw.tracks) ?
        raw.tracks
            .map((entry, trackIndex) => normalizeAnimationTrack(entry, trackIndex))
            .filter((entry): entry is ScaAnimationTrack => entry !== null) :
        [];

    const clip: ScaAnimationClip = {
        id,
        name,
        duration: normalizeDuration(raw.duration),
        tracks
    };

    if (typeof raw.autoplay === 'boolean') {
        clip.autoplay = raw.autoplay;
    }

    if (typeof raw.loop === 'boolean') {
        clip.loop = raw.loop;
    }

    const trigger = normalizeAnimationClipTrigger(raw.trigger);
    if (trigger) {
        clip.trigger = trigger;
    }

    return clip;
};

const normalizeAnimations = (raw: unknown): ScaAnimationClip[] | undefined => {
    if (!Array.isArray(raw)) {
        return undefined;
    }

    const beforeCount = raw.length;
    const clips = raw
        .map((entry, index) => normalizeAnimationClip(entry, index))
        .filter((entry): entry is ScaAnimationClip => entry !== null);

    if (beforeCount !== clips.length) {
        console.log(`[SCA ANIM NORMALIZE] before=${beforeCount} after=${clips.length}`);
    }

    return clips.length > 0 ? clips : undefined;
};

const pruneAnimationTargets = (
    clips: ScaAnimationClip[] | undefined,
    nodeIds: Set<string>,
    regionIds: Set<string>
): ScaAnimationClip[] | undefined => {
    if (!clips || clips.length === 0) {
        return undefined;
    }

    const next = clips.map((clip) => ({
        ...clip,
        tracks: clip.tracks.filter((track) => {
            if (track.targetType === 'rig-node') {
                return nodeIds.has(track.nodeId);
            }

            return regionIds.has(track.regionId);
        })
    }));

    return next.some((clip) => clip.tracks.length > 0) || next.length > 0 ? next : next;
};

export {
    DEFAULT_ANIMATION_DURATION,
    MAX_ANIMATION_DURATION,
    MIN_ANIMATION_DURATION,
    normalizeAnimationClip,
    normalizeAnimations,
    KEYFRAME_TIME_EPSILON,
    normalizeDuration,
    normalizeOpacity,
    normalizeTime,
    normalizeVec3,
    pruneAnimationTargets,
    sortKeyframesByTime
};
