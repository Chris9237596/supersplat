import {
    SCA_PROJECT_VERSION,
    ScaProject,
    ScaViewerConfig
} from '../types/project';
import { normalizeProject } from '../viewer/viewer-config';

const parseProjectJson = (json: string): ScaProject => {
    const data = JSON.parse(json) as unknown;

    if (!data || typeof data !== 'object') {
        throw new Error('[SCA] invalid project.json: root must be an object');
    }

    const record = data as Record<string, unknown>;

    if (record.version !== SCA_PROJECT_VERSION) {
        throw new Error(`[SCA] unsupported project version: ${String(record.version)}`);
    }

    if (!Array.isArray(record.hotspots)) {
        throw new Error('[SCA] invalid project.json: hotspots must be an array');
    }

    return normalizeProject({
        version: SCA_PROJECT_VERSION,
        hotspots: record.hotspots as ScaProject['hotspots'],
        regions: Array.isArray(record.regions) ? record.regions : [],
        viewer: record.viewer as ScaViewerConfig | undefined
    });
};

const stringifyProjectJson = (project: ScaProject, pretty = true): string => {
    return JSON.stringify(project, null, pretty ? 2 : undefined);
};

export { parseProjectJson, stringifyProjectJson };
