import {
    logger as splatTransformLogger,
    MemoryFileSystem,
    ZipFileSystem,
    type LogEvent
} from '@playcanvas/splat-transform';

import { Events } from '../../events';
import { BrowserFileSystem } from '../../io';
import { Splat } from '../../splat';
import {
    defaultPostEffectSettings,
    ExperienceSettings,
    ExportGaussianMap,
    SerializeSettings,
    SogCompressionMode,
    DEFAULT_SOG_COMPRESSION_MODE,
    WebGPUUnavailableError,
    resolveSogCompressionBackendLabel
} from '../../splat-serialize';
import { stringifyProjectJson } from '../serialize/project-json';
import { ScaProject } from '../types/project';
import { resolveViewerConfig } from '../viewer/viewer-config';
import { backgroundAssetPath, parseHexColor } from '../viewer/viewer-background';
import { ScaAssetStore } from '../store/sca-asset-store';

import { hotspotsToAnnotations } from './hotspot-to-annotation';
import { patchViewerBundle } from './patch-viewer-bundle';
import { applySpikeSplatIndexPickPatch } from './spike-splat-index-pick-patch';
import { ExportPerfTracker, isExportPerfEnabled } from './export-perf';
import { getSogGeometryFingerprintInputs, writeViewerExportWithCachedSog } from './sog-export-cache';
import { ensureScaSplatId } from '../regions/splat-identity';
import { regionMaskStorePath } from '../regions/region-mask-paths';
import { remapRegionMasksForRuntimeExport } from '../regions/region-mask-runtime-export';
import { ScaRegion } from '../types/region';

const PACKAGE_FILENAME = 'sca-runtime-package.zip';
const PREVIEW_FILENAME = 'preview.html';

const createScaRuntimeSerializeSettings = (events: Events): SerializeSettings => ({
    maxSHBands: events.invoke('view.bands') as number,
    keepWorldTransform: true,
    skipTransformPalette: true
});

const SCA_RUNTIME_ASSET_FILENAMES = [
    'sca-runtime-capabilities.js',
    'sca-debug.js',
    'camera-animation.js',
    'hotspot-bridge.js',
    'region-bridge.js',
    'region-mask-runtime.js',
    'sca-picker.js',
    'sca-region-core.js',
    'sca-annotation-projector.js',
    'sca-hotspot-overlay.js',
    'sca-region-overlay.js',
    'sca-region-runtime.js',
    'sca-animation-runtime.js',
    'sca-hotspot-markers.css',
    'sca-runtime.js',
    'sca-host-bridge.js'
] as const;

type ScaRuntimeAssetFilename = typeof SCA_RUNTIME_ASSET_FILENAMES[number];

class ScaRuntimeAssetLoadError extends Error {
    readonly assetPath: string;

    readonly cause: unknown;

    constructor(message: string, assetPath: string, cause: unknown) {
        super(message);
        this.name = 'ScaRuntimeAssetLoadError';
        this.assetPath = assetPath;
        this.cause = cause;
    }
}

type ScaRuntimeAssets = {
    scaCapabilitiesJs: string;
    scaDebugJs: string;
    cameraAnimationJs: string;
    bridgeJs: string;
    regionBridgeJs: string;
    regionMaskJs: string;
    pickerJs: string;
    regionCoreJs: string;
    annotationProjectorJs: string;
    overlayJs: string;
    regionOverlayJs: string;
    regionRuntimeJs: string;
    animationRuntimeJs: string;
    hotspotCss: string;
    runtimeJs: string;
    hostBridgeJs: string;
};

let runtimeAssetFetchCache: Promise<ScaRuntimeAssets> | null = null;

type ScaRuntimePackageOptions = {
    includePreview?: boolean;
    /** @deprecated Debug only — Gaussian Pick Spike. Production uses RuntimeWebGpuPickerAdapter / RuntimeCentersPickerAdapter. */
    useGaussianPickSpike?: boolean;
    sogCompressionMode?: SogCompressionMode;
};

type ScaRuntimeExportSharedContext = {
    runtimeAssets: ScaRuntimeAssets;
    embeddedAssets: Record<string, string>;
    exportProject: ScaProject;
};

type ScaExportPackageStatus = {
    inProgress: boolean;
    message?: string;
    cpuFallback?: boolean;
};

const fireExportStatus = (events: Events | undefined, status: ScaExportPackageStatus): void => {
    events?.fire('sca.export.packageStatus', status);
};

