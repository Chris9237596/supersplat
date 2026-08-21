import {
    ScaCameraPose,
    ScaNavigationMode,
    ScaProject,
    ScaStartAnimationType,
    ScaViewerConfig,
    Vec3
} from '../types/project';

const DEFAULT_FOV = 60;
const DEFAULT_ANIMATION_DURATION = 1.5;
const DEFAULT_FOCUS_TRANSITION_DURATION = 0.8;
const DEFAULT_HOME_TRANSITION_DURATION = 1.0;
const MIN_TRANSITION_DURATION = 0;
const MAX_FOCUS_TRANSITION_DURATION = 3;
const MAX_HOME_TRANSITION_DURATION = 5;
const DEFAULT_POSITION: Vec3 = [0, 1, -1];
const DEFAULT_TARGET: Vec3 = [0, 0, 0];

const cloneVec3 = (value: Vec3): Vec3 => [...value] as Vec3;

const clonePose = (pose: ScaCameraPose): ScaCameraPose => ({
    position: cloneVec3(pose.position),
    target: cloneVec3(pose.target),
    fov: pose.fov
});

const isVec3 = (value: unknown): value is Vec3 => {
    return Array.isArray(value) &&
        value.length === 3 &&
        value.every((component) => typeof component === 'number' && Number.isFinite(component));
};

const normalizePose = (raw: unknown, fallback: ScaCameraPose): ScaCameraPose => {
    if (!raw || typeof raw !== 'object') {
        return clonePose(fallback);
    }

    const record = raw as Record<string, unknown>;
    const position = isVec3(record.position) ? cloneVec3(record.position) : cloneVec3(fallback.position);
    const target = isVec3(record.target) ? cloneVec3(record.target) : cloneVec3(fallback.target);
    const fov = typeof record.fov === 'number' && Number.isFinite(record.fov) ? record.fov : fallback.fov;

    return { position, target, fov };
};

const normalizeAllowedModes = (raw: unknown): ScaNavigationMode[] => {
    if (!Array.isArray(raw)) {
        return ['orbit'];
    }

    const modes = raw.filter((mode): mode is ScaNavigationMode => mode === 'orbit' || mode === 'fly');
    return modes.length > 0 ? [...new Set(modes)] : ['orbit'];
};

const normalizeDefaultMode = (
    raw: unknown,
    allowedModes: ScaNavigationMode[]
): ScaNavigationMode => {
    if (raw === 'orbit' || raw === 'fly') {
        return allowedModes.includes(raw) ? raw : allowedModes[0];
    }

    return allowedModes[0];
};

const normalizeAnimationType = (raw: unknown): ScaStartAnimationType => {
    return raw === 'flyTo' ? 'flyTo' : 'none';
};

const normalizeTransitionDuration = (
    raw: unknown,
    fallback: number,
    max: number
): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return fallback;
    }

    return Math.min(max, Math.max(MIN_TRANSITION_DURATION, raw));
};

const normalizeInteraction = (raw: unknown): ScaViewerConfig['interaction'] => {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const focusRaw = record.focusTransition;
    const homeRaw = record.homeTransition;
    const focusRecord = focusRaw && typeof focusRaw === 'object' ?
        focusRaw as Record<string, unknown> :
        {};
    const homeRecord = homeRaw && typeof homeRaw === 'object' ?
        homeRaw as Record<string, unknown> :
        {};

    return {
        focusTransition: {
            duration: normalizeTransitionDuration(
                focusRecord.duration,
                DEFAULT_FOCUS_TRANSITION_DURATION,
                MAX_FOCUS_TRANSITION_DURATION
            )
        },
        homeTransition: {
            duration: normalizeTransitionDuration(
                homeRecord.duration,
                DEFAULT_HOME_TRANSITION_DURATION,
                MAX_HOME_TRANSITION_DURATION
            )
        }
    };
};

const createDefaultViewerConfig = (initial?: Partial<ScaCameraPose>): ScaViewerConfig => {
    const basePose: ScaCameraPose = {
        position: initial?.position ? cloneVec3(initial.position) : cloneVec3(DEFAULT_POSITION),
        target: initial?.target ? cloneVec3(initial.target) : cloneVec3(DEFAULT_TARGET),
        fov: initial?.fov ?? DEFAULT_FOV
    };

    return {
        camera: {
            initial: basePose,
            animation: {
                type: 'none',
                duration: DEFAULT_ANIMATION_DURATION
            }
        },
        navigation: {
            defaultMode: 'orbit',
            allowedModes: ['orbit']
        },
        interaction: normalizeInteraction(undefined)
    };
};

