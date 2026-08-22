import { Quat, Vec3 } from 'playcanvas';

import { ScaRig, ScaRigVec3 } from '../types/rig';

import { ScaRigEvaluatedPose, ScaRigNodePose } from './rig-pose';
import {
    ScaRigAnimationClip,
    ScaRigAnimationPlaybackState,
    ScaRigAnimationTrack
} from './rig-animation-types';
import { cloneVec3 } from './rig-transform';

const eulerScratch = new Vec3();
const quatA = new Quat();
const quatB = new Quat();

const eulerToQuat = (rotation: ScaRigVec3, target = quatA): Quat => {
    return target.setFromEulerAngles(rotation[0], rotation[1], rotation[2]);
};

const quatToEuler = (quat: Quat, target = eulerScratch): ScaRigVec3 => {
    quat.getEulerAngles(target);
    return [target.x, target.y, target.z];
};

const sampleTrackRotation = (track: ScaRigAnimationTrack, time: number): ScaRigVec3 => {
    const keyframes = track.keyframes;
    if (keyframes.length === 0) {
        return [0, 0, 0];
    }

    if (keyframes.length === 1 || time <= keyframes[0].time) {
        return cloneVec3(keyframes[0].rotation);
    }

    const last = keyframes[keyframes.length - 1];
    if (time >= last.time) {
        return cloneVec3(last.rotation);
    }

    for (let index = 0; index < keyframes.length - 1; index++) {
        const left = keyframes[index];
        const right = keyframes[index + 1];
        if (time < left.time || time > right.time) {
            continue;
        }

        const span = right.time - left.time;
        const alpha = span > 0 ? (time - left.time) / span : 0;
        eulerToQuat(left.rotation, quatA);
        eulerToQuat(right.rotation, quatB);
        quatA.slerp(quatA, quatB, alpha);
        return quatToEuler(quatA, eulerScratch);
    }

    return cloneVec3(last.rotation);
};

const createTestAnimationClip = (
    nodeId: string,
    authoredRotation: ScaRigVec3
): ScaRigAnimationClip => {
    const start = cloneVec3(authoredRotation);
    const end: ScaRigVec3 = [
        authoredRotation[0],
        authoredRotation[1],
        authoredRotation[2] + 30
    ];

    return {
        id: 'sca_rig_test_animation',
        name: 'Test Animation',
        duration: 1,
        tracks: [{
            nodeId,
            keyframes: [
                { time: 0, rotation: start },
                { time: 1, rotation: end }
            ]
        }]
    };
};

const clipTargetNodeExists = (rig: ScaRig | undefined, clip: ScaRigAnimationClip | null): boolean => {
    if (!rig || !clip) {
        return false;
    }

    return clip.tracks.every((track) => rig.nodes.some((node) => node.id === track.nodeId));
};

const applyAnimationToPose = (
    basePose: ScaRigEvaluatedPose,
    rig: ScaRig,
    playback: ScaRigAnimationPlaybackState
): ScaRigEvaluatedPose => {
    if (!playback.influenceActive || !playback.clip || !clipTargetNodeExists(rig, playback.clip)) {
        return basePose;
    }

    const nodes = new Map<string, ScaRigNodePose>();
    for (const [nodeId, pose] of basePose.nodes.entries()) {
        nodes.set(nodeId, {
            position: cloneVec3(pose.position),
            rotation: cloneVec3(pose.rotation)
        });
    }

    const clampedTime = Math.max(0, Math.min(playback.currentTime, playback.clip.duration));

    for (const track of playback.clip.tracks) {
        if (!rig.nodes.some((node) => node.id === track.nodeId)) {
            continue;
        }

        const baseNodePose = nodes.get(track.nodeId);
        if (!baseNodePose) {
            continue;
        }

        baseNodePose.rotation = sampleTrackRotation(track, clampedTime);
    }

    return { nodes };
};

export {
    applyAnimationToPose,
    clipTargetNodeExists,
    createTestAnimationClip,
    sampleTrackRotation
};
