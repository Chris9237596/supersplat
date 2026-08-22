import { Vec3 } from 'playcanvas';

import { Splat } from '../../splat';

import { getRigNodeHandleWorldTransform } from './rig-node-space';
import { ScaRig, ScaRigNode } from '../types/rig';

const DEFAULT_PICK_RADIUS_PX = 18;

type RigNodeScreenPickOptions = {
    pickX: number;
    pickY: number;
    viewportWidth: number;
    viewportHeight: number;
    radiusPx?: number;
    isNodeInFront?: (world: Vec3) => boolean;
    projectWorldToScreen: (world: Vec3, out: Vec3) => void;
};

const pickRigNodeIdAtScreen = (
    rig: ScaRig,
    resolveSplat: (node: ScaRigNode) => Splat | null,
    options: RigNodeScreenPickOptions
): string | null => {
    const radiusPx = options.radiusPx ?? DEFAULT_PICK_RADIUS_PX;
    const worldScratch = new Vec3();
    const screenScratch = new Vec3();

    let bestId: string | null = null;
    let bestDistance = radiusPx;

    for (const node of rig.nodes) {
        const splat = resolveSplat(node);
        if (!splat) {
            continue;
        }

        const handle = getRigNodeHandleWorldTransform(rig, node, splat, {
            worldPosition: worldScratch
        }).worldPosition;

        if (options.isNodeInFront && !options.isNodeInFront(handle)) {
            continue;
        }

        options.projectWorldToScreen(handle, screenScratch);
        const screenX = screenScratch.x * options.viewportWidth;
        const screenY = screenScratch.y * options.viewportHeight;
        const distance = Math.hypot(screenX - options.pickX, screenY - options.pickY);

        if (distance <= bestDistance) {
            bestDistance = distance;
            bestId = node.id;
        }
    }

    return bestId;
};

export {
    DEFAULT_PICK_RADIUS_PX,
    RigNodeScreenPickOptions,
    pickRigNodeIdAtScreen
};