const patchViewerBundleForExport = (source: string, useGaussianPickSpike: boolean): string => {
    const patched = patchViewerBundle(source);
    /** @deprecated Spike path — use production RuntimeWebGpuPickerAdapter / RuntimeCentersPickerAdapter. */
    return useGaussianPickSpike ? applySpikeSplatIndexPickPatch(patched) : patched;
};

const createProgressRenderer = (header: string, events?: Events) => ({
    handle: (event: LogEvent) => {
        switch (event.kind) {
            case 'scopeStart':
                if (event.depth === 0) {
                    events?.fire('progressStart', header);
                } else {
                    events?.fire('progressUpdate', {
                        text: event.index !== undefined && event.total !== undefined ?
                            `Step ${event.index} of ${event.total}: ${event.name}` :
                            event.name,
                        progress: 0
                    });
                }
                break;
            case 'scopeEnd':
                if (event.depth === 0) {
                    events?.fire('progressEnd');
                }
                break;
            case 'barStart':
                events?.fire('progressUpdate', { text: event.name, progress: 0 });
                break;
            case 'barTick':
                events?.fire('progressUpdate', {
                    progress: event.total > 0 ? 100 * event.current / event.total : 0
                });
                break;
            case 'barEnd':
                events?.fire('progressUpdate', { progress: 100 });
                break;
            case 'message':
                if (event.level === 'error') console.error(event.text);
                else if (event.level === 'warn') console.warn(event.text);
                else if (event.level === 'info') console.info(event.text);
                else if (event.level === 'debug') console.debug(event.text);
                break;
            case 'output':
                console.log(event.text);
                break;
        }
    }
});

const buildViewerExperienceSettings = (events: Events, project: ScaProject): ExperienceSettings => {
    const editorPose = events.invoke('camera.getPose') as {
        position?: { x: number; y: number; z: number };
        target?: { x: number; y: number; z: number };
    } | null;
    const editorFov = events.invoke('camera.fov') as number;

    const fallbackInitial = (editorPose?.position && editorPose?.target) ? {
        position: [editorPose.position.x, editorPose.position.y, editorPose.position.z] as [number, number, number],
        target: [editorPose.target.x, editorPose.target.y, editorPose.target.z] as [number, number, number],
        fov: editorFov
    } : undefined;

    const viewerConfig = resolveViewerConfig(project, fallbackInitial);
    const background = viewerConfig.background ?? { type: 'color' as const, color: '#000000' };
    const initial = viewerConfig.camera.initial;

    let backgroundColor: [number, number, number] = [0, 0, 0];
    if (background.type === 'color' && background.color) {
        const { r, g, b } = parseHexColor(background.color);
        backgroundColor = [r, g, b];
    }

    const backgroundSettings: ExperienceSettings['background'] = {
        color: backgroundColor
    };
    if (background.type === 'panorama' && background.image?.filename) {
        backgroundSettings.skyboxUrl = `./assets/${background.image.filename}`;
    }

    const cameras = [{
        initial: {
            position: [...initial.position] as [number, number, number],
            target: [...initial.target] as [number, number, number],
            fov: initial.fov
        }
    }];

    const navTargets = viewerConfig.navigationTargets ?? { enabled: true, hotspots: true, regions: true };

    return {
        version: 2,
        tonemapping: 'none',
        highPrecisionRendering: false,
        background: backgroundSettings,
        postEffectSettings: defaultPostEffectSettings,
        animTracks: [],
        cameras,
        annotations: hotspotsToAnnotations(project.hotspots),
        startMode: 'default',
        navigation: {
            disableAnnotationCameraNavigation: true,
            navigationTargetsEnabled: navTargets.enabled !== false
        }
    };
};

const patchViewerBootstrap = (html: string): string => {
    let patched = html.replace(
        "const renderer = url.searchParams.has('webgl') ? 'webgl' : 'webgpu';",
        "const renderer = url.searchParams.has('webgpu') ? 'webgpu' : 'webgl';"
    );

    patched = patched.replace(
        'const viewer = await main(canvas, settingsJson, config);',
        'const viewer = await SCA3D.bootstrapViewer({ canvas, settingsJson, config, main });'
    );

    patched = patched.replace(
        `document.addEventListener('DOMContentLoaded', async () => {
                const canvas = document.getElementById('application-canvas');
                const settingsJson = await settings;
                const viewer = await SCA3D.bootstrapViewer({ canvas, settingsJson, config, main });
            });`,
        `document.addEventListener('DOMContentLoaded', async () => {
                try {
                    if (window.SCA3D?.capabilities?.webgl2 === false) {
                        window.SCA3D.showRuntimeError?.('This browser does not support the required WebGL2 rendering features.');
                        return;
                    }
                    const canvas = document.getElementById('application-canvas');
                    const settingsJson = await settings;
                    const viewer = await SCA3D.bootstrapViewer({ canvas, settingsJson, config, main });
                    window.SCA3D.logRuntimeCompatibilitySummary?.(viewer);
                } catch (error) {
                    console.error('[SCA3D] runtime startup failed:', error);
                    if (window.SCA3D?.capabilities?.webgl2 !== false) {
                        window.SCA3D.showRuntimeError?.('Unable to start the 3D viewer. Check the browser console for details.');
                    }
                }
            });`
    );

    return patched;
};

