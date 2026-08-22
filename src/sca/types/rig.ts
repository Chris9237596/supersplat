type ScaRigVec3 = [number, number, number];

type ScaRigBindingMode = 'rigid';

type ScaRigNode = {
    id: string;
    name: string;
    position: ScaRigVec3;
    /** Euler rotation in degrees (X, Y, Z). */
    rotation: ScaRigVec3;
    pivot: ScaRigVec3;
};

type ScaRigBinding = {
    regionId: string;
    nodeId: string;
    mode: ScaRigBindingMode;
};

type ScaRig = {
    version: 1;
    nodes: ScaRigNode[];
    bindings: ScaRigBinding[];
};

export {
    ScaRig,
    ScaRigBinding,
    ScaRigBindingMode,
    ScaRigNode,
    ScaRigVec3
};
