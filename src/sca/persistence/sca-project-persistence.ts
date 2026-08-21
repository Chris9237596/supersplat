import { ScaProject } from '../types/project';

import {
    migrateSsprojScaBlock,
    SCA_SSPROJ_VERSION,
    ScaSsprojBlock
} from './sca-project-migration';

const serializeSsprojScaBlock = (project: ScaProject): ScaSsprojBlock => {
    return {
        version: SCA_SSPROJ_VERSION,
        project: structuredClone(project)
    };
};

const deserializeSsprojScaBlock = (raw: unknown): ScaProject => {
    return migrateSsprojScaBlock(raw);
};

export {
    deserializeSsprojScaBlock,
    serializeSsprojScaBlock
};
