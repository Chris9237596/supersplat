import { ScaAnimationClip, ScaAnimationTrack } from '../types/animation';

import { KEYFRAME_TIME_EPSILON } from './animation-defaults';

export { KEYFRAME_TIME_EPSILON };

const timesNearEqual = (left: number, right: number, epsilon = KEYFRAME_TIME_EPSILON): boolean => {
    return Math.abs(left - right) <= epsilon;
};

const collectDistinctKeyframeTimes = (
    clip: ScaAnimationClip,
    filter?: (track: ScaAnimationTrack) => boolean
): number[] => {
    const bucketed: number[] = [];

    for (const track of clip.tracks) {
        if (filter && !filter(track)) {
            continue;
        }

        for (const keyframe of track.keyframes) {
            const exists = bucketed.some((time) => timesNearEqual(time, keyframe.time));
            if (!exists) {
                bucketed.push(keyframe.time);
            }
        }
    }

    return bucketed.sort((left, right) => left - right);
};

const findPreviousKeyframeTime = (times: number[], currentTime: number): number | null => {
    let candidate: number | null = null;

    for (const time of times) {
        if (time < currentTime - KEYFRAME_TIME_EPSILON) {
            candidate = time;
        }
    }

    return candidate;
};

const findNextKeyframeTime = (times: number[], currentTime: number): number | null => {
    for (const time of times) {
        if (time > currentTime + KEYFRAME_TIME_EPSILON) {
            return time;
        }
    }

    return null;
};

const findKeyframeIdAtTime = (
    clip: ScaAnimationClip,
    time: number,
    filter?: (track: ScaAnimationTrack) => boolean
): { trackId: string; keyframeId: string } | null => {
    for (const track of clip.tracks) {
        if (filter && !filter(track)) {
            continue;
        }

        for (const keyframe of track.keyframes) {
            if (timesNearEqual(keyframe.time, time)) {
                return { trackId: track.id, keyframeId: keyframe.id };
            }
        }
    }

    return null;
};

const buildSelectedTargetTrackFilter = (
    clip: ScaAnimationClip,
    selectedNodeId: string | null,
    selectedRegionId: string | null
): ((track: ScaAnimationTrack) => boolean) | undefined => {
    if (selectedNodeId) {
        return (track) => track.targetType === 'rig-node' && track.nodeId === selectedNodeId;
    }

    if (selectedRegionId) {
        return (track) => track.targetType === 'region' && track.regionId === selectedRegionId;
    }

    return undefined;
};

const navigateClipKeyframeTime = (
    clip: ScaAnimationClip,
    currentTime: number,
    direction: 'previous' | 'next',
    selectedNodeId: string | null,
    selectedRegionId: string | null
): { time: number; trackId: string | null; keyframeId: string | null } | null => {
    const selectedFilter = buildSelectedTargetTrackFilter(clip, selectedNodeId, selectedRegionId);
    let times = collectDistinctKeyframeTimes(clip, selectedFilter);

    if (times.length === 0) {
        times = collectDistinctKeyframeTimes(clip);
    }

    if (times.length === 0) {
        return null;
    }

    const targetTime = direction === 'previous' ?
        findPreviousKeyframeTime(times, currentTime) :
        findNextKeyframeTime(times, currentTime);

    if (targetTime === null) {
        return null;
    }

    const selection = findKeyframeIdAtTime(clip, targetTime, selectedFilter) ??
        findKeyframeIdAtTime(clip, targetTime);

    return {
        time: targetTime,
        trackId: selection?.trackId ?? null,
        keyframeId: selection?.keyframeId ?? null
    };
};

export {
    buildSelectedTargetTrackFilter,
    collectDistinctKeyframeTimes,
    findKeyframeIdAtTime,
    findNextKeyframeTime,
    findPreviousKeyframeTime,
    navigateClipKeyframeTime,
    timesNearEqual
};
