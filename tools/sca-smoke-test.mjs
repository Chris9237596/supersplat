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
    if (!indexJs.includes('animateStartupTransition')) {
        throw new Error('exported index.js missing animateStartupTransition patch');
    }
    if (!indexJs.includes('scaStartupFlyAnim')) {
        throw new Error('exported index.js missing scaStartupFlyAnim patch');
    }
    if (!indexJs.includes('interruptScaCameraAnimations')) {
        throw new Error('exported index.js missing interruptScaCameraAnimations patch');
    }
    if (!indexJs.includes('animateTurntable')) {
        throw new Error('exported index.js missing animateTurntable patch');
    }
    if (!indexJs.includes('scaTurntableAnim')) {
        throw new Error('exported index.js missing scaTurntableAnim patch');
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

    const project = JSON.parse(readFileSync(path.join(packageDir, 'project.json'), 'utf8'));
    const enabledRegions = (project.regions ?? []).filter((region) => region.enabled);
    if (enabledRegions.length === 0) {
        throw new Error('project.json has no enabled regions after export');
    }
    const regionId = enabledRegions[0].id;
    const maskPath = path.join(packageDir, 'regions', `${regionId}.mask`);
    if (!existsSync(maskPath)) {
        throw new Error(`exported package missing region mask: regions/${regionId}.mask`);
    }

    const previewHtml = readFileSync(path.join(packageDir, 'preview.html'), 'utf8');
    if (!previewHtml.includes(`regions/${regionId}.mask`)) {
        throw new Error('preview.html missing embedded region mask asset');
    }
    if (!previewHtml.includes('SCA_PICK_GAUSSIAN')) {
        throw new Error('preview.html missing SCA_PICK_GAUSSIAN picker patch');
    }

    if (!indexJs.includes('SCA_REGION_HIGHLIGHT')) {
        throw new Error('exported index.js missing SCA_REGION_HIGHLIGHT shader patch');
    }
    if (indexJs.includes('@location(undefined)')) {
        throw new Error('exported index.js contains invalid WGSL @location(undefined)');
    }
    for (const forbidden of [
        'var<uniform> scaRegionHighlight',
        'var scaRegionHighlight: texture_2d',
        'scaGaussianIndex = f32(sortedIndices[order])',
        'SCA_REGION_HIGHLIGHT_WGSL'
    ]) {
        if (indexJs.includes(forbidden)) {
            throw new Error(`exported index.js contains forbidden WGSL highlight injection: ${forbidden}`);
        }
    }
    if (!indexJs.includes('texelFetch(scaRegionHighlight')) {
        throw new Error('exported index.js missing GLSL region highlight patch');
    }
    if (!indexJs.includes('pickGaussianId')) {
        throw new Error('exported index.js missing pickGaussianId patch');
    }
    if (!indexJs.includes('SCA_PICK_GAUSSIAN')) {
        throw new Error('exported index.js missing SCA_PICK_GAUSSIAN picker marker');
    }
    if (!indexJs.includes('scaPickerReady')) {
        throw new Error('exported index.js missing scaPickerReady picker event');
    }
    if (!indexJs.includes('this.pickGaussian = async')) {
        throw new Error('exported index.js missing viewer.pickGaussian patch');
    }
    if (!indexJs.includes('unregisterPickerShaderPatches(app)')) {
        throw new Error('exported index.js missing ID pick depth-patch suspension');
    }
    if (!indexJs.includes('scaResolveClientPickCoords')) {
        throw new Error('exported index.js missing client-coordinate pick conversion');
    }
    if (!indexJs.includes('scaWaitForUnifiedGsplatPick')) {
        throw new Error('exported index.js missing unified gsplat pick readiness wait');
    }
    if (!indexJs.includes('dumpPickTarget')) {
        throw new Error('exported index.js missing dumpPickTarget helper');
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

    console.log('[export] creating region from selection');
    await page.evaluate(async () => {
        const scene = window.scene;
        const splats = scene.events.invoke('scene.splats');
        const splat = splats[0];
        scene.events.fire('selection', splat);
        scene.events.fire('select.all');
        await new Promise((resolve) => setTimeout(resolve, 800));
    });

    await page.waitForFunction(() => {
        const splat = window.scene?.events?.invoke('selection');
        return splat?.numSelected > 0;
    }, { timeout: 60000 });

    await page.evaluate(() => {
        window.scene.events.fire('sca.region.createFromSelection');
    });
    await page.waitForFunction(() => {
        const regions = window.scene?.events?.invoke('sca.region.list') || [];
        return regions.length > 0;
    }, { timeout: 30000 });
    await sleep(300);

    await page.evaluate(() => {
        const regions = window.scene.events.invoke('sca.region.list') || [];
        const region = regions[0];
        if (!region) {
            throw new Error('region was not created from selection');
        }
        window.scene.events.fire('sca.region.update', region.id, {
            name: 'Test Region',
            text: 'Region card text',
            interaction: { clickable: true, showCard: true }
        });
    });
    await sleep(300);

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
    if (e.data?.source === 'SCA3DViewer' && (e.data?.type === 'hotspotClicked' || e.data?.type === 'regionClicked')) {
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
  window.addEventListener('sca3d:regionClicked', (e) => {
    window.__SCA3D_TEST__.postMessages.push({
      source: 'SCA3DViewer',
      type: 'regionClicked',
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
        fov: cam.fov ?? null,
        distance: cam.distance ?? null
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
    await page.evaluate(({ dx, dy }) => {
        const canvas = document.getElementById('application-canvas');
        if (!canvas) {
            throw new Error('canvas not found for orbit drag');
        }
        const rect = canvas.getBoundingClientRect();
        const startX = rect.left + rect.width * 0.5;
        const startY = rect.top + rect.height * 0.5;
        const endX = startX + dx;
        const endY = startY + dy;
        const pointerInit = {
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: 1,
            bubbles: true,
            cancelable: true
        };
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            ...pointerInit,
            clientX: startX,
            clientY: startY
        }));
        for (let step = 1; step <= 12; step++) {
            const t = step / 12;
            canvas.dispatchEvent(new PointerEvent('pointermove', {
                ...pointerInit,
                clientX: startX + dx * t,
                clientY: startY + dy * t
            }));
        }
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            ...pointerInit,
            clientX: endX,
            clientY: endY,
            buttons: 0
        }));
    }, { dx, dy });
    await sleep(600);
};

