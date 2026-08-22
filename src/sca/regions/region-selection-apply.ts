import { SelectOp } from '../../edit-ops';
import { IndexRanges } from '../../index-ranges';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaRegion } from '../types/region';

import { getRegionMask } from './region-mask-store';
import { findSplatByScaSplatId } from './splat-identity';

type RegionSelectionResolveResult =
    | { ok: true; region: ScaRegion; mask: IndexRanges; gaussianCount: number; splat: Splat }
    | { ok: false; reason: string };

const indexRangesToSelectionMask = (ranges: IndexRanges, total: number): Uint8Array => {
    const mask = new Uint8Array(total);
    ranges.forEach((index) => {
        if (index >= 0 && index < total) {
            mask[index] = 255;
        }
    });
    return mask;
};

const resolveRegionGaussianSelection = (
    store: HotspotStore,
    assetStore: ScaAssetStore,
    scene: Scene,
    regionId: string
): RegionSelectionResolveResult => {
    const region = store.getRegions().find((entry) => entry.id === regionId);
    if (!region) {
        return { ok: false, reason: 'Region not found' };
    }

    if (region.source.type !== 'gaussian-mask') {
        return { ok: false, reason: 'Region has no Gaussian mask source' };
    }

    const mask = getRegionMask(assetStore, regionId);
    if (!mask || mask.empty) {
        return { ok: false, reason: 'Region mask missing or empty' };
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
        mask,
        gaussianCount: splat.splatData.numSplats,
        splat
    };
};

const applyRegionMaskToNativeSelection = (
    events: Events,
    scene: Scene,
    regionId: string
): { ok: boolean; reason?: string } => {
    const store = events.invoke('sca.store') as HotspotStore;
    const assetStore = events.invoke('sca.assetStore') as ScaAssetStore;

    const resolved = resolveRegionGaussianSelection(store, assetStore, scene, regionId);
    if (resolved.ok === false) {
        return { ok: false, reason: resolved.reason };
    }

    const selectionMask = indexRangesToSelectionMask(resolved.mask, resolved.gaussianCount);
    events.fire('selection', resolved.splat);
    events.fire('edit.add', new SelectOp(resolved.splat, 'set', selectionMask));

    return { ok: true };
};

export {
    applyRegionMaskToNativeSelection,
    indexRangesToSelectionMask,
    resolveRegionGaussianSelection,
    RegionSelectionResolveResult
};
