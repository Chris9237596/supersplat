import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PLY_URL = 'http://127.0.0.1:4173/test-assets/dragon.compressed.ply';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn('npx', ['serve', 'dist', '-p', '4173', '-C'], { cwd: ROOT, shell: true, stdio: 'ignore' });
await sleep(2000);

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => console.log('[console]', msg.text()));
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

await page.goto(`http://127.0.0.1:4173/index.html?load=${encodeURIComponent(PLY_URL)}&filename=dragon.compressed.ply`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.scene?.events, { timeout: 120000 });
await sleep(15000);
const after = await page.evaluate(() => {
  const all = window.scene.events.invoke('scene.allSplats') || [];
  return { allCount: all.length, nums: all.map((s) => s.numSplats) };
});
console.log('after load param:', after);

await browser.close();
proc.kill();
