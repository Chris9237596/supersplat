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
};

const SCA_PROJECT_VERSION = 1 as const;

const createEmptyProject = (): ScaProject => ({
    version: SCA_PROJECT_VERSION,
    hotspots: []
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
    ScaProject,
    Vec3
};
