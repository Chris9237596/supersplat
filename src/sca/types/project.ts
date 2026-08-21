/** World-space coordinate tuple `[x, y, z]`. */
type Vec3 = [number, number, number];

type ScaHotspotVisual = {
    type: 'annotation';
    visible: boolean;
};

type ScaHotspotHover = {
    enabled: boolean;
};

type ScaClickAction = {
    type: 'event';
    eventName: string;
};

type ScaHotspotClick = {
    enabled: boolean;
    action: ScaClickAction;
};

type ScaCameraPose = {
    position: Vec3;
    target: Vec3;
    fov: number;
};

type ScaHotspotCamera = {
    initial: ScaCameraPose;
};

type ScaNavigationMode = 'orbit' | 'fly';
type ScaStartAnimationType = 'none' | 'flyTo';

type ScaViewerCameraAnimation = {
    type: ScaStartAnimationType;
    duration: number;
};

type ScaViewerCamera = {
    initial: ScaCameraPose;
    animation: ScaViewerCameraAnimation;
};

type ScaViewerNavigation = {
    defaultMode: ScaNavigationMode;
    allowedModes: ScaNavigationMode[];
};

type ScaViewerFocusTransition = {
    duration: number;
};

type ScaViewerHomeTransition = {
    duration: number;
};

type ScaViewerInteraction = {
    focusTransition: ScaViewerFocusTransition;
    homeTransition: ScaViewerHomeTransition;
};

type ScaViewerConfig = {
    camera: ScaViewerCamera;
    navigation: ScaViewerNavigation;
    interaction: ScaViewerInteraction;
};

/** Application-level hotspot record (SCA project.json v1). */
type ScaHotspot = {
    id: string;
    name: string;
    text: string;
    position: Vec3;
    enabled: boolean;
    visual: ScaHotspotVisual;
    hover: ScaHotspotHover;
    click: ScaHotspotClick;
    camera: ScaHotspotCamera;
};

/** SCA project.json root document (version 1). */
type ScaProject = {
    version: 1;
    hotspots: ScaHotspot[];
    viewer?: ScaViewerConfig;
};

const SCA_PROJECT_VERSION = 1 as const;

const createEmptyProject = (): ScaProject => ({
    version: SCA_PROJECT_VERSION,
    hotspots: [],
    viewer: undefined
});

export {
    SCA_PROJECT_VERSION,
    createEmptyProject,
    ScaCameraPose,
    ScaClickAction,
    ScaHotspot,
    ScaHotspotCamera,
    ScaHotspotClick,
    ScaHotspotHover,
    ScaHotspotVisual,
    ScaNavigationMode,
    ScaProject,
    ScaStartAnimationType,
    ScaViewerCamera,
    ScaViewerCameraAnimation,
    ScaViewerConfig,
    ScaViewerFocusTransition,
    ScaViewerHomeTransition,
    ScaViewerInteraction,
    ScaViewerNavigation,
    Vec3
};
