import { Container } from '@playcanvas/pcui';

import { Events } from '../../events';
import { Scene } from '../../scene';

import { ScaRig } from '../types/rig';

import { RegionRigApplier } from './region-rig-applier';
import { chooseRigSyncPath, computeRigTopology } from './region-rig-topology';
import { ScaRigGizmo } from './sca-rig-gizmo';
import { ScaRigTransformController } from './sca-rig-transform';

const registerScaRigEvents = (events: Events, scene: Scene, canvasContainer: Container): void => {
    const applier = new RegionRigApplier();
    new ScaRigGizmo(events, scene);
    new ScaRigTransformController(events, scene, canvasContainer);

    let cachedTopology = '';

    const syncRig = async () => {
        const project = events.invoke('sca.project.get') as { rig?: ScaRig } | null;
        const rig = project?.rig;
        const topology = computeRigTopology(events, rig);
        const syncPath = chooseRigSyncPath(
            cachedTopology,
            topology,
            applier.hasActiveSlots(),
            (rig?.bindings.length ?? 0) > 0
        );

        if (syncPath === 'structural') {
            cachedTopology = topology;
            await applier.apply(events, scene, rig);
            return;
        }

        if (syncPath === 'pose') {
            await applier.updateNodePoses(events, scene, rig);
        }
    };

    events.on('sca.project.changed', () => {
        void syncRig();
    });

    events.on('scene.clear', () => {
        applier.clear();
        cachedTopology = '';
        scene.forceRender = true;
    });

    void syncRig();
};

export { registerScaRigEvents };
