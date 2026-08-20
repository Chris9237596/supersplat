import { ScaProject } from '../types/project';

const HOTSPOT_ID_PREFIX = 'hotspot_';

const generateHotspotId = (project: ScaProject): string => {
    const existing = new Set(project.hotspots.map((hotspot) => hotspot.id));

    const numbers = project.hotspots
    .map((hotspot) => hotspot.id)
    .map((id) => {
        const match = /^hotspot_(\d+)$/.exec(id);
        return match ? parseInt(match[1], 10) : null;
    })
    .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${HOTSPOT_ID_PREFIX}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${HOTSPOT_ID_PREFIX}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

export { generateHotspotId, HOTSPOT_ID_PREFIX };
