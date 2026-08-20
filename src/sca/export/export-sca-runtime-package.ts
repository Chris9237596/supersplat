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

import { hotspotsToAnnotations } from './hotspot-to-annotation';

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
    const bgClr = events.invoke('bgClr') as { r: number; g: number; b: number };
    const fov = events.invoke('camera.fov') as number;
    const pose = events.invoke('camera.getPose') as {
        position?: { x: number; y: number; z: number };
        target?: { x: number; y: number; z: number };
    } | null;

    const p = pose?.position;
    const t = pose?.target;
    const cameras = (p && t) ? [{
        initial: {
            position: [p.x, p.y, p.z] as [number, number, number],
            target: [t.x, t.y, t.z] as [number, number, number],
            fov
        }
    }] : [];

    return {
        version: 2,
        tonemapping: 'none',
        highPrecisionRendering: false,
        background: {
            color: [bgClr.r, bgClr.g, bgClr.b]
        },
        postEffectSettings: defaultPostEffectSettings,
        animTracks: [],
        cameras,
        annotations: hotspotsToAnnotations(project.hotspots),
        startMode: 'default'
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
        '        <!-- Application Script -->',
        '        <script src="./hotspot-bridge.js"></script>\n' +
        '        <script src="./sca-runtime.js"></script>\n\n' +
        '        <!-- Application Script -->'
    );

    return patchViewerBootstrap(patched);
};

const patchPreviewHtml = (html: string, project: ScaProject, bridgeJs: string, runtimeJs: string): string => {
    const embeddedProject = JSON.stringify(project);
    const inlineScripts =
        `<script>\nwindow.__SCA3D_EMBEDDED_PROJECT__ = ${embeddedProject};\n</script>\n` +
        `<script>\n${bridgeJs}\n</script>\n` +
        `<script>\n${runtimeJs}\n</script>\n\n`;

    let patched = html.replace(
        '        <!-- Application Script -->',
        `${inlineScripts}        <!-- Application Script -->`
    );

    return patchViewerBootstrap(patched);
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

    const experienceSettings = buildViewerExperienceSettings(events, project);
    const serializeSettings: SerializeSettings = {
        maxSHBands: events.invoke('view.bands') as number
    };

    const exported = {
        project,
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

        const indexBytes = memFs.results.get('index.html');
        if (!indexBytes) {
            throw new Error('[SCA] viewer export did not produce index.html');
        }

        const patchedHtml = patchIndexHtml(new TextDecoder().decode(indexBytes));
        const encoder = new TextEncoder();

        memFs.results.set('index.html', encoder.encode(patchedHtml));
        const bridgeJs = await fetchRuntimeAsset('hotspot-bridge.js');
        const runtimeJs = await fetchRuntimeAsset('sca-runtime.js');

        memFs.results.set('project.json', encoder.encode(stringifyProjectJson(project)));
        memFs.results.set('hotspot-bridge.js', encoder.encode(bridgeJs));
        memFs.results.set('sca-runtime.js', encoder.encode(runtimeJs));

        if (includePreview) {
            const previewMemFs = new MemoryFileSystem();

            await writeSplatFile(splats, serializeSettings, 'html-bundle', PREVIEW_FILENAME, {
                viewerSettingsJson: experienceSettings,
                iterations: 10
            }, previewMemFs);

            const previewBytes = previewMemFs.results.get(PREVIEW_FILENAME);
            if (!previewBytes) {
                throw new Error('[SCA] bundled viewer export did not produce preview.html');
            }

            const previewHtml = patchPreviewHtml(
                new TextDecoder().decode(previewBytes),
                project,
                bridgeJs,
                runtimeJs
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
    patchIndexHtml,
    patchPreviewHtml,
    PREVIEW_FILENAME,
    ScaRuntimePackageOptions,
    WebGPUUnavailableError
};
