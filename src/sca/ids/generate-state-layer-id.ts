import { ScaProject } from '../types/project';

const STATE_LAYER_ID_PREFIX = 'state_layer_';

const collectExistingStateLayerIds = (project: ScaProject): Set<string> => {
    const ids = new Set<string>();

    for (const region of project.regions) {
        const layers = region.visual.stateContent?.visited?.layers ?? [];
        for (const layer of layers) {
            if (layer?.id) {
                ids.add(layer.id);
            }
        }
    }

    return ids;
};

const generateStateLayerId = (project: ScaProject): string => {
    const existing = collectExistingStateLayerIds(project);

    const numbers = [...existing]
        .map((id) => {
            const match = /^state_layer_(\d+)$/.exec(id);
            return match ? parseInt(match[1], 10) : null;
        })
        .filter((value): value is number => value !== null);

    let next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    let candidate = `${STATE_LAYER_ID_PREFIX}${String(next).padStart(2, '0')}`;

    while (existing.has(candidate)) {
        next += 1;
        candidate = `${STATE_LAYER_ID_PREFIX}${String(next).padStart(2, '0')}`;
    }

    return candidate;
};

export { generateStateLayerId, STATE_LAYER_ID_PREFIX };
