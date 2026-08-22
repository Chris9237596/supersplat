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

type ScaHotspotInteraction = {
    clickable?: boolean;
    showInNavigation?: boolean;
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

type ScaViewerNavigationTargets = {
    enabled?: boolean;
    hotspots?: boolean;
    regions?: boolean;
};

type ScaViewerConfig = {
    camera: ScaViewerCamera;
    navigation: ScaViewerNavigation;
    navigationTargets?: ScaViewerNavigationTargets;
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
    interaction?: ScaHotspotInteraction;
    camera: ScaHotspotCamera;
};

import type { ScaRegion } from './region';
import type { ScaRig, ScaRigNode } from './rig';
import type { ScaAnimationClip } from './animation';

type ScaRuntimeSplatRef = {
    scaSplatId: string;
    name?: string;
};

/** SCA project.json root document (version 1). */
type ScaProject = {
    version: 1;
    hotspots: ScaHotspot[];
    regions: ScaRegion[];
    splats?: ScaRuntimeSplatRef[];
    viewer?: ScaViewerConfig;
    rig?: ScaRig;
    animations?: ScaAnimationClip[];
};

const SCA_PROJECT_VERSION = 1 as const;

const createEmptyProject = (): ScaProject => ({
    version: SCA_PROJECT_VERSION,
    hotspots: [],
    regions: [],
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
    ScaHotspotInteraction,
    ScaHotspotVisual,
    ScaNavigationMode,
    ScaProject,
    ScaRuntimeSplatRef,
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
    ScaViewerNavigationTargets,
    Vec3
};

export type { ScaAnimationClip } from './animation';
export type { ScaRegion } from './region';
export type { ScaRig, ScaRigBinding, ScaRigNode } from './rig';
