import { defaultCameraForHotspot } from '../hotspot-defaults';
import { ScaHotspot } from '../types/project';

/** SuperSplat Viewer `ExperienceSettings.annotations` entry (geometry-only layer). */
type ScaViewerAnnotation = {
    position: [number, number, number];
    title: string;
    text: string;
    extras: {
        id: string;
    };
    camera: ScaHotspot['camera'];
};

const isExportableHotspot = (hotspot: ScaHotspot): boolean => {
    if (!hotspot.enabled) {
        return false;
    }
    if (hotspot.visual?.visible === false) {
        return false;
    }
    const visualType = hotspot.visual?.type ?? 'annotation';
    return visualType === 'annotation';
};

const hotspotToAnnotation = (hotspot: ScaHotspot): ScaViewerAnnotation => ({
    position: [...hotspot.position],
    title: hotspot.name || hotspot.id,
    text: hotspot.text ?? '',
    extras: {
        id: hotspot.id
    },
    camera: hotspot.camera ?? defaultCameraForHotspot(hotspot.position)
});

const hotspotsToAnnotations = (hotspots: ScaHotspot[]): ScaViewerAnnotation[] => {
    return hotspots.filter(isExportableHotspot).map(hotspotToAnnotation);
};

export {
    hotspotToAnnotation,
    hotspotsToAnnotations,
    isExportableHotspot,
    ScaViewerAnnotation
};
