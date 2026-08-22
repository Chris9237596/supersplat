import { Mat4, Quat, Vec3 } from 'playcanvas';

import { ScaRig, ScaRigBinding, ScaRigNode, ScaRigVec3 } from '../types/rig';

import { evaluateRigPose, requireEvaluatedNodePose, ScaRigEvaluatedPose } from './rig-pose';
import { buildRigidRigMatrixFromPose, bindOffsetToMatrix, matrixToArray, matrixToPose } from './rig-transform';

type ScaRigReparentMode = 'keep-world' | 'keep-local';

const matC = new Mat4();
const matParentWorld = new Mat4();
const matLocal = new Mat4();
const matCompose = new Mat4();
const vecA = new Vec3();
const eulerA = new Vec3();

const isScaRigHierarchyDebugEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!debug?.rigHierarchy;
};

const logScaRigHierarchy = (payload: Record<string, unknown>): void => {
    if (!isScaRigHierarchyDebugEnabled()) {
        return;
    }

    console.log('[SCA RIG HIERARCHY]', payload);
};

const getRigNode = (rig: ScaRig, nodeId: string): ScaRigNode | null => {
    return rig.nodes.find((node) => node.id === nodeId) ?? null;
};

const getRigChildren = (rig: ScaRig, parentId: string | null): ScaRigNode[] => {
    return rig.nodes.filter((node) => (node.parentId ?? null) === parentId);
};

const collectRigDescendants = (rig: ScaRig, nodeId: string): string[] => {
    const result: string[] = [];
    const queue = getRigChildren(rig, nodeId).map((node) => node.id);

    while (queue.length > 0) {
        const current = queue.shift()!;
        result.push(current);
        queue.push(...getRigChildren(rig, current).map((node) => node.id));
    }

    return result;
};

const collectRigSubtreeNodeIds = (rig: ScaRig, nodeId: string): string[] => {
    return [nodeId, ...collectRigDescendants(rig, nodeId)];
};

const wouldCreateRigCycle = (rig: ScaRig, nodeId: string, parentId: string | null): boolean => {
    if (!parentId || parentId === nodeId) {
        return parentId === nodeId;
    }

    if (!getRigNode(rig, parentId)) {
        return true;
    }

    let cursor: string | null | undefined = parentId;
    while (cursor) {
        if (cursor === nodeId) {
            return true;
        }
        cursor = getRigNode(rig, cursor)?.parentId ?? null;
    }

    return false;
};

const breakRigHierarchyCycles = (rig: ScaRig): boolean => {
    let changed = false;
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (nodeId: string): void => {
        if (visited.has(nodeId)) {
            return;
        }

        if (visiting.has(nodeId)) {
            const node = getRigNode(rig, nodeId);
            if (node) {
                delete node.parentId;
                changed = true;
                console.warn(`[SCA RIG HIERARCHY] broke cycle at node ${nodeId}`);
            }
            return;
        }

        visiting.add(nodeId);
        const node = getRigNode(rig, nodeId);
        const parentId = node?.parentId ?? null;
        if (parentId) {
            if (!getRigNode(rig, parentId)) {
                if (node) {
                    delete node.parentId;
                    changed = true;
                }
            } else {
                dfs(parentId);
            }
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
    };

    for (const node of rig.nodes) {
        dfs(node.id);
    }

    return changed;
};

const normalizeRigHierarchy = (rig: ScaRig): void => {
    for (const node of rig.nodes) {
        if (node.parentId === undefined) {
            continue;
        }

        if (!node.parentId) {
            delete node.parentId;
            continue;
        }

        if (node.parentId === node.id || !getRigNode(rig, node.parentId)) {
            delete node.parentId;
        }
    }

    breakRigHierarchyCycles(rig);
};

const buildNodeLocalMatrixFromPose = (
    node: ScaRigNode,
    pose: Pick<ScaRigNode, 'position' | 'rotation'>,
    target = new Mat4()
): Mat4 => {
    return buildRigidRigMatrixFromPose(node, pose, target);
};

const buildNodeLocalMatrix = (node: ScaRigNode, target = new Mat4()): Mat4 => {
    return buildNodeLocalMatrixFromPose(node, node, target);
};

const buildParentWorldMatrixFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    target = new Mat4()
): Mat4 => {
    const parentId = node.parentId ?? null;
    if (!parentId) {
        return target.copy(Mat4.IDENTITY);
    }

    const parent = getRigNode(rig, parentId);
    if (!parent) {
        return target.copy(Mat4.IDENTITY);
    }

    return buildNodeWorldMatrixFromPose(rig, pose, parent, target);
};

