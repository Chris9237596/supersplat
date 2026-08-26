/**
 * Isolated harness test: can Playwright load current.ssproj into the editor?
 * Does not export, probe, or require WebGPU.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.join(ROOT, 'sca-workspace');
const SSPROJ_PATH = path.join(WORKSPACE, 'project/current.ssproj');

const EDITOR_PORT = 4327;
const ASSET_PORT = 4329;
const SAME_ORIGIN_PATH = '/workspace/current.ssproj';

const serveDir = (rootDir, extraRoutes = new Map()) => createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (extraRoutes.has(urlPath)) {
        const data = extraRoutes.get(urlPath);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
        return;
    }

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
            '.css': 'text/css'
        };
        res.writeHead(200, {
            'Content-Type': mime[ext] ?? 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    } catch (error) {
        res.writeHead(404);
        res.end(String(error));
    }
});

const startServer = (server) => new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const runCase = async (playwright, label, setup) => {
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await setup(page);
        const result = await page.evaluate(async ({ crossOriginUrl, sameOriginPath }) => {
            const attempt = async (mode, loadFn) => {
                const out = { mode, steps: [] };
                try {
                    await loadFn(out);
                    return out;
                } catch (error) {
                    out.error = String(error);
                    return out;
                }
            };

            const crossOrigin = await attempt('cross-origin-fetch', async (out) => {
                const response = await fetch(crossOriginUrl);
                out.steps.push({
                    step: 'fetch',
                    ok: response.ok,
                    status: response.status,
                    type: response.type
                });
                if (!response.ok) {
                    throw new Error(`fetch HTTP ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                out.steps.push({ step: 'arrayBuffer', byteLength: buffer.byteLength });
                const file = new File([buffer], 'current.ssproj', { type: 'application/octet-stream' });
                const loadResult = await window.scene.events.invoke('doc.load', file);
                out.steps.push({ step: 'doc.load', loadResult });
            });

            const sameOrigin = await attempt('same-origin-fetch', async (out) => {
                const response = await fetch(sameOriginPath);
                out.steps.push({
                    step: 'fetch',
                    ok: response.ok,
                    status: response.status,
                    type: response.type
                });
                if (!response.ok) {
                    throw new Error(`fetch HTTP ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                out.steps.push({ step: 'arrayBuffer', byteLength: buffer.byteLength });
                const file = new File([buffer], 'current.ssproj', { type: 'application/octet-stream' });
                const loadResult = await window.scene.events.invoke('doc.load', file);
                out.steps.push({ step: 'doc.load', loadResult });
            });

            return { crossOrigin, sameOrigin };
        }, setup.urls);

        return { label, ...result };
    } finally {
        await browser.close();
    }
};

const main = async () => {
    if (!existsSync(SSPROJ_PATH)) {
        throw new Error(`missing ${SSPROJ_PATH}`);
    }

    const ssprojBytes = readFileSync(SSPROJ_PATH);
    const assetServer = serveDir(path.join(WORKSPACE, 'project'));
    const assetPort = await startServer(assetServer);

    const editorRoutes = new Map([[SAME_ORIGIN_PATH, ssprojBytes]]);
    const editorServer = serveDir(path.join(ROOT, 'dist'), editorRoutes);
    const editorPort = await startServer(editorServer);

    const crossOriginUrl = `http://127.0.0.1:${assetPort}/current.ssproj`;
    const editorUrl = `http://127.0.0.1:${editorPort}/index.html`;
    const sameOriginPath = SAME_ORIGIN_PATH;

    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        throw new Error('playwright not installed');
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(editorUrl, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.scene?.events, { timeout: 120000 });

    const report = await page.evaluate(async ({ crossOriginUrl, sameOriginPath }) => {
        const attempt = async (mode, loadFn) => {
            const out = { mode, steps: [] };
            try {
                await loadFn(out);
                return out;
            } catch (error) {
                out.error = String(error);
                return out;
            }
        };

        return {
            crossOrigin: await attempt('cross-origin-fetch', async (out) => {
                const response = await fetch(crossOriginUrl);
                out.steps.push({
                    step: 'fetch',
                    ok: response.ok,
                    status: response.status,
                    type: response.type,
                    url: crossOriginUrl
                });
                if (!response.ok) {
                    throw new Error(`fetch HTTP ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                out.steps.push({ step: 'arrayBuffer', byteLength: buffer.byteLength });
                const file = new File([buffer], 'current.ssproj', { type: 'application/octet-stream' });
                out.steps.push({ step: 'file', size: file.size });
                const loadResult = await window.scene.events.invoke('doc.load', file);
                out.steps.push({ step: 'doc.load', loadResult });
            }),
            sameOrigin: await attempt('same-origin-fetch', async (out) => {
                const response = await fetch(sameOriginPath);
                out.steps.push({
                    step: 'fetch',
                    ok: response.ok,
                    status: response.status,
                    type: response.type,
                    url: sameOriginPath
                });
                if (!response.ok) {
                    throw new Error(`fetch HTTP ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                out.steps.push({ step: 'arrayBuffer', byteLength: buffer.byteLength });
                const file = new File([buffer], 'current.ssproj', { type: 'application/octet-stream' });
                out.steps.push({ step: 'file', size: file.size });
                const loadResult = await window.scene.events.invoke('doc.load', file);
                out.steps.push({ step: 'doc.load', loadResult });
            })
        };
    }, { crossOriginUrl, sameOriginPath });

    await browser.close();
    assetServer.close();
    editorServer.close();

    console.log(JSON.stringify({
        editorUrl,
        crossOriginUrl,
        sameOriginUrl: `${editorUrl.replace('/index.html', '')}${sameOriginPath}`,
        ssprojBytes: ssprojBytes.length,
        report
    }, null, 2));
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
