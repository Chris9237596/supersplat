import { Mat4, Quat, Vec3 } from 'playcanvas';

import { ScaRigNode } from '../types/rig';

const buildRigidRigMatrix = (node: ScaRigNode, target = new Mat4()): Mat4 => {
    const pivot = new Vec3(node.pivot[0], node.pivot[1], node.pivot[2]);
    const position = new Vec3(node.position[0], node.position[1], node.position[2]);
    const rotation = new Quat().setFromEulerAngles(node.rotation[0], node.rotation[1], node.rotation[2]);

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

const isZeroRigTransform = (node: ScaRigNode): boolean => {
    const posZero = node.position.every((value) => Math.abs(value) < 1e-8);
    const rotZero = node.rotation.every((value) => Math.abs(value) < 1e-8);
    return posZero && rotZero;
};

export {
    buildRigidRigMatrix,
    isZeroRigTransform
};
