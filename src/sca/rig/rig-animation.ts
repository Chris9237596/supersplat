import { Quat, Vec3 } from 'playcanvas';

import { ScaAnimationClip, ScaAnimationTrack, ScaRigNodeAnimationTrack } from '../types/animation';
import { ScaProject } from '../types/project';
import { ScaRig, ScaRigVec3 } from '../types/rig';

import { ScaRigEvaluatedPose, ScaRigNodePose } from './rig-pose';
import { cloneVec3 } from './rig-transform';

const eulerScratch = new Vec3();
const quatA = new Quat();
const quatB = new Quat();
const vecScratch = new Vec3();

const eulerToQuat = (rotation: ScaRigVec3, target = quatA): Quat => {
    return target.setFromEulerAngles(rotation[0], rotation[1], rotation[2]);
};

const quatToEuler = (quat: Quat, target = eulerScratch): ScaRigVec3 => {
    quat.getEulerAngles(target);
    return [target.x, target.y, target.z];
};

const lerpNumber = (left: number, right: number, alpha: number): number => {
    return left + (right - left) * alpha;
};

const lerpVec3 = (left: ScaRigVec3, right: ScaRigVec3, alpha: number): ScaRigVec3 => {
    return [
        lerpNumber(left[0], right[0], alpha),
        lerpNumber(left[1], right[1], alpha),
        lerpNumber(left[2], right[2], alpha)
    ];
};

const sampleSortedKeyframes = <T extends { time: number }>(
    keyframes: T[],
    time: number,
    samplePair: (left: T, right: T, alpha: number) => T extends { value: infer V } ? V : never,
    fallback: T extends { value: infer V } ? V : never
): T extends { value: infer V } ? V : never => {
    if (keyframes.length === 0) {
        return fallback;
    }

    if (keyframes.length === 1 || time <= keyframes[0].time) {
        return (keyframes[0] as T & { value: typeof fallback }).value;
    }

    const last = keyframes[keyframes.length - 1];
    if (time >= last.time) {
        return (last as T & { value: typeof fallback }).value;
    }

    for (let index = 0; index < keyframes.length - 1; index++) {
        const left = keyframes[index];
        const right = keyframes[index + 1];
        if (time < left.time || time > right.time) {
            continue;
        }

        const span = right.time - left.time;
        const alpha = span > 0 ? (time - left.time) / span : 0;
        return samplePair(left, right, alpha);
    }

    return (last as T & { value: typeof fallback }).value;
};

const sampleVec3Track = (
    keyframes: { time: number; value: ScaRigVec3 }[],
    time: number,
    useSlerp: boolean
): ScaRigVec3 => {
    return sampleSortedKeyframes(
        keyframes,
        time,
        (left, right, alpha) => {
            if (!useSlerp) {
                return lerpVec3(left.value, right.value, alpha);
            }

            eulerToQuat(left.value, quatA);
            eulerToQuat(right.value, quatB);
            quatA.slerp(quatA, quatB, alpha);
            return quatToEuler(quatA, eulerScratch);
        },
        [0, 0, 0]
    );
};

const sampleNumberTrack = (
    keyframes: { time: number; value: number }[],
    time: number
): number => {
    return sampleSortedKeyframes(
        keyframes,
        time,
        (left, right, alpha) => lerpNumber(left.value, right.value, alpha),
        1
    );
};

const sampleTrackRotation = (
    track: { keyframes: { time: number; value: ScaRigVec3 }[] },
    time: number
): ScaRigVec3 => {
    return sampleVec3Track(track.keyframes, time, true);
};

const sampleTrackPosition = (
    track: { keyframes: { time: number; value: ScaRigVec3 }[] },
    time: number
): ScaRigVec3 => {
    return sampleVec3Track(track.keyframes, time, false);
};

const isRigNodeTrack = (track: ScaAnimationTrack): track is ScaRigNodeAnimationTrack => {
    return track.targetType === 'rig-node';
};

