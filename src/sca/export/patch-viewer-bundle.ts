/**
 * Patches the exported SuperSplat Viewer bundle with SCA camera/navigation hooks.
 * Applied to index.js (and inlined JS in html-bundle exports) at package build time.
 */

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
                console.log('[SCA3D] home transition complete');
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
                console.log('[SCA3D] home transition frame', JSON.stringify({ t: homeT, position: [px, py, pz] }));
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
                    console.log('[SCA3D] home transition complete');
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
    'this.pickGaussian = async',
    'scaPickerReady'
] as const;

const verifyPickerPatch = (source: string): void => {
    for (const marker of PICKER_PATCH_MARKERS) {
        if (!source.includes(marker)) {
            throw new Error(`[SCA] viewer picker patch failed: missing "${marker}"`);
        }
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
    if (!source.includes('flat varying float scaGaussianIndex')) {
        throw new Error('[SCA] viewer GLSL highlight patch failed: missing flat varying scaGaussianIndex');
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
            trial = trial.replace(
                'vec4 fragColor = vec4(gaussianColor.xyz, alpha);',
                `vec4 fragColor = vec4(gaussianColor.xyz, alpha);
        #ifdef SCA_REGION_HIGHLIGHT
        if (scaRegionHighlightActive > 0.5) {
            float regionMask = texelFetch(scaRegionHighlight, ivec2(int(scaGaussianIndex) % int(splatTextureSize), int(scaGaussianIndex) / int(splatTextureSize)), 0).r;
            if (regionMask > 0.0) {
                fragColor.xyz = mix(fragColor.xyz, scaRegionHighlightClr.xyz, scaRegionHighlightClr.a * regionMask);
            }
        }
        #endif`
            );
        }

        if (trial.includes('varying mediump vec4 gaussianColor;\n#ifndef DITHER_NONE')) {
            trial = trial.replace(
                'varying mediump vec4 gaussianColor;\n#ifndef DITHER_NONE',
                'varying mediump vec4 gaussianColor;\nflat varying float scaGaussianIndex;\n#ifndef DITHER_NONE'
            );
        }

        if (trial.includes('#ifndef DITHER_NONE\n\tvarying float id;\n#endif\nmediump vec4 discardVec')) {
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
uniform float scaRegionHighlightActive;
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
\t\tconsole.log('[SCA3D CAMERA MOVE] wheel event', JSON.stringify({ deltaY: event.deltaY }));
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

    patched = replaceOnce(
        patched,
        'this.pickSurface = (x, y) => serializePick(() => pickSurface(x, y));',
        `this.pickSurface = (x, y) => serializePick(() => pickSurface(x, y));
        let scaIdPickPass = null;
        let scaIdPickTarget = null;
        let scaIdPickBuffer = null;
        let scaIdCacheValid = false;
        let scaIdCacheWidth = 0;
        let scaIdCacheHeight = 0;
        let scaIdPickIdsEnabled = false;
        let scaLastPickPassDiag = null;
        let idPickQueue = Promise.resolve();
        const serializeIdPick = (op) => {
            const next = idPickQueue.then(() => op());
            idPickQueue = next.catch(() => {});
            return next;
        };
        const scaIdClearColor = new Color(0, 0, 0, 0);
        const scaGetSceneCamera = () => camera.camera.camera;
        const scaGetCameraComponent = () => camera.camera;
        const scaPickChannel = (value) => {
            const n = Number(value);
            if (!Number.isFinite(n)) {
                return 0;
            }
            return n <= 1 ? Math.round(n * 255) : Math.round(n);
        };
        const scaDecodePickPixel = (pixels) => {
            const r = scaPickChannel(pixels[0]);
            const g = scaPickChannel(pixels[1]);
            const b = scaPickChannel(pixels[2]);
            const a = scaPickChannel(pixels[3]);
            if (r === 0 && g === 0 && b === 0 && a === 0) {
                return { gaussianIndex: null, rawRGBA: [r, g, b, a] };
            }
            const storedId = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
            if (storedId === 0 || storedId === 0xffffffff) {
                return { gaussianIndex: null, rawRGBA: [r, g, b, a] };
            }
            return { gaussianIndex: storedId - 1, rawRGBA: [r, g, b, a] };
        };
        const scaCollectPickPassDiagnostics = (worldLayer, width, height, pickMI) => {
            const sceneCam = scaGetSceneCamera();
            const camComp = scaGetCameraComponent();
            const director = app.renderer.gsplatDirector;
            const cameraData = director?.camerasMap?.get(sceneCam);
            const layerData = cameraData?.layersMap?.get(worldLayer);
            const manager = layerData?.gsplatManager;
            const worldState = manager?.world?.getState(manager.world.currentVersion);
            const pickMaterial = pickMI?.material;
            return {
                renderPassExecuted: false,
                cameraEntity: camera?.name ?? 'camera',
                cameraLayers: camComp?.layers ? camComp.layers.slice() : [],
                worldLayerId: worldLayer?.id,
                worldLayerName: worldLayer?.name,
                worldLayerEnabled: !!worldLayer?.enabled,
                cameraInWorldLayer: !!worldLayer?.camerasSet?.has(sceneCam),
                gsplatDirectorPresent: !!director,
                gsplatManagerPresent: !!manager,
                gsplatIncluded: !!pickMI,
                gsplatVisible: pickMI?.visible !== false,
                gsplatInstancingCount: pickMI?.instancingCount ?? 0,
                gsplatEnableIdsBefore: scaIdPickIdsEnabled,
                gsplatEnableIdsDuring: app.scene.gsplat.enableIds,
                sortedBefore: !!worldState?.sortedBefore,
                totalActiveSplats: worldState?.totalActiveSplats ?? 0,
                usesGpuSort: !!manager?.renderer?.usesGpuSort,
                pickUnifiedIdDefine: !!pickMaterial?.getDefine?.('GSPLAT_UNIFIED_ID'),
                pickCustomIdDefine: !!pickMaterial?.getDefine?.('PICK_CUSTOM_ID'),
                pickPassVariant: !!pickMaterial?.getDefine?.('GSPLAT_UNIFIED_ID'),
                gsplatPlacementCount: worldLayer?.gsplatPlacements?.length ?? 0,
                clearColor: [scaIdClearColor.r, scaIdClearColor.g, scaIdClearColor.b, scaIdClearColor.a],
                targetWidth: width,
                targetHeight: height
            };
        };
        const scaLogPickPassDiagnostics = (diag) => {
            if (!window.SCA3D?.pickPassDebug && !window.SCA3D?.pickDebugLog) {
                return;
            }
            console.log('[SCA PICK PASS]');
            console.log('drawCalls:', diag.drawCallsEstimate ?? 0);
            console.log('gsplatIncluded:', diag.gsplatIncluded);
            console.log('pickPassVariant:', diag.pickPassVariant);
            console.log('renderPassExecuted:', diag.renderPassExecuted);
            console.log('cameraInWorldLayer:', diag.cameraInWorldLayer);
            console.log('sortedBefore:', diag.sortedBefore);
            console.log('enableIds:', diag.gsplatEnableIdsDuring);
            console.log('instancingCount:', diag.gsplatInstancingCount);
            console.log('placements:', diag.gsplatPlacementCount);
            console.log('detail:', diag);
        };
        const scaEnsureCameraOnWorldLayer = (worldLayer) => {
            const sceneCam = scaGetSceneCamera();
            if (!worldLayer?.camerasSet?.has(sceneCam)) {
                worldLayer.addCamera(scaGetCameraComponent());
            }
        };
        const scaWaitForUnifiedGsplatPick = async (worldLayer, width, height) => {
            const sceneCam = scaGetSceneCamera();
            const director = app.renderer.gsplatDirector;
            if (!director) {
                return null;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            if (!app.scene.gsplat.enableIds) {
                app.scene.gsplat.enableIds = true;
                scaIdPickIdsEnabled = true;
            }
            for (let attempt = 0; attempt < 40; attempt++) {
                app.renderNextFrame = true;
                await new Promise((resolve) => app.once('frameend', resolve));
                const pickMI = director.prepareForPicking(sceneCam, width, height, worldLayer);
                if (pickMI && pickMI.instancingCount > 0) {
                    return pickMI;
                }
            }
            return director.prepareForPicking(sceneCam, width, height, worldLayer);
        };
        const scaCountPickTargetNonZero = async (width, height) => {
            const step = Math.max(8, Math.floor(Math.min(width, height) / 32));
            const flipY = graphicsDevice.isWebGL2 || graphicsDevice.isWebGPU;
            let nonZeroPixels = 0;
            let samples = 0;
            for (let y = 0; y < height; y += step) {
                for (let x = 0; x < width; x += step) {
                    const texY = flipY ? height - y - 1 : y;
                    const px = await scaIdPickBuffer.read(x, texY, 1, 1, {
                        renderTarget: scaIdPickTarget,
                        immediate: true
                    });
                    samples++;
                    if (scaPickChannel(px[0]) > 0 || scaPickChannel(px[1]) > 0 ||
                        scaPickChannel(px[2]) > 0 || scaPickChannel(px[3]) > 0) {
                        nonZeroPixels++;
                    }
                }
            }
            return { nonZeroPixels, samples, step, targetWidth: width, targetHeight: height };
        };
        const scaEnsureIdPickRendered = async (width, height, worldLayer) => {
            if (scaIdCacheValid &&
                scaIdCacheWidth === width &&
                scaIdCacheHeight === height &&
                cameraMatches(width, height)) {
                return scaLastPickPassDiag;
            }
            const depthPickerPatchesActive = !!pickerShaderPatchState.get(graphicsDevice);
            if (!app.scene.gsplat.enableIds) {
                app.scene.gsplat.enableIds = true;
                scaIdPickIdsEnabled = true;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            const pickMI = await scaWaitForUnifiedGsplatPick(worldLayer, width, height);
            let diag = scaCollectPickPassDiagnostics(worldLayer, width, height, pickMI);
            try {
                if (!scaIdPickPass) {
                    scaIdPickBuffer = new Texture(graphicsDevice, {
                        format: PIXELFORMAT_RGBA8,
                        width,
                        height,
                        mipmaps: false,
                        minFilter: FILTER_NEAREST,
                        magFilter: FILTER_NEAREST,
                        addressU: ADDRESS_CLAMP_TO_EDGE,
                        addressV: ADDRESS_CLAMP_TO_EDGE,
                        name: 'sca-picker-id'
                    });
                    scaIdPickTarget = new RenderTarget({
                        colorBuffer: scaIdPickBuffer,
                        depth: true
                    });
                    scaIdPickPass = new RenderPassPicker(graphicsDevice, app.renderer);
                    scaIdPickPass.blendState = BlendState.NOBLEND;
                } else if (scaIdCacheWidth !== width || scaIdCacheHeight !== height) {
                    scaIdCacheValid = false;
                    scaIdPickTarget.resize(width, height);
                }
                if (depthPickerPatchesActive) {
                    unregisterPickerShaderPatches(app);
                }
                if (window.SCA3D?.pickDebugForceClear) {
                    scaIdPickPass.init(scaIdPickTarget);
                    scaIdPickPass.setClearColor(new Color(1, 0, 0, 1));
                    scaIdPickPass.update(scaGetCameraComponent(), app.scene, [], new Map(), false);
                    scaIdPickPass.render();
                    if (graphicsDevice.isWebGPU) {
                        await new Promise((resolve) => app.once('frameend', resolve));
                    }
                    diag = { ...diag, renderPassExecuted: true, drawCallsEstimate: 0, debugForceClear: true };
                    scaLastPickPassDiag = diag;
                    scaLogPickPassDiagnostics(diag);
                    return diag;
                }
                app.renderNextFrame = true;
                scaIdPickPass.init(scaIdPickTarget);
                scaIdPickPass.setClearColor(scaIdClearColor);
                scaIdPickPass.update(scaGetCameraComponent(), app.scene, [worldLayer], new Map(), false);
                scaIdPickPass.render();
                if (graphicsDevice.isWebGPU) {
                    await new Promise((resolve) => app.once('frameend', resolve));
                }
                diag = {
                    ...diag,
                    renderPassExecuted: true,
                    drawCallsEstimate: pickMI ? (pickMI.instancingCount > 0 ? 1 : 0) : 0,
                    gsplatEnableIdsDuring: app.scene.gsplat.enableIds
                };
                scaIdCacheWidth = width;
                scaIdCacheHeight = height;
                scaIdCacheValid = true;
            } finally {
                if (depthPickerPatchesActive) {
                    registerPickerShaderPatches(app);
                }
            }
            scaLastPickPassDiag = diag;
            scaLogPickPassDiagnostics(diag);
            if (window.SCA3D?.pickPassDebug || window.SCA3D?.pickDebugLog) {
                const grid = await scaCountPickTargetNonZero(width, height);
                console.log('[SCA PICK PASS] pick target grid:', grid);
                diag.pickTargetGrid = grid;
            }
            return diag;
        };
        const pickGaussianId = async (nx, ny) => {
            const width = Math.floor(graphicsDevice.width);
            const height = Math.floor(graphicsDevice.height);
            if (width <= 0 || height <= 0) {
                return null;
            }
            const worldLayer = app.scene.layers.getLayerByName('World');
            if (!worldLayer) {
                return null;
            }
            const screenX = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
            const screenY = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
            await scaEnsureIdPickRendered(width, height, worldLayer);
            const flipY = graphicsDevice.isWebGL2 || graphicsDevice.isWebGPU;
            const texY = flipY ? scaIdPickTarget.height - screenY - 1 : screenY;
            const pixels = await scaIdPickBuffer.read(screenX, texY, 1, 1, {
                renderTarget: scaIdPickTarget,
                immediate: true
            });
            const decoded = scaDecodePickPixel(pixels);
            const base = {
                position: null,
                screenX,
                screenY,
                width,
                height,
                rawRGBA: decoded.rawRGBA,
                pickPassDiag: scaLastPickPassDiag
            };
            if (decoded.gaussianIndex === null) {
                return { gaussianIndex: null, ...base };
            }
            return { gaussianIndex: decoded.gaussianIndex, ...base };
        };
        this.pickGaussianId = (nx, ny) => serializeIdPick(() => pickGaussianId(nx, ny));
        this.dumpPickTarget = async () => {
            const width = Math.floor(graphicsDevice.width);
            const height = Math.floor(graphicsDevice.height);
            const worldLayer = app.scene.layers.getLayerByName('World');
            if (!worldLayer || width <= 0 || height <= 0) {
                return { error: 'pick target unavailable' };
            }
            scaIdCacheValid = false;
            const passDiag = await scaEnsureIdPickRendered(width, height, worldLayer);
            const grid = await scaCountPickTargetNonZero(width, height);
            const summary = { ...grid, pickPassDiag: passDiag };
            console.log('[SCA PICK PASS] dumpPickTarget:', summary);
            return summary;
        };`,
        'SCA pickGaussianId'
    );

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
                    return {
                        width: dims.x,
                        height: dims.y,
                        source: 'gsplat.textureDimensions'
                    };
                }
                const splatTextureSize = app.scene?.gsplat?.material?.getParameter?.('splatTextureSize')?.data;
                if (typeof splatTextureSize === 'number' && splatTextureSize > 0) {
                    return {
                        width: splatTextureSize,
                        height: Math.ceil(gaussianCount / splatTextureSize),
                        source: 'splatTextureSize'
                    };
                }
                const width = Math.ceil(Math.sqrt(gaussianCount));
                return {
                    width,
                    height: Math.ceil(gaussianCount / width),
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
                        console.error('[SCA REGION] highlight init failed: GLSL shader patch unavailable', {
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
                    const bufferSize = layout.width * layout.height;
                    scaRegionHighlightBuffer = new Uint8Array(bufferSize);
                    scaRegionHighlightTexture = new Texture(app.graphicsDevice, {
                        name: 'scaRegionHighlight',
                        width: layout.width,
                        height: layout.height,
                        format: PIXELFORMAT_R8,
                        mipmaps: false,
                        minFilter: FILTER_NEAREST,
                        magFilter: FILTER_NEAREST,
                        addressU: ADDRESS_CLAMP_TO_EDGE,
                        addressV: ADDRESS_CLAMP_TO_EDGE
                    });
                    scaRegionHighlightTexture.setSource(scaRegionHighlightBuffer);
                    material.setDefine('SCA_REGION_HIGHLIGHT', true);
                    material.setParameter('scaRegionHighlight', scaRegionHighlightTexture);
                    material.setParameter('scaRegionHighlightClr', [1, 0.4, 0, 0.5]);
                    material.setParameter('scaRegionHighlightActive', 0);
                    material.update();
                    app.renderNextFrame = true;
                    console.log('[SCA REGION] highlight texture created', {
                        width: layout.width,
                        height: layout.height,
                        gaussianCount,
                        format: 'R8',
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
                    return false;
                }
            };
            this.setScaRegionHighlight = (bitset, color, active) => {
                if (!scaRegionHighlightTexture || !scaRegionHighlightMaterial || !scaRegionHighlightBuffer) {
                    return;
                }
                scaRegionHighlightBuffer.fill(0);
                if (bitset && active) {
                    const limit = Math.min(bitset.length, scaRegionHighlightBuffer.length);
                    for (let i = 0; i < limit; i++) {
                        if (bitset[i]) {
                            scaRegionHighlightBuffer[i] = 255;
                        }
                    }
                }
                scaRegionHighlightTexture.setSource(scaRegionHighlightBuffer);
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightClr', color);
                scaRegionHighlightMaterial.setParameter('scaRegionHighlightActive', active ? 1 : 0);
                scaRegionHighlightMaterial.update();
                app.renderNextFrame = true;
            };
            this.clearScaRegionHighlight = () => {
                this.setScaRegionHighlight(null, [0, 0, 0, 0], false);
            };
            const scaResolveClientPickCoords = (clientX, clientY) => {
                const canvas = app.graphicsDevice.canvas;
                const rect = canvas.getBoundingClientRect();
                const width = Math.floor(app.graphicsDevice.width);
                const height = Math.floor(app.graphicsDevice.height);
                if (!rect.width || !rect.height || width <= 0 || height <= 0) {
                    return null;
                }
                const scaleX = width / rect.width;
                const scaleY = height / rect.height;
                const pixelX = Math.min(width - 1, Math.max(0, Math.floor((clientX - rect.left) * scaleX)));
                const pixelY = Math.min(height - 1, Math.max(0, Math.floor((clientY - rect.top) * scaleY)));
                return {
                    clientX,
                    clientY,
                    canvasRect: {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    },
                    dpr: window.devicePixelRatio || 1,
                    pixelX,
                    pixelY,
                    targetWidth: width,
                    targetHeight: height,
                    nx: pixelX / width,
                    ny: pixelY / height
                };
            };
            let scaLastPickDebugKey = '';
            const scaLogPickDebug = (coords, rawRGBA, decodedIndex) => {
                if (!window.SCA3D?.pickDebugLog) {
                    return;
                }
                const key = [
                    coords.pixelX,
                    coords.pixelY,
                    decodedIndex ?? 'miss',
                    rawRGBA?.join?.(',') ?? ''
                ].join('|');
                if (key === scaLastPickDebugKey) {
                    return;
                }
                scaLastPickDebugKey = key;
                console.log('[SCA PICK DEBUG]');
                console.log('clientX:', coords.clientX);
                console.log('clientY:', coords.clientY);
                console.log('canvasRect:', coords.canvasRect);
                console.log('dpr:', coords.dpr);
                console.log('pixelX:', coords.pixelX);
                console.log('pixelY:', coords.pixelY);
                console.log('targetWidth:', coords.targetWidth);
                console.log('targetHeight:', coords.targetHeight);
                console.log('rawRGBA:', rawRGBA);
                console.log('decodedIndex:', decodedIndex);
            };
            // viewer.pickGaussian(clientX, clientY) — client/viewport coordinates; converts to render-target pixels internally.
            this.pickGaussian = async (clientX, clientY) => {
                const coords = scaResolveClientPickCoords(clientX, clientY);
                if (!coords) {
                    return null;
                }
                const result = await this.picker.pickGaussianId(coords.nx, coords.ny);
                scaLogPickDebug(coords, result?.rawRGBA ?? null, result?.gaussianIndex ?? null);
                if (!result || result.gaussianIndex === null || result.gaussianIndex === undefined) {
                    return null;
                }
                return {
                    gaussianIndex: result.gaussianIndex,
                    position: result.position,
                    scaSplatId: window.SCA3D?.state?.defaultScaSplatId ?? 'splat_01',
                    screenX: coords.pixelX,
                    screenY: coords.pixelY,
                    clientX: coords.clientX,
                    clientY: coords.clientY
                };
            };
            window.SCA3D = window.SCA3D || {};
            window.SCA3D.pickDebugLog = window.SCA3D.pickDebugLog ?? false;
            window.SCA3D.pickPassDebug = window.SCA3D.pickPassDebug ?? false;
            window.SCA3D.pickDebugForceClear = window.SCA3D.pickDebugForceClear ?? false;
            window.SCA3D.debugPick = async (clientX, clientY) => {
                const prev = window.SCA3D.pickDebugLog;
                const prevPass = window.SCA3D.pickPassDebug;
                window.SCA3D.pickDebugLog = true;
                window.SCA3D.pickPassDebug = true;
                scaLastPickDebugKey = '';
                const result = await this.pickGaussian(clientX, clientY);
                window.SCA3D.pickDebugLog = prev;
                window.SCA3D.pickPassDebug = prevPass;
                return result;
            };
            window.SCA3D.dumpPickTarget = () => this.picker?.dumpPickTarget?.();
            window.SCA3D.debugPickReadback = async () => {
                const prev = window.SCA3D.pickDebugForceClear;
                window.SCA3D.pickDebugForceClear = true;
                window.SCA3D.pickPassDebug = true;
                const summary = await this.picker?.dumpPickTarget?.();
                window.SCA3D.pickDebugForceClear = prev;
                return summary;
            };
            events.fire('scaPickerReady'); // SCA_PICK_GAUSSIAN`,
        'SCA region highlight and pickGaussian'
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
    return patched;
};

export {
    patchViewerBundle,
    verifyPickerPatch,
    verifyNoInvalidWgslHighlightInjection,
    verifyGlslHighlightPatch,
    PICKER_PATCH_MARKERS
};
