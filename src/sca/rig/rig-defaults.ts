import {
    ScaRig,
    ScaRigBinding,
    ScaRigBindMode,
    ScaRigMat4,
    ScaRigNode,
    ScaRigPose,
    ScaRigVec3
} from '../types/rig';
import { ScaProject } from '../types/project';

import { identityPose } from './rig-transform';
import { normalizeRigHierarchy } from './rig-hierarchy';

const ZERO_VEC3: ScaRigVec3 = [0, 0, 0];

const DEFAULT_RIG_BIND_MODE: ScaRigBindMode = 'keep-world';

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeVec3 = (raw: unknown, fallback: ScaRigVec3 = ZERO_VEC3): ScaRigVec3 => {
    if (!Array.isArray(raw) || raw.length < 3) {
        return [...fallback] as ScaRigVec3;
    }

    const result: ScaRigVec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        const value = raw[i];
        result[i] = typeof value === 'number' && Number.isFinite(value) ? value : fallback[i];
    }
    return result;
};

const normalizePose = (raw: unknown, fallback: ScaRigPose = identityPose()): ScaRigPose => {
    if (!isRecord(raw)) {
        return {
            position: [...fallback.position] as ScaRigVec3,
            rotation: [...fallback.rotation] as ScaRigVec3
        };
    }

    return {
        position: normalizeVec3(raw.position, fallback.position),
        rotation: normalizeVec3(raw.rotation, fallback.rotation)
    };
};

const normalizeBindMode = (raw: unknown): ScaRigBindMode | undefined => {
    if (raw === 'keep-world' || raw === 'snap') {
        return raw;
    }

    return undefined;
};

const normalizeRigNodeId = (raw: unknown, index: number): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!/^rig_\d+$/.test(trimmed)) {
        console.warn(`[SCA] ignoring invalid rig node id at index ${index}: ${raw}`);
        return null;
    }

    return trimmed;
};

const normalizeRigNode = (raw: unknown, index: number): ScaRigNode | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const id = normalizeRigNodeId(raw.id, index);
    if (!id) {
        return null;
    }

    const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ?
        raw.name.trim() :
        id;

    const position = normalizeVec3(raw.position);
    const rotation = normalizeVec3(raw.rotation);
    const pivot = normalizeVec3(raw.pivot);

    let parentId: string | undefined;
    if (raw.parentId === null || raw.parentId === undefined || raw.parentId === '') {
        parentId = undefined;
    } else if (typeof raw.parentId === 'string') {
        const trimmedParent = raw.parentId.trim();
        parentId = trimmedParent.length > 0 ? trimmedParent : undefined;
    }

    const node: ScaRigNode = {
        id,
        name,
        position,
        rotation,
        pivot,
        rest: normalizePose(raw.rest, identityPose())
    };

    if (parentId && parentId !== id) {
        node.parentId = parentId;
    }

    return node;
};

const normalizeBindOffsetMatrix = (raw: unknown): ScaRigMat4 | undefined => {
    if (!Array.isArray(raw) || raw.length < 16) {
        return undefined;
    }

    const result: number[] = [];
    for (let i = 0; i < 16; i++) {
        const value = raw[i];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return undefined;
        }
        result.push(value);
    }

    return result as ScaRigMat4;
};

const normalizeRigBinding = (
    raw: unknown,
    index: number,
    nodeIds: Set<string>
): ScaRigBinding | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const regionId = typeof raw.regionId === 'string' ? raw.regionId.trim() : '';
    const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId.trim() : '';
    if (!regionId || !nodeId || !nodeIds.has(nodeId)) {
        console.warn(`[SCA] ignoring invalid rig binding at index ${index}`);
        return null;
    }

    const mode = raw.mode === 'rigid' ? 'rigid' : 'rigid';
    const bindMode = normalizeBindMode(raw.bindMode);
    const bindOffset = isRecord(raw.bindOffset) || Array.isArray(raw.bindOffset) ?
        normalizePose(raw.bindOffset) :
        undefined;
    const bindOffsetMatrix = normalizeBindOffsetMatrix(raw.bindOffsetMatrix);

    const binding: ScaRigBinding = { regionId, nodeId, mode };
    if (bindMode) {
        binding.bindMode = bindMode;
    }
    if (bindOffsetMatrix) {
        binding.bindOffsetMatrix = bindOffsetMatrix;
    }
    if (bindOffset && (bindMode || !isZeroPose(bindOffset))) {
        binding.bindOffset = bindOffset;
    }

    return binding;
};

const isZeroPose = (pose: ScaRigPose): boolean => {
    return pose.position.every((value) => Math.abs(value) < 1e-8) &&
        pose.rotation.every((value) => Math.abs(value) < 1e-8);
};

const finalizeRig = (rig: ScaRig): ScaRig => {
    normalizeRigHierarchy(rig);
    return rig;
};

const normalizeRig = (raw: unknown): ScaRig | undefined => {
    if (!isRecord(raw)) {
        return undefined;
    }

    const nodesRaw = raw.nodes;
    if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) {
        return undefined;
    }

    const nodes: ScaRigNode[] = [];
    const nodeIds = new Set<string>();

    for (let index = 0; index < nodesRaw.length; index++) {
        const node = normalizeRigNode(nodesRaw[index], index);
        if (!node || nodeIds.has(node.id)) {
            continue;
        }
        nodeIds.add(node.id);
        nodes.push(node);
    }

    if (nodes.length === 0) {
        return undefined;
    }

    const bindings: ScaRigBinding[] = [];
    const boundRegions = new Set<string>();
    const bindingsRaw = raw.bindings;
    if (Array.isArray(bindingsRaw)) {
        for (let index = 0; index < bindingsRaw.length; index++) {
            const binding = normalizeRigBinding(bindingsRaw[index], index, nodeIds);
            if (!binding || boundRegions.has(binding.regionId)) {
                continue;
            }
            boundRegions.add(binding.regionId);
            bindings.push(binding);
        }
    }

    return finalizeRig({
        version: 1,
        nodes,
        bindings
    });
};

const createDefaultRigNode = (id: string, name?: string): ScaRigNode => ({
    id,
    name: name ?? `Rig Node ${id.replace(/^rig_/, '')}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    pivot: [0, 0, 0],
    rest: identityPose()
});

const ensureProjectRig = (project: ScaProject): ScaRig => {
    return project.rig ?? { version: 1, nodes: [], bindings: [] };
};

export {
    DEFAULT_RIG_BIND_MODE,
    ZERO_VEC3,
    createDefaultRigNode,
    ensureProjectRig,
    normalizePose,
    normalizeRig,
    normalizeVec3
};
