import { ScaRigVec3 } from './rig';

type ScaAnimationInterpolation = 'linear';

type ScaAnimationKeyframeBase = {
    id: string;
    time: number;
    interpolation?: ScaAnimationInterpolation;
};

type ScaAnimationKeyframeVec3 = ScaAnimationKeyframeBase & {
    value: ScaRigVec3;
};

type ScaAnimationKeyframeNumber = ScaAnimationKeyframeBase & {
    value: number;
};

type ScaRigNodeAnimationProperty = 'position' | 'rotation';

type ScaRigNodeAnimationTrackBase = {
    id: string;
    targetType: 'rig-node';
    nodeId: string;
    keyframes: ScaAnimationKeyframeVec3[];
};

type ScaRigPositionAnimationTrack = ScaRigNodeAnimationTrackBase & {
    property: 'position';
};

type ScaRigRotationAnimationTrack = ScaRigNodeAnimationTrackBase & {
    property: 'rotation';
};

type ScaRegionOpacityAnimationTrack = {
    id: string;
    targetType: 'region';
    regionId: string;
    property: 'opacity';
    keyframes: ScaAnimationKeyframeNumber[];
};

type ScaRigNodeAnimationTrack = ScaRigPositionAnimationTrack | ScaRigRotationAnimationTrack;

type ScaAnimationTrack = ScaRigNodeAnimationTrack | ScaRegionOpacityAnimationTrack;

type ScaAnimationTriggerType = 'none' | 'hotspot' | 'region';

type ScaAnimationClipTrigger = {
    type: ScaAnimationTriggerType;
    targetId?: string;
};

type ScaAnimationClip = {
    id: string;
    name: string;
    duration: number;
    tracks: ScaAnimationTrack[];
    autoplay?: boolean;
    loop?: boolean;
    trigger?: ScaAnimationClipTrigger;
};

type ScaAnimationPlaybackState = {
    activeClipId: string | null;
    /** Transient resolved clip mirror for evaluation (not persisted). */
    clip: ScaAnimationClip | null;
    playing: boolean;
    previewActive: boolean;
    currentTime: number;
    selectedTrackId: string | null;
    selectedKeyframeId: string | null;
    editMode: boolean;
};

export {
    ScaAnimationClip,
    ScaAnimationClipTrigger,
    ScaAnimationTriggerType,
    ScaAnimationInterpolation,
    ScaAnimationKeyframeBase,
    ScaAnimationKeyframeNumber,
    ScaAnimationKeyframeVec3,
    ScaAnimationPlaybackState,
    ScaAnimationTrack,
    ScaRegionOpacityAnimationTrack,
    ScaRigNodeAnimationProperty,
    ScaRigNodeAnimationTrack,
    ScaRigPositionAnimationTrack,
    ScaRigRotationAnimationTrack
};
