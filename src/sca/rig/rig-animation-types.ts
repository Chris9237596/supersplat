import {
    ScaAnimationClip,
    ScaAnimationKeyframeVec3,
    ScaAnimationPlaybackState,
    ScaAnimationTrack,
    ScaRigRotationAnimationTrack
} from '../types/animation';

/** @deprecated Use ScaAnimationKeyframeVec3 */
type ScaRigAnimationKeyframe = {
    time: number;
    rotation: import('../types/rig').ScaRigVec3;
};

/** @deprecated Use ScaRigRotationAnimationTrack */
type ScaRigAnimationTrack = {
    nodeId: string;
    keyframes: ScaRigAnimationKeyframe[];
};

/** @deprecated Use ScaAnimationClip */
type ScaRigAnimationClip = ScaAnimationClip;

/** @deprecated Use ScaAnimationPlaybackState */
type ScaRigAnimationPlaybackState = ScaAnimationPlaybackState & {
    clip?: ScaAnimationClip | null;
    influenceActive?: boolean;
};

export {
    ScaAnimationClip,
    ScaAnimationKeyframeVec3,
    ScaAnimationPlaybackState,
    ScaAnimationTrack,
    ScaRigAnimationClip,
    ScaRigAnimationKeyframe,
    ScaRigAnimationPlaybackState,
    ScaRigAnimationTrack,
    ScaRigRotationAnimationTrack
};
