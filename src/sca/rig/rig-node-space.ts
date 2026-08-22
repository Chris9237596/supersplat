import { Entity, Mat4, Quat, Vec3 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { findSplatByScaSplatId } from '../regions/splat-identity';
import {
    buildNodeWorldMatrix,
    buildParentWorldMatrix,
    getNodeHandleWorldEuler,
    getNodeHandleWorldPosition,
    localTransformFromWorldHandle,
    localTransformFromWorldMatrix
} from './rig-hierarchy';
import { matrixMaxAbsError, matricesNearEqual } from './rig-transform';
import { ScaRig, ScaRigNode, ScaRigVec3 } from '../types/rig';
import { ScaRegion } from '../types/region';

type RigNodeHandleWorldTransform = {
    /** Handle position in splat-local space (full rig hierarchy applied). */
    splatLocalPosition: Vec3;
    /** Handle euler in splat-local space (full rig hierarchy applied). */
    splatLocalEuler: ScaRigVec3;
    /** Handle position in scene/world space. */
    worldPosition: Vec3;
    /** Node world matrix in splat-local space. */
    splatLocalMatrix: Mat4;
};

type RigNodeHandleWorldTransformScratch = {
    splatLocalPosition?: Vec3;
    splatLocalEuler?: Vec3;
    worldPosition?: Vec3;
    splatLocalMatrix?: Mat4;
};

const localPivot = new Vec3();
const worldPivot = new Vec3();
const eulerA = new Vec3();
const quatA = new Quat();
const matEntity = new Mat4();
const matNodeWorld = new Mat4();
const matParentWorld = new Mat4();
const matExpected = new Mat4();

const resolveSplatForNode = (
    events: Events,
    scene: Scene,
    node: ScaRigNode,
    rig: ScaRig
): Splat | null => {
    const bindings = rig.bindings.filter((binding) => binding.nodeId === node.id);
    for (const binding of bindings) {
        const region = events.invoke('sca.region.get', binding.regionId) as ScaRegion | null;
        if (!region) {
            continue;
        }

        const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
        if (splat) {
            return splat;
        }
    }

    const splats = scene.getElementsByType(ElementType.splat) as Splat[];
    return splats[0] ?? null;
};

const getNodeLocalPivotPosition = (node: ScaRigNode, out = localPivot): Vec3 => {
    out.set(
        node.pivot[0] + node.position[0],
        node.pivot[1] + node.position[1],
        node.pivot[2] + node.position[2]
    );
    return out;
};

const getRigNodeHandleWorldTransform = (
    rig: ScaRig,
    node: ScaRigNode,
    splat: Splat,
    scratch: RigNodeHandleWorldTransformScratch = {}
): RigNodeHandleWorldTransform => {
    const splatLocalPosition = scratch.splatLocalPosition ?? new Vec3();
    const splatLocalEulerVec = scratch.splatLocalEuler ?? new Vec3();
    const worldPosition = scratch.worldPosition ?? new Vec3();
    const splatLocalMatrix = scratch.splatLocalMatrix ?? new Mat4();

    buildNodeWorldMatrix(rig, node, splatLocalMatrix);
    getNodeHandleWorldPosition(rig, node, splatLocalPosition);
    getNodeHandleWorldEuler(rig, node, splatLocalEulerVec);
    splat.worldTransform.transformPoint(splatLocalPosition, worldPosition);

    return {
        splatLocalPosition,
        splatLocalEuler: [
            splatLocalEulerVec.x,
            splatLocalEulerVec.y,
            splatLocalEulerVec.z
        ],
        worldPosition,
        splatLocalMatrix
    };
};

const getNodeWorldPivotPosition = (
    rig: ScaRig,
    node: ScaRigNode,
    splat: Splat,
    out = worldPivot
): Vec3 => {
    return getRigNodeHandleWorldTransform(rig, node, splat, {
        worldPosition: out
    }).worldPosition;
};

/** Gizmo helper pose = handle position + node world rotation in splat-local space. */
const nodeWorldMatrixToHelperHandle = (
    rig: ScaRig,
    node: ScaRigNode,
    target = matEntity
): Mat4 => {
    buildNodeWorldMatrix(rig, node, matNodeWorld);
    getNodeHandleWorldPosition(rig, node, localPivot);
    quatA.setFromMat4(matNodeWorld);
    return target.setTRS(localPivot, quatA, Vec3.ONE);
};

const syncHelperFromNode = (entity: Entity, rig: ScaRig, node: ScaRigNode, _splat: Splat): void => {
    nodeWorldMatrixToHelperHandle(rig, node, matEntity);
    entity.setLocalPosition(localPivot.x, localPivot.y, localPivot.z);
    entity.setLocalRotation(quatA);
};

const entityHandleMatchesNode = (
    entity: Entity,
    rig: ScaRig,
    node: ScaRigNode,
    epsilon = 1e-4
): boolean => {
    const patch = readNodePatchFromHelper(entity, rig, node);
    return rigNodePatchMatchesNode(node, patch, epsilon);
};

/** @deprecated Prefer entityHandleMatchesNode; kept for diagnostics. */
const entitySplatLocalMatrixMatchesNode = (
    entity: Entity,
    rig: ScaRig,
    node: ScaRigNode,
    epsilon = 1e-4
): boolean => {
    return entityHandleMatchesNode(entity, rig, node, epsilon);
};

const readNodePatchFromHelper = (
    entity: Entity,
    rig: ScaRig,
    node: ScaRigNode
): Partial<ScaRigNode> => {
    const handlePosition = entity.getLocalPosition();
    const handleEuler = entity.getLocalEulerAngles();
    return localTransformFromWorldHandle(
        rig,
        node,
        handlePosition,
        [handleEuler.x, handleEuler.y, handleEuler.z]
    );
};

const applyNodePatchToHelper = (
    entity: Entity,
    rig: ScaRig,
    node: ScaRigNode,
    patch: Partial<ScaRigNode>
): void => {
    const nextNode: ScaRigNode = {
        ...node,
        position: patch.position ? [...patch.position] as ScaRigVec3 : node.position,
        rotation: patch.rotation ? [...patch.rotation] as ScaRigVec3 : node.rotation
    };
    syncHelperFromNode(entity, rig, nextNode, null as unknown as Splat);
};

const rigNodePatchMatchesNode = (
    node: ScaRigNode,
    patch: Partial<ScaRigNode>,
    epsilon = 1e-4
): boolean => {
    if (patch.position) {
        for (let axis = 0; axis < 3; axis++) {
            if (Math.abs(patch.position[axis] - node.position[axis]) > epsilon) {
                return false;
            }
        }
    }

    if (patch.rotation) {
        quatA.setFromEulerAngles(node.rotation[0], node.rotation[1], node.rotation[2]);
        const patchQuat = new Quat().setFromEulerAngles(
            patch.rotation[0],
            patch.rotation[1],
            patch.rotation[2]
        );
        if (Math.abs(Math.abs(quatA.dot(patchQuat)) - 1) > epsilon) {
            return false;
        }
    }

    return true;
};

const transformSplatLocalDirectionToWorld = (
    splat: Splat,
    splatLocalEuler: ScaRigVec3,
    localDirection: Vec3,
    out = new Vec3()
): Vec3 => {
    quatA.setFromEulerAngles(splatLocalEuler[0], splatLocalEuler[1], splatLocalEuler[2]);
    quatA.transformVector(localDirection, out);
    splat.worldTransform.transformVector(out, out);
    out.normalize();
    return out;
};

const formatMatrixArray = (matrix: Mat4): number[] => {
    return Array.from(matrix.data).map((value) => Number(value.toFixed(6)));
};

const formatVec3Array = (value: Vec3 | ScaRigVec3): number[] => {
    if (Array.isArray(value)) {
        return value.map((entry) => Number(entry.toFixed(6)));
    }
    return [value.x, value.y, value.z].map((entry) => Number(entry.toFixed(6)));
};

const isScaRigFirstMoveDebugEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!debug?.rigTrace || !!debug?.rigFirstMove;
};