const buildParentWorldMatrix = (rig: ScaRig, node: ScaRigNode, target = new Mat4()): Mat4 => {
    return buildParentWorldMatrixFromPose(rig, evaluateRigPose(rig), node, target);
};

const buildNodeWorldMatrixFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    target = new Mat4()
): Mat4 => {
    buildParentWorldMatrixFromPose(rig, pose, node, matParentWorld);
    buildNodeLocalMatrixFromPose(node, requireEvaluatedNodePose(pose, node), matLocal);
    matCompose.copy(matParentWorld).mul(matLocal);
    return target.copy(matCompose);
};

const buildNodeWorldMatrix = (rig: ScaRig, node: ScaRigNode, target = new Mat4()): Mat4 => {
    return buildNodeWorldMatrixFromPose(rig, evaluateRigPose(rig), node, target);
};

const isWorldMatrixIdentity = (matrix: Mat4): boolean => {
    const identity = Mat4.IDENTITY.data;
    for (let i = 0; i < 16; i++) {
        if (Math.abs(matrix.data[i] - identity[i]) > 1e-5) {
            return false;
        }
    }
    return true;
};

const getNodeHandleWorldPositionFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    out = vecA
): Vec3 => {
    buildParentWorldMatrixFromPose(rig, pose, node, matParentWorld);
    const poseNode = requireEvaluatedNodePose(pose, node);
    out.set(
        node.pivot[0] + poseNode.position[0],
        node.pivot[1] + poseNode.position[1],
        node.pivot[2] + poseNode.position[2]
    );
    return matParentWorld.transformPoint(out, out);
};

const getNodeHandleWorldPosition = (rig: ScaRig, node: ScaRigNode, out = vecA): Vec3 => {
    return getNodeHandleWorldPositionFromPose(rig, evaluateRigPose(rig), node, out);
};

const getNodeHandleWorldEulerFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    out = eulerA
): Vec3 => {
    buildNodeWorldMatrixFromPose(rig, pose, node, matCompose);
    matCompose.getEulerAngles(out);
    return out;
};

const getNodeHandleWorldEuler = (rig: ScaRig, node: ScaRigNode, out = eulerA): Vec3 => {
    return getNodeHandleWorldEulerFromPose(rig, evaluateRigPose(rig), node, out);
};

const localTransformFromWorldMatrix = (
    rig: ScaRig,
    node: ScaRigNode,
    worldMatrix: Mat4
): Pick<ScaRigNode, 'position' | 'rotation'> => {
    const pose = evaluateRigPose(rig);
    buildParentWorldMatrixFromPose(rig, pose, node, matParentWorld);
    matLocal.copy(matParentWorld).invert().mul(worldMatrix);
    return localPoseFromRigidMatrix(node, matLocal);
};

const localTransformFromWorldHandle = (
    rig: ScaRig,
    node: ScaRigNode,
    handleWorld: Vec3,
    handleWorldEuler: ScaRigVec3
): Pick<ScaRigNode, 'position' | 'rotation'> => {
    const pose = evaluateRigPose(rig);
    buildParentWorldMatrixFromPose(rig, pose, node, matParentWorld);
    matLocal.copy(matParentWorld).invert();
    matLocal.transformPoint(handleWorld, vecA);

    const parentQuat = new Quat().setFromMat4(matParentWorld);
    const worldQuat = new Quat().setFromEulerAngles(
        handleWorldEuler[0],
        handleWorldEuler[1],
        handleWorldEuler[2]
    );
    parentQuat.invert().mul(worldQuat);
    parentQuat.getEulerAngles(eulerA);

    return {
        position: [
            vecA.x - node.pivot[0],
            vecA.y - node.pivot[1],
            vecA.z - node.pivot[2]
        ] as ScaRigVec3,
        rotation: [eulerA.x, eulerA.y, eulerA.z] as ScaRigVec3
    };
};

const localPoseFromRigidMatrix = (
    node: ScaRigNode,
    localMatrix: Mat4
): Pick<ScaRigNode, 'position' | 'rotation'> => {
    localMatrix.getTranslation(vecA);
    const rotation = new Quat().setFromMat4(localMatrix);
    const rotatedPivot = new Vec3(node.pivot[0], node.pivot[1], node.pivot[2]);
    rotation.transformVector(rotatedPivot, rotatedPivot);
    rotation.getEulerAngles(eulerA);

    return {
        position: [
            vecA.x - node.pivot[0] + rotatedPivot.x,
            vecA.y - node.pivot[1] + rotatedPivot.y,
            vecA.z - node.pivot[2] + rotatedPivot.z
        ] as ScaRigVec3,
        rotation: [eulerA.x, eulerA.y, eulerA.z] as ScaRigVec3
    };
};

