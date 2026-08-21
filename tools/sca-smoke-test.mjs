/**
 * End-to-end smoke test for SCA runtime package export + viewer behavior.
 * Run: npx tsx tools/sca-smoke-test.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tools', 'smoke-out');
const ZIP_PATH = path.join(OUT_DIR, 'sca-runtime-package.zip');
const EDITOR_URL = 'http://127.0.0.1:4173/index.html';
const FIXTURE_PLY = path.join(ROOT, 'tools', 'fixtures', 'dragon.compressed.ply');
const DIST_PLY = path.join(ROOT, 'dist', 'test-assets', 'dragon.compressed.ply');
const PLY_URL = 'http://127.0.0.1:4173/test-assets/dragon.compressed.ply';
const SERVE_PORT = 4174;

const makeHotspot = (id, name, position) => ({
    id,
    name,
    text: `${name} description`,
    position,
    enabled: true,
    visual: { type: 'annotation', visible: true },
    hover: { enabled: false },
    click: {
        enabled: true,
        action: { type: 'event', eventName: 'hotspotClicked' }
    },
    camera: {
        initial: {
            position: [0, 1.5, -2],
            target: [...position],
            fov: 45
        }
    }
});

const TEST_PROJECT = {
    version: 1,
    hotspots: [
        makeHotspot('hotspot_01', 'Hotspot 01', [0.4, 0.2, 0.1]),
        makeHotspot('hotspot_02', 'Hotspot 02', [-0.5, 0.15, -0.2])
    ],
        viewer: {
            camera: {
                initial: {
                    position: [0, 1, -1.5],
                    target: [0, 0, 0],
                    fov: 60
                },
                animation: { type: 'none', duration: 1.5 }
            },
            navigation: {
                defaultMode: 'orbit',
                allowedModes: ['orbit']
            },
            interaction: {
                focusTransition: { duration: 0.8 },
                homeTransition: { duration: 1.0 }
            }
        }
};

const results = {
    export: { ok: false, error: null },
    preview: { ok: false, failures: [] },
    served: { ok: false, failures: [] },
    patch: { ok: false, error: null }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startStaticServer = (rootDir, port) => {
    const server = createServer((req, res) => {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const rel = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.join(rootDir, rel.replace(/^\//, ''));
        if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const types = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.sog': 'application/octet-stream',
            '.map': 'application/json'
        };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(readFileSync(filePath));
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
};

const startEditorServer = () => {
    const proc = spawn('npx', ['serve', 'dist', '-p', '4173', '-C'], {
        cwd: ROOT,
        shell: true,
        stdio: 'ignore'
    });
    return proc;
};

const unzipPackage = () => {
    const extractDir = path.join(OUT_DIR, 'package');
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${ZIP_PATH.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`,
        { stdio: 'inherit' }
    );
    return extractDir;
};

const assertPatchApplied = (packageDir) => {
    const indexJs = readFileSync(path.join(packageDir, 'index.js'), 'utf8');
    if (!indexJs.includes('lookAtTargetAnimatedWithoutMovingCamera')) {
        throw new Error('exported index.js missing lookAtTargetAnimatedWithoutMovingCamera patch');
    }
    if (!indexJs.includes('animateHomeTransition')) {
        throw new Error('exported index.js missing animateHomeTransition patch');
    }
    if (!indexJs.includes('interruptScaCameraAnimations')) {
        throw new Error('exported index.js missing interruptScaCameraAnimations patch');
    }
    if (indexJs.includes('scaLockedPivot')) {
        throw new Error('exported index.js still contains removed scaLockedPivot lock');
    }
    if (indexJs.includes('if (!scaLockedPivot)')) {
        throw new Error('exported index.js still contains removed pan pivot guard');
    }
    const settings = JSON.parse(readFileSync(path.join(packageDir, 'settings.json'), 'utf8'));
    if (!settings.annotations?.every((a) => a.camera?.initial)) {
        throw new Error('settings.json annotations missing camera data');
    }
    if (settings.navigation?.disableAnnotationCameraNavigation !== true) {
        throw new Error('settings.json missing disableAnnotationCameraNavigation');
    }
};

const exportViaEditor = async (playwright) => {
    const browser = await playwright.chromium.launch({
        headless: true,
        args: [
            '--enable-unsafe-webgpu',
            '--enable-features=WebGPU',
            '--use-angle=default'
        ]
    });

    const context = await browser.newContext({
        acceptDownloads: true
    });
    context.setDefaultTimeout(300000);
    const page = await context.newPage();
    page.setDefaultTimeout(300000);

    const browserLogs = [];
    page.on('console', (msg) => {
        const text = msg.text();
        browserLogs.push(text);
        if (text.includes('[SCA]') || text.includes('[SCA3D]') || text.includes('Error') ||
            text.includes('error') || text.includes('import')) {
            console.log(`[browser] ${text}`);
        }
    });

    page.on('pageerror', (err) => {
        console.error('[browser pageerror]', err.message);
    });

    const loadUrl = EDITOR_URL;
    console.log('[export] loading editor:', loadUrl);
    await page.goto(loadUrl, { waitUntil: 'load', timeout: 300000 });

    await page.waitForFunction(() => window.scene?.events, { timeout: 120000 });

    console.log('[export] importing local splat fixture');
    const importResult = await page.evaluate(async (url) => {
        try {
            await window.scene.events.invoke('import', [{
                filename: 'dragon.compressed.ply',
                url
            }]);
            const all = window.scene.events.invoke('scene.allSplats') || [];
            return {
                ok: true,
                allCount: all.length,
                nums: all.map((splat) => splat.numSplats)
            };
        } catch (error) {
            return { ok: false, error: String(error) };
        }
    }, PLY_URL);

    if (!importResult.ok) {
        throw new Error(`import failed: ${importResult.error}`);
    }
    console.log('[export] import result:', importResult);

    try {
        await page.waitForFunction(() => {
            const scene = window.scene;
            const splats = scene.events.invoke('scene.allSplats');
            return Array.isArray(splats) && splats.some((splat) => splat.numSplats > 0);
        }, { timeout: 120000 });
    } catch (error) {
        const state = await page.evaluate(() => {
            const scene = window.scene;
            if (!scene?.events) {
                return { hasScene: false };
            }
            const all = scene.events.invoke('scene.allSplats') || [];
            return {
                hasScene: true,
                allCount: all.length,
                exportableCount: (scene.events.invoke('scene.splats') || []).length,
                nums: all.map((s) => s.numSplats)
            };
        });
        console.error('[export] splat load state:', state);
        console.error('[export] recent browser logs:', browserLogs.slice(-20));
        throw error;
    }

    console.log('[export] splat loaded, configuring project');
    await page.evaluate((project) => {
        window.scene.events.fire('sca.project.load', project);
    }, TEST_PROJECT);

    await sleep(1000);

    const downloadPromise = page.waitForEvent('download', { timeout: 300000 });
    await page.evaluate(() => {
        window.scene.events.fire('sca.export.runtimePackage', true);
    });

    console.log('[export] waiting for package download...');
    const download = await downloadPromise;
    mkdirSync(OUT_DIR, { recursive: true });
    await download.saveAs(ZIP_PATH);

    await browser.close();
};

const TEST_HOOK = `
(() => {
  window.__SCA3D_TEST__ = {
    logs: [],
    postMessages: [],
    errors: [],
    navCursorVisible: () => {
      const svg = document.querySelector('svg[style*="pointer-events:none"]');
      if (!svg || svg.style.display === 'none') return false;
      const circles = svg.querySelectorAll('circle, ellipse');
      for (const c of circles) {
        const style = window.getComputedStyle(c);
        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.05) {
          return true;
        }
      }
      return false;
    }
  };
  window.addEventListener('error', (e) => window.__SCA3D_TEST__.errors.push(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) => window.__SCA3D_TEST__.errors.push(String(e.reason)));
  window.addEventListener('message', (e) => {
    if (e.data?.source === 'SCA3DViewer' && e.data?.type === 'hotspotClicked') {
      window.__SCA3D_TEST__.postMessages.push(e.data);
    }
  });
  window.addEventListener('sca3d:hotspotClicked', (e) => {
    window.__SCA3D_TEST__.postMessages.push({
      source: 'SCA3DViewer',
      type: 'hotspotClicked',
      payload: e.detail || {}
    });
  });
})();
`;

const readCameraDiagnostics = async (page) => page.evaluate(() => {
    const viewer = window.__testViewer;
    const cam = viewer?.cameraManager?.camera;
    if (!cam) {
        return null;
    }
    const radX = cam.angles.x * Math.PI / 180;
    const radY = cam.angles.y * Math.PI / 180;
    const cosx = Math.cos(radX);
    const sinx = Math.sin(radX);
    const cosy = Math.cos(radY);
    const siny = Math.sin(radY);
    const fx = -siny * cosx;
    const fy = sinx;
    const fz = -cosy * cosx;
    return {
        position: [cam.position.x, cam.position.y, cam.position.z],
        rotation: [cam.angles.x, cam.angles.y, cam.angles.z],
        pivot: [
            cam.position.x + fx * cam.distance,
            cam.position.y + fy * cam.distance,
            cam.position.z + fz * cam.distance
        ],
        fov: cam.fov ?? null
    };
});

const logDiagnostics = (label, diag) => {
    console.log(`[SCA3D TEST] ${label}`);
    console.log('position', diag?.position);
    console.log('rotation', diag?.rotation);
    console.log('pivot', diag?.pivot);
};

const vecNear = (a, b, eps = 0.02) => {
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    return a.every((v, i) => Math.abs(v - b[i]) <= eps);
};

const mod360 = (value) => ((value % 360) + 360) % 360;

const anglesNear = (a, b, eps = 0.08) => {
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        const da = mod360(a[i]);
        const db = mod360(b[i]);
        let diff = Math.abs(da - db);
        if (diff > 180) {
            diff = 360 - diff;
        }
        if (diff > eps) {
            return false;
        }
    }
    return true;
};

const computeLookAngles = (position, target) => {
    const [px, py, pz] = position;
    const [tx, ty, tz] = target;
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= 1e-6) {
        return [0, 0, 0];
    }
    const dirX = dx / dist;
    const dirY = dy / dist;
    const dirZ = dz / dist;
    const horizLenSq = dirX * dirX + dirZ * dirZ;
    const x = Math.asin(Math.max(-1, Math.min(1, dirY))) * (180 / Math.PI);
    const y = horizLenSq > 1e-8 ? Math.atan2(-dirX, -dirZ) * (180 / Math.PI) : 0;
    return [x, y, 0];
};

const cameraLooksAt = (position, rotation, target, eps = 0.08) => {
    const expected = computeLookAngles(position, target);
    return anglesNear(rotation, expected, eps);
};

const distanceBetween = (a, b) => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const activateHotspot = async (page, hotspotId) => {
    return page.evaluate((id) => {
        const viewer = window.__testViewer;
        const annotations = viewer.global.settings.annotations;
        const annotation = annotations.find((entry) => entry?.extras?.id === id);
        if (!annotation) {
            throw new Error(`annotation not found for ${id}`);
        }
        viewer.global.events.fire('annotation.activate', annotation);
        return annotation.position;
    }, hotspotId);
};

const deactivateHotspot = async (page) => {
    await page.evaluate(() => {
        window.__testViewer.global.events.fire('annotation.deactivate');
    });
};

const orbitDrag = async (page, dx = 200, dy = 30) => {
    const canvas = page.locator('#application-canvas');
    const box = await canvas.boundingBox();
    if (!box) {
        throw new Error('canvas not found for orbit drag');
    }
    const startX = box.x + box.width * 0.5;
    const startY = box.y + box.height * 0.5;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
    await page.mouse.up({ button: 'left' });
    await sleep(600);
};

const waitForViewerReady = async (page) => {
    await page.waitForFunction(() => {
        const viewer = window.SCA3D?.state?.viewer;
        return viewer?.lookAtTargetAnimatedWithoutMovingCamera &&
            viewer?.animateHomeTransition &&
            viewer?.cameraManager?.animateHomeTransition &&
            viewer?.interruptScaCameraAnimations &&
            viewer?.global?.state?.loaded;
    }, { timeout: 180000 });
    await page.evaluate(() => {
        window.__testViewer = window.SCA3D.state.viewer;
    });
};

const runViewerScenario = async (playwright, label, openPage) => {
    const failures = [];
    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });
    const context = await browser.newContext();
    context.setDefaultTimeout(300000);
    const page = await context.newPage();
    page.setDefaultTimeout(300000);
    page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[SCA3D TEST]') || text.includes('[SCA3D] hotspotClicked')) {
            console.log(`[${label}] ${text}`);
        }
    });
    page.on('pageerror', (err) => {
        if (err.message.includes('setPointerCapture') || err.message.includes('releasePointerCapture')) {
            return;
        }
        failures.push(`pageerror: ${err.message}`);
    });

    await page.addInitScript(TEST_HOOK);
    await openPage(page);
    await waitForViewerReady(page);

    const uiState = await page.evaluate(() => ({
        playHidden: document.getElementById('play')?.classList.contains('hidden'),
        pauseHidden: document.getElementById('pause')?.classList.contains('hidden'),
        timelineHidden: document.getElementById('timelineContainer')?.classList.contains('hidden'),
        flyHidden: document.getElementById('flyCamera')?.classList.contains('hidden'),
        walkHidden: document.getElementById('fpsCamera')?.classList.contains('hidden')
    }));

    if (!uiState.playHidden || !uiState.pauseHidden || !uiState.timelineHidden) {
        failures.push('animation UI visible while animation.type=none');
    }
    if (!uiState.flyHidden || !uiState.walkHidden) {
        failures.push('disabled camera modes not hidden');
    }

    const before01 = await readCameraDiagnostics(page);
    logDiagnostics(`${label} before hotspot_01`, before01);

    await page.evaluate(() => {
      window.__SCA3D_TEST__.postMessages = [];
    });

    await activateHotspot(page, 'hotspot_01');
    await sleep(900);

    const after01 = await readCameraDiagnostics(page);
    logDiagnostics(`${label} after hotspot_01`, after01);

    const testState = await page.evaluate(() => window.__SCA3D_TEST__);
    if (testState.errors.length > 0) {
        failures.push(`console errors: ${testState.errors.join('; ')}`);
    }
    if (!vecNear(before01.position, after01.position)) {
        failures.push(`camera position changed on hotspot_01 select: before=${before01.position} after=${after01.position}`);
    }
    const expectedLook01 = computeLookAngles(after01.position, [0.4, 0.2, 0.1]);
    if (!cameraLooksAt(after01.position, after01.rotation, [0.4, 0.2, 0.1])) {
        failures.push(`camera rotation not looking at hotspot_01: expected=${expectedLook01} actual=${after01.rotation}`);
    }
    if (vecNear(before01.rotation, after01.rotation, 0.02)) {
        failures.push('camera rotation unchanged on hotspot_01 select (expected reorientation toward hotspot)');
    }
    const clicks01 = testState.postMessages.filter((m) => m.payload?.hotspotId === 'hotspot_01');
    if (clicks01.length !== 1) {
        failures.push(`hotspotClicked count for hotspot_01 expected 1 got ${clicks01.length}`);
    }
    const cardVisible = await page.evaluate(() => {
        const nav = document.getElementById('annotationNav');
        return nav && !nav.classList.contains('hidden');
    });
    if (!cardVisible) {
        failures.push('annotation card/nav not visible after hotspot_01 select');
    }
    if (await page.evaluate(() => window.__SCA3D_TEST__.navCursorVisible())) {
        failures.push('NavCursor white ring visible after hotspot_01 select');
    }

    const homeButtonState = await page.evaluate(() => {
        const button = document.getElementById('scaHomeView');
        return {
            exists: !!button,
            title: button?.getAttribute('title') ?? null,
            visible: !!(button && button.offsetParent !== null)
        };
    });
    if (!homeButtonState.exists || !homeButtonState.visible) {
        failures.push('scaHomeView button not visible in viewer controls');
    }
    if (homeButtonState.title !== 'Reset view') {
        failures.push(`scaHomeView tooltip expected "Reset view" got ${homeButtonState.title}`);
    }

    await orbitDrag(page, 200, 30);

    const canvas = page.locator('#application-canvas');
    const box = await canvas.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        await page.mouse.wheel(0, -240);
        await sleep(600);
    }
    const afterZoom = await readCameraDiagnostics(page);
    if (vecNear(after01.position, afterZoom.position, 0.02) &&
        vecNear(after01.rotation, afterZoom.rotation, 0.5)) {
        failures.push('wheel zoom after hotspot_01 did not move camera');
    }

    const before02 = await readCameraDiagnostics(page);
    logDiagnostics(`${label} before hotspot_02`, before02);
    await activateHotspot(page, 'hotspot_02');
    await sleep(900);
    const after02 = await readCameraDiagnostics(page);
    logDiagnostics(`${label} after hotspot_02`, after02);
    if (!vecNear(before02.position, after02.position)) {
      failures.push('camera moved when switching hotspot_01 -> hotspot_02');
    }
    if (!cameraLooksAt(after02.position, after02.rotation, [-0.5, 0.15, -0.2])) {
      failures.push(`camera not looking at hotspot_02 after switch: rotation=${after02.rotation}`);
    }

    const beforeDeselect = await readCameraDiagnostics(page);
    logDiagnostics(`${label} before deselect`, beforeDeselect);
    await deactivateHotspot(page);
    await sleep(300);
    const afterDeselect = await readCameraDiagnostics(page);
    logDiagnostics(`${label} after deselect`, afterDeselect);
    if (!vecNear(beforeDeselect.position, afterDeselect.position, 0.03)) {
      failures.push('camera moved on deselect');
    }
    if (!vecNear(beforeDeselect.rotation, afterDeselect.rotation, 0.15)) {
      failures.push('camera rotation changed on deselect');
    }

    await orbitDrag(page, -200, 15);
    const beforeHome = await readCameraDiagnostics(page);
    await page.evaluate(() => {
        document.getElementById('scaHomeView')?.click();
    });
    await sleep(1200);
    const afterHome = await readCameraDiagnostics(page);
    if (vecNear(beforeHome.position, afterHome.position, 0.02) &&
        vecNear(beforeHome.rotation, afterHome.rotation, 0.5)) {
        failures.push('home/reset button did not move camera');
    }
    if (!vecNear(afterHome.position, [0, 1, -1.5], 0.08)) {
        failures.push(`home/reset did not restore initial position: ${afterHome.position}`);
    }
    if (!cameraLooksAt(afterHome.position, afterHome.rotation, [0, 0, 0], 0.12)) {
        failures.push(`home/reset did not restore initial target look: rotation=${afterHome.rotation}`);
    }
    if (Math.abs((afterHome.fov ?? 0) - 60) > 1) {
        failures.push(`home/reset did not restore initial fov: ${afterHome.fov}`);
    }

    await browser.close();
    return failures;
};

async function main() {
    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    if (!existsSync(FIXTURE_PLY)) {
        throw new Error(`missing fixture PLY: ${FIXTURE_PLY}`);
    }
    mkdirSync(path.dirname(DIST_PLY), { recursive: true });
    cpSync(FIXTURE_PLY, DIST_PLY);

    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        console.log('[setup] installing playwright chromium...');
        execSync('npm install playwright --no-save', { cwd: ROOT, stdio: 'inherit' });
        execSync('npx playwright install chromium', { cwd: ROOT, stdio: 'inherit' });
        playwright = await import('playwright');
    }

    const editorProc = startEditorServer();
    await sleep(2000);

    try {
        await exportViaEditor(playwright);
        results.export.ok = true;
        console.log('[export] saved', ZIP_PATH);
    } catch (error) {
        results.export.error = error instanceof Error ? error.message : String(error);
        console.error('[export] failed:', results.export.error);
        throw error;
    } finally {
        editorProc.kill();
    }

    const packageDir = unzipPackage();
    try {
        assertPatchApplied(packageDir);
        results.patch.ok = true;
    } catch (error) {
        results.patch.error = error instanceof Error ? error.message : String(error);
        throw error;
    }

    const previewPath = path.join(packageDir, 'preview.html');
    const previewFailures = await runViewerScenario(playwright, 'preview.html', async (page) => {
        await page.goto(`file:///${previewPath.replace(/\\/g, '/')}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    });
    results.preview.failures = previewFailures;
    results.preview.ok = previewFailures.length === 0;

    const serveRoot = packageDir;
    const server = await startStaticServer(serveRoot, SERVE_PORT);
    try {
        const servedFailures = await runViewerScenario(playwright, 'index.html', async (page) => {
            await page.goto(`http://127.0.0.1:${SERVE_PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        });
        results.served.failures = servedFailures;
        results.served.ok = servedFailures.length === 0;
    } finally {
        server.close();
    }

    console.log('\n========== SCA SMOKE TEST REPORT ==========');
    console.log('Export:', results.export.ok ? 'PASS' : `FAIL (${results.export.error})`);
    console.log('Viewer patch in package:', results.patch.ok ? 'PASS' : `FAIL (${results.patch.error})`);
    console.log('preview.html (file://):', results.preview.ok ? 'PASS' : 'FAIL');
    if (results.preview.failures.length) {
        results.preview.failures.forEach((f) => console.log('  -', f));
    }
    console.log('index.html (served):', results.served.ok ? 'PASS' : 'FAIL');
    if (results.served.failures.length) {
        results.served.failures.forEach((f) => console.log('  -', f));
    }
    console.log('Hotspot camera data preserved:', results.patch.ok ? 'PASS' : 'FAIL');
    console.log('Orbit pivot + look-at focus:', (results.preview.ok && results.served.ok) ? 'PASS' : 'SEE FAILURES');
    console.log('NavCursor suppressed:', (results.preview.ok && results.served.ok) ? 'PASS' : 'SEE FAILURES');
    console.log('Storyline bridge:', (results.preview.ok && results.served.ok) ? 'PASS' : 'SEE FAILURES');
    console.log('===========================================\n');

    if (!results.export.ok || !results.patch.ok || !results.preview.ok || !results.served.ok) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
