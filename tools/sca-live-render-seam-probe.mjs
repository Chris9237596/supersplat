/**
 * Live render-seam comparison using existing rig-render-seam-probe hooks.
 * Inputs:
 *   sca-workspace/project/current.ssproj
 *   sca-workspace/runtime/latest/ (re-exported first)
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.join(ROOT, 'sca-workspace');
const SSPROJ_PATH = path.join(WORKSPACE, 'project/current.ssproj');
const RUNTIME_DIR = path.join(WORKSPACE, 'runtime/latest');
const EXPORT_ZIP = path.join(WORKSPACE, 'runtime/sca-runtime-package.zip');
const REPORT_PATH = path.join(WORKSPACE, 'compare/reports/live-render-seam-animation_01-rig_02-region_04-t0.5.json');

const EDITOR_PORT = 4317;
const RUNTIME_PORT = 4318;
const ASSET_PORT = 4319;
const EDITOR_URL = `http://127.0.0.1:${EDITOR_PORT}/index.html`;
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}/index.html`;
const SSPROJ_URL = `http://127.0.0.1:${ASSET_PORT}/current.ssproj`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const serveDir = (rootDir) => createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relativePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.resolve(rootDir, relativePath);
    const rootResolved = path.resolve(rootDir);
    if (!filePath.startsWith(rootResolved + path.sep) && filePath !== rootResolved) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    try {
        const data = readFileSync(filePath);
        const ext = path.extname(filePath);
        const mime = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.sog': 'application/octet-stream',
            '.mask': 'application/octet-stream',
            '.ssproj': 'application/octet-stream',
            '.zip': 'application/zip'
        };
        res.writeHead(200, {
            'Content-Type': mime[ext] ?? 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});

const startServer = (rootDir, port) => new Promise((resolve) => {
    const server = serveDir(rootDir);
    server.listen(port, '127.0.0.1', () => resolve(server));
});

const unzipExport = () => {
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
    mkdirSync(RUNTIME_DIR, { recursive: true });
    execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${EXPORT_ZIP.replace(/'/g, "''")}' -DestinationPath '${RUNTIME_DIR.replace(/'/g, "''")}' -Force"`,
        { stdio: 'inherit' }
    );
};

const exportRuntimePackage = async (playwright) => {
    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });
    const context = await browser.newContext({ acceptDownloads: true });
    context.setDefaultTimeout(300000);
    const page = await context.newPage();
    page.setDefaultTimeout(300000);

    await page.goto(EDITOR_URL, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.scene?.events, { timeout: 120000 });

    const loadResult = await page.evaluate(async (url) => {
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const ok = await window.scene.events.invoke('doc.load', buffer);
            return { ok: !!ok };
        } catch (error) {
            return { ok: false, error: String(error) };
        }
    }, SSPROJ_URL);

    if (!loadResult.ok) {
        throw new Error(`doc.load failed: ${loadResult.error ?? 'unknown'}`);
    }

    await page.waitForFunction(() => {
        const splats = window.scene?.events?.invoke('scene.splats');
        return Array.isArray(splats) && splats.length > 0 && splats[0].numSplats > 0;
    }, { timeout: 180000 });

    await sleep(1500);

    const downloadPromise = page.waitForEvent('download', { timeout: 600000 });
    await page.evaluate(() => {
        window.scene.events.fire('sca.export.runtimePackage', true);
    });
    const download = await downloadPromise;
    mkdirSync(path.dirname(EXPORT_ZIP), { recursive: true });
    await download.saveAs(EXPORT_ZIP);
    await browser.close();
};

const captureEditorSeam = async (playwright) => {
    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[SCA RENDER SEAM PROBE]')) {
            console.log(`[editor] ${text}`);
        }
    });

    await page.goto(EDITOR_URL, { waitUntil: 'load', timeout: 180000 });
    await page.waitForFunction(() => window.scene?.events, { timeout: 120000 });

    const loadResult = await page.evaluate(async (url) => {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        return !!(await window.scene.events.invoke('doc.load', buffer));
    }, SSPROJ_URL);

    if (!loadResult) {
        throw new Error('editor doc.load failed');
    }

    await page.waitForFunction(() => {
        const splats = window.scene?.events?.invoke('scene.splats');
        return Array.isArray(splats) && splats.length > 0 && splats[0].numSplats > 0;
    }, { timeout: 180000 });

    await page.evaluate(() => {
        const events = window.scene.events;
        events.fire('sca.animation.setActiveClip', 'animation_01');
        events.fire('sca.animation.setCurrentTime', 0.5);
    });

    await page.waitForFunction(() => {
        const store = window.SCA3D?.renderSeamProbe;
        return !!store?.editor;
    }, { timeout: 60000 });

    const editorCapture = await page.evaluate(() => window.SCA3D.renderSeamProbe.editor);
    await browser.close();
    return editorCapture;
};

const waitForRuntimeReady = async (page) => {
    await page.waitForFunction(() => {
        const viewer = window.SCA3D?.state?.viewer;
        const lookup = window.SCA3D?.state?.regionLookup;
        const loaded = viewer?.global?.state?.loaded;
        const pickerReady = typeof viewer?.pickGaussian === 'function';
        const animReady = window.SCA3D?.state?.runtimeAnimationReady === true;
        return loaded && pickerReady && lookup?.entries?.length > 0 && animReady;
    }, { timeout: 180000 });
};

const captureRuntimeSeam = async (playwright, editorCapture) => {
    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);

    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[SCA RENDER SEAM PROBE]') || text.includes('[SCA RUNTIME RIG] apply')) {
            console.log(`[runtime] ${text}`);
        }
    });

    await page.goto(RUNTIME_URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForRuntimeReady(page);

    await page.evaluate(() => {
        window.SCA3D.playAnimation('animation_01');
    });

    await page.waitForFunction(() => {
        const capture = window.SCA3D?.renderSeamProbe?.runtime;
        return !!capture && capture.playbackTime >= 0.45 && capture.playbackTime <= 0.55;
    }, { timeout: 30000 });

    await page.evaluate(() => {
        const app = window.SCA3D?.state?.viewer?.global?.app;
        if (app) {
            app.renderNextFrame = 1;
        }
    });

    await page.waitForFunction(() => {
        const capture = window.SCA3D?.renderSeamProbe?.runtime;
        return !!capture && capture.playbackTime >= 0.45 && capture.playbackTime <= 0.55;
    }, { timeout: 10000 });

    const comparison = await page.evaluate((editor) => {
        window.SCA3D.renderSeamProbe = window.SCA3D.renderSeamProbe || { editor: null, runtime: null, firstDivergence: null };
        window.SCA3D.renderSeamProbe.editor = editor;
        return window.SCA3D.compareRenderSeamProbe();
    }, editorCapture);

    await browser.close();
    return comparison;
};

const pickFields = (capture) => ({
    localCenterShaderSource: capture?.localCenterShaderSource ?? null,
    transformIndexTexel: capture?.transformIndexTexel ?? null,
    paletteMatrixFromTexture: capture?.paletteMatrixFromTexture ?? null,
    matrixModel: capture?.matrixModel ?? null,
    matrixView: capture?.matrixView ?? null,
    matrixProjection: capture?.matrixProjection ?? null,
    worldCenterPredicted: capture?.worldCenterPredicted ?? null,
    screenPosPredicted: capture?.screenPosPredicted ?? null,
    playbackTime: capture?.playbackTime ?? null,
    gaussianIndex: capture?.gaussianIndex ?? null
});

const main = async () => {
    if (!existsSync(SSPROJ_PATH)) {
        throw new Error(`missing ${SSPROJ_PATH}`);
    }

    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        const { execSync } = await import('node:child_process');
        execSync('npm install playwright --no-save', { cwd: ROOT, stdio: 'inherit' });
        execSync('npx playwright install chromium', { cwd: ROOT, stdio: 'inherit' });
        playwright = await import('playwright');
    }

    const editorServer = await startServer(path.join(ROOT, 'dist'), EDITOR_PORT);
    const assetServer = await startServer(path.join(WORKSPACE, 'project'), ASSET_PORT);
    await sleep(500);

    try {
        console.log('[export] exporting runtime package from editor...');
        await exportRuntimePackage(playwright);
        console.log('[export] unzipping to runtime/latest...');
        await unzipExport();
    } finally {
        editorServer.close();
        assetServer.close();
    }

    const runtimeServer = await startServer(RUNTIME_DIR, RUNTIME_PORT);
    const editorServer2 = await startServer(path.join(ROOT, 'dist'), EDITOR_PORT);
    const assetServer2 = await startServer(path.join(WORKSPACE, 'project'), ASSET_PORT);

    try {
        console.log('[probe] capturing editor render seam at t≈0.5...');
        const editorCapture = await captureEditorSeam(playwright);
        console.log('[probe] capturing runtime render seam at t≈0.5...');
        const comparison = await captureRuntimeSeam(playwright, editorCapture);

        const report = {
            target: {
                animationClipId: 'animation_01',
                nodeId: 'rig_02',
                regionId: 'region_04',
                sampleTime: 0.5
            },
            runtimePackage: EXPORT_ZIP,
            firstDivergence: comparison.firstDivergence ?? null,
            ready: comparison.ready,
            editor: pickFields(comparison.editor),
            runtime: pickFields(comparison.runtime)
        };

        mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify(report, null, 2));
    } finally {
        runtimeServer.close();
        editorServer2.close();
        assetServer2.close();
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