const computeReparentLocalKeepWorld = (
    rig: ScaRig,
    node: ScaRigNode,
    newParentId: string | null
): Pick<ScaRigNode, 'position' | 'rotation'> => {
    const pose = evaluateRigPose(rig);
    buildNodeWorldMatrixFromPose(rig, pose, node, matC);

    const tempNode: ScaRigNode = {
        ...node,
        parentId: newParentId ?? undefined
    };
    if (!newParentId) {
        delete tempNode.parentId;
    }

    buildParentWorldMatrixFromPose(rig, pose, tempNode, matParentWorld);
    matLocal.copy(matParentWorld).invert().mul(matC);
    return localPoseFromRigidMatrix(node, matLocal);
};

const promoteDirectChildrenOnDelete = (
    rig: ScaRig,
    deletedNodeId: string
): void => {
    const pose = evaluateRigPose(rig);
    const children = getRigChildren(rig, deletedNodeId);
    for (const child of children) {
        buildNodeWorldMatrixFromPose(rig, pose, child, matC);
        child.parentId = undefined;
        delete child.parentId;

        const local = localTransformFromWorldMatrix(rig, child, matC);
        child.position = local.position;
        child.rotation = local.rotation;

        logScaRigHierarchy({
            node: child.id,
            parent: null,
            action: 'promote-on-delete',
            localPosition: child.position,
            worldPosition: matrixToPose(matC).position
        });
    }
};

const getValidParentOptions = (rig: ScaRig, nodeId: string): ScaRigNode[] => {
    const invalid = new Set<string>([nodeId, ...collectRigDescendants(rig, nodeId)]);
    return rig.nodes.filter((node) => !invalid.has(node.id));
};

const buildEffectiveRigWorldMatrixFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    binding: ScaRigBinding | null | undefined,
    target = new Mat4()
): Mat4 => {
    buildNodeWorldMatrixFromPose(rig, pose, node, target);
    bindOffsetToMatrix(binding, matC);
    return target.mul(matC);
};

const buildEffectiveRigWorldMatrix = (
    rig: ScaRig,
    node: ScaRigNode,
    binding: ScaRigBinding | null | undefined,
    target = new Mat4()
): Mat4 => {
    return buildEffectiveRigWorldMatrixFromPose(rig, evaluateRigPose(rig), node, binding, target);
};

const computeKeepWorldBindOffsetMatrixFromPose = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    target = new Mat4()
): Mat4 => {
    buildNodeWorldMatrixFromPose(rig, pose, node, matCompose);
    return target.copy(matCompose).invert();
};

const computeKeepWorldBindOffsetMatrix = (
    rig: ScaRig,
    node: ScaRigNode,
    target = new Mat4()
): Mat4 => {
    return computeKeepWorldBindOffsetMatrixFromPose(rig, evaluateRigPose(rig), node, target);
};

const computeKeepWorldBindOffset = (rig: ScaRig, node: ScaRigNode) => {
    computeKeepWorldBindOffsetMatrix(rig, node, matLocal);
    return matrixToPose(matLocal);
};

const createKeepWorldBindOffset = (rig: ScaRig, node: ScaRigNode) => {
    computeKeepWorldBindOffsetMatrix(rig, node, matLocal);
    return {
        bindOffsetMatrix: matrixToArray(matLocal),
        bindOffset: matrixToPose(matLocal)
    };
};

export {
    ScaRigReparentMode,
    breakRigHierarchyCycles,
    buildEffectiveRigWorldMatrix,
    buildEffectiveRigWorldMatrixFromPose,
    buildNodeLocalMatrix,
    buildNodeLocalMatrixFromPose,
    buildNodeWorldMatrix,
    buildNodeWorldMatrixFromPose,
    buildParentWorldMatrix,
    buildParentWorldMatrixFromPose,
    collectRigDescendants,
    collectRigSubtreeNodeIds,
    computeKeepWorldBindOffset,
    computeKeepWorldBindOffsetMatrix,
    createKeepWorldBindOffset,
    computeReparentLocalKeepWorld,
    getNodeHandleWorldEuler,
    getNodeHandleWorldPosition,
    getRigChildren,
    getValidParentOptions,
    isWorldMatrixIdentity,
    localTransformFromWorldHandle,
    localTransformFromWorldMatrix,
    logScaRigHierarchy,
    normalizeRigHierarchy,
    promoteDirectChildrenOnDelete,
    wouldCreateRigCycle
};
