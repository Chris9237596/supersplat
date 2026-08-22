import { MemoryFileSystem } from '@playcanvas/splat-transform';

import { Events } from '../../events';
import { Splat } from '../../splat';
import {
    ExportGaussianMap,
    ExperienceSettings,
    SerializeSettings,
    SogCompressionMode,
    buildExportGaussianMap,
    resolveSogCompressionBackendLabel,
    writeSplatFile
} from '../../splat-serialize';

import { isExportPerfEnabled } from './export-perf';

type SogGeometryCacheEntry = {
    indexSog: Uint8Array;
    exportMap: ExportGaussianMap;
};

type ViewerShellCacheEntry = {
    indexCss: Uint8Array;
    indexJs: Uint8Array;
    indexHtmlShell: Uint8Array;
};

type ViewerOutputFormat = 'html' | 'html-bundle';

type WriteViewerExportOptions = {
    splats: Splat[];
    serializeSettings: SerializeSettings;
    sogCompressionMode: SogCompressionMode;
    iterations: number;
    outputFormat: ViewerOutputFormat;
    filename: string;
    experienceSettings: ExperienceSettings;
    events?: Events;
    memFs: MemoryFileSystem;
};

let geometryCache: { key: string; entry: SogGeometryCacheEntry } | null = null;
let viewerShellCache: ViewerShellCacheEntry | null = null;
let sessionSogBuildCount = 0;

type EnsureCompressedSogResult = {
    entry: SogGeometryCacheEntry;
    cacheHit: boolean;
    sogBuildMs: number;
    cacheLookupMs: number;
    sogBuildCount: number;
};

