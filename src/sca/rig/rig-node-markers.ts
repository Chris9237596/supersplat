import { Vec3 } from 'playcanvas';

import { Splat } from '../../splat';
import { ScaRig, ScaRigNode } from '../types/rig';

import { getRigNodeHandleWorldTransform } from './rig-node-space';

type RigHierarchyMarkerSegment = {
    childId: string;
    parentId: string;
    from: [number, number, number];
    to: [number, number, number];
};

const vecToTuple = (value: Vec3): [number, number, number] => (
    [value.x, value.y, value.z]
);

const collectRigHierarchyMarkerSegments = (
    rig: ScaRig,
    resolveSplat: (node: ScaRigNode) => Splat | null
): RigHierarchyMarkerSegment[] => {
    const segments: RigHierarchyMarkerSegment[] = [];
    const worldScratch = new Vec3();

    for (const node of rig.nodes) {
        const parentId = node.parentId ?? null;
        if (!parentId) {
            continue;
        }

        const parent = rig.nodes.find((entry) => entry.id === parentId);
        if (!parent) {
            continue;
        }

        const childSplat = resolveSplat(node);
        const parentSplat = resolveSplat(parent);
        if (!childSplat || !parentSplat) {
            continue;
        }

        const childWorld = getRigNodeHandleWorldTransform(rig, node, childSplat, {
            worldPosition: worldScratch
        }).worldPosition;

        const parentWorld = getRigNodeHandleWorldTransform(rig, parent, parentSplat, {
            worldPosition: new Vec3()
        }).worldPosition;

        segments.push({
            childId: node.id,
            parentId: parent.id,
            from: vecToTuple(childWorld),
            to: vecToTuple(parentWorld)
        });
    }

    return segments;
};

export {
    RigHierarchyMarkerSegment,
    collectRigHierarchyMarkerSegments
};
