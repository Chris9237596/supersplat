import { Mat4 } from 'playcanvas';

type GsplatResourceLike = {
    id: number;
    centers: Float32Array;
    centersVersion: number;
};

type GsplatComponentLike = {
    resource?: GsplatResourceLike | null;
    _resource?: GsplatResourceLike | null;
    instance?: { resource?: GsplatResourceLike | null };
};

type GsplatCpuSorterLike = {
    setCenters: (id: number, centers: Float32Array | null) => void;
};

type GsplatManagerLike = {
    cpuSorter?: GsplatCpuSorterLike | null;
    sortNeeded?: boolean;
};

type GsplatDirectorLike = {
    camerasMap?: Map<unknown, {
        layersMap?: Map<unknown, {
            gsplatManager?: GsplatManagerLike | null;
            gsplatManagerShadow?: GsplatManagerLike | null;
        }>;
    }>;
};

type AppWithGsplatDirector = {
    renderer?: {
        gsplatDirector?: GsplatDirectorLike | null;
    };
};

const transformPoint = (matrix: Mat4, x: number, y: number, z: number): [number, number, number] => {
    const m = matrix.data;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const resolveGsplatResource = (component: GsplatComponentLike | null): GsplatResourceLike | null => {
    const resource = component?.resource ??
        component?._resource ??
        component?.instance?.resource ??
        null;

    if (!resource?.centers || resource.centers.length < 3) {
        return null;
    }

    return resource;
};

const forEachCpuSorter = (
    app: AppWithGsplatDirector | undefined,
    fn: (sorter: GsplatCpuSorterLike, manager: GsplatManagerLike) => void
): void => {
    const director = app?.renderer?.gsplatDirector;
    if (!director?.camerasMap) {
        return;
    }

    for (const cameraData of director.camerasMap.values()) {
        for (const layerData of cameraData.layersMap?.values() ?? []) {
            for (const manager of [layerData.gsplatManager, layerData.gsplatManagerShadow]) {
                const sorter = manager?.cpuSorter;
                if (sorter && manager) {
                    fn(sorter, manager);
                }
            }
        }
    }
};

const syncCpuSorterCenters = (
    app: AppWithGsplatDirector | undefined,
    resource: GsplatResourceLike,
    sortCenters: Float32Array
): boolean => {
    let synced = false;

    forEachCpuSorter(app, (sorter, manager) => {
        sorter.setCenters(resource.id, null);
        sorter.setCenters(resource.id, sortCenters);
        manager.sortNeeded = true;
        synced = true;
    });

    return synced;
};

type RuntimeRigSortCentersBinding = {
    gaussianIndices: number[];
};

type RuntimeRigSortCentersState = {
    resource: GsplatResourceLike;
    sourceCenters: Float32Array;
    readSourceCenter: (gaussianIndex: number) => [number, number, number] | null;
    readSortCenter: (gaussianIndex: number) => [number, number, number] | null;
    updateForMatrix: (matrix: Mat4, bindings: RuntimeRigSortCentersBinding[]) => void;
    flush: () => boolean;
    restoreAuthoredCenters: (bindings: RuntimeRigSortCentersBinding[]) => boolean;
    destroy: () => void;
};

const createRuntimeRigSortCentersState = (
    app: AppWithGsplatDirector | undefined,
    component: GsplatComponentLike | null,
    bindings: RuntimeRigSortCentersBinding[]
): RuntimeRigSortCentersState | null => {
    const resource = resolveGsplatResource(component);
    if (!resource) {
        console.warn('[SCA RUNTIME RIG] sort centers unavailable: gsplat resource.centers missing');
        return null;
    }

    // Neutral render centers — never mutated after capture.
    const sourceCenters = resource.centers.slice();
    // Scratch buffer for CPU depth sort only (palette * local for rig-bound indices).
    const sortCenters = sourceCenters.slice();

    let dirty = false;

    const applyMatrix = (matrix: Mat4, activeBindings: RuntimeRigSortCentersBinding[]): void => {
        for (const binding of activeBindings) {
            for (const gaussianIndex of binding.gaussianIndices) {
                const offset = gaussianIndex * 3;
                if (offset + 2 >= sortCenters.length || offset + 2 >= sourceCenters.length) {
                    continue;
                }

                const [tx, ty, tz] = transformPoint(
                    matrix,
                    sourceCenters[offset],
                    sourceCenters[offset + 1],
                    sourceCenters[offset + 2]
                );
                sortCenters[offset] = tx;
                sortCenters[offset + 1] = ty;
                sortCenters[offset + 2] = tz;
                dirty = true;
            }
        }
    };

    const flush = (): boolean => {
        if (!dirty) {
            return false;
        }

        dirty = false;
        return syncCpuSorterCenters(app, resource, sortCenters);
    };

    const restoreAuthoredCenters = (activeBindings: RuntimeRigSortCentersBinding[]): boolean => {
        let updated = false;

        for (const binding of activeBindings) {
            for (const gaussianIndex of binding.gaussianIndices) {
                const offset = gaussianIndex * 3;
                if (offset + 2 >= sortCenters.length || offset + 2 >= sourceCenters.length) {
                    continue;
                }

                sortCenters[offset] = sourceCenters[offset];
                sortCenters[offset + 1] = sourceCenters[offset + 1];
                sortCenters[offset + 2] = sourceCenters[offset + 2];
                updated = true;
            }
        }

        if (!updated) {
            return false;
        }

        dirty = false;
        return syncCpuSorterCenters(app, resource, sortCenters);
    };

    const readCenter = (
        buffer: Float32Array,
        gaussianIndex: number
    ): [number, number, number] | null => {
        const offset = gaussianIndex * 3;
        if (offset + 2 >= buffer.length) {
            return null;
        }
        return [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
    };

    return {
        resource,
        sourceCenters,
        readSourceCenter: (gaussianIndex) => readCenter(sourceCenters, gaussianIndex),
        readSortCenter: (gaussianIndex) => readCenter(sortCenters, gaussianIndex),
        updateForMatrix: (matrix, activeBindings) => applyMatrix(matrix, activeBindings),
        flush,
        restoreAuthoredCenters,
        destroy: () => {
            restoreAuthoredCenters(bindings);
        }
    };
};

export {
    createRuntimeRigSortCentersState,
    resolveGsplatResource,
    RuntimeRigSortCentersBinding,
    RuntimeRigSortCentersState,
    syncCpuSorterCenters,
    transformPoint
};
