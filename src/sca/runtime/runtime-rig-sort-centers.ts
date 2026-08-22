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
    resource: GsplatResourceLike
): boolean => {
    let synced = false;

    resource.centersVersion = (resource.centersVersion ?? 0) + 1;

    forEachCpuSorter(app, (sorter, manager) => {
        sorter.setCenters(resource.id, null);
        sorter.setCenters(resource.id, resource.centers);
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

    const sourceCenters = resource.centers.slice();

    let dirty = false;

    const applyMatrix = (matrix: Mat4, activeBindings: RuntimeRigSortCentersBinding[]): void => {
        const centers = resource.centers;

        for (const binding of activeBindings) {
            for (const gaussianIndex of binding.gaussianIndices) {
                const offset = gaussianIndex * 3;
                if (offset + 2 >= centers.length || offset + 2 >= sourceCenters.length) {
                    continue;
                }

                const [tx, ty, tz] = transformPoint(
                    matrix,
                    sourceCenters[offset],
                    sourceCenters[offset + 1],
                    sourceCenters[offset + 2]
                );
                centers[offset] = tx;
                centers[offset + 1] = ty;
                centers[offset + 2] = tz;
                dirty = true;
            }
        }
    };

    const flush = (): boolean => {
        if (!dirty) {
            return false;
        }

        dirty = false;
        return syncCpuSorterCenters(app, resource);
    };

    const restoreAuthoredCenters = (activeBindings: RuntimeRigSortCentersBinding[]): boolean => {
        const centers = resource.centers;
        let updated = false;

        for (const binding of activeBindings) {
            for (const gaussianIndex of binding.gaussianIndices) {
                const offset = gaussianIndex * 3;
                if (offset + 2 >= centers.length || offset + 2 >= sourceCenters.length) {
                    continue;
                }

                centers[offset] = sourceCenters[offset];
                centers[offset + 1] = sourceCenters[offset + 1];
                centers[offset + 2] = sourceCenters[offset + 2];
                updated = true;
            }
        }

        if (!updated) {
            return false;
        }

        return syncCpuSorterCenters(app, resource);
    };

    return {
        resource,
        sourceCenters,
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
