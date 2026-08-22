import { ScaRig, ScaRigVec3 } from '../types/rig';

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
    evaluateRigPose,
    getEvaluatedNodePose,
    requireEvaluatedNodePose
};
