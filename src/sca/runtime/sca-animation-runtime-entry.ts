import { ScaAnimationClip } from '../types/animation';
import { ScaProject } from '../types/project';

import { RuntimeRigApplier } from './runtime-rig-applier';
import {
    createRuntimeRigViewerHost,
    inspectRuntimeGsplatSeam,
    isRuntimeRigHostReady,
    patchGsplatCenterForRig,
    projectNeedsRuntimeRigHost,
    resetRuntimeGsplatInspectLog,
    resetRuntimeRigShaderDiagnostic,
    resetRuntimeRigTextureIdentityDiagnostic,
    resetRuntimeRigUniformDiagnostic,
    resetRigIndexCheckDiagnostic,
    resolveRuntimeGsplatMaterial,
    RuntimeRigViewerHostContext
} from './runtime-rig-viewer-host';
import { createRuntimeAnimationController, ScaRuntimeAnimationController } from './sca-animation-runtime';

type RuntimeAnimationInitOptions = {
    getProject: () => ScaProject;
    getViewer: () => RuntimeViewer | null;
    refreshRegionPresentation: () => void;
    rigApplier?: RuntimeRigApplier;
};

type RuntimeViewer = {
    global?: {
        app?: { renderNextFrame?: number };
        events?: {
            on: (name: string, handler: () => void) => void;
            off: (name: string, handler: () => void) => void;
        };
    };
};

const scaGlobal = window as typeof window & {
    SCA3D?: Record<string, unknown> & {
        state?: Record<string, unknown> & {
            regionLookup?: {
                gaussianCount: number;
                entries: Array<{ regionId: string; bitset: Uint8Array }>;
            };
        };
        playAnimation?: (clipId: string) => boolean;
        stopAnimation?: (clipId?: string) => void;
        resetAnimation?: (clipId?: string) => void;
        triggerAnimationForTarget?: (targetType: 'hotspot' | 'region', targetId: string) => void;
    };
};

const RIG_HOST_INIT_TIMEOUT_MS = 120000;
const RIG_HOST_RETRY_MS = 100;

let activeController: ScaRuntimeAnimationController | null = null;
let activeRigHostContext: RuntimeRigViewerHostContext | null = null;
let sharedRigApplier = new RuntimeRigApplier();
let rigHostInitGeneration = 0;

const getAutoplayClip = (project: ScaProject): ScaAnimationClip | null => {
    return (project.animations ?? []).find((clip) => clip.autoplay === true) ?? null;
};

const clipHasRigTracks = (clip: ScaAnimationClip | null): boolean => {
    return clip?.tracks.some((track) => track.targetType === 'rig-node') ?? false;
};

const autoplayClipNeedsRigHost = (project: ScaProject): boolean => {
    if (!projectNeedsRuntimeRigHost(project)) {
        return false;
    }

    return clipHasRigTracks(getAutoplayClip(project));
};

const cancelDeferredRigHostInit = (): void => {
    rigHostInitGeneration++;
    resetRuntimeGsplatInspectLog();
    resetRuntimeRigShaderDiagnostic();
    resetRuntimeRigUniformDiagnostic();
    resetRuntimeRigTextureIdentityDiagnostic();
    resetRigIndexCheckDiagnostic();
};

const logProjectLoaded = (project: ScaProject): void => {
    const animations = project.animations ?? [];
    console.log('[SCA RUNTIME ANIM] project loaded', {
        clipCount: animations.length,
        triggers: animations.map((clip) => ({
            clipId: clip.id,
            type: clip.trigger?.type ?? 'none',
            targetId: clip.trigger?.targetId ?? null,
            autoplay: clip.autoplay === true,
            loop: clip.loop === true
        }))
    });
};

const tryCreateRuntimeRigHost = (
    options: RuntimeAnimationInitOptions
): RuntimeRigViewerHostContext | null => {
    const viewer = options.getViewer();
    const project = options.getProject();
    const regionLookup = scaGlobal.SCA3D?.state?.regionLookup ?? null;

    if (!viewer || !isRuntimeRigHostReady(viewer, project, regionLookup)) {
        return null;
    }

    return createRuntimeRigViewerHost(viewer, project, regionLookup);
};

const finishRuntimeStartup = (
    controller: ScaRuntimeAnimationController,
    project: ScaProject
): void => {
    if (project.rig && activeRigHostContext) {
        activeRigHostContext.applyRestPose(project.rig);
    }

    controller.initAutoplay();
    logProjectLoaded(project);
};

