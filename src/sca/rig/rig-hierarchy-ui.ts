import { ScaRig, ScaRigNode } from '../types/rig';

import { getValidParentOptions } from './rig-hierarchy';

const RIG_PARENT_NONE_VALUE = '__sca_rig_parent_none__';

type RigParentSelectOption = {
    v: string;
    t: string;
};

const buildRigParentSelectOptions = (rig: ScaRig, nodeId: string): RigParentSelectOption[] => {
    const options: RigParentSelectOption[] = [
        { v: RIG_PARENT_NONE_VALUE, t: 'None' }
    ];

    for (const node of getValidParentOptions(rig, nodeId)) {
        options.push({ v: node.id, t: node.name });
    }

    return options;
};

const resolveRigParentSelectValue = (
    parentId: string | null | undefined
): string => {
    if (!parentId) {
        return RIG_PARENT_NONE_VALUE;
    }

    return parentId;
};

const rigParentIdFromSelectValue = (value: string | null | undefined): string | null => {
    if (!value || value === RIG_PARENT_NONE_VALUE) {
        return null;
    }

    return value;
};

type RigTreeEntry = {
    node: ScaRigNode;
    depth: number;
};

const buildRigTreeOrder = (nodes: ScaRigNode[]): RigTreeEntry[] => {
    const byParent = new Map<string | null, ScaRigNode[]>();

    for (const node of nodes) {
        const parentId = node.parentId ?? null;
        const siblings = byParent.get(parentId) ?? [];
        siblings.push(node);
        byParent.set(parentId, siblings);
    }

    for (const siblings of byParent.values()) {
        siblings.sort((left, right) => left.name.localeCompare(right.name));
    }

    const result: RigTreeEntry[] = [];
    const walk = (parentId: string | null, depth: number) => {
        for (const node of byParent.get(parentId) ?? []) {
            result.push({ node, depth });
            walk(node.id, depth + 1);
        }
    };

    walk(null, 0);
    return result;
};

export {
    RIG_PARENT_NONE_VALUE,
    RigParentSelectOption,
    RigTreeEntry,
    buildRigParentSelectOptions,
    buildRigTreeOrder,
    resolveRigParentSelectValue,
    rigParentIdFromSelectValue
};
