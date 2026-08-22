import {
    ScaRegionInteractionCore,
    isClickableRegion,
    resolveRegion
} from '../interaction/sca-region-core';
import { ScaRegion } from '../types/region';

import {
    RuntimeRegionLookup,
    createRuntimeRegionMaskLookup
} from './sca-runtime-mask-lookup';

type RuntimeRegionInteractionCallbacks = {
    getRegion: (regionId: string) => ScaRegion | null;
    getSelectedRegionId: () => string | null;
    onHoverChange: (regionId: string | null) => void;
    onSelectionChange: (regionId: string | null) => void;
};

const createRuntimeRegionInteraction = (
    lookup: RuntimeRegionLookup,
    defaultScaSplatId: string,
    callbacks: RuntimeRegionInteractionCallbacks
): ScaRegionInteractionCore => {
    const maskLookup = createRuntimeRegionMaskLookup(lookup, defaultScaSplatId);
    return new ScaRegionInteractionCore(maskLookup, callbacks);
};

const scaGlobal = window as typeof window & {
    SCA3D?: {
        createRuntimeRegionInteraction?: typeof createRuntimeRegionInteraction;
        isClickableRegion?: typeof isClickableRegion;
        resolveRuntimeRegion?: typeof resolveRegion;
    };
};

scaGlobal.SCA3D = scaGlobal.SCA3D || {};
scaGlobal.SCA3D.createRuntimeRegionInteraction = createRuntimeRegionInteraction;
scaGlobal.SCA3D.isClickableRegion = isClickableRegion;
scaGlobal.SCA3D.resolveRuntimeRegion = resolveRegion;

export {
    createRuntimeRegionInteraction
};
