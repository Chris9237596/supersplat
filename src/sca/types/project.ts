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
type ScaStartAnimationType = 'none' | 'flyTo' | 'turntable';

type ScaTurntableDirection = 'clockwise' | 'counterclockwise';

type ScaTurntableAnimation = {
    duration: number;
    direction: ScaTurntableDirection;
    degrees: number;
    loop: boolean;
};

type ScaViewerCameraAnimation = {
    type: ScaStartAnimationType;
    duration: number;
    turntable?: ScaTurntableAnimation;
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

type ScaBackgroundType = 'color' | 'transparent' | 'image' | 'panorama';

type ScaBackgroundImageRef = {
    assetId?: string;
    filename?: string;
};

type ScaViewerBackground = {
    type: ScaBackgroundType;
    color?: string;
    image?: ScaBackgroundImageRef;
};

type ScaViewerHotspots = {
    showCards: boolean;
};

type ScaViewerConfig = {
    camera: ScaViewerCamera;
    navigation: ScaViewerNavigation;
    interaction: ScaViewerInteraction;
    background?: ScaViewerBackground;
    hotspots?: ScaViewerHotspots;
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
    ScaBackgroundImageRef,
    ScaBackgroundType,
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
    ScaTurntableAnimation,
    ScaTurntableDirection,
    ScaViewerCamera,
    ScaViewerCameraAnimation,
    ScaViewerBackground,
    ScaViewerConfig,
    ScaViewerFocusTransition,
    ScaViewerHomeTransition,
    ScaViewerHotspots,
    ScaViewerInteraction,
    ScaViewerNavigation,
    Vec3
};
