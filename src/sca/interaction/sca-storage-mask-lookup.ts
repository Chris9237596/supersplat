import { IndexRanges } from '../../index-ranges';

import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';

import { getRegionMask } from '../regions/region-mask-store';

import { ScaRegionMaskLookup } from './sca-region-types';

const indexRangesContains = (ranges: IndexRanges, index: number): boolean => {
    let found = false;
    ranges.forEach((entry) => {
        if (entry === index) {
            found = true;
        }
    });
    return found;
};

const createStorageRegionMaskLookup = (
    store: HotspotStore,
    assetStore: ScaAssetStore
): ScaRegionMaskLookup => ({
    resolve(gaussianIndex: number, scaSplatId: string): string | null {
        if (gaussianIndex < 0) {
            return null;
        }

        const regions = store.getRegions();
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            if (!region.enabled || region.source.scaSplatId !== scaSplatId) {
                continue;
            }

            const mask = getRegionMask(assetStore, region.id);
            if (!mask || mask.empty) {
                continue;
            }

            if (indexRangesContains(mask, gaussianIndex)) {
                return region.id;
            }
        }

        return null;
    }
});

export {
    createStorageRegionMaskLookup,
    indexRangesContains
};
