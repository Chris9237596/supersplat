import { IndexRanges } from '../../index-ranges';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';
import { captureSelectionRanges } from './region-selection-capture';

type RegionReplaceContextResult =
    | { ok: true; region: ScaRegion; splat: Splat; gaussianCount: number }
    | { ok: false; reason: string };

const resolveRegionReplaceContext = (
    store: HotspotStore,
    scene: Scene,
    regionId: string
): RegionReplaceContextResult => {
    const region = store.getRegions().find((entry) => entry.id === regionId);
    if (!region) {
        return { ok: false, reason: 'Region not found' };
    }

    if (region.source.type !== 'gaussian-mask') {
        return { ok: false, reason: 'Region has no Gaussian mask source' };
    }

    const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
    if (!splat) {
        return {
            ok: false,
            reason: `Source splat "${region.source.scaSplatId}" not found in scene`
        };
    }

    if (!splat.visible) {
        return { ok: false, reason: 'Source splat is hidden' };
    }

    return {
        ok: true,
        region,
        splat,
        gaussianCount: splat.splatData.numSplats
    };
};

const readSourceSplatSelectionRanges = (splat: Splat): IndexRanges => {
    return captureSelectionRanges(splat);
};

export {
    readSourceSplatSelectionRanges,
    resolveRegionReplaceContext,
    RegionReplaceContextResult
};
