import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const preview = path.join(ROOT, 'tools', 'smoke-out', 'package', 'preview.html');

const { chromium } = await import('playwright');
const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU']
});
const page = await browser.newPage();
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));

await page.goto(`file:///${preview.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 120000 });
for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => ({
        hasSCA3D: !!window.SCA3D,
        hasViewer: !!window.SCA3D?.state?.viewer,
        loaded: window.SCA3D?.state?.viewer?.global?.state?.loaded,
        hasPivotApi: !!window.SCA3D?.state?.viewer?.setOrbitPivotOnly,
        hasCameraManager: !!window.SCA3D?.state?.viewer?.cameraManager,
        errors: window.__errors || []
    }));
    console.log(`tick ${i}`, state);
    if (state.loaded && state.hasPivotApi) break;
}
await browser.close();