const patchIndexHtml = (html: string): string => {
    let patched = html;

    patched = patched.replace(
        '<link rel="stylesheet" href="./index.css">',
        '<link rel="stylesheet" href="./index.css">\n' +
        '        <link rel="stylesheet" href="./sca-hotspot-markers.css">'
    );

    patched = patched.replace(
        '        <!-- Application Script -->',
        '        <script src="./sca-runtime-capabilities.js"></script>\n' +
        '        <script src="./sca-debug.js"></script>\n' +
        '        <script src="./camera-animation.js"></script>\n' +
        '        <script src="./hotspot-bridge.js"></script>\n' +
        '        <script src="./region-bridge.js"></script>\n' +
        '        <script src="./region-mask-runtime.js"></script>\n' +
        '        <script src="./sca-picker.js"></script>\n' +
        '        <script src="./sca-region-core.js"></script>\n' +
        '        <script src="./sca-annotation-projector.js"></script>\n' +
        '        <script src="./sca-hotspot-overlay.js"></script>\n' +
        '        <script src="./sca-region-overlay.js"></script>\n' +
        '        <script src="./sca-region-runtime.js"></script>\n' +
        '        <script src="./sca-animation-runtime.js"></script>\n' +
        '        <script src="./sca-runtime.js"></script>\n' +
        '        <script src="./sca-host-bridge.js"></script>\n\n' +
        '        <!-- Application Script -->'
    );

    return patchViewerBootstrap(patched);
};

const patchPreviewHtml = (
    html: string,
    project: ScaProject,
    scaCapabilitiesJs: string,
    scaDebugJs: string,
    cameraAnimationJs: string,
    bridgeJs: string,
    regionBridgeJs: string,
    regionMaskJs: string,
    pickerJs: string,
    regionCoreJs: string,
    annotationProjectorJs: string,
    overlayJs: string,
    regionOverlayJs: string,
    regionRuntimeJs: string,
    animationRuntimeJs: string,
    hotspotCss: string,
    runtimeJs: string,
    hostBridgeJs: string,
    embeddedAssets: Record<string, string> = {}
): string => {
    const embeddedProject = JSON.stringify(project);
    const embeddedAssetsJson = JSON.stringify(embeddedAssets);
    const inlineScripts =
        `<script>\nwindow.__SCA3D_EMBEDDED_PROJECT__ = ${embeddedProject};\n</script>\n` +
        `<script>\nwindow.__SCA3D_EMBEDDED_ASSETS__ = ${embeddedAssetsJson};\n</script>\n` +
        `<style>\n${hotspotCss}\n</style>\n` +
        `<script>\n${scaCapabilitiesJs}\n</script>\n` +
        `<script>\n${scaDebugJs}\n</script>\n` +
        `<script>\n${cameraAnimationJs}\n</script>\n` +
        `<script>\n${bridgeJs}\n</script>\n` +
        `<script>\n${regionBridgeJs}\n</script>\n` +
        `<script>\n${regionMaskJs}\n</script>\n` +
        `<script>\n${pickerJs}\n</script>\n` +
        `<script>\n${regionCoreJs}\n</script>\n` +
        `<script>\n${annotationProjectorJs}\n</script>\n` +
        `<script>\n${overlayJs}\n</script>\n` +
        `<script>\n${regionOverlayJs}\n</script>\n` +
        `<script>\n${regionRuntimeJs}\n</script>\n` +
        `<script>\n${animationRuntimeJs}\n</script>\n` +
        `<script>\n${runtimeJs}\n</script>\n` +
        `<script>\n${hostBridgeJs}\n</script>\n\n`;

    let patched = html.replace(
        '        <!-- Application Script -->',
        `${inlineScripts}        <!-- Application Script -->`
    );

    return patchViewerBootstrap(patched);
};

