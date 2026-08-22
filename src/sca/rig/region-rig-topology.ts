import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';

import { ScaRig } from '../types/rig';

const countIndexRanges = (ranges: IndexRanges | null | undefined): number => {
    if (!ranges || ranges.empty) {
        return 0;
    }

    let count = 0;
    ranges.forEach(() => {
        count++;
    });
    return count;
};

const computeRigTopology = (events: Events, rig: ScaRig | undefined): string => {
    if (!rig || (rig.nodes.length === 0 && rig.bindings.length === 0)) {
        return '';
    }

    const nodeIds = rig.nodes.map((node) => node.id).sort().join(',');
    const bindingParts = [...rig.bindings]
        .sort((left, right) => (
            left.regionId.localeCompare(right.regionId) ||
            left.nodeId.localeCompare(right.nodeId)
        ))
        .map((binding) => {
            const ranges = events.invoke('sca.region.getMask', binding.regionId) as IndexRanges | null;
            return `${binding.regionId}:${binding.nodeId}:${countIndexRanges(ranges)}`;
        });

    return `${nodeIds}|${bindingParts.join(';')}`;
};

type RigSyncPath = 'structural' | 'pose' | 'none';

const chooseRigSyncPath = (
    cachedTopology: string,
    nextTopology: string,
    hasActiveSlots: boolean,
    hasBindings: boolean
): RigSyncPath => {
    if (cachedTopology !== nextTopology) {
        return 'structural';
    }

    if (hasBindings && hasActiveSlots) {
        return 'pose';
    }

    return 'none';
};

export {
    RigSyncPath,
    chooseRigSyncPath,
    computeRigTopology,
    countIndexRanges
};
