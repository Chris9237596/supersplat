/**
 * Probe gsplat entity world/model matrix in the exported runtime viewer.
 * Usage: node tools/sca-splat-matrix-probe.mjs [runtimeDir]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeDir = path.resolve(ROOT, process.argv[2] ?? 'sca-workspace/runtime/latest');

const serveDir = (rootDir) => {
    const mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.sog': 'application/octet-stream',
        '.mask': 'application/octet-stream',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.wasm': 'application/wasm'
    };

    return http.createServer((req, res) => {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
        if (!filePath.startsWith(rootDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
            res.end(data);
        });
    });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatMatrix = (data) => {
    if (!data || data.length < 16) {
        return null;
    }
    const rows = [];
    for (let row = 0; row < 4; row += 1) {
        rows.push(Array.from(data.slice(row * 4, row * 4 + 4)).map((v) => Number(v.toFixed(6))));
    }
    return rows;
};

const isIdentity = (data, eps = 1e-5) => {
    if (!data || data.length < 16) {
        return false;
    }
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return identity.every((v, i) => Math.abs(v - data[i]) <= eps);
};

const isRz180 = (data, eps = 1e-4) => {
    if (!data || data.length < 16) {
        return false;
    }
    const expected = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return expected.every((v, i) => Math.abs(v - data[i]) <= eps);
};

const runProbe = async () => {
    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        console.error('playwright not installed — run: npm install playwright --no-save && npx playwright install chromium');
        process.exit(1);
    }

    const server = serveDir(runtimeDir);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/index.html`;

    const browser = await playwright.chromium.launch({
        headless: true,
        args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            const viewer = window.SCA3D?.state?.viewer;
            return viewer?.global?.state?.loaded;
        }, { timeout: 180000 });
        await sleep(500);

        const result = await page.evaluate(() => {
            const projectSplats = window.SCA3D?.state?.project?.splats ?? null;
            const entity = window.SCA3D?.state?.viewer?.global?.app?.root?.findComponents?.('gsplat')?.[0]?.entity;
            const matrixData = entity?.getWorldTransform?.()?.data;
            const matrix = matrixData && matrixData.length >= 16 ? Array.from(matrixData) : null;
            const localRot = entity?.getLocalRotation?.();
            const localPos = entity?.getLocalPosition?.();
            const localScale = entity?.getLocalScale?.();
            return {
                projectSplats,
                matrix,
                localRotation: localRot ? [localRot.x, localRot.y, localRot.z, localRot.w] : null,
                localPosition: localPos ? [localPos.x, localPos.y, localPos.z] : null,
                localScale: localScale ? [localScale.x, localScale.y, localScale.z] : null
            };
        });

        const projectJson = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'project.json'), 'utf8'));
        const report = {
            runtimeDir,
            projectSplatsField: projectJson.splats ?? null,
            probe: result,
            matrix_model: formatMatrix(result.matrix),
            classification: {
                identity: isIdentity(result.matrix),
                rz180: isRz180(result.matrix)
            }
        };

        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
        server.close();
    }
};

runProbe().catch((error) => {
    console.error(error);
    process.exit(1);
});
