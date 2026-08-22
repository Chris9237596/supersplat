import { IndexRanges } from '../../index-ranges';
import { Splat } from '../../splat';
import { State } from '../../splat-state';

import { encodeRegionMask, decodeRegionMask, remapIndexRanges, buildCompactionMap } from './region-mask-format';
import { regionMaskMimeType, regionMaskStorePath } from './region-mask-paths';
import { findSplatByScaSplatId } from './splat-identity';
import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaRegion } from '../types/region';
import { Scene } from '../../scene';

const cloneAssets = (assetStore: ScaAssetStore) => {
    return assetStore.list().map((entry) => ({
        path: entry.path,
        data: entry.data.slice(),
        mimeType: entry.mimeType
    }));
};

const getRegionMask = (assetStore: ScaAssetStore, regionId: string): IndexRanges | null => {
    const entry = assetStore.get(regionMaskStorePath(regionId));
    if (!entry) {
        return null;
    }

    try {
        return decodeRegionMask(entry.data).ranges;
    } catch (error) {
        console.warn(`[SCA] failed to decode region mask for ${regionId}:`, error);
        return null;
    }
};

const setRegionMask = (
    assetStore: ScaAssetStore,
    regionId: string,
    ranges: IndexRanges,
    gaussianCount: number
): void => {
    assetStore.set(
        regionMaskStorePath(regionId),
        encodeRegionMask(ranges, gaussianCount),
        regionMaskMimeType
    );
};

const deleteRegionMask = (assetStore: ScaAssetStore, regionId: string): void => {
    assetStore.delete(regionMaskStorePath(regionId));
};

const remapRegionMasksForSave = (
    store: HotspotStore,
    assetStore: ScaAssetStore,
    scene: Scene
): void => {
    const project = store.getProject();
    if (project.regions.length === 0) {
        return;
    }

    const regionsBySplat = new Map<string, ScaRegion[]>();
    for (const region of project.regions) {
        const list = regionsBySplat.get(region.source.scaSplatId) ?? [];
        list.push(region);
        regionsBySplat.set(region.source.scaSplatId, list);
    }

    const updatedRegions = project.regions.map((region) => structuredClone(region));
    const regionIndex = new Map(updatedRegions.map((region, index) => [region.id, index]));

    for (const [scaSplatId, regions] of regionsBySplat) {
        const splat = findSplatByScaSplatId(scene, scaSplatId);
        if (!splat) {
            console.warn(`[SCA] region save remap: source splat not found: ${scaSplatId}`);
            continue;
        }

        const state = splat.splatData.getProp('state') as Uint8Array;
        const { map, survivorCount } = buildCompactionMap(state);

        for (const region of regions) {
            const ranges = getRegionMask(assetStore, region.id);
            if (!ranges) {
                console.warn(`[SCA] region save remap: missing mask for ${region.id}`);
                continue;
            }

            const remapped = remapIndexRanges(ranges, map, survivorCount);
            setRegionMask(assetStore, region.id, remapped, survivorCount);

            const idx = regionIndex.get(region.id);
            if (idx !== undefined) {
                updatedRegions[idx].capture.gaussianCount = survivorCount;
            }
        }
    }

    store.loadProject({
        ...project,
        regions: updatedRegions
    });
};

const validateRegionMasksOnLoad = (
    store: HotspotStore,
    assetStore: ScaAssetStore,
    scene: Scene
): void => {
    for (const region of store.getRegions()) {
        const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
        if (!splat) {
            console.warn(`[SCA] region "${region.id}" source splat "${region.source.scaSplatId}" not found in scene`);
            continue;
        }

        const entry = assetStore.get(regionMaskStorePath(region.id));
        if (!entry) {
            console.warn(`[SCA] region "${region.id}" mask asset missing: ${region.source.maskAsset}`);
            continue;
        }

        try {
            const { header } = decodeRegionMask(entry.data);
            const currentCount = splat.splatData.numSplats;

            if (header.gaussianCount !== currentCount) {
                console.warn(
                    `[SCA] region "${region.id}" mask gaussianCount (${header.gaussianCount}) ` +
                    `does not match source splat (${currentCount}); membership may be invalid`
                );
            }
        } catch (error) {
            console.warn(`[SCA] region "${region.id}" mask invalid:`, error);
        }
    }
};

export {
    cloneAssets,
    deleteRegionMask,
    getRegionMask,
    remapRegionMasksForSave,
    setRegionMask,
    validateRegionMasksOnLoad
};
