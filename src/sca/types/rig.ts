type ScaRigVec3 = [number, number, number];

/** Row-major 4x4 rigid transform matrix. */
type ScaRigMat4 = [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
];

type ScaRigPose = {
    position: ScaRigVec3;
    /** Euler rotation in degrees (X, Y, Z). */
    rotation: ScaRigVec3;
};

type ScaRigBindingMode = 'rigid';

type ScaRigBindMode = 'keep-world' | 'snap';

type ScaRigNode = {
    id: string;
    name: string;
    /** Parent rig node id. Root nodes omit this field. */
    parentId?: string | null;
    /** Current pose offset from pivot in parent-local space. */
    position: ScaRigVec3;
    /** Current Euler rotation in degrees (X, Y, Z). */
    rotation: ScaRigVec3;
    /**
     * Non-uniform scale is not supported yet. The hierarchy, gizmo readback, bind-offset
     * pose fallback, and rest pose paths are rigid-only (rotation + translation).
     * GPU transformPalette can apply scaled matrices once TRS authoring is added.
     */
    pivot: ScaRigVec3;
    /** Authored rest/reference pose. Reset moves current pose here. */
    rest: ScaRigPose;
};

type ScaRigBinding = {
    regionId: string;
    nodeId: string;
    mode: ScaRigBindingMode;
    bindMode?: ScaRigBindMode;
    /** Legacy pose encoding of bind offset. Prefer bindOffsetMatrix when present. */
    bindOffset?: ScaRigPose;
    /** Exact plain rigid bind-offset matrix (row-major). Not pivot-relative. */
    bindOffsetMatrix?: ScaRigMat4;
};

type ScaRig = {
    version: 1;
    nodes: ScaRigNode[];
    bindings: ScaRigBinding[];
};

export {
    ScaRig,
    ScaRigBindMode,
    ScaRigBinding,
    ScaRigBindingMode,
    ScaRigMat4,
    ScaRigNode,
    ScaRigPose,
    ScaRigVec3
};
