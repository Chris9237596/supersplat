import { Entity, Mat4, Quat, Vec3 } from 'playcanvas';

import { Splat } from '../../splat';

import { buildNodeWorldMatrix, buildParentWorldMatrix } from './rig-hierarchy';
import { getRigNodeHandleWorldTransform } from './rig-node-space';
import { ScaRig, ScaRigNode } from '../types/rig';

type RigDragStage =
    | 'before-start'
    | 'start'
    | 'first-move'
    | 'last-move'
    | 'end-before-commit'
    | 'end-after-commit';

const matA = new Mat4();
const matB = new Mat4();
const quatA = new Quat();
const quatB = new Quat();

const isScaRigDragDebugEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!debug?.rigDrag;
};

const formatVec3 = (value: Vec3 | [number, number, number]): number[] => {
    if (Array.isArray(value)) {
        return value.map((entry) => Number(entry.toFixed(6)));
    }

    return [value.x, value.y, value.z].map((entry) => Number(entry.toFixed(6)));
};

const formatMatrix = (matrix: Mat4): number[] => {
    return Array.from(matrix.data).map((entry) => Number(entry.toFixed(6)));
};

const logScaRigDragStage = (
    stage: RigDragStage,
    rig: ScaRig | null,
    node: ScaRigNode | null,
    splat: Splat | null,
    entity: Entity | null
): void => {
    if (!isScaRigDragDebugEnabled() || !rig || !node || !splat || !entity) {
        return;
    }

    buildParentWorldMatrix(rig, node, matA);
    buildNodeWorldMatrix(rig, node, matB);
    const handle = getRigNodeHandleWorldTransform(rig, node, splat);

    quatA.setFromMat4(matB);
    const entityLocal = entity.getLocalTransform();
    const entityWorld = entity.getWorldTransform();
    quatB.setFromMat4(entityLocal);

    console.log('[SCA RIG DRAG]', {
        stage,
        nodeId: node.id,
        parentId: node.parentId ?? null,
        storedLocalPosition: formatVec3(node.position),
        storedLocalRotation: formatVec3(node.rotation),
        parentWorldMatrix: formatMatrix(matA),
        nodeWorldMatrix: formatMatrix(matB),
        canonicalGizmoWorldPosition: formatVec3(handle.worldPosition),
        canonicalGizmoWorldRotation: handle.splatLocalEuler.map((entry) => Number(entry.toFixed(6))),
        helperEntityLocalPosition: formatVec3(entity.getLocalPosition()),
        helperEntityLocalRotation: formatVec3(entity.getLocalEulerAngles()),
        helperEntityWorldPosition: formatVec3(entityWorld.getTranslation()),
        helperEntityWorldRotation: formatVec3(entityWorld.getEulerAngles()),
        helperEntityLocalMatrix: formatMatrix(entityLocal),
        helperEntityWorldMatrix: formatMatrix(entityWorld),
        helperEntityLocalQuat: [
            Number(quatB.x.toFixed(6)),
            Number(quatB.y.toFixed(6)),
            Number(quatB.z.toFixed(6)),
            Number(quatB.w.toFixed(6))
        ],
        nodeWorldQuat: [
            Number(quatA.x.toFixed(6)),
            Number(quatA.y.toFixed(6)),
            Number(quatA.z.toFixed(6)),
            Number(quatA.w.toFixed(6))
        ]
    });
};

export {
    RigDragStage,
    logScaRigDragStage
};
