/**
 * Patches the exported SuperSplat Viewer bundle with SCA camera/navigation hooks.
 * Applied to index.js (and inlined JS in html-bundle exports) at package build time.
 */

import { SCA_VIEWER_PICK_SEAM } from './sca-viewer-pick-seam';

const replaceOnce = (source: string, search: string, replacement: string, label: string): string => {
    if (!source.includes(search)) {
        throw new Error(`[SCA] viewer patch failed: missing anchor "${label}"`);
    }
    return source.replace(search, replacement);
};

const SCA_ORBIT_SCRATCH = `const scaLookPose = new Pose();
const scaLookTarget = new Vec3();
const scaLookAnimFromAngles = new Vec3();
const scaLookAnimToAngles = new Vec3();
const scaLookAnimFixedPos = new Vec3();
const scaHomeFromPos = new Vec3();
const scaHomeToPos = new Vec3();
const scaHomeFromTarget = new Vec3();
const scaHomeToTarget = new Vec3();
const scaHomeLerpPos = new Vec3();
const scaNavFlags = { navigationTargetsEnabled: true };
let scaLookAnim = null;
let scaHomeAnim = null;
let scaHomeAnimResolve = null;
let scaStartupFlyAnim = null;
let scaStartupFlyAnimResolve = null;
let scaTurntableAnim = null;
let scaPointerWasDrag = false;
let scaPointerDownX = 0;
let scaPointerDownY = 0;
let scaActiveCameraManager = null;
const SCA_DRAG_THRESHOLD_SQ = 36;
const scaEaseInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const scaDiagPrevPos = new Vec3();
let scaDiagPrevDist = 0;
let scaDiagInitialized = false;
let scaDiagWheelFrameCount = 0;
let scaDiagPointerDown = false;
const scaDiagGetExternal = () => window.__SCA3D_CAMERA_DIAG || {};
const scaDiagClassifySource = (state, transitionTimer) => {
    const ext = scaDiagGetExternal();
    if (scaStartupFlyAnim) {
        return 'startupFlyTo';
    }
    if (scaTurntableAnim) {
        return 'turntable';
    }
    if (ext.flyToActive) {
        return 'startupFlyTo';
    }
    if (scaHomeAnim) {
        return 'home';
    }
    if (scaLookAnim) {
        return 'hotspot';
    }
    if (state.cameraMode === 'anim') {
        return 'animTrack';
    }
    if (transitionTimer < 0.999) {
        return 'modeTransition';
    }
    if (scaDiagWheelFrameCount > 0) {
        return 'wheel';
    }
    if (scaDiagPointerDown) {
        return 'orbit';
    }
    return 'orbit';
};
const scaDiagMaybeLogMove = (cam, state, transitionTimer) => {
    if (!scaDiagInitialized) {
        scaDiagPrevPos.copy(cam.position);
        scaDiagPrevDist = cam.distance;
        scaDiagInitialized = true;
        return;
    }
    const posDelta = cam.position.distance(scaDiagPrevPos);
    const distDelta = Math.abs(cam.distance - scaDiagPrevDist);
    if (posDelta < 1e-5 && distDelta < 1e-5) {
        if (scaDiagWheelFrameCount > 0) {
            scaDiagWheelFrameCount--;
        }
        return;
    }
    const ext = scaDiagGetExternal();
    const homeAnimT = scaHomeAnim ?
        Math.min(1, scaHomeAnim.elapsed / scaHomeAnim.duration) :
        null;
    const lookAnimT = scaLookAnim ?
        Math.min(1, scaLookAnim.elapsed / scaLookAnim.duration) :
        null;
    if (window.SCA3D?.debug?.camera || window.SCA3D?.cameraDebugVerbose) {
        console.log('[SCA3D CAMERA MOVE]', JSON.stringify({
            source: scaDiagClassifySource(state, transitionTimer),
            positionBefore: [scaDiagPrevPos.x, scaDiagPrevPos.y, scaDiagPrevPos.z],
            positionAfter: [cam.position.x, cam.position.y, cam.position.z],
            distanceBefore: scaDiagPrevDist,
            distanceAfter: cam.distance,
            animationState: {
                cameraMode: state.cameraMode,
                transitionTimer,
                homeAnimActive: !!scaHomeAnim,
                homeAnimT,
                lookAnimActive: !!scaLookAnim,
                lookAnimT,
                startupFlyAnimActive: !!scaStartupFlyAnim,
                startupFlyAnimT: scaStartupFlyAnim ?
                    Math.min(1, scaStartupFlyAnim.elapsed / scaStartupFlyAnim.duration) :
                    null,
                flyToActive: !!ext.flyToActive,
                flyToT: ext.flyToT ?? null,
                flyToStartCount: ext.flyToStartCount ?? 0,
                startupAnimationType: ext.startupAnimationType ?? null,
                startupAnimationDuration: ext.startupAnimationDuration ?? null
            }
        }));
    }
    scaDiagPrevPos.copy(cam.position);
    scaDiagPrevDist = cam.distance;
    if (scaDiagWheelFrameCount > 0) {
        scaDiagWheelFrameCount--;
    }
};
const scaResolveHomeAnim = () => {
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
    if (!window.SCA3D?.debug?.camera && !window.SCA3D?.cameraDebugVerbose) {
        return;
    }
    console.log('[SCA3D] startup flyTo complete', JSON.stringify({
        cameraPosition: [cam.position.x, cam.position.y, cam.position.z],
        orbitCurrentDistance: oc._childPose.position.z,
        orbitTargetDistance: oc._targetChildPose.position.z,
        orbitPivot: [oc._rootPose.position.x, oc._rootPose.position.y, oc._rootPose.position.z],
        expectedPivot: pivot
    }));
};
window.addEventListener('sca:interruptCameraAnimation', () => {
    scaActiveCameraManager?.interruptScaCameraAnimations?.();
});
const scaSyncOrbitToCamera = (oc, cam, pivot) => {
    const px = cam.position.x;
    const py = cam.position.y;
    const pz = cam.position.z;
    scaLookTarget.set(pivot[0], pivot[1], pivot[2]);
    scaLookAnimFixedPos.set(px, py, pz);
    cam.look(scaLookAnimFixedPos, scaLookTarget);
    cam.position.set(px, py, pz);
    scaLookPose.set(cam.position, cam.angles, cam.distance);
    oc.attach(scaLookPose, false);
    oc._targetRootPose.position.set(pivot[0], pivot[1], pivot[2]);
    oc._rootPose.position.copy(oc._targetRootPose.position);
    oc._targetRootPose.angles.copy(cam.angles);
    oc._rootPose.angles.copy(cam.angles);
    oc._targetChildPose.position.set(0, 0, cam.distance);
    oc._childPose.position.copy(oc._targetChildPose.position);
};
const scaSyncOrbitToCurrentCamera = (oc, cam) => {
    cam.calcFocusPoint(scaLookTarget);
    scaLookPose.set(cam.position, cam.angles, cam.distance);
    oc.attach(scaLookPose, false);
    oc._targetRootPose.position.copy(scaLookTarget);
    oc._rootPose.position.copy(scaLookTarget);
    oc._targetRootPose.angles.copy(cam.angles);
    oc._rootPose.angles.copy(cam.angles);
    oc._targetChildPose.position.set(0, 0, cam.distance);
    oc._childPose.position.copy(oc._targetChildPose.position);
};
const scaApplyHomePose = (cam, pos, target, fov) => {
    scaHomeLerpPos.set(pos[0], pos[1], pos[2]);
    scaLookTarget.set(target[0], target[1], target[2]);
    cam.look(scaHomeLerpPos, scaLookTarget);
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.fov = fov;
};
`;

const CAMERA_MANAGER_NAV_INIT = `constructor(global, bbox, collision = null) {
        const { events, settings, state } = global;
        const scaNavigation = settings.navigation ?? (settings.navigation = {});
        let annotationCameraNavigationEnabled = scaNavigation.disableAnnotationCameraNavigation !== true;
        scaNavFlags.navigationTargetsEnabled = scaNavigation.navigationTargetsEnabled !== false;
        const walkAllowed = isWalkAllowed(bbox, collision);`;