const buildRuntimeExportProject = (
    project: ScaProject,
    splats: Splat[],
    viewerConfig: ScaProject['viewer'],
    runtimeGaussianCount?: number
): ScaProject => {
    const runtimeSplats = splats.map((splat) => {
        const scene = splat.scene;
        const scaSplatId = splat.scaSplatId ?? (scene ? ensureScaSplatId(splat, scene) : 'splat_01');
        return {
            scaSplatId,
            name: splat.name
        };
    });

    const runtimeRegions: ScaRegion[] = project.regions
        .filter((region) => region.enabled)
        .map((region) => ({
            ...structuredClone(region),
            source: {
                ...region.source,
                maskAsset: regionMaskStorePath(region.id)
            },
            capture: runtimeGaussianCount ?
                { ...region.capture, gaussianCount: runtimeGaussianCount } :
                region.capture
        }));

    return {
        ...project,
        regions: runtimeRegions,
        splats: runtimeSplats,
        viewer: viewerConfig
    };
};

const writeRegionMaskAssets = (
    memFs: MemoryFileSystem,
    project: ScaProject,
    splats: Splat[],
    serializeSettings: SerializeSettings,
    assetStore: ScaAssetStore | undefined,
    embeddedAssets: Record<string, string>,
    exportMapOverride?: ExportGaussianMap | null
): number => {
    if (!assetStore) {
        return 0;
    }

    const enabledRegions = project.regions.filter((region) => region.enabled);
    if (enabledRegions.length === 0) {
        return 0;
    }

    const sourceMaskBytes = new Map<string, Uint8Array>();
    for (const region of enabledRegions) {
        const storePath = region.source.maskAsset.startsWith('sca/') ?
            region.source.maskAsset.replace(/^sca\//, '') :
            region.source.maskAsset;
        const asset = assetStore.get(storePath) ?? assetStore.get(`sca/${storePath}`);
        if (!asset) {
            console.warn(`[SCA] runtime export: missing region mask for ${region.id}`);
            continue;
        }
        sourceMaskBytes.set(region.id, asset.data);
    }

    if (sourceMaskBytes.size === 0) {
        return 0;
    }

    const { exportMap, runtimeMasks } = remapRegionMasksForRuntimeExport(
        splats,
        serializeSettings,
        enabledRegions,
        sourceMaskBytes,
        exportMapOverride
    );

    for (const region of enabledRegions) {
        const runtimePath = regionMaskStorePath(region.id);
        const bytes = runtimeMasks.get(region.id);
        if (!bytes) {
            continue;
        }

        memFs.results.set(runtimePath, bytes);
        embeddedAssets[runtimePath] = `data:application/octet-stream;base64,${bytesToBase64(bytes)}`;
    }

    return exportMap.runtimeGaussianCount;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

const runtimeAssetPublicPath = (filename: string): string => `static/sca/${filename}`;

const isNetworkFetchFailure = (error: unknown): boolean => {
    if (!(error instanceof TypeError)) {
        return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('network request failed') ||
        message.includes('load failed');
};

const formatRuntimeAssetLoadError = (filename: string, error: unknown): ScaRuntimeAssetLoadError => {
    if (error instanceof ScaRuntimeAssetLoadError) {
        return error;
    }

    const assetPath = runtimeAssetPublicPath(filename);

    if (isNetworkFetchFailure(error)) {
        return new ScaRuntimeAssetLoadError(
            'SCA Runtime export failed\n\n' +
            `Could not load:\n${assetPath}\n\n` +
            'The editor server may no longer be available.\n\n' +
            'Reload the editor and try again.',
            assetPath,
            error
        );
    }

    const detail = error instanceof Error ? error.message : String(error);
    return new ScaRuntimeAssetLoadError(
        'SCA Runtime export failed\n\n' +
        `Could not load:\n${assetPath}\n\n` +
        `${detail}\n\n` +
        'Runtime assets are unavailable. Reload the editor or restart the development server.',
        assetPath,
        error
    );
};

const fetchRuntimeAsset = async (filename: ScaRuntimeAssetFilename): Promise<string> => {
    const assetPath = runtimeAssetPublicPath(filename);
    const url = new URL(assetPath, window.location.href).href;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new ScaRuntimeAssetLoadError(
                'SCA Runtime export failed\n\n' +
                `Could not load:\n${assetPath}\n\n` +
                `The server responded with HTTP ${response.status}.\n\n` +
                'Reload the editor and try again.',
                assetPath,
                new Error(`HTTP ${response.status}`)
            );
        }

        return response.text();
    } catch (error) {
        throw formatRuntimeAssetLoadError(filename, error);
    }
};

const resetRuntimeAssetFetchCache = (): void => {
    runtimeAssetFetchCache = null;
};

const fetchScaRuntimeAssetsInternal = async (): Promise<ScaRuntimeAssets> => {
    console.log(`[SCA EXPORT] loading ${SCA_RUNTIME_ASSET_FILENAMES.length} runtime assets`);

    const [
        scaCapabilitiesJs,
        scaDebugJs,
        cameraAnimationJs,
        bridgeJs,
        regionBridgeJs,
        regionMaskJs,
        pickerJs,
        regionCoreJs,
        annotationProjectorJs,
        overlayJs,
        regionOverlayJs,
        regionRuntimeJs,
        animationRuntimeJs,
        hotspotCss,
        runtimeJs,
        hostBridgeJs
    ] = await Promise.all(SCA_RUNTIME_ASSET_FILENAMES.map((filename) => fetchRuntimeAsset(filename)));

    return {
        scaCapabilitiesJs,
        scaDebugJs,
        cameraAnimationJs,
        bridgeJs,
        regionBridgeJs,
        regionMaskJs,
        pickerJs,
        regionCoreJs,
        annotationProjectorJs,
        overlayJs,
        regionOverlayJs,
        regionRuntimeJs,
        animationRuntimeJs,
        hotspotCss,
        runtimeJs,
        hostBridgeJs
    };
};

const fetchScaRuntimeAssets = async (): Promise<ScaRuntimeAssets> => {
    if (!runtimeAssetFetchCache) {
        runtimeAssetFetchCache = fetchScaRuntimeAssetsInternal().catch((error) => {
            runtimeAssetFetchCache = null;
            throw error;
        });
    }

    return runtimeAssetFetchCache;
};

/** Fail fast before SOG compression when runtime assets cannot be loaded. */
const ensureScaRuntimeAssetsAvailable = async (): Promise<ScaRuntimeAssets> => {
    try {
        return await fetchScaRuntimeAssets();
    } catch (error) {
        if (error instanceof ScaRuntimeAssetLoadError) {
            console.error('[SCA EXPORT] runtime asset load failed:', {
                assetPath: error.assetPath,
                cause: error.cause
            });
            throw error;
        }

        console.error('[SCA EXPORT] runtime asset load failed:', error);
        throw new ScaRuntimeAssetLoadError(
            'Runtime assets are unavailable. Reload the editor or restart the development server.',
            'static/sca/*',
            error
        );
    }
};

const writeZipFromMemory = async (memFs: MemoryFileSystem, filename: string): Promise<void> => {
    const fs = new BrowserFileSystem(filename);
    const zipWriter = await fs.createWriter(filename);
    const zipFs = new ZipFileSystem(zipWriter);

    try {
        for (const [entryName, data] of memFs.results.entries()) {
            const writer = await zipFs.createWriter(entryName);
            await writer.write(data);
            await writer.close();
        }
    } finally {
        await zipFs.close();
    }
};

const patchExportedViewerAssets = (memFs: MemoryFileSystem, useGaussianPickSpike: boolean): void => {
    const encoder = new TextEncoder();

    const indexJs = memFs.results.get('index.js');
    if (indexJs) {
        const patchedJs = patchViewerBundleForExport(new TextDecoder().decode(indexJs), useGaussianPickSpike);
        memFs.results.set('index.js', encoder.encode(patchedJs));
    }

    for (const [filename, bytes] of memFs.results.entries()) {
        if (!filename.endsWith('.html')) {
            continue;
        }

        const html = new TextDecoder().decode(bytes);
        if (!html.includes('class CameraManager')) {
            continue;
        }

        memFs.results.set(filename, encoder.encode(patchViewerBundleForExport(html, useGaussianPickSpike)));
    }
};

type RuntimeViewerPreviewResult = {
    html: string;
    exportProject: ScaProject;
    pickerMode: 'gaussian-index-spike' | 'production';
    sogBuildCount: number;
    htmlBundleMs: number;
    cacheLookupMs: number;
};

/**
 * Build the same self-contained preview.html the ZIP export uses, entirely in memory.
 * Uses unified GSplat export, runtime-remapped region masks, and patched viewer bundle.
 */
const buildRuntimeViewerPreviewHtml = async (
    splats: Splat[],
    project: ScaProject,
    events: Events,
    options: ScaRuntimePackageOptions = {},
    shared?: ScaRuntimeExportSharedContext
): Promise<RuntimeViewerPreviewResult> => {
    const useGaussianPickSpike = options.useGaussianPickSpike ?? false;
    const sogCompressionMode = options.sogCompressionMode ?? DEFAULT_SOG_COMPRESSION_MODE;
    console.log(`[SCA EXPORT] requested compression: ${sogCompressionMode}`);
    if (useGaussianPickSpike) {
        console.warn('[SCA RUNTIME PREVIEW] deprecated Gaussian Pick Spike enabled — production uses RuntimeWebGpuPickerAdapter or RuntimeCentersPickerAdapter');
    }

    if (splats.length === 0) {
        throw new Error('[SCA] cannot build runtime preview: no splats in scene');
    }

    const assetStore = events.invoke('sca.assetStore') as ScaAssetStore | undefined;

    const editorPose = events.invoke('camera.getPose') as {
        position?: { x: number; y: number; z: number };
        target?: { x: number; y: number; z: number };
    } | null;
    const editorFov = events.invoke('camera.fov') as number;
    const fallbackInitial = (editorPose?.position && editorPose?.target) ? {
        position: [editorPose.position.x, editorPose.position.y, editorPose.position.z] as [number, number, number],
        target: [editorPose.target.x, editorPose.target.y, editorPose.target.z] as [number, number, number],
        fov: editorFov
    } : undefined;

    const viewerConfig = resolveViewerConfig(project, fallbackInitial);
    const serializeSettings = createScaRuntimeSerializeSettings(events);
    const experienceSettings = buildViewerExperienceSettings(events, project);

    splatTransformLogger.setRenderer(createProgressRenderer('Building Runtime Viewer Preview', events));

    try {
        const runtimeAssets = shared?.runtimeAssets ?? await ensureScaRuntimeAssetsAvailable();

        const previewMemFs = new MemoryFileSystem();

        const exportResult = await writeViewerExportWithCachedSog({
            splats,
            serializeSettings,
            sogCompressionMode,
            iterations: 10,
            outputFormat: 'html-bundle',
            filename: PREVIEW_FILENAME,
            experienceSettings,
            events,
            memFs: previewMemFs
        });

        patchExportedViewerAssets(previewMemFs, useGaussianPickSpike);

        const previewBytes = previewMemFs.results.get(PREVIEW_FILENAME);
        if (!previewBytes) {
            throw new Error('[SCA] bundled viewer export did not produce preview.html');
        }

        let exportProject: ScaProject;
        let embeddedAssets: Record<string, string>;

        if (shared) {
            exportProject = shared.exportProject;
            embeddedAssets = shared.embeddedAssets;
        } else {
            const draftExportProject = buildRuntimeExportProject(project, splats, viewerConfig);
            embeddedAssets = {};
            const maskScratchFs = new MemoryFileSystem();
            const runtimeGaussianCount = writeRegionMaskAssets(
                maskScratchFs,
                draftExportProject,
                splats,
                serializeSettings,
                assetStore,
                embeddedAssets,
                exportResult.exportMap
            );
            exportProject = buildRuntimeExportProject(
                project,
                splats,
                viewerConfig,
                runtimeGaussianCount > 0 ? runtimeGaussianCount : undefined
            );
        }

        const previewHtml = patchPreviewHtml(
            new TextDecoder().decode(previewBytes),
            exportProject,
            runtimeAssets.scaCapabilitiesJs,
            runtimeAssets.scaDebugJs,
            runtimeAssets.cameraAnimationJs,
            runtimeAssets.bridgeJs,
            runtimeAssets.regionBridgeJs,
            runtimeAssets.regionMaskJs,
            runtimeAssets.pickerJs,
            runtimeAssets.regionCoreJs,
            runtimeAssets.annotationProjectorJs,
            runtimeAssets.overlayJs,
            runtimeAssets.regionOverlayJs,
            runtimeAssets.regionRuntimeJs,
            runtimeAssets.animationRuntimeJs,
            runtimeAssets.hotspotCss,
            runtimeAssets.runtimeJs,
            runtimeAssets.hostBridgeJs,
            embeddedAssets
        );

        return {
            html: previewHtml,
            exportProject,
            pickerMode: useGaussianPickSpike ? 'gaussian-index-spike' : 'production',
            sogBuildCount: exportResult.sogBuildCount,
            htmlBundleMs: exportResult.htmlBundleMs,
            cacheLookupMs: exportResult.cacheLookupMs
        };
    } catch (err) {
        splatTransformLogger.unwindAll(true);
        throw err;
    }
};

const exportScaRuntimePackage = async (
    splats: Splat[],
    project: ScaProject,
    events: Events,
    options: ScaRuntimePackageOptions = {}
): Promise<void> => {
    const includePreview = options.includePreview ?? true;
    const useGaussianPickSpike = options.useGaussianPickSpike ?? false;
    const sogCompressionMode = options.sogCompressionMode ?? DEFAULT_SOG_COMPRESSION_MODE;
    console.log(`[SCA EXPORT] requested compression: ${sogCompressionMode}`);
    if (useGaussianPickSpike) {
        console.warn('[SCA EXPORT] deprecated Gaussian Pick Spike enabled — production uses RuntimeWebGpuPickerAdapter or RuntimeCentersPickerAdapter');
    }
    if (splats.length === 0) {
        throw new Error('[SCA] cannot export runtime package: no splats in scene');
    }

    const assetStore = events.invoke('sca.assetStore') as ScaAssetStore | undefined;

    const editorPose = events.invoke('camera.getPose') as {
        position?: { x: number; y: number; z: number };
        target?: { x: number; y: number; z: number };
    } | null;
    const editorFov = events.invoke('camera.fov') as number;
    const fallbackInitial = (editorPose?.position && editorPose?.target) ? {
        position: [editorPose.position.x, editorPose.position.y, editorPose.position.z] as [number, number, number],
        target: [editorPose.target.x, editorPose.target.y, editorPose.target.z] as [number, number, number],
        fov: editorFov
    } : undefined;

    const viewerConfig = resolveViewerConfig(project, fallbackInitial);
    const serializeSettings = createScaRuntimeSerializeSettings(events);

    const experienceSettings = buildViewerExperienceSettings(events, project);
    console.log('[SCA] runtime package export preview:', {
        project,
        annotations: experienceSettings.annotations
    });

    splatTransformLogger.setRenderer(createProgressRenderer('Exporting SCA Runtime Package', events));

    const perf = new ExportPerfTracker();
    const compressionBackend = await resolveSogCompressionBackendLabel(sogCompressionMode);
    const cpuFallback = compressionBackend === 'cpu';
    perf.setPartial({ compressionBackend });

    fireExportStatus(events, {
        inProgress: true,
        message: 'Checking runtime assets...',
        cpuFallback
    });

    if (isExportPerfEnabled()) {
        console.log('[SCA EXPORT] geometry fingerprint inputs:', getSogGeometryFingerprintInputs());
    }

    let totalSogBuildCount = 0;
    let totalSogBuildMs = 0;
    let totalCacheLookupMs = 0;
    let totalHtmlBundleMs = 0;

    resetRuntimeAssetFetchCache();

    try {
        const runtimeAssets = await ensureScaRuntimeAssetsAvailable();

        fireExportStatus(events, {
            inProgress: true,
            message: cpuFallback ? 'CPU export — this may take longer' : 'Preparing SOG...',
            cpuFallback
        });

        const memFs = new MemoryFileSystem();

        const sogResult = await writeViewerExportWithCachedSog({
            splats,
            serializeSettings,
            sogCompressionMode,
            iterations: 10,
            outputFormat: 'html',
            filename: 'index.html',
            experienceSettings,
            events,
            memFs
        });
        totalSogBuildCount += sogResult.sogBuildCount;
        totalSogBuildMs += sogResult.sogBuildMs;
        totalCacheLookupMs += sogResult.cacheLookupMs;

        fireExportStatus(events, {
            inProgress: true,
            message: 'Building runtime package...',
            cpuFallback
        });

        patchExportedViewerAssets(memFs, useGaussianPickSpike);

        const indexBytes = memFs.results.get('index.html');
        if (!indexBytes) {
            throw new Error('[SCA] viewer export did not produce index.html');
        }

        const patchedHtml = patchIndexHtml(new TextDecoder().decode(indexBytes));
        const encoder = new TextEncoder();

        memFs.results.set('index.html', encoder.encode(patchedHtml));
        const {
            scaCapabilitiesJs,
            scaDebugJs,
            cameraAnimationJs,
            bridgeJs,
            regionBridgeJs,
            regionMaskJs,
            pickerJs,
            regionCoreJs,
            annotationProjectorJs,
            overlayJs,
            regionOverlayJs,
            regionRuntimeJs,
            animationRuntimeJs,
            hotspotCss,
            runtimeJs,
            hostBridgeJs
        } = runtimeAssets;

        memFs.results.set('sca-runtime-capabilities.js', encoder.encode(scaCapabilitiesJs));
        memFs.results.set('sca-debug.js', encoder.encode(scaDebugJs));
        memFs.results.set('camera-animation.js', encoder.encode(cameraAnimationJs));
        memFs.results.set('hotspot-bridge.js', encoder.encode(bridgeJs));
        memFs.results.set('region-bridge.js', encoder.encode(regionBridgeJs));
        memFs.results.set('region-mask-runtime.js', encoder.encode(regionMaskJs));
        memFs.results.set('sca-picker.js', encoder.encode(pickerJs));
        memFs.results.set('sca-region-core.js', encoder.encode(regionCoreJs));
        memFs.results.set('sca-annotation-projector.js', encoder.encode(annotationProjectorJs));
        memFs.results.set('sca-hotspot-overlay.js', encoder.encode(overlayJs));
        memFs.results.set('sca-region-overlay.js', encoder.encode(regionOverlayJs));
        memFs.results.set('sca-region-runtime.js', encoder.encode(regionRuntimeJs));
        memFs.results.set('sca-animation-runtime.js', encoder.encode(animationRuntimeJs));
        memFs.results.set('sca-hotspot-markers.css', encoder.encode(hotspotCss));
        memFs.results.set('sca-runtime.js', encoder.encode(runtimeJs));
        memFs.results.set('sca-host-bridge.js', encoder.encode(hostBridgeJs));

        const draftExportProject = buildRuntimeExportProject(project, splats, viewerConfig);
        const embeddedAssets: Record<string, string> = {};
        perf.markStageStart();
        const runtimeGaussianCount = writeRegionMaskAssets(
            memFs,
            draftExportProject,
            splats,
            serializeSettings,
            assetStore,
            embeddedAssets,
            sogResult.exportMap
        );
        const regionMasksMs = perf.elapsedMs();
        const exportProject = buildRuntimeExportProject(
            project,
            splats,
            viewerConfig,
            runtimeGaussianCount > 0 ? runtimeGaussianCount : undefined
        );
        memFs.results.set('project.json', encoder.encode(stringifyProjectJson(exportProject)));

        const background = exportProject.viewer?.background;
        if ((background?.type === 'image' || background?.type === 'panorama') && background.image?.filename && assetStore) {
            const assetPath = backgroundAssetPath(background.image.filename);
            const asset = assetStore.get(assetPath);
            if (asset) {
                memFs.results.set(assetPath, asset.data);
                const binary = bytesToBase64(asset.data);
                embeddedAssets[assetPath] = `data:${asset.mimeType};base64,${binary}`;
            }
        }

        if (includePreview) {
            const previewResult = await buildRuntimeViewerPreviewHtml(
                splats,
                project,
                events,
                options,
                {
                    runtimeAssets,
                    embeddedAssets,
                    exportProject
                }
            );
            totalSogBuildCount += previewResult.sogBuildCount;
            totalCacheLookupMs += previewResult.cacheLookupMs;
            totalHtmlBundleMs += previewResult.htmlBundleMs;
            memFs.results.set(PREVIEW_FILENAME, encoder.encode(previewResult.html));
        }

        fireExportStatus(events, {
            inProgress: true,
            message: 'Saving...',
            cpuFallback
        });

        perf.markStageStart();
        await writeZipFromMemory(memFs, PACKAGE_FILENAME);
        const zipMs = perf.elapsedMs();

        perf.setPartial({
            cacheLookupMs: totalCacheLookupMs,
            sogBuildMs: totalSogBuildMs,
            sogCacheHit: totalSogBuildCount === 0,
            sogBuildCount: totalSogBuildCount,
            regionMasksMs,
            htmlBundleMs: totalHtmlBundleMs,
            zipMs
        });
        perf.log(perf.finish());

        fireExportStatus(events, { inProgress: false });
    } catch (err) {
        splatTransformLogger.unwindAll(true);
        fireExportStatus(events, { inProgress: false });
        throw err;
    } finally {
        resetRuntimeAssetFetchCache();
    }
};

export {
    buildRuntimeViewerPreviewHtml,
    buildViewerExperienceSettings,
    ensureScaRuntimeAssetsAvailable,
    exportScaRuntimePackage,
    formatRuntimeAssetLoadError,
    isNetworkFetchFailure,
    PACKAGE_FILENAME,
    patchExportedViewerAssets,
    patchIndexHtml,
    patchPreviewHtml,
    patchViewerBundle,
    PREVIEW_FILENAME,
    resetRuntimeAssetFetchCache,
    RuntimeViewerPreviewResult,
    ScaExportPackageStatus,
    ScaRuntimeAssetLoadError,
    SCA_RUNTIME_ASSET_FILENAMES,
    ScaRuntimeExportSharedContext,
    ScaRuntimePackageOptions,
    SogCompressionMode,
    DEFAULT_SOG_COMPRESSION_MODE,
    WebGPUUnavailableError
};
