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
let scaPointerWasDrag = false;
let scaPointerDownX = 0;
let scaPointerDownY = 0;
let scaActiveCameraManager = null;
const SCA_DRAG_THRESHOLD_SQ = 36;
const scaEaseInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const scaResolveHomeAnim = () => {
    if (scaHomeAnimResolve) {
        const resolve = scaHomeAnimResolve;
        scaHomeAnimResolve = null;
        resolve();
    }
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
        this.interruptScaCameraAnimations = () => {
            return this.interruptLookAnimation() || this.interruptHomeAnimation();
        };
        events.on('sca:interruptCameraAnimation', () => {
            this.interruptScaCameraAnimations();
        });
        this.animateHomeTransition = (fromPose, toPose, durationSec) => {
            this.interruptHomeAnimation();
            this.interruptLookAnimation();
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
        scaActiveCameraManager = this;
        this.lookAtTargetAnimatedWithoutMovingCamera = (focusPoint, durationSec) => {
            if (state.cameraMode !== 'orbit') {
                return;
            }
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
        // application update`;

const SCA_CAMERA_UPDATE = `            if (scaHomeAnim) {
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
                scaLookAnim.elapsed += dt;
                const lookT = Math.min(1, scaLookAnim.elapsed / scaLookAnim.duration);
                const lookEased = easeOut(lookT);
                this.camera.position.copy(scaLookAnimFixedPos);
                this.camera.angles.x = math.lerpAngle(scaLookAnimFromAngles.x, scaLookAnimToAngles.x, lookEased);
                this.camera.angles.y = math.lerpAngle(scaLookAnimFromAngles.y, scaLookAnimToAngles.y, lookEased);
                this.camera.angles.z = math.lerpAngle(scaLookAnimFromAngles.z, scaLookAnimToAngles.z, lookEased);
                target.copy(this.camera);
                from.copy(this.camera);
                transitionTimer = 1;
                if (lookT >= 1) {
                    scaSyncOrbitToCamera(controllers.orbit.controller, this.camera, scaLookAnim.focus);
                    scaLookAnim = null;
                    getController(state.cameraMode).onEnter(this.camera);
                    target.copy(this.camera);
                    from.copy(this.camera);
                    transitionTimer = 1;
                }
                global.app.renderNextFrame = true;
            } else {
                controller.update(dt, frame, target);
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
            this.cancelLookAnimation = () => {
                this.cameraManager.cancelLookAnimation();
            };
            this.interruptLookAnimation = () => {
                return this.cameraManager.interruptLookAnimation();
            };
            this.interruptHomeAnimation = () => {
                return this.cameraManager.interruptHomeAnimation();
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
        if (scaLookAnim || scaHomeAnim) {
            events.fire('sca:interruptCameraAnimation');
        }
        scaPointerDownX = event.clientX;
        scaPointerDownY = event.clientY;
        scaPointerWasDrag = false;
        // record offsets for click/tap target picking
        this._lastPointerOffsetX = event.offsetX;`,
        'SCA pointer down tracking'
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
\t\tif (scaLookAnim || scaHomeAnim) {
\t\t\twindow.dispatchEvent(new CustomEvent('sca:interruptCameraAnimation'));
\t\t}
\t\tthis.deltas.wheel.append([event.deltaY]);
\t}`,
        'SCA wheel interrupt'
    );

    patched = replaceOnce(
        patched,
        `this.cameraManager = new CameraManager(global, sceneBound, collision);
            applyCamera(this.cameraManager.camera);`,
        VIEWER_SCA_API,
        'Viewer SCA API'
    );

    return patched;
};

export {
    patchViewerBundle
};
