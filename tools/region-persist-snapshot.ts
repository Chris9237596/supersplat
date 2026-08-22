import { createHash } from 'node:crypto';

import { IndexRanges } from '../src/index-ranges';
import { decodeRegionMask } from '../src/sca/regions/region-mask-format';
import { regionMaskStorePath } from '../src/sca/regions/region-mask-paths';
import { getRegionMask } from '../src/sca/regions/region-mask-store';
import { ScaAssetStore } from '../src/sca/store/sca-asset-store';
import { ScaRegion } from '../src/sca/types/region';

type RegionPersistSnapshot = {
    regionId: string;
    sourceScaSplatId: string;
    members: number;
    rangeCount: number;
    maskHash: string;
    splatGaussianCount: number;
};

const countRanges = (ranges: IndexRanges): number => {
    let rangeCount = 0;
    const { data } = ranges;
    let index = 0;
    while (index < data.length) {
        rangeCount++;
        if (data[index] & 0x80000000) {
            index++;
        } else {
            index += 2;
        }
    }
    return rangeCount;
};

const hashMaskBytes = (bytes: Uint8Array): string => {
    return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
};

const snapshotRegionPersist = (
    region: ScaRegion,
    assetStore: ScaAssetStore,
    splatGaussianCount: number
): RegionPersistSnapshot | null => {
    const ranges = getRegionMask(assetStore, region.id);
    const storePath = regionMaskStorePath(region.id);
    const entry = assetStore.get(storePath);
    if (!ranges || !entry) {
        return null;
    }

    let members = 0;
    ranges.forEach(() => {
        members++;
    });

    return {
        regionId: region.id,
        sourceScaSplatId: region.source.scaSplatId,
        members,
        rangeCount: countRanges(ranges),
        maskHash: hashMaskBytes(entry.data),
        splatGaussianCount
    };
};

const logRegionPersistSnapshot = (
    phase: 'beforeSave' | 'afterSave' | 'afterReload',
    snapshot: RegionPersistSnapshot | null
): void => {
    if (!snapshot) {
        console.log(`[SCA REGION PERSIST] phase=${phase} snapshot=null`);
        return;
    }

    console.log(
        '[SCA REGION PERSIST]\n' +
        `phase=${phase}\n` +
        `regionId=${snapshot.regionId}\n` +
        `sourceScaSplatId=${snapshot.sourceScaSplatId}\n` +
        `members=${snapshot.members}\n` +
        `rangeCount=${snapshot.rangeCount}\n` +
        `maskHash=${snapshot.maskHash}\n` +
        `splatGaussianCount=${snapshot.splatGaussianCount}`
    );
};

const reloadRegionMaskFromBytes = (
    assetStore: ScaAssetStore,
    regionId: string,
    bytes: Uint8Array
): IndexRanges => {
    const decoded = decodeRegionMask(bytes);
    assetStore.set(regionMaskStorePath(regionId), bytes.slice(), 'application/x-sca-region-mask');
    return decoded.ranges;
};

export {
    RegionPersistSnapshot,
    hashMaskBytes,
    logRegionPersistSnapshot,
    reloadRegionMaskFromBytes,
    snapshotRegionPersist
};
