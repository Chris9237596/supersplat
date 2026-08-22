import { ScaProject } from '../types/project';

const REGION_ID_PREFIX = 'region_';

const generateRegionId = (project: ScaProject): string => {
    const existing = new Set(project.regions.map((region) => region.id));

    const numbers = project.regions
        .map((region) => region.id)
        .map((id) => {
            const match = /^region_(\d+)$/.exec(id);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${REGION_ID_PREFIX}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${REGION_ID_PREFIX}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

export { generateRegionId, REGION_ID_PREFIX };