const LOOK_AT_TARGET_METHODS = `this.setAnnotationNavigationEnabled = (enabled) => {
            annotationCameraNavigationEnabled = enabled;
        };
        this.setFreeNavigationTargetsEnabled = (enabled) => {
            scaNavFlags.navigationTargetsEnabled = enabled;
            scaNavigation.navigationTargetsEnabled = enabled;
            if (!enabled) {
                events.fire('orbitTarget:clear');
                events.fire('navTarget:clear');
            }
        };
        this.cancelLookAnimation = () => {
            scaLookAnim = null;
        };
        this.interruptLookAnimation = () => {
            if (!scaLookAnim) {
                return false;
            }
            scaLookAnim = null;
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
            return true;
        };
        this.interruptHomeAnimation = () => {
            if (!scaHomeAnim) {
                return false;
            }
            scaHomeAnim = null;
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
            scaResolveHomeAnim();
            return true;
        };
        this.interruptStartupFlyAnimation = () => {
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
        this.interruptTurntableAnimation = () => {
            if (!scaTurntableAnim) {
                return false;
            }
            scaTurntableAnim = null;
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
            return true;
        };
        this.interruptScaCameraAnimations = () => {
            return this.interruptLookAnimation() ||
                this.interruptHomeAnimation() ||
                this.interruptStartupFlyAnimation() ||
                this.interruptTurntableAnimation();
        };
        events.on('sca:interruptCameraAnimation', () => {
            this.interruptScaCameraAnimations();
        });
        this.animateHomeTransition = (fromPose, toPose, durationSec) => {
            this.interruptHomeAnimation();
            this.interruptLookAnimation();
            this.interruptTurntableAnimation();
            const applyFinal = () => {
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
            };
            if (!(durationSec > 0)) {
                applyFinal();
                window.scaDebug?.('camera', '[SCA3D] home transition complete');
                return Promise.resolve();
            }
            scaHomeFromPos.set(fromPose.position[0], fromPose.position[1], fromPose.position[2]);
            scaHomeToPos.set(toPose.position[0], toPose.position[1], toPose.position[2]);
            scaHomeFromTarget.set(fromPose.target[0], fromPose.target[1], fromPose.target[2]);
            scaHomeToTarget.set(toPose.target[0], toPose.target[1], toPose.target[2]);
            scaHomeAnim = {
                elapsed: 0,
                duration: Math.max(durationSec, 0.001),
                fromFov: fromPose.fov,
                toFov: toPose.fov,
                toTarget: [toPose.target[0], toPose.target[1], toPose.target[2]]
            };
            target.copy(this.camera);
            from.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
            return new Promise((resolve) => {
                scaHomeAnimResolve = resolve;
            });
        };
        this.animateStartupTransition = (fromPose, toPose, durationSec) => {
            this.interruptStartupFlyAnimation();
            this.interruptHomeAnimation();
            this.interruptLookAnimation();
            this.interruptTurntableAnimation();
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
        scaActiveCameraManager = this;
        this.lookAtTargetAnimatedWithoutMovingCamera = (focusPoint, durationSec) => {
            if (state.cameraMode !== 'orbit') {
                return;
            }
            this.interruptTurntableAnimation();
            scaLookAnimFixedPos.copy(this.camera.position);
            scaLookAnimFromAngles.copy(this.camera.angles);
            scaLookTarget.set(focusPoint[0], focusPoint[1], focusPoint[2]);
            const lookCam = new Camera(this.camera);
            lookCam.look(scaLookAnimFixedPos, scaLookTarget);
            scaLookAnimToAngles.copy(lookCam.angles);
            scaLookAnim = {
                elapsed: 0,
                duration: Math.max(durationSec, 0.001),
                focus: [focusPoint[0], focusPoint[1], focusPoint[2]]
            };
            target.copy(this.camera);
            from.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
        };
        this.animateTurntable = (basePose, turntableConfig) => {
            this.interruptTurntableAnimation();
            this.interruptHomeAnimation();
            this.interruptLookAnimation();
            this.interruptStartupFlyAnimation();
            scaApplyHomePose(this.camera, basePose.position, basePose.target, basePose.fov);
            if (state.cameraMode === 'orbit') {
                scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, basePose.target);
                getController(state.cameraMode).onEnter(this.camera);
            } else {
                state.cameraMode = 'orbit';
                this.snap();
                scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, basePose.target);
                getController(state.cameraMode).onEnter(this.camera);
            }
            scaTurntableAnim = {
                elapsed: 0,
                basePose,
                config: turntableConfig
            };
            target.copy(this.camera);
            from.copy(this.camera);
            transitionTimer = 1;
            global.app.renderNextFrame = true;
        };
        // application update`;

const SCA_CAMERA_UPDATE = `            if (scaLookAnim) {
                scaLookAnim.elapsed += dt;
                if (scaLookAnim.elapsed >= scaLookAnim.duration) {
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, scaLookAnim.focus);
                    scaLookAnim = null;
                    getController(state.cameraMode).onEnter(this.camera);
                    target.copy(this.camera);
                    from.copy(this.camera);
                    transitionTimer = 1;
                }
            }
            const scaExclusiveAnim = scaStartupFlyAnim || scaHomeAnim || scaTurntableAnim || scaLookAnim;
            if (!scaExclusiveAnim) {
                controller.update(dt, frame, target);
            }
            if (scaStartupFlyAnim) {
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
                scaHomeAnim.elapsed += dt;
                const homeT = Math.min(1, scaHomeAnim.elapsed / scaHomeAnim.duration);
                const homeEased = scaEaseInOutCubic(homeT);
                const px = scaHomeFromPos.x + (scaHomeToPos.x - scaHomeFromPos.x) * homeEased;
                const py = scaHomeFromPos.y + (scaHomeToPos.y - scaHomeFromPos.y) * homeEased;
                const pz = scaHomeFromPos.z + (scaHomeToPos.z - scaHomeFromPos.z) * homeEased;
                const tx = scaHomeFromTarget.x + (scaHomeToTarget.x - scaHomeFromTarget.x) * homeEased;
                const ty = scaHomeFromTarget.y + (scaHomeToTarget.y - scaHomeFromTarget.y) * homeEased;
                const tz = scaHomeFromTarget.z + (scaHomeToTarget.z - scaHomeFromTarget.z) * homeEased;
                const fov = scaHomeAnim.fromFov + (scaHomeAnim.toFov - scaHomeAnim.fromFov) * homeEased;
                scaApplyHomePose(this.camera, [px, py, pz], [tx, ty, tz], fov);
                window.scaDebug?.('camera', '[SCA3D] home transition frame', JSON.stringify({ t: homeT, position: [px, py, pz] }));
                target.copy(this.camera);
                from.copy(this.camera);
                transitionTimer = 1;
                if (homeT >= 1) {
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, scaHomeAnim.toTarget);
                    scaHomeAnim = null;
                    getController(state.cameraMode).onEnter(this.camera);
                    target.copy(this.camera);
                    from.copy(this.camera);
                    transitionTimer = 1;
                    window.scaDebug?.('camera', '[SCA3D] home transition complete');
                    scaResolveHomeAnim();
                }
                global.app.renderNextFrame = true;
            } else if (scaLookAnim) {
                const lookT = Math.min(1, scaLookAnim.elapsed / scaLookAnim.duration);
                const lookEased = easeOut(lookT);
                this.camera.position.copy(scaLookAnimFixedPos);
                this.camera.angles.x = math.lerpAngle(scaLookAnimFromAngles.x, scaLookAnimToAngles.x, lookEased);
                this.camera.angles.y = math.lerpAngle(scaLookAnimFromAngles.y, scaLookAnimToAngles.y, lookEased);
                this.camera.angles.z = math.lerpAngle(scaLookAnimFromAngles.z, scaLookAnimToAngles.z, lookEased);
                target.copy(this.camera);
                from.copy(this.camera);
                transitionTimer = 1;
                global.app.renderNextFrame = true;
            } else if (scaTurntableAnim) {
                scaTurntableAnim.elapsed += dt;
                const computePose = window.SCA3D?.computeTurntablePose;
                if (!computePose) {
                    scaTurntableAnim = null;
                } else {
                    const pose = computePose(
                        scaTurntableAnim.basePose,
                        scaTurntableAnim.elapsed,
                        scaTurntableAnim.config
                    );
                    scaApplyHomePose(this.camera, pose.position, pose.target, pose.fov);
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, pose.target);
                    target.copy(this.camera);
                    from.copy(this.camera);
                    transitionTimer = 1;
                    const done = !scaTurntableAnim.config.loop &&
                        scaTurntableAnim.elapsed >= scaTurntableAnim.config.duration;
                    if (done) {
                        scaTurntableAnim = null;
                        getController(state.cameraMode).onEnter(this.camera);
                    }
                    global.app.renderNextFrame = true;
                }
            }
            if (transitionTimer < 1) {
                // lerp away from previous camera during transition
                this.camera.lerp(from, target, easeOut(transitionTimer));`;

