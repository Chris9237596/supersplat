import { Mat4, Quat, Vec3 } from 'playcanvas';

import { ScaRigBinding, ScaRigNode, ScaRigPose, ScaRigVec3 } from '../types/rig';

const eulerScratch = new Vec3();
const quatScratch = new Quat();
const vecScratch = new Vec3();
const matScratch = new Mat4();
const invScratch = new Mat4();

const cloneVec3 = (value: ScaRigVec3): ScaRigVec3 => ([value[0], value[1], value[2]]);

const identityPose = (): ScaRigPose => ({
    position: [0, 0, 0],
    rotation: [0, 0, 0]
});

const poseFromVec3 = (position: ScaRigVec3, rotation: ScaRigVec3): ScaRigPose => ({
    position: cloneVec3(position),
    rotation: cloneVec3(rotation)
});

const poseToMatrix = (pose: ScaRigPose, target = new Mat4()): Mat4 => {
    quatScratch.setFromEulerAngles(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    vecScratch.set(pose.position[0], pose.position[1], pose.position[2]);
    return target.setTRS(vecScratch, quatScratch, Vec3.ONE);
};

const matrixToPose = (matrix: Mat4): ScaRigPose => {
    const translation = matrix.getTranslation(vecScratch);
    quatScratch.setFromMat4(matrix);
    quatScratch.getEulerAngles(eulerScratch);
    return {
        position: [translation.x, translation.y, translation.z],
        rotation: [eulerScratch.x, eulerScratch.y, eulerScratch.z]
    };
};

const matrixToArray = (matrix: Mat4) => {
    return Array.from(matrix.data) as import('../types/rig').ScaRigMat4;
};

const arrayToMatrix = (values: readonly number[], target = new Mat4()): Mat4 => {
    if (values.length < 16) {
        return target.copy(Mat4.IDENTITY);
    }

    for (let i = 0; i < 16; i++) {
        target.data[i] = values[i];
    }

    return target;
};

const bindOffsetToMatrix = (
    binding: ScaRigBinding | null | undefined,
    target = new Mat4()
): Mat4 => {
    if (binding?.bindOffsetMatrix) {
        return arrayToMatrix(binding.bindOffsetMatrix, target);
    }

    if (binding?.bindOffset) {
        return poseToMatrix(binding.bindOffset, target);
    }

    return target.copy(Mat4.IDENTITY);
};

const matricesNearEqual = (left: Mat4, right: Mat4, epsilon = 1e-4): boolean => {
    for (let i = 0; i < 16; i++) {
        if (Math.abs(left.data[i] - right.data[i]) > epsilon) {
            return false;
        }
    }
    return true;
};

const matrixMaxAbsError = (left: Mat4, right: Mat4): number => {
    let max = 0;
    for (let i = 0; i < 16; i++) {
        max = Math.max(max, Math.abs(left.data[i] - right.data[i]));
    }
    return max;
};

const buildRigidRigMatrixFromPose = (
    node: ScaRigNode,
    pose: Pick<ScaRigNode, 'position' | 'rotation'>,
    target = new Mat4()
): Mat4 => {
    const pivot = new Vec3(node.pivot[0], node.pivot[1], node.pivot[2]);
    const position = new Vec3(pose.position[0], pose.position[1], pose.position[2]);
    const rotation = new Quat().setFromEulerAngles(
        pose.rotation[0],
        pose.rotation[1],
        pose.rotation[2]
    );

    const shiftToOrigin = new Mat4().setTranslate(-pivot.x, -pivot.y, -pivot.z);
    const rotate = new Mat4().setTRS(Vec3.ZERO, rotation, Vec3.ONE);
    const shiftBack = new Mat4().setTranslate(
        pivot.x + position.x,
        pivot.y + position.y,
        pivot.z + position.z
    );

    target.copy(shiftBack);
    target.mul(rotate);
    target.mul(shiftToOrigin);
    return target;
};

const buildRigidRigMatrix = (node: ScaRigNode, target = new Mat4()): Mat4 => {
    return buildRigidRigMatrixFromPose(node, node, target);
};

const buildEffectiveRigMatrix = (
    node: ScaRigNode,
    binding: ScaRigBinding | null | undefined,
    target = new Mat4()
): Mat4 => {
    buildRigidRigMatrix(node, target);

    if (binding?.bindOffset) {
        poseToMatrix(binding.bindOffset, matScratch);
        target.mul(matScratch);
    }

    return target;
};

const computeSnapBindOffset = (): ScaRigPose => identityPose();

const isZeroRigTransform = (node: ScaRigNode): boolean => {
    const posZero = node.position.every((value) => Math.abs(value) < 1e-8);
    const rotZero = node.rotation.every((value) => Math.abs(value) < 1e-8);
    return posZero && rotZero;
};

const isZeroPose = (pose: ScaRigPose): boolean => {
    return pose.position.every((value) => Math.abs(value) < 1e-8) &&
        pose.rotation.every((value) => Math.abs(value) < 1e-8);
};

const bindingUsesKeepWorldOffset = (binding: ScaRigBinding): boolean => {
    if (binding.bindMode === 'keep-world') {
        return true;
    }

    if (binding.bindMode === 'snap') {
        return false;
    }

    // Legacy bindings without bindMode/bindOffset behave like direct node matrix (snap).
    return false;
};

export {
    arrayToMatrix,
    bindOffsetToMatrix,
    buildEffectiveRigMatrix,
    buildRigidRigMatrix,
    buildRigidRigMatrixFromPose,
    bindingUsesKeepWorldOffset,
    cloneVec3,
    computeSnapBindOffset,
    identityPose,
    isZeroPose,
    isZeroRigTransform,
    matricesNearEqual,
    matrixMaxAbsError,
    matrixToArray,
    matrixToPose,
    poseFromVec3,
    poseToMatrix
};
