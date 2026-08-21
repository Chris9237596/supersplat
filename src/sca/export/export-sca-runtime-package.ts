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
    SerializeSettings,
    WebGPUUnavailableError,
    writeSplatFile
} from '../../splat-serialize';
import { stringifyProjectJson } from '../serialize/project-json';
import { ScaProject } from '../types/project';
import { resolveViewerConfig } from '../viewer/viewer-config';
import { backgroundAssetPath, parseHexColor } from '../viewer/viewer-background';
import { ScaAssetStore } from '../store/sca-asset-store';

import { hotspotsToAnnotations } from './hotspot-to-annotation';
import { patchViewerBundle } from './patch-viewer-bundle';

const PACKAGE_FILENAME = 'sca-runtime-package.zip';
const PREVIEW_FILENAME = 'preview.html';

type ScaRuntimePackageOptions = {
    includePreview?: boolean;
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
            navigationTargetsEnabled: false
        }
    };
};

const patchViewerBootstrap = (html: string): string => {
    return html.replace(
        'const viewer = await main(canvas, settingsJson, config);',
        'const viewer = await SCA3D.bootstrapViewer({ canvas, settingsJson, config, main });'
    );
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
        '        <script src="./camera-animation.js"></script>\n' +
        '        <script src="./hotspot-bridge.js"></script>\n' +
        '        <script src="./sca-hotspot-overlay.js"></script>\n' +
        '        <script src="./sca-runtime.js"></script>\n\n' +
        '        <!-- Application Script -->'
    );

    return patchViewerBootstrap(patched);
};

const patchPreviewHtml = (
    html: string,
    project: ScaProject,
    cameraAnimationJs: string,
    bridgeJs: string,
    overlayJs: string,
    hotspotCss: string,
    runtimeJs: string,
    embeddedAssets: Record<string, string> = {}
): string => {
    const embeddedProject = JSON.stringify(project);
    const embeddedAssetsJson = JSON.stringify(embeddedAssets);
    const inlineScripts =
        `<script>\nwindow.__SCA3D_EMBEDDED_PROJECT__ = ${embeddedProject};\n</script>\n` +
        `<script>\nwindow.__SCA3D_EMBEDDED_ASSETS__ = ${embeddedAssetsJson};\n</script>\n` +
        `<style>\n${hotspotCss}\n</style>\n` +
        `<script>\n${cameraAnimationJs}\n</script>\n` +
        `<script>\n${bridgeJs}\n</script>\n` +
        `<script>\n${overlayJs}\n</script>\n` +
        `<script>\n${runtimeJs}\n</script>\n\n`;

    let patched = html.replace(
        '        <!-- Application Script -->',
        `${inlineScripts}        <!-- Application Script -->`
    );

    return patchViewerBootstrap(patched);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

const fetchRuntimeAsset = async (filename: string): Promise<string> => {
    const url = new URL(`static/sca/${filename}`, window.location.href).href;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`[SCA] failed to load runtime asset: ${filename} (${response.status})`);
    }

    return response.text();
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

const patchExportedViewerAssets = (memFs: MemoryFileSystem): void => {
    const encoder = new TextEncoder();

    const indexJs = memFs.results.get('index.js');
    if (indexJs) {
        const patchedJs = patchViewerBundle(new TextDecoder().decode(indexJs));
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

        memFs.results.set(filename, encoder.encode(patchViewerBundle(html)));
    }
};

const exportScaRuntimePackage = async (
    splats: Splat[],
    project: ScaProject,
    events: Events,
    options: ScaRuntimePackageOptions = {}
): Promise<void> => {
    const includePreview = options.includePreview ?? true;
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
    const exportProject: ScaProject = {
        ...project,
        viewer: viewerConfig
    };

    const experienceSettings = buildViewerExperienceSettings(events, exportProject);
    const serializeSettings: SerializeSettings = {
        maxSHBands: events.invoke('view.bands') as number
    };

    const exported = {
        project: exportProject,
        annotations: experienceSettings.annotations
    };
    console.log('[SCA] runtime package export preview:', exported);

    splatTransformLogger.setRenderer(createProgressRenderer('Exporting SCA Runtime Package', events));

    try {
        const memFs = new MemoryFileSystem();

        await writeSplatFile(splats, serializeSettings, 'html', 'index.html', {
            viewerSettingsJson: experienceSettings,
            iterations: 10
        }, memFs);

        patchExportedViewerAssets(memFs);

        const indexBytes = memFs.results.get('index.html');
        if (!indexBytes) {
            throw new Error('[SCA] viewer export did not produce index.html');
        }

        const patchedHtml = patchIndexHtml(new TextDecoder().decode(indexBytes));
        const encoder = new TextEncoder();

        memFs.results.set('index.html', encoder.encode(patchedHtml));
        const cameraAnimationJs = await fetchRuntimeAsset('camera-animation.js');
        const bridgeJs = await fetchRuntimeAsset('hotspot-bridge.js');
        const overlayJs = await fetchRuntimeAsset('sca-hotspot-overlay.js');
        const hotspotCss = await fetchRuntimeAsset('sca-hotspot-markers.css');
        const runtimeJs = await fetchRuntimeAsset('sca-runtime.js');

        memFs.results.set('project.json', encoder.encode(stringifyProjectJson(exportProject)));
        memFs.results.set('camera-animation.js', encoder.encode(cameraAnimationJs));
        memFs.results.set('hotspot-bridge.js', encoder.encode(bridgeJs));
        memFs.results.set('sca-hotspot-overlay.js', encoder.encode(overlayJs));
        memFs.results.set('sca-hotspot-markers.css', encoder.encode(hotspotCss));
        memFs.results.set('sca-runtime.js', encoder.encode(runtimeJs));

        const background = exportProject.viewer?.background;
        const embeddedAssets: Record<string, string> = {};
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
            const previewMemFs = new MemoryFileSystem();

            await writeSplatFile(splats, serializeSettings, 'html-bundle', PREVIEW_FILENAME, {
                viewerSettingsJson: experienceSettings,
                iterations: 10
            }, previewMemFs);

            patchExportedViewerAssets(previewMemFs);

            const previewBytes = previewMemFs.results.get(PREVIEW_FILENAME);
            if (!previewBytes) {
                throw new Error('[SCA] bundled viewer export did not produce preview.html');
            }

            const previewHtml = patchPreviewHtml(
                new TextDecoder().decode(previewBytes),
                exportProject,
                cameraAnimationJs,
                bridgeJs,
                overlayJs,
                hotspotCss,
                runtimeJs,
                embeddedAssets
            );
            memFs.results.set(PREVIEW_FILENAME, encoder.encode(previewHtml));
        }

        await writeZipFromMemory(memFs, PACKAGE_FILENAME);
    } catch (err) {
        splatTransformLogger.unwindAll(true);
        throw err;
    }
};

export {
    buildViewerExperienceSettings,
    exportScaRuntimePackage,
    PACKAGE_FILENAME,
    patchExportedViewerAssets,
    patchIndexHtml,
    patchPreviewHtml,
    patchViewerBundle,
    PREVIEW_FILENAME,
    ScaRuntimePackageOptions,
    WebGPUUnavailableError
};
