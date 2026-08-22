type RegionActivationSource = 'click' | 'nav' | 'panel';

type ScaRegionHit = {
    regionId: string;
};

/**
 * Resolves gaussianIndex → regionId in a single declared index space.
 * Implementations must not convert between storage and runtime indices.
 */
interface ScaRegionMaskLookup {
    resolve(gaussianIndex: number, scaSplatId: string): string | null;
}

export {
    RegionActivationSource,
    ScaRegionHit,
    ScaRegionMaskLookup
};
