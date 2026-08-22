/**
 * SPIKE ONLY — Option B: static survey of PlayCanvas engine picking APIs.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

type EnginePickSurvey = {
    engineVersion: string;
    bundledViewerEngineVersion: string | null;
    bundledViewerVersion: string | null;
    hasPrepareForPicking: boolean;
    hasGsplatLocalDispatch: boolean;
    hasComputeLocalRenderer: boolean;
    hasGetSelectionAsync: boolean;
    hasGetWorldPointAsync: boolean;
    hasEnableIds: boolean;
    hasEncodePickOutputVPickId: boolean;
    hasSplatIndexInShader: boolean;
    pickerReturnsNote: string;
    pr8556Present: boolean;
    newerThanBundledExport: boolean;
};

const readText = (filePath: string): string | null => {
    if (!existsSync(filePath)) {
        return null;
    }
    return readFileSync(filePath, 'utf8');
};

const matchVersion = (source: string, pattern: RegExp): string | null => {
    const m = source.match(pattern);
    return m?.[1] ?? null;
};

const surveyEngineBundle = (engineRoot: string, version: string): EnginePickSurvey => {
    const dbgPath = path.join(engineRoot, 'build', 'playcanvas.dbg.mjs');
    const dtsPath = path.join(engineRoot, 'build', 'playcanvas.d.ts');
    const dbg = readText(dbgPath) ?? '';
    const dts = readText(dtsPath) ?? '';

    const hasGsplatLocalDispatch = dbg.includes('GSplatLocalDispatchSet') ||
        dbg.includes('gsplat-local-dispatch-set');
    const hasComputeLocalRenderer = dbg.includes('GSplatComputeLocalRenderer') ||
        dbg.includes('gsplat-compute-local-renderer') ||
        dbg.includes('compute-gsplat-local-rasterize');

    return {
        engineVersion: version,
        bundledViewerEngineVersion: null,
        bundledViewerVersion: null,
        hasPrepareForPicking: dbg.includes('prepareForPicking'),
        hasGsplatLocalDispatch,
        hasComputeLocalRenderer,
        hasGetSelectionAsync: dts.includes('getSelectionAsync'),
        hasGetWorldPointAsync: dts.includes('getWorldPointAsync'),
        hasEnableIds: dts.includes('enableIds'),
        hasEncodePickOutputVPickId: dbg.includes('encodePickOutput(vPickId)'),
        hasSplatIndexInShader: dbg.includes('splat.index = idx') || dbg.includes('vGaussianIndex = splat.index'),
        pr8556Present: hasGsplatLocalDispatch || hasComputeLocalRenderer,
        newerThanBundledExport: false,
        pickerReturnsNote: dts.includes('MeshInstance | GSplatComponent') ?
            'Picker.getSelectionAsync returns MeshInstance | GSplatComponent (component-level, not gaussian index)' :
            'Picker.getSelectionAsync returns MeshInstance[]'
    };
};

const surveyBundledViewer = (viewerIndexJs: string): Pick<EnginePickSurvey, 'bundledViewerEngineVersion' | 'bundledViewerVersion'> => {
    const source = readText(viewerIndexJs) ?? '';
    return {
        bundledViewerEngineVersion: matchVersion(source, /Engine v(\d+\.\d+\.\d+)/),
        bundledViewerVersion: matchVersion(source, /SuperSplat Viewer v(\d+\.\d+\.\d+)/)
    };
};

const compareEngineVersions = (a: string, b: string): number => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) {
            return d;
        }
    }
    return 0;
};

const runEnginePickSurvey = (repoRoot: string): {
    projectEngine: EnginePickSurvey;
    bundledViewer: ReturnType<typeof surveyBundledViewer>;
    notes: string[];
} => {
    const projectEnginePath = path.join(repoRoot, 'node_modules', 'playcanvas');
    const pkg = JSON.parse(readText(path.join(projectEnginePath, 'package.json')) ?? '{}');
    const projectEngine = surveyEngineBundle(projectEnginePath, pkg.version ?? 'unknown');

    const viewerIndex = path.join(repoRoot, 'tools', 'smoke-out', 'package', 'index.js');
    const bundledViewer = surveyBundledViewer(viewerIndex);
    projectEngine.bundledViewerEngineVersion = bundledViewer.bundledViewerEngineVersion;
    projectEngine.bundledViewerVersion = bundledViewer.bundledViewerVersion;

    if (projectEngine.bundledViewerEngineVersion) {
        projectEngine.newerThanBundledExport =
            compareEngineVersions(projectEngine.engineVersion, projectEngine.bundledViewerEngineVersion) > 0;
    }

    const notes: string[] = [];
    notes.push('Engine pc.Picker.getSelectionAsync identifies GSplatComponent (entity/placement), not splat.index.');
    notes.push('SuperSplat Viewer ships a separate depth Picker (pick/pickSurface) for world position — not engine pc.Picker.');
    if (!projectEngine.pr8556Present) {
        notes.push(`Engine ${projectEngine.engineVersion} does NOT contain PR #8556 compute local GSplat pick (GSplatLocalDispatchSet).`);
        notes.push('PR #8556 merged after 2.21.1; requires newer engine than project devDependency for compute splat-ID pick.');
    } else {
        notes.push(`Engine ${projectEngine.engineVersion} appears to include PR #8556 compute pick infrastructure.`);
    }
    if (projectEngine.newerThanBundledExport) {
        notes.push(`Project engine ${projectEngine.engineVersion} is newer than exported viewer engine ${projectEngine.bundledViewerEngineVersion}.`);
    }

    return { projectEngine, bundledViewer, notes };
};

export {
    runEnginePickSurvey,
    type EnginePickSurvey
};