const fnv1aUpdate = (hash: number, data: ArrayBufferView | string): number => {
    let h = hash;
    if (typeof data === 'string') {
        for (let i = 0; i < data.length; i++) {
            h ^= data.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    const bytes = data instanceof Uint8Array ?
        data :
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const hashSplatTransform = (splat: Splat): number => {
    const entity = splat.entity;
    const pos = entity.getPosition();
    const rot = entity.getRotation();
    const scale = entity.getLocalScale();
    let h = 2166136261;
    h = fnv1aUpdate(h, splat.scaSplatId ?? '');
    h = fnv1aUpdate(
        h,
        `${pos.x},${pos.y},${pos.z},${rot.x},${rot.y},${rot.z},${rot.w},${scale.x},${scale.y},${scale.z}`
    );
    return h;
};

const hashSplatVertexData = (splat: Splat): number => {
    let h = 2166136261;
    const element = splat.splatData.getElement('vertex');
    for (const prop of element.properties) {
        if (prop.storage) {
            h = fnv1aUpdate(h, prop.name);
            h = fnv1aUpdate(
                h,
                new Uint8Array(prop.storage.buffer, prop.storage.byteOffset, prop.storage.byteLength)
            );
        }
    }
    return h;
};

/**
 * Geometry-only fingerprint for SOG compression caching.
 * Excludes viewer output format and project/viewer metadata.
 */
const computeSogGeometryCacheKey = (
    splats: Splat[],
    settings: SerializeSettings,
    sogCompressionMode: SogCompressionMode,
    iterations: number
): string => {
    let h = 2166136261;
    h = fnv1aUpdate(h, `mode:${sogCompressionMode}`);
    h = fnv1aUpdate(h, `iter:${iterations}`);
    h = fnv1aUpdate(h, `bands:${settings.maxSHBands ?? 3}`);
    h = fnv1aUpdate(h, `sel:${settings.selected ?? false}`);
    h = fnv1aUpdate(h, `minOp:${settings.minOpacity ?? 0}`);
    h = fnv1aUpdate(h, `rmInv:${settings.removeInvalid ?? false}`);
    h = fnv1aUpdate(h, `keepWT:${settings.keepWorldTransform ?? false}`);
    h = fnv1aUpdate(h, `keepTint:${settings.keepColorTint ?? false}`);

    for (const splat of splats) {
        h = fnv1aUpdate(h, hashSplatTransform(splat).toString(16));
        h = fnv1aUpdate(h, hashSplatVertexData(splat).toString(16));
    }

    return h.toString(16);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

const padMultiline = (text: string, spaces: number): string => {
    const whitespace = ' '.repeat(spaces);
    return text.split('\n').map((line) => whitespace + line).join('\n');
};

const requireViewerShellCache = (): ViewerShellCacheEntry => {
    if (!viewerShellCache) {
        throw new Error('[SCA EXPORT] viewer shell cache unavailable after SOG compression');
    }
    return viewerShellCache;
};

const captureViewerShellFromResults = (results: Map<string, Uint8Array>): ViewerShellCacheEntry => {
    const indexCss = results.get('index.css');
    const indexJs = results.get('index.js');
    const indexHtmlShell = results.get('index.html');
    const indexSog = results.get('index.sog');

    if (!indexCss || !indexJs || !indexHtmlShell || !indexSog) {
        throw new Error('[SCA EXPORT] html viewer export did not produce index.css/index.js/index.html/index.sog');
    }

    return {
        indexCss: indexCss.slice(),
        indexJs: indexJs.slice(),
        indexHtmlShell: indexHtmlShell.slice()
    };
};

const ensureCompressedSogGeometry = async (
    splats: Splat[],
    serializeSettings: SerializeSettings,
    sogCompressionMode: SogCompressionMode,
    iterations: number,
    events?: Events
): Promise<EnsureCompressedSogResult> => {
    const lookupStartedAt = performance.now();
    const geometryKey = computeSogGeometryCacheKey(
        splats,
        serializeSettings,
        sogCompressionMode,
        iterations
    );
    const cacheLookupMs = Math.round(performance.now() - lookupStartedAt);

    if (geometryCache?.key === geometryKey) {
        console.log('[SCA EXPORT] SOG geometry cache hit');
        if (isExportPerfEnabled()) {
            console.log('[SCA EXPORT] sogBuildCount=0 (cache hit, no compression this export)');
        }
        return {
            entry: geometryCache.entry,
            cacheHit: true,
            sogBuildMs: 0,
            cacheLookupMs,
            sogBuildCount: 0
        };
    }

    const backendLabel = await resolveSogCompressionBackendLabel(sogCompressionMode);
    console.log(`[SCA EXPORT] SOG cache miss — rebuilding with ${backendLabel}`);

    const sogBuildStartedAt = performance.now();
    const scratchFs = new MemoryFileSystem();
    await writeSplatFile(splats, serializeSettings, 'html', 'index.html', {
        viewerSettingsJson: {
            version: 2,
            tonemapping: 'none',
            highPrecisionRendering: false,
            background: { color: [0, 0, 0] },
            postEffectSettings: {
                sharpness: { enabled: false, amount: 0 },
                bloom: { enabled: false, intensity: 1, blurLevel: 2 },
                grading: { enabled: false, brightness: 0, contrast: 1, saturation: 1, tint: [1, 1, 1] },
                vignette: { enabled: false, intensity: 0.5, inner: 0.3, outer: 0.75, curvature: 1 },
                fringing: { enabled: false, intensity: 0.5 }
            },
            animTracks: [],
            cameras: [{
                initial: {
                    position: [0, 0, 0],
                    target: [0, 0, 1],
                    fov: 75
                }
            }],
            annotations: [],
            startMode: 'default'
        },
        iterations
    }, scratchFs, events, sogCompressionMode);

    const indexSog = scratchFs.results.get('index.sog');
    if (!indexSog) {
        throw new Error('[SCA EXPORT] html viewer export did not produce index.sog');
    }

    const exportMap = buildExportGaussianMap(splats, serializeSettings);
    if (!exportMap) {
        throw new Error('[SCA EXPORT] no gaussians pass export filter');
    }

    viewerShellCache = captureViewerShellFromResults(scratchFs.results);
    const entry: SogGeometryCacheEntry = {
        indexSog: indexSog.slice(),
        exportMap
    };
    geometryCache = { key: geometryKey, entry };
    sessionSogBuildCount += 1;
    const sogBuildMs = Math.round(performance.now() - sogBuildStartedAt);
    if (isExportPerfEnabled()) {
        console.log(`[SCA EXPORT] sogBuildCount=1 sessionSogBuildCount=${sessionSogBuildCount}`);
    }
    return {
        entry,
        cacheHit: false,
        sogBuildMs,
        cacheLookupMs,
        sogBuildCount: 1
    };
};

const writeFreshSettingsJson = (
    memFs: MemoryFileSystem,
    experienceSettings: ExperienceSettings
): void => {
    const encoder = new TextEncoder();
    memFs.results.set(
        'settings.json',
        encoder.encode(JSON.stringify(experienceSettings, null, 4))
    );
};

const populateUnbundledViewerFiles = (
    memFs: MemoryFileSystem,
    geometry: SogGeometryCacheEntry,
    shell: ViewerShellCacheEntry,
    experienceSettings: ExperienceSettings,
    htmlFilename: string
): void => {
    memFs.results.set('index.sog', geometry.indexSog.slice());
    memFs.results.set('index.css', shell.indexCss.slice());
    memFs.results.set('index.js', shell.indexJs.slice());
    memFs.results.set(htmlFilename, shell.indexHtmlShell.slice());
    writeFreshSettingsJson(memFs, experienceSettings);
};

const assembleBundledViewerHtml = (
    shell: ViewerShellCacheEntry,
    indexSog: Uint8Array,
    experienceSettings: ExperienceSettings
): string => {
    const html = new TextDecoder().decode(shell.indexHtmlShell);
    const css = new TextDecoder().decode(shell.indexCss);
    const js = new TextDecoder().decode(shell.indexJs);
    const sogData = bytesToBase64(indexSog);

    const styleLink = '<link rel="stylesheet" href="./index.css">';
    const moduleImport = 'import { main } from \'./index.js\';';
    const settingsFetch = 'settings: fetch(settingsUrl).then(response => response.json())';
    const contentFetch = 'fetch(contentUrl)';
    const sogFetch = 'fetch("index.sog")';

    let bundled = html;
    if (!bundled.includes(styleLink)) {
        throw new Error('[SCA EXPORT] viewer html shell missing index.css link');
    }
    if (!bundled.includes(moduleImport)) {
        throw new Error('[SCA EXPORT] viewer html shell missing index.js module import');
    }

    bundled = bundled
        .replace(styleLink, `<style>\n${padMultiline(css, 12)}\n        </style>`)
        .replace(moduleImport, js)
        .replace(
            settingsFetch,
            `settings: ${JSON.stringify(experienceSettings)}`
        );

    if (bundled.includes(contentFetch)) {
        bundled = bundled.replace(
            contentFetch,
            `fetch("data:application/octet-stream;base64,${sogData}")`
        );
    } else if (bundled.includes(sogFetch)) {
        bundled = bundled.replace(
            sogFetch,
            `fetch("data:application/octet-stream;base64,${sogData}")`
        );
    } else {
        throw new Error('[SCA EXPORT] viewer html shell missing content fetch marker');
    }

    return bundled.replace('.compressed.ply', '.sog');
};

type WriteViewerExportResult = {
    exportMap: ExportGaussianMap;
    cacheHit: boolean;
    sogBuildMs: number;
    cacheLookupMs: number;
    sogBuildCount: number;
    htmlBundleMs: number;
};

const writeViewerExportWithCachedSog = async (
    options: WriteViewerExportOptions
): Promise<WriteViewerExportResult> => {
    const {
        splats,
        serializeSettings,
        sogCompressionMode,
        iterations,
        outputFormat,
        filename,
        experienceSettings,
        events,
        memFs
    } = options;

    const compressed = await ensureCompressedSogGeometry(
        splats,
        serializeSettings,
        sogCompressionMode,
        iterations,
        events
    );
    const shell = requireViewerShellCache();
    let htmlBundleMs = 0;

    if (outputFormat === 'html') {
        populateUnbundledViewerFiles(memFs, compressed.entry, shell, experienceSettings, filename);
        return {
            exportMap: compressed.entry.exportMap,
            cacheHit: compressed.cacheHit,
            sogBuildMs: compressed.sogBuildMs,
            cacheLookupMs: compressed.cacheLookupMs,
            sogBuildCount: compressed.sogBuildCount,
            htmlBundleMs: 0
        };
    }

    const bundleStartedAt = performance.now();
    console.log('[SCA EXPORT] building html-bundle from cached SOG');
    const encoder = new TextEncoder();
    memFs.results.set(
        filename,
        encoder.encode(assembleBundledViewerHtml(shell, compressed.entry.indexSog, experienceSettings))
    );
    htmlBundleMs = Math.round(performance.now() - bundleStartedAt);
    return {
        exportMap: compressed.entry.exportMap,
        cacheHit: compressed.cacheHit,
        sogBuildMs: compressed.sogBuildMs,
        cacheLookupMs: compressed.cacheLookupMs,
        sogBuildCount: compressed.sogBuildCount,
        htmlBundleMs
    };
};

const clearSogExportCache = (): void => {
    geometryCache = null;
    viewerShellCache = null;
    sessionSogBuildCount = 0;
};

const getSogGeometryFingerprintInputs = (): string[] => {
    return [
        'sogCompressionMode',
        'iterations',
        'serializeSettings.maxSHBands',
        'serializeSettings.selected',
        'serializeSettings.minOpacity',
        'serializeSettings.removeInvalid',
        'serializeSettings.keepWorldTransform',
        'serializeSettings.keepColorTint',
        'per-splat scaSplatId + entity transform',
        'per-splat vertex property storage buffers'
    ];
};

export {
    EnsureCompressedSogResult,
    SogGeometryCacheEntry,
    ViewerOutputFormat,
    WriteViewerExportResult,
    clearSogExportCache,
    computeSogGeometryCacheKey,
    getSogGeometryFingerprintInputs,
    writeViewerExportWithCachedSog
};
