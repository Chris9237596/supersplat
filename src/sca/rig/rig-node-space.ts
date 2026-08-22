import { Entity, Vec3 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { findSplatByScaSplatId } from '../regions/splat-identity';
import { ScaRig, ScaRigNode, ScaRigVec3 } from '../types/rig';
import { ScaRegion } from '../types/region';

const localPivot = new Vec3();
const worldPivot = new Vec3();

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

const getNodeWorldPivotPosition = (
    node: ScaRigNode,
    splat: Splat,
    out = worldPivot
): Vec3 => {
    getNodeLocalPivotPosition(node, out);
    splat.worldTransform.transformPoint(out, out);
    return out;
};

const syncHelperFromNode = (entity: Entity, node: ScaRigNode): void => {
    entity.setLocalPosition(
        node.pivot[0] + node.position[0],
        node.pivot[1] + node.position[1],
        node.pivot[2] + node.position[2]
    );
    entity.setLocalEulerAngles(node.rotation[0], node.rotation[1], node.rotation[2]);
};

const readNodePatchFromHelper = (entity: Entity, node: ScaRigNode): Partial<ScaRigNode> => {
    const localPos = entity.getLocalPosition();
    const euler = entity.getLocalEulerAngles();

    return {
        position: [
            localPos.x - node.pivot[0],
            localPos.y - node.pivot[1],
            localPos.z - node.pivot[2]
        ] as ScaRigVec3,
        rotation: [euler.x, euler.y, euler.z] as ScaRigVec3
    };
};

export {
    getNodeLocalPivotPosition,
    getNodeWorldPivotPosition,
    readNodePatchFromHelper,
    resolveSplatForNode,
    syncHelperFromNode
};
