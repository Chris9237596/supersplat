import { ScaRegionMaskLookup } from '../interaction/sca-region-types';

type RuntimeRegionLookupEntry = {
    regionId: string;
    region: {
        enabled?: boolean;
        interaction?: { clickable?: boolean };
    };
    bitset: Uint8Array;
};

type RuntimeRegionLookup = {
    gaussianCount: number;
    entries: RuntimeRegionLookupEntry[];
};

const createRuntimeRegionMaskLookup = (
    lookup: RuntimeRegionLookup,
    defaultScaSplatId: string
): ScaRegionMaskLookup => ({
    resolve(gaussianIndex: number, scaSplatId: string): string | null {
        if (scaSplatId !== defaultScaSplatId) {
            return null;
        }
        if (gaussianIndex < 0 || gaussianIndex >= lookup.gaussianCount) {
            return null;
        }

        for (let i = 0; i < lookup.entries.length; i++) {
            const entry = lookup.entries[i];
            if (entry.bitset[gaussianIndex]) {
                return entry.regionId;
            }
        }

        return null;
    }
});

export {
    RuntimeRegionLookup,
    RuntimeRegionLookupEntry,
    createRuntimeRegionMaskLookup
};
