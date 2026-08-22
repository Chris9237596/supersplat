import { ScaRig, ScaRigBinding, ScaRigNode, ScaRigVec3 } from '../types/rig';
import { ScaProject } from '../types/project';

const ZERO_VEC3: ScaRigVec3 = [0, 0, 0];

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

    return {
        id,
        name,
        position: normalizeVec3(raw.position),
        rotation: normalizeVec3(raw.rotation),
        pivot: normalizeVec3(raw.pivot)
    };
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

    return { regionId, nodeId, mode };
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

    return {
        version: 1,
        nodes,
        bindings
    };
};

const createDefaultRigNode = (id: string, name?: string): ScaRigNode => ({
    id,
    name: name ?? `Rig Node ${id.replace(/^rig_/, '')}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    pivot: [0, 0, 0]
});

const ensureProjectRig = (project: ScaProject): ScaRig => {
    return project.rig ?? { version: 1, nodes: [], bindings: [] };
};

export {
    ZERO_VEC3,
    createDefaultRigNode,
    ensureProjectRig,
    normalizeRig,
    normalizeVec3
};
