import { Events } from '../../events';

import { HotspotStore } from '../store/hotspot-store';
import { ScaAnimationClip, ScaRigNodeAnimationProperty } from '../types/animation';
import { ScaRigVec3 } from '../types/rig';

import { ScaHistoryController } from '../edit/register-sca-history';

const registerScaAnimationEvents = (
    events: Events,
    store: HotspotStore,
    history: ScaHistoryController
): void => {
    const notifyProjectChanged = () => {
        events.fire('sca.project.changed');
    };

    events.function('sca.animation.list', () => store.getAnimations());

    events.function('sca.animation.get', (clipId: string) => store.getAnimationClip(clipId));

    events.on('sca.animation.create', (name: string, duration?: number) => {
        history.record(() => {
            const clip = store.addAnimationClip(name, duration);
            events.fire('sca.animation.setActiveClip', clip.id);
            notifyProjectChanged();
        });
    });

    events.on('sca.animation.update', (
        clipId: string,
        patch: Partial<Pick<ScaAnimationClip, 'name' | 'duration' | 'autoplay' | 'loop' | 'trigger'>>
    ) => {
        history.record(() => {
            store.updateAnimationClip(clipId, patch);
            notifyProjectChanged();
        });
    });

    events.on('sca.animation.delete', (clipId: string) => {
        history.record(() => {
            store.deleteAnimationClip(clipId);
            notifyProjectChanged();
            events.fire('sca.animation.setActiveClip', store.getAnimations()[0]?.id ?? null);
        });
    });

    events.on('sca.animation.keyframe.addRig', (
        clipId: string,
        nodeId: string,
        property: ScaRigNodeAnimationProperty,
        time: number,
        value: ScaRigVec3
    ) => {
        history.record(() => {
            store.addRigAnimationKeyframe(clipId, nodeId, property, time, value);
            notifyProjectChanged();
        });
    });

    events.on('sca.animation.keyframe.toggleRig', (
        clipId: string,
        nodeId: string,
        property: ScaRigNodeAnimationProperty,
        time: number,
        value: ScaRigVec3
    ) => {
        history.record(() => {
            store.toggleRigAnimationKeyframe(clipId, nodeId, property, time, value);
            notifyProjectChanged();
        });
    });

    events.on('sca.animation.keyframe.addRegionOpacity', (
        clipId: string,
        regionId: string,
        time: number,
        value: number
    ) => {
        history.record(() => {
            store.addRegionOpacityAnimationKeyframe(clipId, regionId, time, value);
            notifyProjectChanged();
        });
    });

    events.on('sca.animation.keyframe.delete', (
        clipId: string,
        trackId: string,
        keyframeId: string
    ) => {
        history.record(() => {
            store.deleteAnimationKeyframe(clipId, trackId, keyframeId);
            notifyProjectChanged();
        });
    });
};

export { registerScaAnimationEvents };
