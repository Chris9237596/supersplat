import { IndexRanges, sortedPredicate } from '../../index-ranges';
import { Splat } from '../../splat';
import { SerializeSettings, buildExportGaussianMap, ExportGaussianMap } from '../../splat-serialize';

import { decodeRegionMask, encodeRegionMask } from './region-mask-format';
import { ScaRegion } from '../types/region';

type RegionMaskRemapResult = {
    bytes: Uint8Array;
    runtimeMemberCount: number;
    sample?: {
        sourceScaSplatId: string;
        sourceIndex: number;
        exportRow: number;
        runtimeIndex: number;
        regionId: string;
    };
};

const remapRegionMaskToRuntime = (
    maskBytes: Uint8Array,
    region: ScaRegion,
    exportMap: ExportGaussianMap,
    logSample: boolean
): RegionMaskRemapResult => {
    const scaSplatId = region.source.scaSplatId;
    const storageMap = exportMap.storageToExportRowBySplatId.get(scaSplatId);
    if (!storageMap) {
        throw new Error(`[SCA] runtime export: no export map for splat ${scaSplatId} (region ${region.id})`);
    }

    const { ranges } = decodeRegionMask(maskBytes);
    const runtimeIndices: number[] = [];
    let sampleSourceIndex: number | null = null;
    let sampleExportRow: number | null = null;
    let sampleRuntimeIndex: number | null = null;

    ranges.forEach((storageIndex) => {
        const exportRow = storageMap[storageIndex];
        if (exportRow < 0) {
            return;
        }

        const runtimeIndex = exportMap.exportRowToRuntime[exportRow];
        runtimeIndices.push(runtimeIndex);

        if (sampleSourceIndex === null) {
            sampleSourceIndex = storageIndex;
            sampleExportRow = exportRow;
            sampleRuntimeIndex = runtimeIndex;
        }
    });

    if (runtimeIndices.length === 0) {
        return {
            bytes: encodeRegionMask(IndexRanges.fromPredicate(exportMap.runtimeGaussianCount, () => false), exportMap.runtimeGaussianCount),
            runtimeMemberCount: 0
        };
    }

    runtimeIndices.sort((a, b) => a - b);
    const runtimeRanges = IndexRanges.fromPredicate(
        exportMap.runtimeGaussianCount,
        sortedPredicate(new Uint32Array(runtimeIndices))
    );
    const bytes = encodeRegionMask(runtimeRanges, exportMap.runtimeGaussianCount);

    const result: RegionMaskRemapResult = {
        bytes,
        runtimeMemberCount: runtimeIndices.length
    };

    if (logSample && sampleSourceIndex !== null && sampleRuntimeIndex !== null && sampleExportRow !== null) {
        result.sample = {
            sourceScaSplatId: scaSplatId,
            sourceIndex: sampleSourceIndex,
            exportRow: sampleExportRow,
            runtimeIndex: sampleRuntimeIndex,
            regionId: region.id
        };
        console.log('[SCA REGION EXPORT]', JSON.stringify(result.sample));
    }

    return result;
};

const remapRegionMasksForRuntimeExport = (
    splats: Splat[],
    serializeSettings: SerializeSettings,
    regions: ScaRegion[],
    maskBytesByRegionId: Map<string, Uint8Array>
): { exportMap: ExportGaussianMap; runtimeMasks: Map<string, Uint8Array> } => {
    const exportMap = buildExportGaussianMap(splats, serializeSettings);
    if (!exportMap) {
        throw new Error('[SCA] runtime export: no gaussians pass export filter');
    }

    const runtimeMasks = new Map<string, Uint8Array>();
    let loggedSample = false;

    for (const region of regions) {
        if (!region.enabled) {
            continue;
        }

        const sourceBytes = maskBytesByRegionId.get(region.id);
        if (!sourceBytes) {
            console.warn(`[SCA] runtime export: missing source mask for ${region.id}`);
            continue;
        }

        const remapped = remapRegionMaskToRuntime(sourceBytes, region, exportMap, !loggedSample);
        if (remapped.sample) {
            loggedSample = true;
        }

        runtimeMasks.set(region.id, remapped.bytes);
        console.log(`[SCA REGION EXPORT] ${region.id} members: ${remapped.runtimeMemberCount} (runtime gaussianCount=${exportMap.runtimeGaussianCount})`);
    }

    return { exportMap, runtimeMasks };
};

export {
    remapRegionMasksForRuntimeExport,
    remapRegionMaskToRuntime
};

export type {
    RegionMaskRemapResult
};
