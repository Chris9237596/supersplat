import { ScaRig, ScaRigBinding, ScaRigNode, ScaRigVec3 } from '../types/rig';

const TARGET_NODE_ID = 'rig_01';
const TARGET_REGION_ID = 'region_06';

let editorLogged = false;
let runtimeLogged = false;

const cloneVec3 = (value: ScaRigVec3): [number, number, number] => ([value[0], value[1], value[2]]);

const findTargetNode = (rig: ScaRig): ScaRigNode | null => {
    return rig.nodes.find((node) => node.id === TARGET_NODE_ID) ?? null;
};

const findTargetBinding = (rig: ScaRig): ScaRigBinding | null => {
    return rig.bindings.find((binding) =>
        binding.regionId === TARGET_REGION_ID && binding.nodeId === TARGET_NODE_ID
    ) ??
        rig.bindings.find((binding) => binding.regionId === TARGET_REGION_ID) ??
        null;
};

const buildRigDataParityPayload = (side: 'editor' | 'runtime', rig: ScaRig): Record<string, unknown> => {
    const node = findTargetNode(rig);
    const binding = findTargetBinding(rig);

    return {
        side,
        target: {
            nodeId: TARGET_NODE_ID,
            regionId: TARGET_REGION_ID
        },
        found: {
            node: !!node,
            binding: !!binding,
            exactPair: binding?.regionId === TARGET_REGION_ID && binding?.nodeId === TARGET_NODE_ID
        },
        node: node ? {
            id: node.id,
            parentId: node.parentId ?? null,
            pivot: cloneVec3(node.pivot),
            position: cloneVec3(node.position),
            rotation: cloneVec3(node.rotation),
            restPosition: cloneVec3(node.rest.position),
            restRotation: cloneVec3(node.rest.rotation)
        } : null,
        binding: binding ? {
            regionId: binding.regionId,
            nodeId: binding.nodeId,
            mode: binding.mode,
            bindMode: binding.bindMode ?? null,
            bindOffsetMatrix: binding.bindOffsetMatrix ? [...binding.bindOffsetMatrix] : null
        } : null
    };
};

const maybeLogEditorRigDataParity = (rig: ScaRig | null | undefined): void => {
    if (editorLogged || !rig) {
        return;
    }

    editorLogged = true;
    console.log('[SCA RIG DATA PARITY]', buildRigDataParityPayload('editor', rig));
};

const maybeLogRuntimeRigDataParity = (rig: ScaRig | null | undefined): void => {
    if (runtimeLogged || !rig) {
        return;
    }

    runtimeLogged = true;
    console.log('[SCA RIG DATA PARITY]', buildRigDataParityPayload('runtime', rig));
};

const resetEditorRigDataParityCheck = (): void => {
    editorLogged = false;
};

const resetRuntimeRigDataParityCheck = (): void => {
    runtimeLogged = false;
};

export {
    maybeLogEditorRigDataParity,
    maybeLogRuntimeRigDataParity,
    resetEditorRigDataParityCheck,
    resetRuntimeRigDataParityCheck,
    TARGET_NODE_ID,
    TARGET_REGION_ID
};
