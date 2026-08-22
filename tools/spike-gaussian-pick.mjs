/**
 * SPIKE ONLY — compare Option A (splat.index pick pass) vs Option B (engine compute pick).
 * Run: npm run test:spike-gaussian-pick
 *
 * Does not modify production export patches or region runtime.
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySpikeSplatIndexPickPatch } from './spike/splat-index-pick-patch.ts';
import { runEnginePickSurvey } from './spike/engine-pick-survey.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SPIKE_OUT = path.join(ROOT, 'tools', 'spike-out');
const SOURCE_INDEX = path.join(ROOT, 'tools', 'smoke-out', 'package', 'index.js');
const SPIKE_INDEX = path.join(SPIKE_OUT, 'index.spike-a.js');
const REPORT_PATH = path.join(SPIKE_OUT, 'GAUSSIAN-PICK-SPIKE-REPORT.md');
const SERVE_PORT = 4188;

const ensureSmokePackage = () => {
    if (!existsSync(SOURCE_INDEX)) {
        console.log('[spike] smoke-out package missing — running sca-smoke-test export stage...');
        execSync('npx tsx tools/sca-smoke-test.mjs', { cwd: ROOT, stdio: 'inherit' });
    }
    if (!existsSync(SOURCE_INDEX)) {
        throw new Error('[spike] tools/smoke-out/package/index.js not found after smoke export');
    }
};

const buildOptionASpikeBundle = async () => {
    ensureSmokePackage();
    const source = readFileSync(SOURCE_INDEX, 'utf8');
    const spikeSource = applySpikeSplatIndexPickPatch(source);
    mkdirSync(SPIKE_OUT, { recursive: true });
    writeFileSync(SPIKE_INDEX, spikeSource, 'utf8');
    return spikeSource.includes('SCA_SPIKE_SPLAT_INDEX_PICK');
};

const startSpikeServer = () => {
    const pkgDir = path.join(ROOT, 'tools', 'smoke-out', 'package');
    const server = createServer((req, res) => {
        const url = req.url?.split('?')[0] ?? '/';
        let filePath = path.join(pkgDir, url === '/' ? 'index.html' : url.replace(/^\//, ''));
        if (url === '/index.js' || url.endsWith('/index.js')) {
            filePath = SPIKE_INDEX;
        }
        if (!existsSync(filePath)) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const ext = path.extname(filePath);
        const types = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.sog': 'application/octet-stream',
            '.mask': 'application/octet-stream'
        };
        res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
        res.end(readFileSync(filePath));
    });
    return new Promise((resolve, reject) => {
        server.listen(SERVE_PORT, '127.0.0.1', () => {
            resolve({ server, url: `http://127.0.0.1:${SERVE_PORT}/preview.html` });
        });
        server.on('error', reject);
    });
};

const runOptionABrowserSpike = async (previewUrl) => {
    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        return {
            ran: false,
            reason: 'playwright not installed — run: npx playwright install chromium',
            webgpu: null,
            depthPickWorks: null,
            gaussianPickHits: 0,
            sampleIndices: [] ,
            pickTargetNonZero: null
        };
    }

    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });

    try {
        const page = await browser.newPage();
        await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 180000 });
        await page.waitForFunction(() => {
            const viewer = window.SCA3D?.state?.viewer;
            return viewer?.global?.state?.loaded && typeof viewer?.pickGaussian === 'function';
        }, { timeout: 180000 });

        const webgpu = await page.evaluate(() => {
            const gd = window.SCA3D?.state?.viewer?.global?.app?.graphicsDevice;
            return !!gd?.isWebGPU;
        });

        const depthPick = await page.evaluate(async () => {
            const viewer = window.SCA3D.state.viewer;
            const canvas = document.getElementById('application-canvas');
            const rect = canvas?.getBoundingClientRect();
            if (!rect?.width) {
                return { ok: false, reason: 'no canvas' };
            }
            const nx = 0.5;
            const ny = 0.5;
            const pos = await viewer.picker.pick(nx, ny);
            return { ok: !!pos, position: pos ? [pos.x, pos.y, pos.z] : null };
        });

        const gridScan = await page.evaluate(async () => {
            window.SCA3D.pickPassDebug = true;
            const viewer = window.SCA3D.state.viewer;
            const canvas = document.getElementById('application-canvas');
            const rect = canvas?.getBoundingClientRect();
            if (!rect?.width) {
                return { hits: [], grid: null };
            }
            const hits = [];
            for (let y = 0.2; y <= 0.8; y += 0.08) {
                for (let x = 0.2; x <= 0.8; x += 0.08) {
                    const clientX = rect.left + x * rect.width;
                    const clientY = rect.top + y * rect.height;
                    const pick = await viewer.pickGaussian(clientX, clientY);
                    if (pick?.gaussianIndex !== null && pick?.gaussianIndex !== undefined) {
                        hits.push({
                            x,
                            y,
                            gaussianIndex: pick.gaussianIndex,
                            rawRGBA: pick.rawRGBA ?? []
                        });
                    }
                }
            }
            const grid = await viewer.picker?.dumpPickTarget?.();
            return { hits, grid };
        });

        return {
            ran: true,
            reason: null,
            webgpu,
            depthPickWorks: depthPick.ok,
            depthPickPosition: depthPick.position,
            gaussianPickHits: gridScan.hits.length,
            sampleIndices: gridScan.hits.slice(0, 8).map((h) => h.gaussianIndex),
            sampleRaw: gridScan.hits.slice(0, 3),
            pickTargetNonZero: gridScan.grid?.nonZeroPixels ?? null,
            pickPassDiag: gridScan.grid?.pickPassDiag ?? null
        };
    } finally {
        await browser.close();
    }
};

const writeReport = (optionA, optionB, spikeApplied) => {
    const lines = [];
    lines.push('# Gaussian Pick Architecture Spike Report');
    lines.push('');
    lines.push('> SPIKE ONLY — not production. Do not merge until decision is made.');
    lines.push('');
    lines.push('## Option A — dedicated `splat.index` pick pass (spike prototype)');
    lines.push('');
    lines.push(`- Spike patch applied to viewer bundle: **${spikeApplied ? 'yes' : 'no'}**`);
    lines.push(`- Browser test ran: **${optionA.ran ? 'yes' : 'no'}**${optionA.reason ? ` (${optionA.reason})` : ''}`);
    if (optionA.ran) {
        lines.push(`- WebGPU backend: **${optionA.webgpu ? 'yes' : 'no (WebGL2)'}**`);
        lines.push(`- Viewer depth pick still works at center: **${optionA.depthPickWorks ? 'yes' : 'no'}**`);
        lines.push(`- Gaussian index hits in grid scan: **${optionA.gaussianPickHits}**`);
        lines.push(`- Sample indices: ${optionA.sampleIndices.length ? optionA.sampleIndices.join(', ') : '(none)'}`);
        lines.push(`- Pick target non-zero pixels (sample grid): **${optionA.pickTargetNonZero ?? 'n/a'}**`);
        if (optionA.pickPassDiag) {
            lines.push(`- Pick pass instancingCount: **${optionA.pickPassDiag.gsplatInstancingCount ?? 'n/a'}**`);
            lines.push(`- Pick pass variant SCA_GAUSSIAN_INDEX_PICK: **${optionA.pickPassDiag.pickPassVariant ?? 'n/a'}**`);
        }
    }
    lines.push('');
    lines.push('### Option A design notes');
    lines.push('- Uses `SCA_GAUSSIAN_INDEX_PICK` shader define on pick MI only.');
    lines.push('- Encodes `encodePickOutput(vGaussianIndex + 1u)` where `vGaussianIndex = splat.index`.');
    lines.push('- Does **not** toggle `enableIds` / `pcId` (avoids work-buffer format churn).');
    lines.push('- Depth picker chunk patches remain independent (unregister during index pass only).');
    lines.push('- No global `vPickId + 1` string replacement.');
    lines.push('');

    lines.push('## Option B — newer engine / PR #8556 compute pick (static survey)');
    lines.push('');
    const eng = optionB.projectEngine;
    lines.push(`- Project devDependency engine: **${eng.engineVersion}**`);
    lines.push(`- Exported viewer engine: **${eng.bundledViewerEngineVersion ?? 'unknown'}** (viewer **${eng.bundledViewerVersion ?? '?'}**)`);
    lines.push(`- \`prepareForPicking\`: **${eng.hasPrepareForPicking}**`);
    lines.push(`- \`Picker.getSelectionAsync\`: **${eng.hasGetSelectionAsync}**`);
    lines.push(`- \`Picker.getWorldPointAsync\`: **${eng.hasGetWorldPointAsync}**`);
    lines.push(`- \`enableIds\` API: **${eng.hasEnableIds}**`);
    lines.push(`- PR #8556 markers (GSplatLocalDispatch / compute-local): **${eng.pr8556Present}**`);
    lines.push(`- ${eng.pickerReturnsNote}`);
    lines.push('');
    for (const note of optionB.notes) {
        lines.push(`- ${note}`);
    }
    lines.push('');

    lines.push('## Comparison matrix');
    lines.push('');
    lines.push('| Criterion | Option A (splat.index spike) | Option B (engine upgrade / #8556) |');
    lines.push('|---|---|---|');
    const aNumeric = optionA.ran && optionA.gaussianPickHits > 0 ? 'Likely yes (if hits > 0)' : 'Unverified / no hits in spike run';
    const bNumeric = eng.pr8556Present ? 'Yes (compute pick path)' : 'Not in 2.21.x — needs engine > 2.21.1';
    lines.push(`| Numeric Gaussian ID | ${aNumeric} | ${bNumeric} |`);
    lines.push(`| WebGPU | ${optionA.ran ? (optionA.webgpu ? 'Tested WebGPU' : 'Tested WebGL2 fallback') : 'Not tested'} | Unknown until engine+viewer co-upgrade |`);
    lines.push('| SOG index alignment | Uses `splat.index` (same concept as editor) | Must verify compute pick ID == export SOG order |');
    lines.push(`| Disturbs depth pick | ${optionA.ran ? (optionA.depthPickWorks ? 'No (spike)' : 'Needs check') : 'Designed: no'} | Likely no if viewer depth picker kept separate |`);
    lines.push('| Viewer bundle patching | Moderate — scoped shader branch + pick MI define | High — rebundle viewer on newer engine |');
    lines.push('| Maintenance risk | Medium (shader chunk drift on viewer updates) | Lower long-term if upstream owns pick |');
    lines.push('| Performance | One extra RGBA8 pick pass on demand | Compute pick may be faster on unified path |');
    lines.push('| Storyline runtime fit | Good if WebGPU hit confirmed | Best if upstream ID matches SOG export |');
    lines.push('');

    lines.push('## Recommendation');
    lines.push('');
    if (optionA.ran && optionA.gaussianPickHits > 0) {
        lines.push('**Primary: Option A (dedicated `splat.index` pick pass)** for production, because the spike demonstrates numeric Gaussian IDs without engine/viewer upgrade.');
        lines.push('');
        lines.push('Continue parallel **Option B evaluation** on engine newer than 2.21.1 (post-#8556) before committing long-term — if compute pick IDs align with SOG order, migrate later.');
    } else if (eng.pr8556Present) {
        lines.push('**Primary: Option B** — project engine already includes #8556 markers; prototype compute pick before custom shader work.');
    } else {
        lines.push('**Primary: Option A (dedicated `splat.index` pick pass)** — engine 2.21.x lacks PR #8556; viewer upgrade alone (1.28.0) does not add per-Gaussian pick.');
        lines.push('');
        lines.push('Re-run Option A browser spike with WebGPU (`npx playwright install chromium`) to confirm non-zero pick target before implementation.');
    }
    lines.push('');
    lines.push('## Files');
    lines.push('');
    lines.push('- `tools/spike/splat-index-pick-patch.ts` — Option A spike patch');
    lines.push('- `tools/spike/engine-pick-survey.ts` — Option B static survey');
    lines.push('- `tools/spike-out/index.spike-a.js` — patched viewer bundle for spike');
    lines.push('');

    mkdirSync(SPIKE_OUT, { recursive: true });
    writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
    console.log(`[spike] report written: ${REPORT_PATH}`);
};

const main = async () => {
    console.log('[spike] Gaussian pick architecture comparison');
    const spikeApplied = await buildOptionASpikeBundle();
    console.log('[spike] Option A spike bundle:', SPIKE_INDEX);

    const optionB = runEnginePickSurvey(ROOT);
    console.log('[spike] Option B survey engine', optionB.projectEngine.engineVersion,
        'PR8556=', optionB.projectEngine.pr8556Present);

    const { server, url } = await startSpikeServer();
    console.log('[spike] serving spike preview at', url);
    let optionA;
    try {
        optionA = await runOptionABrowserSpike(url);
    } finally {
        server.close();
    }

    writeReport(optionA, optionB, spikeApplied);
    console.log('[spike] Option A results:', JSON.stringify(optionA, null, 2));
};

main().catch((error) => {
    console.error('[spike] failed:', error);
    process.exit(1);
});
