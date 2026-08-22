import { ScaRigVec3 } from '../types/rig';

/** Editor-only transient animation keyframe (not persisted). */
type ScaRigAnimationKeyframe = {
    time: number;
    rotation: ScaRigVec3;
};

/** Editor-only transient animation track (not persisted). */
type ScaRigAnimationTrack = {
    nodeId: string;
    keyframes: ScaRigAnimationKeyframe[];
};

/** Editor-only transient animation clip (not persisted). */
type ScaRigAnimationClip = {
    id: string;
    name: string;
    duration: number;
    tracks: ScaRigAnimationTrack[];
};

type ScaRigAnimationPlaybackState = {
    clip: ScaRigAnimationClip | null;
    playing: boolean;
    /** When false, evaluated pose ignores animation even if a clip exists. */
    influenceActive: boolean;
    currentTime: number;
};

export {
    ScaRigAnimationClip,
    ScaRigAnimationKeyframe,
    ScaRigAnimationPlaybackState,
    ScaRigAnimationTrack
};
