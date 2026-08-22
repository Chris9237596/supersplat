import {
    createEmptyProject,
    ScaProject,
    SCA_PROJECT_VERSION
} from '../types/project';
import { normalizeProject } from '../viewer/viewer-config';

/** Persistence schema version stored in `.ssproj` under `document.sca.version`. */
const SCA_SSPROJ_VERSION = 1 as const;

type ScaSsprojBlock = {
    version: number;
    project?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object';
};

const migrateSsprojScaBlock = (raw: unknown): ScaProject => {
    if (raw === undefined || raw === null) {
        return createEmptyProject();
    }

    if (!isRecord(raw)) {
        console.warn('[SCA] ignoring invalid ssproj sca block: expected object');
        return createEmptyProject();
    }

    const version = raw.version;
    if (version !== SCA_SSPROJ_VERSION) {
        console.warn(`[SCA] unsupported ssproj sca version: ${String(version)}; using empty project`);
        return createEmptyProject();
    }

    const projectRaw = raw.project;
    if (projectRaw === undefined || projectRaw === null) {
        return createEmptyProject();
    }

    if (!isRecord(projectRaw)) {
        console.warn('[SCA] ignoring invalid ssproj sca.project: expected object');
        return createEmptyProject();
    }

    if (projectRaw.version !== SCA_PROJECT_VERSION) {
        console.warn(`[SCA] unsupported sca project version: ${String(projectRaw.version)}; using empty project`);
        return createEmptyProject();
    }

    if (!Array.isArray(projectRaw.hotspots)) {
        console.warn('[SCA] ignoring invalid ssproj sca.project: hotspots must be an array');
        return createEmptyProject();
    }

    return normalizeProject({
        version: SCA_PROJECT_VERSION,
        hotspots: projectRaw.hotspots as ScaProject['hotspots'],
        regions: Array.isArray(projectRaw.regions) ? projectRaw.regions : [],
        viewer: projectRaw.viewer as ScaProject['viewer']
    });
};

export {
    migrateSsprojScaBlock,
    SCA_SSPROJ_VERSION,
    ScaSsprojBlock
};
