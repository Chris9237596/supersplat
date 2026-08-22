import { Events } from '../../events';
import { Scene } from '../../scene';

import { ScaRig } from '../types/rig';

import { RegionRigApplier } from './region-rig-applier';
import { ScaRigGizmo } from './sca-rig-gizmo';

const registerScaRigEvents = (events: Events, scene: Scene): void => {
    const applier = new RegionRigApplier();
    new ScaRigGizmo(events, scene);

    const applyRig = async () => {
        const project = events.invoke('sca.project.get') as { rig?: ScaRig } | null;
        await applier.apply(events, scene, project?.rig);
    };

    events.on('sca.project.changed', () => {
        void applyRig();
    });

    events.on('scene.clear', () => {
        applier.clear();
        scene.forceRender = true;
    });

    void applyRig();
};

export { registerScaRigEvents };