const clipTargetsExist = (project: ScaProject | undefined, clip: ScaAnimationClip | null): boolean => {
    if (!project || !clip) {
        return false;
    }

    const nodeIds = new Set(project.rig?.nodes.map((node) => node.id) ?? []);
    const regionIds = new Set(project.regions.map((region) => region.id));

    return clip.tracks.every((track) => {
        if (track.targetType === 'rig-node') {
            return nodeIds.has(track.nodeId);
        }

        return regionIds.has(track.regionId);
    });
};

const collectAnimatedNodeIds = (clip: ScaAnimationClip | null): string[] => {
    if (!clip) {
        return [];
    }

    const nodeIds = new Set<string>();
    for (const track of clip.tracks) {
        if (track.targetType === 'rig-node') {
            nodeIds.add(track.nodeId);
        }
    }

    return [...nodeIds];
};

const applyRigAnimationToPose = (
    basePose: ScaRigEvaluatedPose,
    rig: ScaRig,
    clip: ScaAnimationClip,
    currentTime: number
): ScaRigEvaluatedPose => {
    const nodes = new Map<string, ScaRigNodePose>();
    for (const [nodeId, pose] of basePose.nodes.entries()) {
        nodes.set(nodeId, {
            position: cloneVec3(pose.position),
            rotation: cloneVec3(pose.rotation)
        });
    }

    const clampedTime = Math.max(0, Math.min(currentTime, clip.duration));

    for (const track of clip.tracks) {
        if (!isRigNodeTrack(track) || track.keyframes.length === 0) {
            continue;
        }

        if (!rig.nodes.some((node) => node.id === track.nodeId)) {
            continue;
        }

        const baseNodePose = nodes.get(track.nodeId);
        if (!baseNodePose) {
            continue;
        }

        if (track.property === 'position') {
            baseNodePose.position = sampleTrackPosition(track, clampedTime);
        } else {
            baseNodePose.rotation = sampleTrackRotation(track, clampedTime);
        }
    }

    return { nodes };
};

const createLegacyTestAnimationClip = (
    nodeId: string,
    authoredRotation: ScaRigVec3
): ScaAnimationClip => {
    const start = cloneVec3(authoredRotation);
    const end: ScaRigVec3 = [
        authoredRotation[0],
        authoredRotation[1],
        authoredRotation[2] + 30
    ];

    return {
        id: 'animation_99',
        name: 'Test Animation',
        duration: 1,
        tracks: [{
            id: 'track_99',
            targetType: 'rig-node',
            nodeId,
            property: 'rotation',
            keyframes: [
                { id: 'keyframe_01', time: 0, value: start },
                { id: 'keyframe_02', time: 1, value: end }
            ]
        }]
    };
};

/** @deprecated Use createLegacyTestAnimationClip */
const createTestAnimationClip = createLegacyTestAnimationClip;

/** @deprecated Use clipTargetsExist */
const clipTargetNodeExists = (rig: ScaRig | undefined, clip: ScaAnimationClip | null): boolean => {
    if (!rig || !clip) {
        return false;
    }

    return clip.tracks
        .filter(isRigNodeTrack)
        .every((track) => rig.nodes.some((node) => node.id === track.nodeId));
};

/** @deprecated Use applyRigAnimationToPose */
const applyAnimationToPose = (
    basePose: ScaRigEvaluatedPose,
    rig: ScaRig,
    playback: { influenceActive?: boolean; previewActive?: boolean; clip: ScaAnimationClip | null; currentTime: number }
): ScaRigEvaluatedPose => {
    const previewActive = playback.previewActive ?? playback.influenceActive ?? false;
    if (!previewActive || !playback.clip) {
        return basePose;
    }

    return applyRigAnimationToPose(basePose, rig, playback.clip, playback.currentTime);
};

export {
    applyAnimationToPose,
    applyRigAnimationToPose,
    clipTargetNodeExists,
    clipTargetsExist,
    collectAnimatedNodeIds,
    createLegacyTestAnimationClip,
    createTestAnimationClip,
    sampleNumberTrack,
    sampleTrackPosition,
    sampleTrackRotation,
    sampleVec3Track
};
