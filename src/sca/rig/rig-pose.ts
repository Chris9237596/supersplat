import { ScaProject } from '../types/project';
import { ScaRig, ScaRigVec3 } from '../types/rig';

import { getAnimationEditOverride } from '../animation/animation-edit-state';
import { applyRigAnimationToPose } from './rig-animation';
import { ScaAnimationClip, ScaAnimationPlaybackState } from '../types/animation';
import { cloneVec3 } from './rig-transform';

/** Transient evaluated pose for one rig node (not persisted). */
type ScaRigNodePose = {
    position: ScaRigVec3;
    rotation: ScaRigVec3;
};

/** Transient evaluated pose for an entire rig (not persisted). */
type ScaRigEvaluatedPose = {
    nodes: Map<string, ScaRigNodePose>;
};

let animationPlaybackState: ScaAnimationPlaybackState = {
    activeClipId: null,
    clip: null,
    playing: false,
    previewActive: false,
    currentTime: 0,
    selectedTrackId: null,
    selectedKeyframeId: null,
    editMode: false
};

const setAnimationPlaybackState = (state: ScaAnimationPlaybackState): void => {
    animationPlaybackState = state;
};

const getAnimationPlaybackState = (): ScaAnimationPlaybackState => {
    return animationPlaybackState;
};

/** @deprecated Use setAnimationPlaybackState */
const setRigAnimationPlaybackState = (
    state: ScaAnimationPlaybackState | {
        clip: ScaAnimationClip | null;
        playing: boolean;
        influenceActive?: boolean;
        previewActive?: boolean;
        currentTime: number;
    } | null
): void => {
    if (!state) {
        animationPlaybackState = {
            activeClipId: null,
            clip: null,
            playing: false,
            previewActive: false,
            currentTime: 0,
            selectedTrackId: null,
            selectedKeyframeId: null,
            editMode: false
        };
        return;
    }

    if ('activeClipId' in state) {
        animationPlaybackState = {
            ...state,
            clip: state.clip ? structuredClone(state.clip) : null
        };
        return;
    }

    const legacy = state as {
        clip: ScaAnimationClip | null;
        playing: boolean;
        influenceActive?: boolean;
        previewActive?: boolean;
        currentTime: number;
    };

    animationPlaybackState = {
        activeClipId: legacy.clip?.id ?? null,
        clip: legacy.clip ? structuredClone(legacy.clip) : null,
        playing: legacy.playing,
        previewActive: legacy.previewActive ?? legacy.influenceActive ?? false,
        currentTime: legacy.currentTime,
        selectedTrackId: null,
        selectedKeyframeId: null,
        editMode: false
    };
};

/** @deprecated Use getAnimationPlaybackState */
const getRigAnimationPlaybackState = (): ScaAnimationPlaybackState => {
    return getAnimationPlaybackState();
};

const resolveActiveClip = (project: ScaProject | undefined): ScaAnimationClip | null => {
    if (!project?.animations || !animationPlaybackState.activeClipId) {
        return null;
    }

    return project.animations.find((clip) => clip.id === animationPlaybackState.activeClipId) ?? null;
};

const evaluateRigPose = (rig: ScaRig): ScaRigEvaluatedPose => {
    const nodes = new Map<string, ScaRigNodePose>();

    for (const node of rig.nodes) {
        nodes.set(node.id, {
            position: cloneVec3(node.position),
            rotation: cloneVec3(node.rotation)
        });
    }

    return { nodes };
};

const evaluateFinalRigPose = (rig: ScaRig, project?: ScaProject): ScaRigEvaluatedPose => {
    const basePose = evaluateRigPose(rig);
    if (!animationPlaybackState.previewActive) {
        return basePose;
    }

    const clip = animationPlaybackState.clip ?? resolveActiveClip(project);
    if (!clip) {
        return basePose;
    }

    let pose = applyRigAnimationToPose(
        basePose,
        rig,
        clip,
        animationPlaybackState.currentTime
    );

    const editOverride = getAnimationEditOverride();
    if (editOverride) {
        const nodePose = pose.nodes.get(editOverride.nodeId);
        if (nodePose) {
            if (editOverride.property === 'position') {
                nodePose.position = cloneVec3(editOverride.value);
            } else {
                nodePose.rotation = cloneVec3(editOverride.value);
            }
        }
    }

    return pose;
};

const getEvaluatedNodePose = (
    pose: ScaRigEvaluatedPose,
    nodeId: string
): ScaRigNodePose | null => {
    return pose.nodes.get(nodeId) ?? null;
};

const requireEvaluatedNodePose = (
    pose: ScaRigEvaluatedPose,
    node: { id: string; position: ScaRigVec3; rotation: ScaRigVec3 }
): ScaRigNodePose => {
    return pose.nodes.get(node.id) ?? {
        position: cloneVec3(node.position),
        rotation: cloneVec3(node.rotation)
    };
};

export {
    ScaRigEvaluatedPose,
    ScaRigNodePose,
    evaluateFinalRigPose,
    evaluateRigPose,
    getAnimationPlaybackState,
    getEvaluatedNodePose,
    getRigAnimationPlaybackState,
    requireEvaluatedNodePose,
    resolveActiveClip,
    setAnimationPlaybackState,
    setRigAnimationPlaybackState
};
