import { ScaProject } from '../types/project';

const RIG_ID_PREFIX = 'rig_';

const collectExistingRigIds = (project: ScaProject): Set<string> => {
    const ids = new Set<string>();
    for (const node of project.rig?.nodes ?? []) {
        if (node?.id) {
            ids.add(node.id);
        }
    }
    return ids;
};

const generateRigId = (project: ScaProject): string => {
    const existing = collectExistingRigIds(project);

    const numbers = [...existing]
        .map((id) => {
            const match = /^rig_(\d+)$/.exec(id);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${RIG_ID_PREFIX}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${RIG_ID_PREFIX}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

export { generateRigId, RIG_ID_PREFIX };
