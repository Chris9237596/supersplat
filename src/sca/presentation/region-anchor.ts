type RegionAnchor3D = {
    x: number;
    y: number;
    z: number;
};

type RegionCentersAccessor = {
    count: number;
    getCenter: (index: number) => [number, number, number] | null;
};

type RegionWorldTransform = (x: number, y: number, z: number) => [number, number, number];

const computeRegionAnchorFromIndices = (
    indices: Iterable<number>,
    accessor: RegionCentersAccessor,
    transformWorld?: RegionWorldTransform
): RegionAnchor3D | null => {
    let count = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;

    for (const index of indices) {
        if (index < 0 || index >= accessor.count) {
            continue;
        }

        const center = accessor.getCenter(index);
        if (!center) {
            continue;
        }

        const [wx, wy, wz] = transformWorld ?
            transformWorld(center[0], center[1], center[2]) :
            center;

        sx += wx;
        sy += wy;
        sz += wz;
        count++;
    }

    if (count === 0) {
        return null;
    }

    return {
        x: sx / count,
        y: sy / count,
        z: sz / count
    };
};

const computeRegionAnchorFromBitset = (
    bitset: Uint8Array,
    accessor: RegionCentersAccessor,
    transformWorld?: RegionWorldTransform
): RegionAnchor3D | null => {
    const indices = (function* () {
        const limit = Math.min(bitset.length, accessor.count);
        for (let i = 0; i < limit; i++) {
            if (bitset[i]) {
                yield i;
            }
        }
    })();

    return computeRegionAnchorFromIndices(indices, accessor, transformWorld);
};

const createCentersAccessorFromFloat32 = (
    centers: Float32Array,
    gaussianCount: number
): RegionCentersAccessor => ({
    count: gaussianCount,
    getCenter(index: number): [number, number, number] | null {
        if (index < 0 || index >= gaussianCount) {
            return null;
        }
        const offset = index * 3;
        if (offset + 2 >= centers.length) {
            return null;
        }
        return [centers[offset], centers[offset + 1], centers[offset + 2]];
    }
});

export {
    RegionAnchor3D,
    RegionCentersAccessor,
    RegionWorldTransform,
    computeRegionAnchorFromBitset,
    computeRegionAnchorFromIndices,
    createCentersAccessorFromFloat32
};