const VIEWER_SCA_API = `this.cameraManager = new CameraManager(global, sceneBound, collision);
            applyCamera(this.cameraManager.camera);
            this.lookAtTargetAnimatedWithoutMovingCamera = (focusPoint, durationSec) => {
                this.cameraManager.lookAtTargetAnimatedWithoutMovingCamera(focusPoint, durationSec);
            };
            this.animateHomeTransition = (fromPose, toPose, durationSec) => {
                return this.cameraManager.animateHomeTransition(fromPose, toPose, durationSec);
            };
            this.animateStartupTransition = (fromPose, toPose, durationSec) => {
                return this.cameraManager.animateStartupTransition(fromPose, toPose, durationSec);
            };
            this.cancelLookAnimation = () => {
                this.cameraManager.cancelLookAnimation();
            };
            this.interruptLookAnimation = () => {
                return this.cameraManager.interruptLookAnimation();
            };
            this.interruptHomeAnimation = () => {
                return this.cameraManager.interruptHomeAnimation();
            };
            this.interruptStartupFlyAnimation = () => {
                return this.cameraManager.interruptStartupFlyAnimation();
            };
            this.interruptTurntableAnimation = () => {
                return this.cameraManager.interruptTurntableAnimation();
            };
            this.animateTurntable = (basePose, turntableConfig) => {
                this.cameraManager.animateTurntable(basePose, turntableConfig);
            };
            this.interruptScaCameraAnimations = () => {
                return this.cameraManager.interruptScaCameraAnimations();
            };
            this.setAnnotationNavigationEnabled = (enabled) => {
                this.cameraManager.setAnnotationNavigationEnabled(enabled);
            };
            this.setFreeNavigationTargetsEnabled = (enabled) => {
                this.cameraManager.setFreeNavigationTargetsEnabled(enabled);
            };`;

const SKYBOX_LOAD = `const loadSkybox = (app, url) => {
    return new Promise((resolve, reject) => {
        const asset = new Asset('skybox', 'texture', {
            url
        }, {
            type: 'rgbp',
            projection: 'equirect',
            mipmaps: false,
            addressu: 'repeat',
            addressv: 'clamp'
        });
        asset.on('load', () => {
            const cubemap = EnvLighting.generateSkyboxCubemap(asset.resource);
            resolve(cubemap);
        });
        asset.on('error', (err) => {
            console.log(err);
            reject(err);
        });
        app.assets.add(asset);
        app.assets.load(asset);
    });
};`;

const SKYBOX_ASSIGN = `    const skyboxLoad = config.skyboxUrl &&
        loadSkybox(app, config.skyboxUrl).then((cubemap) => {
            app.scene.envAtlas = null;
            app.scene.skybox = cubemap;
        }).catch((err) => {
            console.warn('Failed to load skybox:', err);
        });`;

const PICKER_PATCH_MARKERS = [
    'SCA_PICK_GAUSSIAN',
    'pickGaussianId',
    'installRuntimePicker',
    'scaPickerReady'
] as const;

const verifyPickerPatch = (source: string): void => {
    for (const marker of PICKER_PATCH_MARKERS) {
        if (!source.includes(marker)) {
            throw new Error(`[SCA] viewer picker patch failed: missing "${marker}"`);
        }
    }
    if (source.includes('this.pickGaussian = async')) {
        console.warn('[SCA] viewer bundle still contains legacy inline pickGaussian; Phase 2 uses modular runtime picker');
    }
};

const FORBIDDEN_WGSL_HIGHLIGHT_PATTERNS = [
    '@location(undefined)',
    'var<uniform> scaRegionHighlight',
    'var scaRegionHighlight: texture_2d',
    'scaGaussianIndex = f32(sortedIndices[order])',
    'SCA_REGION_HIGHLIGHT_WGSL'
] as const;

/** Reject bundle strings that would break WebGPU gsplat compilation. */
const verifyNoInvalidWgslHighlightInjection = (source: string): void => {
    for (const pattern of FORBIDDEN_WGSL_HIGHLIGHT_PATTERNS) {
        if (source.includes(pattern)) {
            throw new Error(`[SCA] viewer bundle contains forbidden WGSL highlight injection: "${pattern}"`);
        }
    }
};