const logScaRigFirstMoveValues = (payload: {
    rig: ScaRig;
    node: ScaRigNode;
    entity: Entity;
    binding: import('../types/rig').ScaRigBinding | null;
    dragStartHelperLocal: Mat4;
    dragStartNodeWorld: Mat4;
    effectiveBefore: Mat4;
    effectiveAfter: Mat4;
    regionCentroidBefore?: [number, number, number] | null;
    regionCentroidAfter?: [number, number, number] | null;
}): void => {
    if (!isScaRigFirstMoveDebugEnabled()) {
        return;
    }

    const { rig, node, entity, binding } = payload;
    const currentHelperLocal = entity.getLocalTransform();
    const currentHelperWorld = entity.getWorldTransform();

    buildNodeWorldMatrix(rig, node, matNodeWorld);
    buildParentWorldMatrix(rig, node, matParentWorld);

    const patch = readNodePatchFromHelper(entity, rig, node);
    const previewNode: ScaRigNode = {
        ...node,
        position: patch.position ? [...patch.position] as ScaRigVec3 : node.position,
        rotation: patch.rotation ? [...patch.rotation] as ScaRigVec3 : node.rotation
    };
    buildNodeWorldMatrix(rig, previewNode, matExpected);

    const helperDelta = new Mat4();
    helperDelta.copy(currentHelperLocal).mul(payload.dragStartHelperLocal.clone().invert());

    const bindOffset = binding?.bindOffsetMatrix ?? null;

    console.log(
        '[SCA RIG FIRST MOVE VALUES]',
        JSON.stringify({
            dragStartHelperLocalMatrix: formatMatrixArray(payload.dragStartHelperLocal),
            dragStartHelperWorldMatrix: formatMatrixArray(payload.dragStartHelperLocal),
            currentHelperLocalMatrix: formatMatrixArray(currentHelperLocal),
            currentHelperWorldMatrix: formatMatrixArray(currentHelperWorld),
            helperDeltaMatrix: formatMatrixArray(helperDelta),
            dragStartNodeLocalMatrix: formatMatrixArray(buildNodeWorldMatrix(rig, node, new Mat4())),
            dragStartNodeWorldMatrix: formatMatrixArray(payload.dragStartNodeWorld),
            readbackNodeLocalMatrix: formatMatrixArray(matExpected),
            readbackNodeWorldMatrix: formatMatrixArray(matExpected),
            expectedNodeWorldMatrix: formatMatrixArray(matExpected),
            storedNodePosition: formatVec3Array(node.position),
            storedNodeRotationEuler: formatVec3Array(node.rotation),
            parentWorldMatrix: formatMatrixArray(matParentWorld),
            bindOffsetMatrix: bindOffset,
            effectiveMatrixBefore: formatMatrixArray(payload.effectiveBefore),
            effectiveMatrixAfter: formatMatrixArray(payload.effectiveAfter),
            regionCentroidBefore: payload.regionCentroidBefore ?? null,
            regionCentroidAfter: payload.regionCentroidAfter ?? null,
            maxErrorHelperVsDragStartNodeWorld: matrixMaxAbsError(currentHelperLocal, payload.dragStartNodeWorld),
            maxErrorReadbackVsDragStartNodeWorld: matrixMaxAbsError(matExpected, payload.dragStartNodeWorld),
            maxErrorEffectiveBeforeVsAfter: matrixMaxAbsError(payload.effectiveBefore, payload.effectiveAfter)
        })
    );
};

export {
    RigNodeHandleWorldTransform,
    RigNodeHandleWorldTransformScratch,
    applyNodePatchToHelper,
    entityHandleMatchesNode,
    entitySplatLocalMatrixMatchesNode,
    getNodeLocalPivotPosition,
    getNodeWorldPivotPosition,
    getRigNodeHandleWorldTransform,
    logScaRigFirstMoveValues,
    nodeWorldMatrixToHelperHandle,
    readNodePatchFromHelper,
    resolveSplatForNode,
    rigNodePatchMatchesNode,
    syncHelperFromNode,
    transformSplatLocalDirectionToWorld
};
