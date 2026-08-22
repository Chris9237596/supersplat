import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';

import { createStorageRegionMaskLookup } from '../interaction/sca-storage-mask-lookup';

/**
 * Resolve a Region at editor storage gaussian index (same space as region masks in authoring).
 * First enabled Region in project order wins (matches runtime overlap policy).
 */
const resolveRegionAtStorageIndex = (
    store: HotspotStore,
    assetStore: ScaAssetStore,
    scaSplatId: string,
    gaussianIndex: number
): string | null => {
    const lookup = createStorageRegionMaskLookup(store, assetStore);
    return lookup.resolve(gaussianIndex, scaSplatId);
};

export { resolveRegionAtStorageIndex };

export { indexRangesContains } from '../interaction/sca-storage-mask-lookup';
export { isClickableRegion, resolveRegion } from '../interaction/sca-region-core';