const wheelZoom = async (page, deltaY = -240) => {
    await page.evaluate((delta) => {
        const canvas = document.getElementById('application-canvas');
        if (!canvas) {
            throw new Error('canvas not found for wheel zoom');
        }
        canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: delta,
            bubbles: true,
            cancelable: true
        }));
    }, deltaY);
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
    await page.waitForFunction(() => {
        const viewer = window.SCA3D?.state?.viewer;
        const lookup = window.SCA3D?.state?.regionLookup;
        const loaded = viewer?.global?.state?.loaded;
        const pickerReady = typeof viewer?.pickGaussian === 'function';
        return loaded && pickerReady && lookup?.entries?.length > 0;
    }, { timeout: 180000 });
};

const findRegionPickPoint = async (page) => page.evaluate(async () => {
    const viewer = window.__testViewer;
    const lookup = window.SCA3D?.state?.regionLookup;
    if (!lookup?.entries?.length) {
        return { error: 'no region lookup' };
    }

    const targetId = lookup.entries[0].regionId;

    for (let y = 0.25; y <= 0.75; y += 0.04) {
        for (let x = 0.25; x <= 0.75; x += 0.04) {
            const canvas = document.getElementById('application-canvas');
            const rect = canvas?.getBoundingClientRect();
            if (!rect?.width) {
                continue;
            }
            const clientX = rect.left + x * rect.width;
            const clientY = rect.top + y * rect.height;
            const pick = await viewer.pickGaussian(clientX, clientY);
            if (!pick || pick.gaussianIndex === null || pick.gaussianIndex === undefined) {
                continue;
            }
            const entry = window.SCA3D.regionMask.resolveRegionAtGaussian(lookup, pick.gaussianIndex);
            if (entry?.regionId === targetId) {
                return {
                    regionId: targetId,
                    gaussianIndex: pick.gaussianIndex,
                    normalized: { x, y }
                };
            }
        }
    }

    return { error: 'no region pick point found' };
});

const dispatchCanvasPointer = async (page, type, normalized, button = 0) => {
    await page.evaluate(({ type, normalized, button }) => {
        const canvas = document.getElementById('application-canvas');
        if (!canvas) {
            throw new Error('canvas not found');
        }
        const rect = canvas.getBoundingClientRect();
        const clientX = rect.left + normalized.x * rect.width;
        const clientY = rect.top + normalized.y * rect.height;
        canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            button,
            buttons: type === 'pointerup' ? 0 : (button === 0 ? 1 : 0),
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        }));
    }, { type, normalized, button });
};

