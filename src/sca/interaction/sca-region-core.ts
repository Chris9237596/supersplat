import { ScaRegion } from '../types/region';

import {
    RegionActivationSource,
    ScaRegionHit,
    ScaRegionMaskLookup
} from './sca-region-types';

const isClickableRegion = (region: ScaRegion | null | undefined): boolean => {
    return !!region?.enabled && region.interaction?.clickable !== false;
};

/**
 * Resolve the first enabled Region (project order) containing gaussianIndex.
 */
const resolveRegion = (
    gaussianIndex: number | null,
    scaSplatId: string | null,
    lookup: ScaRegionMaskLookup
): ScaRegionHit | null => {
    if (gaussianIndex === null || gaussianIndex < 0 || !scaSplatId) {
        return null;
    }

    const regionId = lookup.resolve(gaussianIndex, scaSplatId);
    return regionId ? { regionId } : null;
};

type ScaRegionInteractionCallbacks = {
    getRegion: (regionId: string) => ScaRegion | null;
    getSelectedRegionId: () => string | null;
    onHoverChange: (regionId: string | null) => void;
    onSelectionChange: (regionId: string | null) => void;
};

class ScaRegionInteractionCore {
    private hoveredRegionId: string | null = null;

    constructor(
        private readonly lookup: ScaRegionMaskLookup,
        private readonly callbacks: ScaRegionInteractionCallbacks
    ) {}

    resolveRegionHit(
        gaussianIndex: number | null,
        scaSplatId: string | null
    ): ScaRegionHit | null {
        return resolveRegion(gaussianIndex, scaSplatId, this.lookup);
    }

    resolveClickableRegionHit(
        gaussianIndex: number | null,
        scaSplatId: string | null
    ): ScaRegionHit | null {
        const hit = this.resolveRegionHit(gaussianIndex, scaSplatId);
        if (!hit) {
            return null;
        }

        const region = this.callbacks.getRegion(hit.regionId);
        return isClickableRegion(region) ? hit : null;
    }

    setHoveredRegion(regionId: string | null): void {
        if (this.hoveredRegionId === regionId) {
            return;
        }
        this.hoveredRegionId = regionId;
        this.callbacks.onHoverChange(regionId);
    }

    activateRegion(regionId: string | null, source: RegionActivationSource): void {
        if (regionId !== null) {
            const region = this.callbacks.getRegion(regionId);
            if (!isClickableRegion(region)) {
                return;
            }
        }

        if (source === 'click' && regionId !== null && regionId === this.callbacks.getSelectedRegionId()) {
            this.callbacks.onSelectionChange(null);
            return;
        }

        this.callbacks.onSelectionChange(regionId);
    }
}

export {
    ScaRegionInteractionCore,
    isClickableRegion,
    resolveRegion
};
