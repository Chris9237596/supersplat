import { stringifyProjectJson } from '../serialize/project-json';
import { ScaProject } from '../types/project';

import { hotspotsToAnnotations, ScaViewerAnnotation } from './hotspot-to-annotation';

type ScaRuntimeExport = {
    project: ScaProject;
    annotations: ScaViewerAnnotation[];
};

const buildScaRuntimeExport = (project: ScaProject): ScaRuntimeExport => {
    return {
        project,
        annotations: hotspotsToAnnotations(project.hotspots)
    };
};

const downloadTextFile = (filename: string, text: string): void => {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();

    window.URL.revokeObjectURL(url);
};

const exportScaRuntime = (project: ScaProject): ScaRuntimeExport => {
    const exported = buildScaRuntimeExport(project);

    console.log('[SCA] runtime export preview:', exported);

    downloadTextFile('project.json', stringifyProjectJson(exported.project));
    downloadTextFile(
        'viewer-annotations.json',
        JSON.stringify({ annotations: exported.annotations }, null, 2)
    );

    return exported;
};

export {
    buildScaRuntimeExport,
    exportScaRuntime,
    ScaRuntimeExport
};