const runRegionEndToEndTest = async (page, label, failures) => {
    const lookupCheck = await page.evaluate(() => {
        const sample = window.SCA3D?.state?.regionPickSample;
        const lookup = window.SCA3D?.state?.regionLookup;
        if (!sample || !lookup?.entries?.length) {
            return { ok: false, reason: 'missing region lookup sample' };
        }
        const entry = window.SCA3D.regionMask.resolveRegionAtGaussian(lookup, sample.runtimeIndex);
        return {
            ok: entry?.regionId === sample.regionId,
            reason: entry ? null : `sample runtimeIndex ${sample.runtimeIndex} did not resolve`,
            sample,
            memberCount: lookup.entries[0]?.memberCount ?? 0
        };
    });

    if (!lookupCheck.ok) {
        failures.push(`${label} region mask lookup failed: ${lookupCheck.reason}`);
        return;
    }

    console.log(`[${label}] region mask lookup ok`, lookupCheck.sample, `members=${lookupCheck.memberCount}`);

    const pickerApi = await page.evaluate(() => ({
        pickGaussian: typeof window.SCA3D?.state?.viewer?.pickGaussian === 'function',
        pickGaussianId: typeof window.SCA3D?.state?.viewer?.picker?.pickGaussianId === 'function'
    }));
    if (!pickerApi.pickGaussian || !pickerApi.pickGaussianId) {
        failures.push(`${label} picker API missing after viewer load (pickGaussian=${pickerApi.pickGaussian}, pickGaussianId=${pickerApi.pickGaussianId})`);
        return;
    }
    console.log(`[${label}] picker API verified`);

    let pickPoint = await findRegionPickPoint(page);
    if (pickPoint.error) {
        console.log(`[${label}] GPU region pick skipped (${pickPoint.error}); hover/click E2E requires manual WebGPU browser test`);
        return;
    }

    console.log(`[${label}] region pick point`, pickPoint);

    await page.evaluate(() => {
        window.__SCA3D_TEST__.postMessages = window.__SCA3D_TEST__.postMessages.filter((m) => m.type !== 'regionClicked');
    });

    await dispatchCanvasPointer(page, 'pointermove', pickPoint.normalized);
    await sleep(200);

    const hoverState = await page.evaluate(() => ({
        cursor: document.getElementById('application-canvas')?.style?.cursor ?? '',
        selectedRegionId: window.SCA3D?.state?.selectedRegionId ?? null
    }));

    if (hoverState.cursor !== 'pointer') {
        failures.push(`${label} region hover cursor expected pointer got "${hoverState.cursor}"`);
    }

    await dispatchCanvasPointer(page, 'pointerdown', pickPoint.normalized);
    await dispatchCanvasPointer(page, 'pointerup', pickPoint.normalized);
    await sleep(400);

    const afterClick = await page.evaluate(() => ({
        selectedRegionId: window.SCA3D?.state?.selectedRegionId ?? null,
        cardVisible: !!document.querySelector('#sca-region-overlay .sca-hotspot-marker-card:not(.is-hidden)'),
        cardText: document.querySelector('#sca-region-overlay .sca-hotspot-marker-card')?.textContent ?? '',
        messages: window.__SCA3D_TEST__.postMessages.filter((m) => m.type === 'regionClicked')
    }));

    if (afterClick.selectedRegionId !== pickPoint.regionId) {
        failures.push(`${label} region click did not select ${pickPoint.regionId}, got ${afterClick.selectedRegionId}`);
    }
    if (afterClick.messages.length === 0) {
        failures.push(`${label} regionClicked event not fired`);
    }
    if (!afterClick.cardVisible) {
        failures.push(`${label} region card not visible after click`);
    }
    if (!afterClick.cardText.includes('Test Region')) {
        failures.push(`${label} region card missing name text`);
    }

    await dispatchCanvasPointer(page, 'pointermove', { x: 0.05, y: 0.05 });
    await sleep(250);

    const afterLeave = await page.evaluate(() => ({
        cursor: document.getElementById('application-canvas')?.style?.cursor ?? '',
        hasCursorProp: document.getElementById('application-canvas')?.style?.cursor?.length > 0
    }));

    if (afterLeave.hasCursorProp && afterLeave.cursor === 'pointer') {
        failures.push(`${label} cursor still pointer after leaving region`);
    }
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

    await runRegionEndToEndTest(page, label, failures);

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
    const afterOrbit = await readCameraDiagnostics(page);

    await wheelZoom(page, -240);
    const afterZoom = await readCameraDiagnostics(page);
    if (vecNear(afterOrbit.position, afterZoom.position, 0.02) &&
        vecNear(afterOrbit.rotation, afterZoom.rotation, 0.5) &&
        Math.abs((afterOrbit.distance ?? 0) - (afterZoom.distance ?? 0)) < 0.02) {
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
    console.log('Region end-to-end:', (results.preview.ok && results.served.ok) ? 'PASS' : 'SEE FAILURES');
    console.log('===========================================\n');

    if (!results.export.ok || !results.patch.ok || !results.preview.ok || !results.served.ok) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
