/**
 * Incrementally updates an already SCA-patched viewer index.js with startup flyTo
 * CameraManager integration. Used to refresh tools/smoke-out/package/index.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, 'smoke-out', 'package', 'index.js');

let source = readFileSync(indexPath, 'utf8');

if (source.includes('scaStartupFlyAnim')) {
    console.log('[apply-startup-fly-patch] already patched');
    process.exit(0);
}

const replaceOnce = (search, replacement, label) => {
    if (!source.includes(search)) {
        throw new Error(`missing anchor: ${label}`);
    }
    source = source.replace(search, replacement);
};

replaceOnce(
    'let scaHomeAnimResolve = null;\nlet scaPointerWasDrag = false;',
    `let scaHomeAnimResolve = null;
let scaStartupFlyAnim = null;
let scaStartupFlyAnimResolve = null;
let scaPointerWasDrag = false;`,
    'startup fly vars'
);

replaceOnce(
    `const scaResolveHomeAnim = () => {
    if (scaHomeAnimResolve) {
        const resolve = scaHomeAnimResolve;
        scaHomeAnimResolve = null;
        resolve();
    }
};`,
    `const scaResolveHomeAnim = () => {
    if (scaHomeAnimResolve) {
        const resolve = scaHomeAnimResolve;
        scaHomeAnimResolve = null;
        resolve();
    }
};
const scaResolveStartupFlyAnim = () => {
    if (scaStartupFlyAnimResolve) {
        const resolve = scaStartupFlyAnimResolve;
        scaStartupFlyAnimResolve = null;
        resolve();
    }
};
const scaLogStartupFlyComplete = (cam, oc, pivot) => {
    console.log('[SCA3D] startup flyTo complete', JSON.stringify({
        cameraPosition: [cam.position.x, cam.position.y, cam.position.z],
        orbitCurrentDistance: oc._childPose.position.z,
        orbitTargetDistance: oc._targetChildPose.position.z,
        orbitPivot: [oc._rootPose.position.x, oc._rootPose.position.y, oc._rootPose.position.z],
        expectedPivot: pivot
    }));
};`,
    'startup fly helpers'
);

replaceOnce(
    `        this.interruptScaCameraAnimations = () => {
            return this.interruptLookAnimation() || this.interruptHomeAnimation();
        };
        events.on('sca:interruptCameraAnimation', () => {
            this.interruptScaCameraAnimations();
        });
        this.animateHomeTransition = (fromPose, toPose, durationSec) => {`,
    `        this.interruptStartupFlyAnimation = () => {
            if (!scaStartupFlyAnim) {
                return false;
            }
            scaStartupFlyAnim = null;
            if (state.cameraMode === 'orbit') {
                scaSyncOrbitToCurrentCamera(controllers.orbit.controller, this.camera);
                getController(state.cameraMode).onEnter(this.camera);
            } else {
                this.snap();
            }
            target.copy(this.camera);
            from.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
            const diag = window.__SCA3D_CAMERA_DIAG;
            if (diag) {
                diag.flyToActive = false;
                diag.flyToT = null;
            }
            scaResolveStartupFlyAnim();
            return true;
        };
        this.interruptScaCameraAnimations = () => {
            return this.interruptLookAnimation() ||
                this.interruptHomeAnimation() ||
                this.interruptStartupFlyAnimation();
        };
        events.on('sca:interruptCameraAnimation', () => {
            this.interruptScaCameraAnimations();
        });
        this.animateHomeTransition = (fromPose, toPose, durationSec) => {`,
    'interrupt startup fly'
);

replaceOnce(
    `            return new Promise((resolve) => {
                scaHomeAnimResolve = resolve;
            });
        };
        scaActiveCameraManager = this;`,
    `            return new Promise((resolve) => {
                scaHomeAnimResolve = resolve;
            });
        };
        this.animateStartupTransition = (fromPose, toPose, durationSec) => {
            this.interruptStartupFlyAnimation();
            this.interruptHomeAnimation();
            this.interruptLookAnimation();
            const finishStartupFly = () => {
                scaApplyHomePose(this.camera, toPose.position, toPose.target, toPose.fov);
                if (state.cameraMode === 'orbit') {
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, toPose.target);
                    getController(state.cameraMode).onEnter(this.camera);
                } else {
                    this.snap();
                }
                target.copy(this.camera);
                from.copy(this.camera);
                transitionTimer = 1;
                global.app.renderNextFrame = true;
                scaLogStartupFlyComplete(
                    this.camera,
                    controllers.orbit.controller,
                    toPose.target
                );
                const diag = window.__SCA3D_CAMERA_DIAG;
                if (diag) {
                    diag.flyToActive = false;
                    diag.flyToT = 1;
                }
                scaResolveStartupFlyAnim();
            };
            if (!(durationSec > 0)) {
                scaApplyHomePose(this.camera, fromPose.position, fromPose.target, fromPose.fov);
                finishStartupFly();
                return Promise.resolve();
            }
            scaApplyHomePose(this.camera, fromPose.position, fromPose.target, fromPose.fov);
            scaHomeFromPos.set(fromPose.position[0], fromPose.position[1], fromPose.position[2]);
            scaHomeToPos.set(toPose.position[0], toPose.position[1], toPose.position[2]);
            scaHomeFromTarget.set(fromPose.target[0], fromPose.target[1], fromPose.target[2]);
            scaHomeToTarget.set(toPose.target[0], toPose.target[1], toPose.target[2]);
            scaStartupFlyAnim = {
                elapsed: 0,
                duration: Math.max(durationSec, 0.001),
                fromFov: fromPose.fov,
                toFov: toPose.fov,
                toTarget: [toPose.target[0], toPose.target[1], toPose.target[2]]
            };
            const diag = window.__SCA3D_CAMERA_DIAG;
            if (diag) {
                diag.flyToActive = true;
                diag.flyToT = 0;
            }
            target.copy(this.camera);
            from.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
            return new Promise((resolve) => {
                scaStartupFlyAnimResolve = resolve;
            });
        };
        scaActiveCameraManager = this;`,
    'animateStartupTransition'
);

replaceOnce(
    `            if (scaHomeAnim) {
                scaHomeAnim.elapsed += dt;`,
    `            if (scaStartupFlyAnim) {
                scaStartupFlyAnim.elapsed += dt;
                const flyT = Math.min(1, scaStartupFlyAnim.elapsed / scaStartupFlyAnim.duration);
                const flyEased = easeOut(flyT);
                const px = scaHomeFromPos.x + (scaHomeToPos.x - scaHomeFromPos.x) * flyEased;
                const py = scaHomeFromPos.y + (scaHomeToPos.y - scaHomeFromPos.y) * flyEased;
                const pz = scaHomeFromPos.z + (scaHomeToPos.z - scaHomeFromPos.z) * flyEased;
                const tx = scaHomeFromTarget.x + (scaHomeToTarget.x - scaHomeFromTarget.x) * flyEased;
                const ty = scaHomeFromTarget.y + (scaHomeToTarget.y - scaHomeFromTarget.y) * flyEased;
                const tz = scaHomeFromTarget.z + (scaHomeToTarget.z - scaHomeFromTarget.z) * flyEased;
                const fov = scaStartupFlyAnim.fromFov + (scaStartupFlyAnim.toFov - scaStartupFlyAnim.fromFov) * flyEased;
                scaApplyHomePose(this.camera, [px, py, pz], [tx, ty, tz], fov);
                target.copy(this.camera);
                from.copy(this.camera);
                transitionTimer = 1;
                const flyDiag = window.__SCA3D_CAMERA_DIAG;
                if (flyDiag) {
                    flyDiag.flyToT = flyT;
                }
                if (flyT >= 1) {
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, scaStartupFlyAnim.toTarget);
                    scaLogStartupFlyComplete(
                        this.camera,
                        controllers.orbit.controller,
                        scaStartupFlyAnim.toTarget
                    );
                    scaStartupFlyAnim = null;
                    getController(state.cameraMode).onEnter(this.camera);
                    target.copy(this.camera);
                    from.copy(this.camera);
                    transitionTimer = 1;
                    if (flyDiag) {
                        flyDiag.flyToActive = false;
                        flyDiag.flyToT = 1;
                    }
                    scaResolveStartupFlyAnim();
                }
                global.app.renderNextFrame = true;
            } else if (scaHomeAnim) {
                scaHomeAnim.elapsed += dt;`,
    'startup fly update loop'
);

replaceOnce(
    `            this.animateHomeTransition = (fromPose, toPose, durationSec) => {
                return this.cameraManager.animateHomeTransition(fromPose, toPose, durationSec);
            };`,
    `            this.animateHomeTransition = (fromPose, toPose, durationSec) => {
                return this.cameraManager.animateHomeTransition(fromPose, toPose, durationSec);
            };
            this.animateStartupTransition = (fromPose, toPose, durationSec) => {
                return this.cameraManager.animateStartupTransition(fromPose, toPose, durationSec);
            };`,
    'viewer startup API'
);

replaceOnce(
    '        if (scaLookAnim || scaHomeAnim) {\n            events.fire(\'sca:interruptCameraAnimation\');',
    '        if (scaLookAnim || scaHomeAnim || scaStartupFlyAnim) {\n            events.fire(\'sca:interruptCameraAnimation\');',
    'pointer interrupt startup fly'
);

if (source.includes('if (scaLookAnim || scaHomeAnim) {')) {
    source = source.replace(
        'if (scaLookAnim || scaHomeAnim) {',
        'if (scaLookAnim || scaHomeAnim || scaStartupFlyAnim) {'
    );
}

writeFileSync(indexPath, source);
console.log('[apply-startup-fly-patch] updated', indexPath);