const normalizeViewerConfig = (
    raw: unknown,
    fallbackInitial?: Partial<ScaCameraPose>
): ScaViewerConfig => {
    const defaults = createDefaultViewerConfig(fallbackInitial);

    if (!raw || typeof raw !== 'object') {
        return defaults;
    }

    const record = raw as Record<string, unknown>;
    const cameraRaw = record.camera;
    const navigationRaw = record.navigation;
    const interactionRaw = record.interaction;

    const cameraRecord = cameraRaw && typeof cameraRaw === 'object' ?
        cameraRaw as Record<string, unknown> :
        {};
    const animationRaw = cameraRecord.animation;
    const animationRecord = animationRaw && typeof animationRaw === 'object' ?
        animationRaw as Record<string, unknown> :
        {};

    const allowedModes = normalizeAllowedModes(
        navigationRaw && typeof navigationRaw === 'object' ?
            (navigationRaw as Record<string, unknown>).allowedModes :
            undefined
    );

    const defaultMode = normalizeDefaultMode(
        navigationRaw && typeof navigationRaw === 'object' ?
            (navigationRaw as Record<string, unknown>).defaultMode :
            undefined,
        allowedModes
    );

    const duration = typeof animationRecord.duration === 'number' &&
        Number.isFinite(animationRecord.duration) &&
        animationRecord.duration > 0 ?
        animationRecord.duration :
        DEFAULT_ANIMATION_DURATION;

    return {
        camera: {
            initial: normalizePose(cameraRecord.initial, defaults.camera.initial),
            animation: {
                type: normalizeAnimationType(animationRecord.type),
                duration
            }
        },
        navigation: {
            defaultMode,
            allowedModes
        },
        interaction: normalizeInteraction(interactionRaw)
    };
};

const normalizeProject = (project: ScaProject, fallbackInitial?: Partial<ScaCameraPose>): ScaProject => {
    return {
        version: project.version,
        hotspots: project.hotspots,
        viewer: project.viewer ?
            normalizeViewerConfig(project.viewer, fallbackInitial) :
            undefined
    };
};

const resolveViewerConfig = (
    project: ScaProject,
    fallbackInitial?: Partial<ScaCameraPose>
): ScaViewerConfig => {
    return normalizeViewerConfig(project.viewer, fallbackInitial);
};

const computeCameraDistance = (pose: ScaCameraPose): number => {
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    const dx = px - tx;
    const dy = py - ty;
    const dz = pz - tz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const computeFlyToStartPose = (pose: ScaCameraPose, scale = 2.5): ScaCameraPose => {
    const distance = computeCameraDistance(pose);
    if (distance <= 1e-6) {
        return clonePose(pose);
    }

    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    const factor = (distance * scale) / distance;

    return {
        position: [
            tx + (px - tx) * factor,
            ty + (py - ty) * factor,
            tz + (pz - tz) * factor
        ],
        target: cloneVec3(pose.target),
        fov: pose.fov
    };
};

const ensureNavigationValid = (
    navigation: ScaViewerConfig['navigation']
): ScaViewerConfig['navigation'] => {
    const allowedModes: ScaNavigationMode[] = navigation.allowedModes.length > 0 ?
        [...new Set(navigation.allowedModes)] :
        ['orbit'];

    const defaultMode: ScaNavigationMode = allowedModes.includes(navigation.defaultMode) ?
        navigation.defaultMode :
        allowedModes[0];

    return {
        defaultMode,
        allowedModes
    };
};

export {
    clonePose,
    computeCameraDistance,
    computeFlyToStartPose,
    createDefaultViewerConfig,
    DEFAULT_ANIMATION_DURATION,
    DEFAULT_FOCUS_TRANSITION_DURATION,
    DEFAULT_FOV,
    DEFAULT_HOME_TRANSITION_DURATION,
    ensureNavigationValid,
    normalizeProject,
    normalizeViewerConfig,
    resolveViewerConfig
};
