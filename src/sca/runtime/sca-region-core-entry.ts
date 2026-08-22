import {
    ScaRegionInteractionCore,
    isClickableRegion,
    resolveRegion
} from '../interaction/sca-region-core';
import {
    applyRegionCardLayout,
    buildRegionCardModel,
    buildRegionPresentationEntry,
    buildRegionPresentationState,
    computeRegionAnchorFromBitset,
    computeRegionAnchorFromIndices,
    createCentersAccessorFromFloat32,
    getActivePresentationEntry,
    getHoverPresentationEntry,
    layoutRegionCard,
    parseRegionActiveColor,
    parseRegionHexColor,
    parseRegionHoverColor,
    resolveRegionVisual,
    resolveRegionPulse,
    resolveRegionPulsePreview
} from '../presentation';
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
    SCA3D?: Record<string, unknown>;
};

scaGlobal.SCA3D = scaGlobal.SCA3D || {};
Object.assign(scaGlobal.SCA3D, {
    createRuntimeRegionInteraction,
    isClickableRegion,
    resolveRuntimeRegion: resolveRegion,
    parseRegionHexColor,
    parseRegionHoverColor,
    parseRegionActiveColor,
    resolveRegionVisual,
    resolveRegionPulse,
    resolveRegionPulsePreview,
    computeRegionAnchorFromBitset,
    computeRegionAnchorFromIndices,
    createCentersAccessorFromFloat32,
    buildRegionPresentationState,
    buildRegionPresentationEntry,
    getActivePresentationEntry,
    getHoverPresentationEntry,
    buildRegionCardModel,
    layoutRegionCard,
    applyRegionCardLayout
});

export {
    createRuntimeRegionInteraction
};