const deferRuntimeRigHostInit = (
    options: RuntimeAnimationInitOptions,
    controller: ScaRuntimeAnimationController,
    onComplete: () => void
): void => {
    const generation = ++rigHostInitGeneration;
    let waitingLogged = false;

    const attempt = (): boolean => {
        if (generation !== rigHostInitGeneration) {
            return true;
        }

        const viewer = options.getViewer();
        const project = options.getProject();
        const regionLookup = scaGlobal.SCA3D?.state?.regionLookup ?? null;

        if (!viewer || !isRuntimeRigHostReady(viewer, project, regionLookup)) {
            if (!waitingLogged) {
                inspectRuntimeGsplatSeam(viewer ?? {});
                console.log('[SCA RUNTIME RIG] waiting for gsplat material');
                waitingLogged = true;
            }
            return false;
        }

        if (activeRigHostContext) {
            onComplete();
            return true;
        }

        activeRigHostContext = tryCreateRuntimeRigHost(options);
        if (activeRigHostContext) {
            sharedRigApplier.setHost(activeRigHostContext.host);
        } else {
            sharedRigApplier.setHost(null);
        }

        onComplete();
        return true;
    };

    if (attempt()) {
        return;
    }

    const viewer = options.getViewer();
    const events = viewer?.global?.events;
    const deadline = Date.now() + RIG_HOST_INIT_TIMEOUT_MS;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
        events?.off('firstFrame', onSignal);
        events?.off('frame:ready', onSignal);
        events?.off('scaPickerReady', onSignal);
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const onSignal = (): void => {
        if (attempt()) {
            cleanup();
        }
    };

    events?.on('firstFrame', onSignal);
    events?.on('frame:ready', onSignal);
    events?.on('scaPickerReady', onSignal);

    timer = setInterval(() => {
        if (attempt()) {
            cleanup();
            return;
        }

        if (Date.now() > deadline) {
            cleanup();
            if (generation === rigHostInitGeneration) {
                console.warn('[SCA RUNTIME RIG] host init timed out waiting for gsplat material');
                sharedRigApplier.setHost(null);
                onComplete();
            }
        }
    }, RIG_HOST_RETRY_MS);
};

const initRuntimeAnimation = (options: RuntimeAnimationInitOptions): ScaRuntimeAnimationController => {
    cancelDeferredRigHostInit();
    activeController?.destroy();
    activeRigHostContext?.destroy();
    activeRigHostContext = null;

    const rigApplier = options.rigApplier ?? sharedRigApplier;
    sharedRigApplier = rigApplier;
    rigApplier.setHost(null);

    const project = options.getProject();

    const controller = createRuntimeAnimationController({
        getProject: options.getProject,
        requestRender: () => {
            const activeViewer = options.getViewer();
            const app = activeViewer?.global?.app;
            if (app) {
                app.renderNextFrame = 1;
            }
        },
        refreshRegionPresentation: options.refreshRegionPresentation,
        rigApplier
    });

    activeController = controller;

    scaGlobal.SCA3D = scaGlobal.SCA3D || {};
    scaGlobal.SCA3D.playAnimation = (clipId: string) => controller.playAnimation(clipId);
    scaGlobal.SCA3D.stopAnimation = (clipId?: string) => controller.stopAnimation(clipId);
    scaGlobal.SCA3D.resetAnimation = (clipId?: string) => controller.resetAnimation(clipId);
    scaGlobal.SCA3D.triggerAnimationForTarget = (
        targetType: 'hotspot' | 'region',
        targetId: string
    ) => controller.triggerAnimationForTarget(targetType, targetId);

    scaGlobal.SCA3D.state = scaGlobal.SCA3D.state || {};
    scaGlobal.SCA3D.state.runtimeAnimationReady = true;

    const finishStartup = (): void => {
        finishRuntimeStartup(controller, options.getProject());
    };

    if (!projectNeedsRuntimeRigHost(project)) {
        finishStartup();
        return controller;
    }

    const blockAutoplayForRigHost = autoplayClipNeedsRigHost(project);

    if (blockAutoplayForRigHost) {
        deferRuntimeRigHostInit(options, controller, finishStartup);
        return controller;
    }

    activeRigHostContext = tryCreateRuntimeRigHost(options);
    if (activeRigHostContext) {
        rigApplier.setHost(activeRigHostContext.host);
    }

    finishRuntimeStartup(controller, project);

    if (!activeRigHostContext) {
        deferRuntimeRigHostInit(options, controller, () => {
            if (!activeRigHostContext) {
                return;
            }

            const latestProject = options.getProject();
            if (latestProject.rig && !controller.isPlaying()) {
                activeRigHostContext.applyRestPose(latestProject.rig);
            }
        });
    }

    return controller;
};

const getRuntimeRigApplier = (): RuntimeRigApplier => sharedRigApplier;

Object.assign(scaGlobal.SCA3D || {}, scaGlobal.SCA3D);
scaGlobal.SCA3D = scaGlobal.SCA3D || {};
Object.assign(scaGlobal.SCA3D, {
    initRuntimeAnimation,
    getRuntimeRigApplier
});

export {
    autoplayClipNeedsRigHost,
    getRuntimeRigApplier,
    initRuntimeAnimation,
    isRuntimeRigHostReady,
    RuntimeRigApplier
};
