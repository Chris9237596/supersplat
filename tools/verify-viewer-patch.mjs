import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const bundlePath = path.join(
    repoRoot,
    'node_modules/@playcanvas/supersplat-viewer/dist/index.js'
);

const patchModuleUrl = pathToFileURL(
    path.join(repoRoot, 'dist/sca/export/patch-viewer-bundle.js')
).href;

async function main() {
    const source = fs.readFileSync(bundlePath, 'utf8');
    let patchViewerBundle;

    try {
        ({ patchViewerBundle } = await import(patchModuleUrl));
    } catch {
        console.log('Compiled patch module missing; transpile with project build first.');
        console.log('Running inline patch verification via tsx is required for full test.');
        process.exit(1);
    }

    const patched = patchViewerBundle(source);
    const checks = [
        'lookAtTargetAnimatedWithoutMovingCamera',
        'animateHomeTransition',
        'interruptScaCameraAnimations',
        'interruptLookAnimation',
        'cancelLookAnimation',
        'annotationCameraNavigationEnabled',
        'scaNavFlags',
        'disableAnnotationCameraNavigation',
    ];

    for (const token of checks) {
        if (!patched.includes(token)) {
            throw new Error(`patched bundle missing "${token}"`);
        }
    }

    console.log('viewer patch verification passed');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
