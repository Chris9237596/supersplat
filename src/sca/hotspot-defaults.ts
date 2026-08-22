import { generateHotspotId } from './ids/generate-hotspot-id';
import { ScaHotspot, ScaProject, Vec3 } from './types/project';

const defaultCameraForHotspot = (position: Vec3) => ({
    initial: {
        position: [0, 1, -1] as Vec3,
        target: [...position] as Vec3,
        fov: 60
    }
});

const createDefaultHotspot = (project: ScaProject): ScaHotspot => {
    const position: Vec3 = [0, 0, 0];
    const id = generateHotspotId(project);

    return {
        id,
        name: 'New Hotspot',
        text: '',
        position,
        enabled: true,
        visual: {
            type: 'annotation',
            visible: true
        },
        hover: {
            enabled: false
        },
        click: {
            enabled: true,
            action: {
                type: 'event',
                eventName: 'hotspotClicked'
            }
        },
        interaction: {
            showInNavigation: true
        },
        camera: defaultCameraForHotspot(position)
    };
};

export { createDefaultHotspot, defaultCameraForHotspot };