const verifyGlslHighlightPatch = (source: string): void => {
    if (!source.includes('texelFetch(scaRegionHighlight')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing texelFetch(scaRegionHighlight');
    }
    if (!source.includes('scaRegionHighlightTexWidth')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing scaRegionHighlightTexWidth uniform');
    }
    if (source.includes('texelFetch(scaRegionHighlight') && source.includes('splatTextureSize')) {
        const highlightFetch = source.match(/texelFetch\(scaRegionHighlight[\s\S]{0,200}\)/);
        if (highlightFetch?.[0]?.includes('splatTextureSize')) {
            throw new Error('[SCA] viewer GLSL highlight patch failed: fragment shader references splatTextureSize');
        }
    }
    if (!source.includes('scaRegionHoverClr')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing scaRegionHoverClr uniform');
    }
    if (!source.includes('scaRegionVisitedClr')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing scaRegionVisitedClr uniform');
    }
    if (!source.includes('regionState > 0.75')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing selected state branch (regionState > 0.75)');
    }
    if (!source.includes('regionState > 0.45')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing visited state branch (regionState > 0.45)');
    }
    if (!source.includes('flat varying float scaGaussianIndex')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing flat varying scaGaussianIndex');
    }
    const vsChunk = source.match(/var gsplat_default\$2 = `([\s\S]*?)`;/);
    if (vsChunk) {
        const declCount = (vsChunk[1].match(/flat varying float scaGaussianIndex/g) || []).length;
        if (declCount > 1) {
            throw new Error('[SCA] viewer GLSL highlight patch failed: duplicate flat varying float scaGaussianIndex in vertex shader');
        }
    }
};

type RegionHighlightShaderPatchResult = {
    source: string;
    ok: boolean;
    reason?: string;
};

/**
 * Apply WebGL/GLSL Region highlight shader patches only.
 * WebGPU WGSL tint is intentionally disabled — raw WGSL uniform/texture injection
 * breaks PlayCanvas bind-group generation and can black-screen the Viewer.
 */
const applyScaRegionHighlightGlslPatches = (source: string): RegionHighlightShaderPatchResult => {
    let trial = source;

    try {
        if (trial.includes('vec4 fragColor = vec4(gaussianColor.xyz, alpha);')) {
            trial = trial.replaceAll(
                'vec4 fragColor = vec4(gaussianColor.xyz, alpha);',
                `vec4 fragColor = vec4(gaussianColor.xyz, alpha);
        #ifdef SCA_REGION_HIGHLIGHT
        if (scaRegionHighlightActive > 0.5) {
            float regionState = texelFetch(scaRegionHighlight, ivec2(int(scaGaussianIndex) % int(scaRegionHighlightTexWidth), int(scaGaussianIndex) / int(scaRegionHighlightTexWidth)), 0).r;
            if (regionState > 0.02) {
                vec4 tint = scaRegionHoverClr;
                if (regionState > 0.75) {
                    tint = scaRegionHighlightClr;
                } else if (regionState > 0.45) {
                    tint = scaRegionVisitedClr;
                }
                fragColor.xyz = mix(fragColor.xyz, tint.xyz, tint.a);
            }
        }
        if (scaRegionStateOverlayActive > 0.5) {
            float overlayMask = texelFetch(scaRegionStateOverlay, ivec2(int(scaGaussianIndex) % int(scaRegionHighlightTexWidth), int(scaGaussianIndex) / int(scaRegionHighlightTexWidth)), 0).r;
            if (overlayMask > 0.02) {
                fragColor.xyz = mix(fragColor.xyz, scaRegionStateOverlayClr.xyz, scaRegionStateOverlayClr.a);
            }
        }
        if (scaRegionPulseActive > 0.5) {
            float pulseMask = texelFetch(scaRegionPulse, ivec2(int(scaGaussianIndex) % int(scaRegionHighlightTexWidth), int(scaGaussianIndex) / int(scaRegionHighlightTexWidth)), 0).r;
            if (pulseMask > 0.02) {
                float pulseWave;
                if (scaRegionPulseOnce > 0.5) {
                    pulseWave = sin(min(scaRegionPulseTime * scaRegionPulseSpeed, 3.14159265)) * 0.5 + 0.5;
                } else {
                    pulseWave = sin(scaRegionPulseTime * scaRegionPulseSpeed) * 0.5 + 0.5;
                }
                float pulseAmount = pulseWave * scaRegionPulseStrength;
                fragColor.xyz = mix(fragColor.xyz, scaRegionPulseClr.xyz, pulseAmount * scaRegionPulseClr.a);
            }
        }
        #endif`
            );
        }

        // VS-only: declare scaGaussianIndex once (do not also inject via gaussianColor/#ifndef — that duplicates in VS).
        if (trial.includes('#ifndef DITHER_NONE\n\tvarying float id;\n#endif\nmediump vec4 discardVec') &&
            !trial.includes('flat varying float scaGaussianIndex;\n#ifndef DITHER_NONE')) {
            trial = trial.replace(
                '#ifndef DITHER_NONE\n\tvarying float id;\n#endif\nmediump vec4 discardVec',
                'flat varying float scaGaussianIndex;\n#ifndef DITHER_NONE\n\tvarying float id;\n#endif\nmediump vec4 discardVec'
            );
        }

        if (trial.includes('\t#ifndef DITHER_NONE\n\t\tid = float(splat.index);\n\t#endif\n\t#ifdef PREPASS_PASS')) {
            trial = trial.replace(
                '\t#ifndef DITHER_NONE\n\t\tid = float(splat.index);\n\t#endif\n\t#ifdef PREPASS_PASS',
                '\tscaGaussianIndex = float(splat.index);\n\t#ifndef DITHER_NONE\n\t\tid = float(splat.index);\n\t#endif\n\t#ifdef PREPASS_PASS'
            );
        }

        if (trial.includes('varying mediump vec2 gaussianUV;\nvarying mediump vec4 gaussianColor;\n#if defined(GSPLAT_UNIFIED_ID)')) {
            trial = trial.replace(
                'varying mediump vec2 gaussianUV;\nvarying mediump vec4 gaussianColor;\n#if defined(GSPLAT_UNIFIED_ID)',
                `#ifdef SCA_REGION_HIGHLIGHT
uniform sampler2D scaRegionHighlight;
uniform vec4 scaRegionHighlightClr;
uniform vec4 scaRegionHoverClr;
uniform vec4 scaRegionVisitedClr;
uniform float scaRegionHighlightActive;
uniform float scaRegionHighlightTexWidth;
uniform float scaRegionHighlightTexHeight;
uniform sampler2D scaRegionPulse;
uniform vec4 scaRegionPulseClr;
uniform float scaRegionPulseActive;
uniform float scaRegionPulseStrength;
uniform float scaRegionPulseSpeed;
uniform float scaRegionPulseTime;
uniform float scaRegionPulseOnce;
uniform sampler2D scaRegionStateOverlay;
uniform vec4 scaRegionStateOverlayClr;
uniform float scaRegionStateOverlayActive;
flat varying float scaGaussianIndex;
#endif
varying mediump vec2 gaussianUV;
varying mediump vec4 gaussianColor;
#if defined(GSPLAT_UNIFIED_ID)`
            );
        }

        verifyNoInvalidWgslHighlightInjection(trial);
        verifyGlslHighlightPatch(trial);
        return {
            source: trial,
            ok: true,
            reason: 'GLSL highlight patches applied; WebGPU tint disabled'
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[SCA] Region highlight GLSL patch skipped: ${reason}`);
        return { source, ok: false, reason };
    }
};

const patchViewerBundle = (source: string): string => {
    let patched = source;

    patched = replaceOnce(
        patched,
        'class CameraManager {',
        `${SCA_ORBIT_SCRATCH}class CameraManager {`,
        'CameraManager class'
    );

    patched = replaceOnce(
        patched,
        `constructor(global, bbox, collision = null) {
        const { events, settings, state } = global;
        const walkAllowed = isWalkAllowed(bbox, collision);`,
        CAMERA_MANAGER_NAV_INIT,
        'CameraManager navigation init'
    );

    patched = replaceOnce(
        patched,
        `events.on('pick', (position) => {
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';`,
        `events.on('pick', (position) => {
            if (scaNavFlags.navigationTargetsEnabled === false) {
                return;
            }
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';`,
        'pick navigation guard'
    );

    patched = replaceOnce(
        patched,
        `events.on('annotation.activate', (annotation) => {
            events.fire('orbitTarget:clear');
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';
            const { initial } = annotation.camera;`,
        `events.on('annotation.activate', (annotation) => {
            events.fire('orbitTarget:clear');
            if (!annotationCameraNavigationEnabled) {
                return;
            }
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';
            const { initial } = annotation.camera;`,
        'annotation camera navigation guard'
    );

    patched = replaceOnce(
        patched,
        `events.on('navigateTo', (position, normal, speedMul = 1) => {
            const source = sourcesByMode[state.cameraMode];`,
        `events.on('navigateTo', (position, normal, speedMul = 1) => {
            if (scaNavFlags.navigationTargetsEnabled === false) {
                return;
            }
            const source = sourcesByMode[state.cameraMode];`,
        'navigateTo guard'
    );

    patched = replaceOnce(
        patched,
        '        // application update\n        this.update = (deltaTime, frame) => {',
        `        ${LOOK_AT_TARGET_METHODS}
        this.update = (deltaTime, frame) => {`,
        'lookAtTargetAnimatedWithoutMovingCamera methods'
    );

    patched = replaceOnce(
        patched,
        `            controller.update(dt, frame, target);
            if (transitionTimer < 1) {
                // lerp away from previous camera during transition
                this.camera.lerp(from, target, easeOut(transitionTimer));`,
        SCA_CAMERA_UPDATE,
        'SCA home and look animation'
    );

    patched = replaceOnce(
        patched,
        `        document.addEventListener('click', () => {
            if (Annotation.activeAnnotation === this) {
                this.hideTooltip();
            }
        });`,
        `        document.addEventListener('click', () => {
            if (scaPointerWasDrag) {
                return;
            }
            if (Annotation.activeAnnotation === this) {
                this.hideTooltip();
            }
        });`,
        'annotation click vs drag guard'
    );

    patched = replaceOnce(
        patched,
        `    _onPointerDown = (event) => {
        const global = this._global;
        if (!global)
            return;
        const { events } = global;
        // record offsets for click/tap target picking
        this._lastPointerOffsetX = event.offsetX;`,
        `    _onPointerDown = (event) => {
        const global = this._global;
        if (!global)
            return;
        const { events } = global;
        if (scaLookAnim || scaHomeAnim || scaStartupFlyAnim || scaTurntableAnim) {
            events.fire('sca:interruptCameraAnimation');
        }
        scaPointerDownX = event.clientX;
        scaPointerDownY = event.clientY;
        scaPointerWasDrag = false;
        scaDiagPointerDown = true;
        // record offsets for click/tap target picking
        this._lastPointerOffsetX = event.offsetX;`,
        'SCA pointer down tracking'
    );

    patched = replaceOnce(
        patched,
        `    _onPointerUp = (event) => {
        const global = this._global;
        if (!global)
            return;
        const { state, events } = global;
        if (this._mouseClickTracking && event.pointerType !== 'touch' && event.button === 0) {`,
        `    _onPointerUp = (event) => {
        const global = this._global;
        if (!global)
            return;
        scaDiagPointerDown = false;
        const { state, events } = global;
        if (this._mouseClickTracking && event.pointerType !== 'touch' && event.button === 0) {`,
        'SCA pointer up diagnostic'
    );

    patched = replaceOnce(
        patched,
        `    _onPointerMove = (event) => {
        const global = this._global;
        if (!global)
            return;
        const { state, events } = global;
        if (this._mouseClickTracking && event.pointerType !== 'touch') {`,
        `    _onPointerMove = (event) => {
        const global = this._global;
        if (!global)
            return;
        const { state, events } = global;
        const scaDx = event.clientX - scaPointerDownX;
        const scaDy = event.clientY - scaPointerDownY;
        if ((scaDx * scaDx + scaDy * scaDy) > SCA_DRAG_THRESHOLD_SQ) {
            scaPointerWasDrag = true;
        }
        if (this._mouseClickTracking && event.pointerType !== 'touch') {`,
        'SCA pointer drag detection'
    );

    patched = replaceOnce(
        patched,
        `events.on('navTarget:set', (pos, normal) => {
            const mode = state.cameraMode === 'walk' || state.cameraMode === 'fly' ?
                state.cameraMode : 'walk';
            this.setTarget(pos, normal, mode);
        });`,
        `events.on('navTarget:set', (pos, normal) => {
            if (scaNavFlags.navigationTargetsEnabled === false) {
                return;
            }
            const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
            const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' && scaSuppressFocusFn();
            window.scaDebug?.('navigation', '[CURSOR RING FLOW]', 'handler=navTarget:set', \`suppressed=\${scaSuppressFocus}\`);
            if (scaSuppressFocus) {
                return;
            }
            const mode = state.cameraMode === 'walk' || state.cameraMode === 'fly' ?
                state.cameraMode : 'walk';
            this.setTarget(pos, normal, mode);
        });`,
        'NavCursor navTarget guard'
    );

    patched = replaceOnce(
        patched,
        `events.on('orbitTarget:set', (pos, normal) => {
            this.navigating = false;
            this.setTarget(pos, normal, 'orbit');
        });`,
        `events.on('orbitTarget:set', (pos, normal) => {
            if (scaNavFlags.navigationTargetsEnabled === false) {
                return;
            }
            const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
            const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' && scaSuppressFocusFn();
            window.scaDebug?.('navigation', '[CURSOR RING FLOW]', 'handler=orbitTarget:set', \`suppressed=\${scaSuppressFocus}\`);
            if (scaSuppressFocus) {
                return;
            }
            this.navigating = false;
            this.setTarget(pos, normal, 'orbit');
        });`,
        'NavCursor orbitTarget guard'
    );

    patched = replaceOnce(
        patched,
        `\t_onWheel(event) {
\t\tevent.preventDefault();
\t\tthis.deltas.wheel.append([event.deltaY]);
\t}`,
        `\t_onWheel(event) {
\t\tevent.preventDefault();
\t\tif (scaLookAnim || scaHomeAnim || scaStartupFlyAnim || scaTurntableAnim) {
\t\t\twindow.dispatchEvent(new CustomEvent('sca:interruptCameraAnimation'));
\t\t}
\t\tscaDiagWheelFrameCount = 3;
\t\tif (window.SCA3D?.debug?.camera || window.SCA3D?.cameraDebugVerbose) {
\t\t\tconsole.log('[SCA3D CAMERA MOVE] wheel event', JSON.stringify({ deltaY: event.deltaY }));
\t\t}
\t\tthis.deltas.wheel.append([event.deltaY]);
\t}`,
        'SCA wheel interrupt'
    );

    patched = replaceOnce(
        patched,
        `            if (clearOrbitTargetOnTransitionEnd && prevTransitionTimer < 1 && transitionTimer === 1) {
                clearOrbitTargetOnTransitionEnd = false;
                events.fire('orbitTarget:clear');
            }
        };
        // handle input events`,
        `            if (clearOrbitTargetOnTransitionEnd && prevTransitionTimer < 1 && transitionTimer === 1) {
                clearOrbitTargetOnTransitionEnd = false;
                events.fire('orbitTarget:clear');
            }
            scaDiagMaybeLogMove(this.camera, state, transitionTimer);
        };
        // handle input events`,
        'SCA camera move diagnostics'
    );

    patched = replaceOnce(
        patched,
        `this.cameraManager = new CameraManager(global, sceneBound, collision);
            applyCamera(this.cameraManager.camera);`,
        VIEWER_SCA_API,
        'Viewer SCA API'
    );

    patched = replaceOnce(
        patched,
        `const loadSkybox = (app, url) => {
    return new Promise((resolve, reject) => {
        const asset = new Asset('skybox', 'texture', {
            url
        }, {
            type: 'rgbp',
            mipmaps: false,
            addressu: 'repeat',
            addressv: 'clamp'
        });
        asset.on('load', () => {
            resolve(asset);
        });
        asset.on('error', (err) => {
            console.log(err);
            reject(err);
        });
        app.assets.add(asset);
        app.assets.load(asset);
    });
};`,
        SKYBOX_LOAD,
        'equirect skybox loader'
    );

    patched = replaceOnce(
        patched,
        `    const skyboxLoad = config.skyboxUrl &&
        loadSkybox(app, config.skyboxUrl).then((asset) => {
            app.scene.envAtlas = asset.resource;
        }).catch((err) => {
            console.warn('Failed to load skybox:', err);
        });`,
        SKYBOX_ASSIGN,
        'skybox cubemap assignment'
    );

    if (!patched.includes('scaInstallRuntimePicker')) {
        patched = replaceOnce(
            patched,
            'this.pickSurface = (x, y) => serializePick(() => pickSurface(x, y));',
            `this.pickSurface = (x, y) => serializePick(() => pickSurface(x, y));
        ${SCA_VIEWER_PICK_SEAM}`,
            'SCA modular runtime picker'
        );
    }

    patched = replaceOnce(
        patched,
        'this.picker = new Picker(app, camera);',
        `this.picker = new Picker(app, camera);
            let scaRegionHighlightShaderReady = __SCA_REGION_HIGHLIGHT_SHADER_READY__;
            let scaRegionHighlightTexture = null;
            let scaRegionHighlightBuffer = null;
            let scaRegionHighlightMaterial = null;
            let scaRegionHighlightTexWidth = 0;
            let scaRegionHighlightTexHeight = 0;
            let scaRegionHighlightGaussianCount = 0;
            let scaRegionHighlightLastDiag = '';
            let scaRegionPulseTexture = null;
            let scaRegionPulseBuffer = null;
            let scaRegionPulseActive = false;
            let scaRegionStateOverlayTexture = null;
            let scaRegionStateOverlayBuffer = null;
            let scaRegionStateOverlayActive = false;
            const scaFindGsplatMaterial = () => {
                const sceneMaterial = app.scene?.gsplat?.material ?? null;
                if (sceneMaterial) {
                    return sceneMaterial;
                }
                const components = app.root.findComponents('gsplat') ?? [];
                for (const component of components) {
                    const material = component?.instance?.material ?? component?.material ?? null;
                    if (material) {
                        return material;
                    }
                }
                return null;
            };
            const scaGetHighlightLayout = (gaussianCount) => {
                const components = app.root.findComponents('gsplat') ?? [];
                const component = components[0];
                const resource = component?.resource ?? component?._resource ?? component?._placement?.resource ?? null;
                const dims = resource?.textureDimensions ?? resource?.streams?.textureDimensions ?? null;
                if (dims?.x > 0 && dims?.y > 0) {
                    const width = dims.x;
                    const height = Math.max(dims.y, Math.ceil(gaussianCount / width));
                    return {
                        width,
                        height,
                        bufferSize: width * height,
                        source: 'gsplat.textureDimensions'
                    };
                }
                const splatTextureSize = app.scene?.gsplat?.material?.getParameter?.('splatTextureSize')?.data;
                if (typeof splatTextureSize === 'number' && splatTextureSize > 0) {
                    const width = splatTextureSize;
                    const height = Math.ceil(gaussianCount / width);
                    return {
                        width,
                        height,
                        bufferSize: width * height,
                        source: 'splatTextureSize'
                    };
                }
                const width = Math.ceil(Math.sqrt(gaussianCount));
                const height = Math.ceil(gaussianCount / width);
                return {
                    width,
                    height,
                    bufferSize: width * height,
                    source: 'calcTextureSize'
                };
            };
            this.initScaRegionHighlight = (gaussianCount) => {
                const stage = 'initScaRegionHighlight';
                try {
                    if (app.graphicsDevice.isWebGPU) {
                        console.log('[SCA REGION] highlight skipped on WebGPU (tint disabled; picker/cursor/card active)');
                        return false;
                    }
                    if (!scaRegionHighlightShaderReady) {
                        console.warn('[SCA REGION] highlight skipped on WebGL2 (unsupported shader variant)', {
                            stage,
                            gaussianCount,
                            renderer: 'webgl',
                            scaRegionHighlightShaderReady
                        });
                        return false;
                    }
                    const material = scaFindGsplatMaterial();
                    if (!material) {
                        console.error('[SCA REGION] highlight init failed: gsplat material not found', {
                            stage,
                            gaussianCount,
                            renderer: app.graphicsDevice.isWebGPU ? 'webgpu' : 'webgl',
                            sceneGsplatMaterial: !!app.scene?.gsplat?.material,
                            gsplatComponents: (app.root.findComponents('gsplat') ?? []).length
                        });
                        return false;
                    }
                    if (gaussianCount <= 0) {
                        console.error('[SCA REGION] highlight init failed: invalid gaussianCount', {
                            stage,
                            gaussianCount
                        });
                        return false;
                    }
                    const layout = scaGetHighlightLayout(gaussianCount);
                    const maxTextureSize = app.graphicsDevice.maxTextureSize ?? 16384;
                    if (layout.width > maxTextureSize || layout.height > maxTextureSize) {
                        console.error('[SCA REGION] highlight init failed: texture exceeds maxTextureSize', {
                            stage,
                            gaussianCount,
                            layout,
                            maxTextureSize,
                            renderer: app.graphicsDevice.isWebGPU ? 'webgpu' : 'webgl'
                        });
                        return false;
                    }
                    scaRegionHighlightMaterial = material;
                    scaRegionHighlightTexWidth = layout.width;
                    scaRegionHighlightTexHeight = layout.height;
                    scaRegionHighlightGaussianCount = gaussianCount;
                    const bufferSize = layout.bufferSize;
                    if (bufferSize < gaussianCount) {
                        console.error('[SCA REGION] highlight init failed: buffer smaller than gaussianCount', {
                            stage,
                            gaussianCount,
                            bufferSize,
                            layout
                        });
                        return false;
                    }
                    scaRegionHighlightBuffer = new Uint8Array(bufferSize);
                    scaRegionHighlightTexture = new Texture(app.graphicsDevice, {
                        name: 'scaRegionHighlight',
                        width: layout.width,
                        height: layout.height,
                        format: PIXELFORMAT_RGBA8,
                        mipmaps: false,
                        minFilter: FILTER_NEAREST,
                        magFilter: FILTER_NEAREST,
                        addressU: ADDRESS_CLAMP_TO_EDGE,
                        addressV: ADDRESS_CLAMP_TO_EDGE
                    });
                    const initLocked = scaRegionHighlightTexture.lock();
                    initLocked.fill(0);
                    scaRegionHighlightTexture.unlock();
                    console.log('[SCA REGION HIGHLIGHT TEXTURE]', {
                        width: scaRegionHighlightTexture.width,
                        height: scaRegionHighlightTexture.height,
                        format: 'RGBA8',
                        lockedLength: initLocked.length,
                        gaussianCount,
                        layoutSource: layout.source
                    });
                    material.setDefine('SCA_REGION_HIGHLIGHT', true);
                    material.setParameter('scaRegionHighlight', scaRegionHighlightTexture);
                    material.setParameter('scaRegionHighlightClr', [1, 0.4, 0, 0.5]);
                    material.setParameter('scaRegionHoverClr', [1, 0.75, 0.2, 0.35]);
                    material.setParameter('scaRegionVisitedClr', [1, 0.4, 0, 0.35]);
                    material.setParameter('scaRegionHighlightActive', 0);
                    material.setParameter('scaRegionHighlightTexWidth', layout.width);
                    material.setParameter('scaRegionHighlightTexHeight', layout.height);
                    scaRegionPulseBuffer = new Uint8Array(bufferSize);
                    scaRegionPulseTexture = new Texture(app.graphicsDevice, {
                        name: 'scaRegionPulse',
                        width: layout.width,
                        height: layout.height,
                        format: PIXELFORMAT_RGBA8,
                        mipmaps: false,
                        minFilter: FILTER_NEAREST,
                        magFilter: FILTER_NEAREST,
                        addressU: ADDRESS_CLAMP_TO_EDGE,
                        addressV: ADDRESS_CLAMP_TO_EDGE
                    });
                    const pulseLocked = scaRegionPulseTexture.lock();
                    pulseLocked.fill(0);
                    scaRegionPulseTexture.unlock();
                    material.setParameter('scaRegionPulse', scaRegionPulseTexture);
                    material.setParameter('scaRegionPulseClr', [1, 0.4, 0, 1]);
                    material.setParameter('scaRegionPulseActive', 0);
                    material.setParameter('scaRegionPulseStrength', 0.5);
                    material.setParameter('scaRegionPulseSpeed', 1);
                    material.setParameter('scaRegionPulseTime', 0);
                    material.setParameter('scaRegionPulseOnce', 0);
                    scaRegionStateOverlayBuffer = new Uint8Array(bufferSize);
                    scaRegionStateOverlayTexture = new Texture(app.graphicsDevice, {
                        name: 'scaRegionStateOverlay',
                        width: layout.width,
                        height: layout.height,
                        format: PIXELFORMAT_RGBA8,
                        mipmaps: false,
                        minFilter: FILTER_NEAREST,
                        magFilter: FILTER_NEAREST,
                        addressU: ADDRESS_CLAMP_TO_EDGE,
                        addressV: ADDRESS_CLAMP_TO_EDGE
                    });
                    const overlayLocked = scaRegionStateOverlayTexture.lock();
                    overlayLocked.fill(0);
                    scaRegionStateOverlayTexture.unlock();
                    material.setParameter('scaRegionStateOverlay', scaRegionStateOverlayTexture);
                    material.setParameter('scaRegionStateOverlayClr', [0, 0.67, 1, 0.4]);
                    material.setParameter('scaRegionStateOverlayActive', 0);
                    material.update();
                    app.renderNextFrame = true;
                    console.log('[SCA REGION] highlight texture created', {
                        width: layout.width,
                        height: layout.height,
                        gaussianCount,
                        format: 'RGBA8',
                        layoutSource: layout.source,
                        renderer: app.graphicsDevice.isWebGPU ? 'webgpu' : 'webgl'
                    });
                    return true;
                } catch (error) {
                    console.error('[SCA REGION] highlight init failed', error, {
                        stage,
                        gaussianCount,
                        renderer: app.graphicsDevice.isWebGPU ? 'webgpu' : 'webgl',
                        stack: error?.stack
                    });
                    scaRegionHighlightTexture = null;
                    scaRegionHighlightBuffer = null;
                    scaRegionHighlightMaterial = null;
                    scaRegionHighlightTexWidth = 0;
                    scaRegionHighlightTexHeight = 0;
                    scaRegionHighlightGaussianCount = 0;
                    scaRegionPulseTexture = null;
                    scaRegionPulseBuffer = null;
                    scaRegionPulseActive = false;
                    scaRegionStateOverlayTexture = null;
                    scaRegionStateOverlayBuffer = null;
                    scaRegionStateOverlayActive = false;
                    return false;
                }
            };
            this.setScaRegionHighlight = (bitset, color, active) => {
                if (!scaRegionHighlightTexture || !scaRegionHighlightMaterial || !scaRegionHighlightBuffer) {
                    return { nonZeroMask: 0, enabled: false, uploaded: false, bufferSize: 0 };
                }
                let nonZeroMask = 0;
                scaRegionHighlightBuffer.fill(0);
                const locked = scaRegionHighlightTexture.lock();
                locked.fill(0);
                if (bitset && active) {
                    const limit = Math.min(
                        bitset.length,
                        scaRegionHighlightGaussianCount,
                        scaRegionHighlightBuffer.length
                    );
                    for (let i = 0; i < limit; i++) {
                        if (bitset[i]) {
                            scaRegionHighlightBuffer[i] = 255;
                            locked[i * 4] = 255;
                            nonZeroMask++;
                        }
                    }
                }
                scaRegionHighlightTexture.unlock();
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightClr', color);
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightActive', active ? 1 : 0);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
                const diagKey = \`\${active ? 1 : 0}:\${nonZeroMask}:\${color?.join?.(',') ?? ''}\`;
                if (diagKey !== scaRegionHighlightLastDiag) {
                    scaRegionHighlightLastDiag = diagKey;
                    window.scaDebug?.('regions', '[SCA REGION HIGHLIGHT]', {
                        nonZeroMask,
                        enabled: !!active,
                        tint: color,
                        opacity: color?.[3],
                        gaussianCount: scaRegionHighlightGaussianCount,
                        bufferSize: locked.length,
                        texWidth: scaRegionHighlightTexWidth,
                        texHeight: scaRegionHighlightTexHeight,
                        textureWidth: scaRegionHighlightTexture.width,
                        textureHeight: scaRegionHighlightTexture.height
                    });
                }
                return {
                    nonZeroMask,
                    enabled: !!active,
                    uploaded: true,
                    bufferSize: locked.length,
                    gaussianCount: scaRegionHighlightGaussianCount
                };
            };
            this.setScaRegionHighlightCombined = (selectedBitset, hoverBitset, selectedColor, hoverColor, visitedBitset, visitedColor) => {
                if (!scaRegionHighlightTexture || !scaRegionHighlightMaterial || !scaRegionHighlightBuffer) {
                    return { nonZeroMask: 0, enabled: false, uploaded: false, bufferSize: 0 };
                }
                const SCA_REGION_STATE_HOVER = 85;
                const SCA_REGION_STATE_VISITED = 170;
                const SCA_REGION_STATE_SELECTED = 255;
                let nonZeroMask = 0;
                let selectedCount = 0;
                let hoverCount = 0;
                let visitedCount = 0;
                scaRegionHighlightBuffer.fill(0);
                const locked = scaRegionHighlightTexture.lock();
                locked.fill(0);
                const limit = Math.min(
                    scaRegionHighlightGaussianCount,
                    scaRegionHighlightBuffer.length
                );
                for (let i = 0; i < limit; i++) {
                    let state = 0;
                    if (visitedBitset?.[i]) {
                        state = SCA_REGION_STATE_VISITED;
                        visitedCount++;
                    }
                    if (selectedBitset?.[i]) {
                        state = SCA_REGION_STATE_SELECTED;
                        selectedCount++;
                    } else if (hoverBitset?.[i]) {
                        state = SCA_REGION_STATE_HOVER;
                        hoverCount++;
                    }
                    if (state) {
                        scaRegionHighlightBuffer[i] = state;
                        locked[i * 4] = state;
                        nonZeroMask++;
                    }
                }
                scaRegionHighlightTexture.unlock();
                const enabled = nonZeroMask > 0;
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightClr', selectedColor);
                scaRegionHighlightMaterial.setParameter('scaRegionHoverClr', hoverColor);
                scaRegionHighlightMaterial.setParameter('scaRegionVisitedClr', visitedColor ?? [0, 0, 0, 0]);
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightActive', enabled ? 1 : 0);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
                const diagKey = \`\${selectedCount}:\${hoverCount}:\${visitedCount}:\${nonZeroMask}:\${selectedColor?.join?.(',') ?? ''}:\${hoverColor?.join?.(',') ?? ''}:\${visitedColor?.join?.(',') ?? ''}\`;
                if (diagKey !== scaRegionHighlightLastDiag) {
                    scaRegionHighlightLastDiag = diagKey;
                    window.scaDebug?.('regions', '[SCA REGION HIGHLIGHT]', {
                        nonZeroMask,
                        selectedCount,
                        hoverCount,
                        visitedCount,
                        enabled,
                        selectedTint: selectedColor,
                        hoverTint: hoverColor,
                        visitedTint: visitedColor,
                        gaussianCount: scaRegionHighlightGaussianCount,
                        bufferSize: locked.length,
                        texWidth: scaRegionHighlightTexWidth,
                        texHeight: scaRegionHighlightTexHeight,
                        textureWidth: scaRegionHighlightTexture.width,
                        textureHeight: scaRegionHighlightTexture.height
                    });
                }
                return {
                    nonZeroMask,
                    selectedCount,
                    hoverCount,
                    visitedCount,
                    enabled,
                    uploaded: true,
                    bufferSize: locked.length,
                    gaussianCount: scaRegionHighlightGaussianCount
                };
            };
            this.setScaRegionPulse = (bitset, color, strength, speed, time, once, active) => {
                if (!scaRegionPulseTexture || !scaRegionHighlightMaterial || !scaRegionPulseBuffer) {
                    return { nonZeroMask: 0, enabled: false, uploaded: false, bufferSize: 0 };
                }
                let nonZeroMask = 0;
                scaRegionPulseBuffer.fill(0);
                const locked = scaRegionPulseTexture.lock();
                locked.fill(0);
                if (bitset && active) {
                    const limit = Math.min(
                        scaRegionHighlightGaussianCount,
                        scaRegionPulseBuffer.length
                    );
                    for (let i = 0; i < limit; i++) {
                        if (bitset[i]) {
                            scaRegionPulseBuffer[i] = 255;
                            locked[i * 4] = 255;
                            nonZeroMask++;
                        }
                    }
                }
                scaRegionPulseTexture.unlock();
                scaRegionPulseActive = !!active && nonZeroMask > 0;
                scaRegionHighlightMaterial.setParameter('scaRegionPulseClr', color);
                scaRegionHighlightMaterial.setParameter('scaRegionPulseStrength', strength ?? 0.5);
                scaRegionHighlightMaterial.setParameter('scaRegionPulseSpeed', speed ?? 1);
                scaRegionHighlightMaterial.setParameter('scaRegionPulseTime', time ?? 0);
                scaRegionHighlightMaterial.setParameter('scaRegionPulseOnce', once ? 1 : 0);
                scaRegionHighlightMaterial.setParameter('scaRegionPulseActive', scaRegionPulseActive ? 1 : 0);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
                return {
                    nonZeroMask,
                    enabled: scaRegionPulseActive,
                    uploaded: true,
                    bufferSize: locked.length,
                    gaussianCount: scaRegionHighlightGaussianCount
                };
            };
            this.updateScaRegionPulseTime = (time) => {
                if (!scaRegionHighlightMaterial || !scaRegionPulseActive) {
                    return;
                }
                scaRegionHighlightMaterial.setParameter('scaRegionPulseTime', time);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
            };
            this.clearScaRegionPulse = () => {
                this.setScaRegionPulse(null, [0, 0, 0, 0], 0.5, 1, 0, false, false);
            };
            this.setScaRegionStateOverlay = (bitset, color, active) => {
                if (!scaRegionStateOverlayTexture || !scaRegionHighlightMaterial || !scaRegionStateOverlayBuffer) {
                    return { nonZeroMask: 0, enabled: false, uploaded: false, bufferSize: 0 };
                }
                let nonZeroMask = 0;
                scaRegionStateOverlayBuffer.fill(0);
                const locked = scaRegionStateOverlayTexture.lock();
                locked.fill(0);
                if (bitset && active) {
                    const limit = Math.min(
                        scaRegionHighlightGaussianCount,
                        scaRegionStateOverlayBuffer.length
                    );
                    for (let i = 0; i < limit; i++) {
                        if (bitset[i]) {
                            scaRegionStateOverlayBuffer[i] = 255;
                            locked[i * 4] = 255;
                            nonZeroMask++;
                        }
                    }
                }
                scaRegionStateOverlayTexture.unlock();
                scaRegionStateOverlayActive = !!active && nonZeroMask > 0;
                scaRegionHighlightMaterial.setParameter('scaRegionStateOverlayClr', color);
                scaRegionHighlightMaterial.setParameter('scaRegionStateOverlayActive', scaRegionStateOverlayActive ? 1 : 0);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
                return {
                    nonZeroMask,
                    enabled: scaRegionStateOverlayActive,
                    uploaded: true,
                    bufferSize: locked.length,
                    gaussianCount: scaRegionHighlightGaussianCount
                };
            };
            this.clearScaRegionStateOverlay = () => {
                this.setScaRegionStateOverlay(null, [0, 0, 0, 0], false);
            };
            this.clearScaRegionHighlight = () => {
                this.setScaRegionHighlight(null, [0, 0, 0, 0], false);
            };
            window.SCA3D = window.SCA3D || {};
            window.SCA3D.dumpPickTarget = () => this.picker?.dumpPickTarget?.();
            events.fire('scaPickerReady'); // SCA_PICK_GAUSSIAN`,
        'SCA region highlight and modular picker ready'
    );

    patched = replaceOnce(
        patched,
        `    _updateCursor = () => {
        const global = this._global;
        const canvas = this._canvas;
        if (!global || !canvas)
            return;
        const { state } = global;
        const canClickTarget = state.inputMode === 'desktop' && ((state.cameraMode === 'walk' && !state.gamingControls) ||
            canTargetFly(global) ||
            state.cameraMode === 'orbit');
        if (canClickTarget) {
            canvas.style.cursor = this._mouseClickTracking ? 'default' : 'pointer';
        }
        else {
            canvas.style.cursor = '';
        }
    };`,
        `    _updateCursor = () => {
        const global = this._global;
        const canvas = this._canvas;
        if (!global || !canvas)
            return;
        if (scaNavFlags.navigationTargetsEnabled === false) {
            canvas.style.removeProperty('cursor');
            return;
        }
        const { state } = global;
        const canClickTarget = state.inputMode === 'desktop' && ((state.cameraMode === 'walk' && !state.gamingControls) ||
            canTargetFly(global) ||
            state.cameraMode === 'orbit');
        if (canClickTarget) {
            canvas.style.cursor = this._mouseClickTracking ? 'default' : 'pointer';
        }
        else {
            canvas.style.removeProperty('cursor');
        }
    };`,
        'SCA NavInteraction cursor guard'
    );

    patched = replaceOnce(
        patched,
        `            if (this._mouseClickDelta < TAP_EPSILON) {
                if (state.cameraMode === 'walk' && !state.gamingControls) {
                    const result = this._pickCollision(this._lastPointerOffsetX, this._lastPointerOffsetY);
                    if (result) {
                        const speedMul = computeClickSpeedMul(event, state.cameraMode);
                        events.fire('navigateTo', result.position, result.normal, speedMul);
                    }
                }
                else if (state.cameraMode === 'fly') {
                    this._flyToPickedPosition(this._lastPointerOffsetX, this._lastPointerOffsetY, event);
                }
                else if (state.cameraMode === 'orbit') {
                    this._focusPickedPosition(this._lastPointerOffsetX, this._lastPointerOffsetY);
                }
            }`,
        `            if (this._mouseClickDelta < TAP_EPSILON) {
                const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
                const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' &&
                    scaSuppressFocusFn(this._lastPointerOffsetX, this._lastPointerOffsetY);
                window.scaDebug?.('navigation', '[NAV CLICK FLOW]', 'handler=_onPointerUp', \`suppressed=\${scaSuppressFocus}\`);
                if (scaSuppressFocus) {
                    return;
                }
                if (state.cameraMode === 'walk' && !state.gamingControls) {
                    const result = this._pickCollision(this._lastPointerOffsetX, this._lastPointerOffsetY);
                    if (result) {
                        const speedMul = computeClickSpeedMul(event, state.cameraMode);
                        events.fire('navigateTo', result.position, result.normal, speedMul);
                    }
                }
                else if (state.cameraMode === 'fly') {
                    this._flyToPickedPosition(this._lastPointerOffsetX, this._lastPointerOffsetY, event);
                }
                else if (state.cameraMode === 'orbit') {
                    this._focusPickedPosition(this._lastPointerOffsetX, this._lastPointerOffsetY);
                }
            }`,
        'SCA region click focus suppress'
    );

    patched = replaceOnce(
        patched,
        `    async _focusPickedPosition(offsetX, offsetY) {
        const global = this._global;
        if (!global || global.state.cameraMode !== 'orbit')
            return;
        const request = ++this._targetPickRequest;
        const target = await this._pickSceneTarget(offsetX, offsetY);`,
        `    async _focusPickedPosition(offsetX, offsetY) {
        const global = this._global;
        if (!global || global.state.cameraMode !== 'orbit')
            return;
        const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
        const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' && scaSuppressFocusFn(offsetX, offsetY);
        window.scaDebug?.('navigation', '[NAV FOCUS FLOW]', 'handler=_focusPickedPosition', \`suppressed=\${scaSuppressFocus}\`);
        if (scaSuppressFocus) {
            return;
        }
        const request = ++this._targetPickRequest;
        const target = await this._pickSceneTarget(offsetX, offsetY);`,
        'SCA focusPickedPosition region suppress'
    );

    patched = replaceOnce(
        patched,
        `    setTarget(pos, normal, mode) {
        this.targetPos = pos.clone();
        this.targetNormal = normal.clone();
        this.targetMode = mode;
        this.hoverRing.hide();
        this.targetRing.hide();
    }`,
        `    setTarget(pos, normal, mode) {
        const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
        const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' && scaSuppressFocusFn();
        window.scaDebug?.('navigation', '[CURSOR RING FLOW]', 'handler=setTarget', \`suppressed=\${scaSuppressFocus}\`);
        if (scaSuppressFocus) {
            return;
        }
        this.targetPos = pos.clone();
        this.targetNormal = normal.clone();
        this.targetMode = mode;
        this.hoverRing.hide();
        this.targetRing.hide();
    }`,
        'SCA NavCursor setTarget suppress'
    );

    patched = replaceOnce(
        patched,
        `    _onMobileTap = () => {
        const global = this._global;
        if (!global)
            return;
        const { state, events } = global;
        if (this._suppressClick) {
            this._suppressClick = false;
            return;
        }
        if (state.cameraMode === 'walk' && !state.gamingControls) {`,
        `    _onMobileTap = () => {
        const global = this._global;
        if (!global)
            return;
        const { state, events } = global;
        if (this._suppressClick) {
            this._suppressClick = false;
            return;
        }
        const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
        const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' &&
            scaSuppressFocusFn(this._lastPointerOffsetX, this._lastPointerOffsetY);
        if (scaSuppressFocus) {
            return;
        }
        if (state.cameraMode === 'walk' && !state.gamingControls) {`,
        'SCA mobile tap region focus suppress'
    );

    patched = replaceOnce(
        patched,
        `        const request = ++this._targetPickRequest;
        const target = await this._pickSceneTarget(event.offsetX, event.offsetY);
        if (!target || request !== this._targetPickRequest)
            return;
        const currentMode = this._global?.state.cameraMode;
        if (currentMode === 'fly') {`,
        `        const request = ++this._targetPickRequest;
        const target = await this._pickSceneTarget(event.offsetX, event.offsetY);
        if (!target || request !== this._targetPickRequest)
            return;
        const scaSuppressFocusFn = window.SCA3D?.shouldSuppressViewerClickFocus;
        const scaSuppressFocus = typeof scaSuppressFocusFn === 'function' &&
            scaSuppressFocusFn(event.offsetX, event.offsetY);
        if (scaSuppressFocus) {
            return;
        }
        const currentMode = this._global?.state.cameraMode;
        if (currentMode === 'fly') {`,
        'SCA dblclick region focus suppress'
    );

    const highlightShaderPatch = applyScaRegionHighlightGlslPatches(patched);
    patched = highlightShaderPatch.source.replace(
        'let scaRegionHighlightShaderReady = __SCA_REGION_HIGHLIGHT_SHADER_READY__;',
        `let scaRegionHighlightShaderReady = ${highlightShaderPatch.ok};`
    );

    // Background = [0,0,0,0]; stored pick ID = gaussianIndex + 1.
    patched = patched.replace(
        /output\.color = encodePickOutput\(vPickId\);/g,
        'output.color = encodePickOutput(vPickId + 1u);'
    );
    patched = patched.replace(
        /pcFragColor0 = encodePickOutput\(vPickId\);/g,
        'pcFragColor0 = encodePickOutput(vPickId + 1u);'
    );

    verifyNoInvalidWgslHighlightInjection(patched);
    verifyPickerPatch(patched);
    if (highlightShaderPatch.ok) {
        verifyGlslHighlightPatch(patched);
    }
    if (!patched.includes('const SCA_REGION_STATE_VISITED = 170')) {
        throw new Error('[SCA] viewer highlight patch failed: missing SCA_REGION_STATE_VISITED encoding');
    }
    return patched;
};

export {
    patchViewerBundle,
    applyScaRegionHighlightGlslPatches,
    verifyPickerPatch,
    verifyNoInvalidWgslHighlightInjection,
    verifyGlslHighlightPatch,
    PICKER_PATCH_MARKERS
};
