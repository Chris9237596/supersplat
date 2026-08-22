import { Mat4 } from 'playcanvas';

import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';

import { buildEffectiveRigWorldMatrixFromPose } from '../rig/rig-hierarchy';
import { ScaRigEvaluatedPose } from '../rig/rig-pose';

type RuntimeRigPaletteBinding = {
    regionId: string;
    nodeId: string;
    paletteIndex: number;
    setPaletteMatrix: (paletteIndex: number, matrix: Mat4) => void;
};

type RuntimeRigHost = {
    bindings: RuntimeRigPaletteBinding[];
    requestRender: () => void;
};

const rigMat = new Mat4();

class RuntimeRigApplier {
    private host: RuntimeRigHost | null = null;

    setHost(host: RuntimeRigHost | null): void {
        this.host = host;
    }

    hasHost(): boolean {
        return !!this.host && this.host.bindings.length > 0;
    }

    getBindingCount(): number {
        return this.host?.bindings.length ?? 0;
    }

    applyPose(rig: ScaRig, pose: ScaRigEvaluatedPose): void {
        const host = this.host;
        if (!host || host.bindings.length === 0) {
            return;
        }

        const nodeById = new Map<string, ScaRigNode>(rig.nodes.map((node) => [node.id, node]));
        const bindingByRegion = new Map<string, ScaRigBinding>(
            rig.bindings.map((binding) => [binding.regionId, binding])
        );

        for (const entry of host.bindings) {
            const node = nodeById.get(entry.nodeId);
            const binding = bindingByRegion.get(entry.regionId);
            if (!node || !binding) {
                continue;
            }

            buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, rigMat);
            entry.setPaletteMatrix(entry.paletteIndex, rigMat);
        }

        host.requestRender();
    }

    resetPose(rig: ScaRig): void {
        this.applyPose(rig, {
            nodes: new Map(
                rig.nodes.map((node) => [node.id, {
                    position: [...node.position] as typeof node.position,
                    rotation: [...node.rotation] as typeof node.rotation
                }])
            )
        });
    }
}

export {
    RuntimeRigApplier,
    RuntimeRigHost,
    RuntimeRigPaletteBinding
};
