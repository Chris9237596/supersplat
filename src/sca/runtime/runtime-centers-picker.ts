import {
    RuntimePickDetailedResult,
    RuntimePickHost,
    RuntimePickerAdapter
} from './runtime-picker-types';

const DEFAULT_PICK_TOLERANCE_PX = 10;

type GsplatComponentLike = {
    entity?: {
        getWorldTransform?: () => { data: Float32Array };
    };
    resource?: {
        centers?: Float32Array | null;
        gsplatData?: { numSplats: number };
    };
    instance?: {
        resource?: {
            centers?: Float32Array | null;
            gsplatData?: { numSplats: number };
        };
    };
};

type SceneCameraLike = {
    _viewProjMat?: { data: Float32Array; mul2?: (a: unknown, b: unknown) => unknown };
    projectionMatrix?: { data: Float32Array };
    viewMatrix?: { data: Float32Array };
};

const transformMat4Vec4 = (
    m: Float32Array,
    x: number,
    y: number,
    z: number,
    w = 1
): [number, number, number, number] => {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w
    ];
};

const mulMat4 = (a: Float32Array, b: Float32Array): Float32Array => {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            out[col * 4 + row] =
                a[row] * b[col * 4 + 0] +
                a[4 + row] * b[col * 4 + 1] +
                a[8 + row] * b[col * 4 + 2] +
                a[12 + row] * b[col * 4 + 3];
        }
    }
    return out;
};

const resolveViewProjMatrix = (camera: SceneCameraLike): Float32Array | null => {
    const viewProj = camera._viewProjMat;
    if (viewProj?.data) {
        if (typeof viewProj.mul2 === 'function' &&
            camera.projectionMatrix?.data &&
            camera.viewMatrix?.data) {
            viewProj.mul2(camera.projectionMatrix, camera.viewMatrix);
        }
        return viewProj.data;
    }
    if (camera.projectionMatrix?.data && camera.viewMatrix?.data) {
        return mulMat4(camera.projectionMatrix.data, camera.viewMatrix.data);
    }
    return null;
};

const resolveGsplatResource = (app: RuntimePickHost['app']) => {
    const components = (app.root.findComponents('gsplat') ?? []) as GsplatComponentLike[];
    const component = components[0];
    if (!component) {
        return null;
    }

    const resource = component.resource ?? component.instance?.resource;
    const gsplatData = resource?.gsplatData;
    const numSplats = gsplatData?.numSplats ?? 0;
    const centers = resource?.centers ?? null;
    const worldTransform = component.entity?.getWorldTransform?.()?.data ?? null;

    return {
        component,
        centers,
        numSplats,
        worldTransform
    };
};

class RuntimeCentersPicker implements RuntimePickerAdapter {
    readonly backendId = 'centers' as const;

    private centers: Float32Array | null = null;
    private numSplats = 0;
    private worldTransform: Float32Array | null = null;
    private pickTolerancePx: number;
    private warnedLayout = false;

    constructor(private readonly host: RuntimePickHost) {
        this.pickTolerancePx = host.pickTolerancePx ?? DEFAULT_PICK_TOLERANCE_PX;
        this.cacheCenters();
    }

    isAvailable(): boolean {
        this.ensureCentersCached();
        return this.centers !== null && this.numSplats > 0;
    }

    pick(nx: number, ny: number): Promise<number | null> {
        return Promise.resolve(this.pickSync(nx, ny));
    }

    pickDetailed(nx: number, ny: number): Promise<RuntimePickDetailedResult | null> {
        return Promise.resolve(this.pickSyncDetailed(nx, ny));
    }

    pickSyncDetailed(nx: number, ny: number): RuntimePickDetailedResult | null {
        const { graphicsDevice } = this.host;
        const width = Math.floor(graphicsDevice.width);
        const height = Math.floor(graphicsDevice.height);
        if (width <= 0 || height <= 0) {
            return null;
        }

        const gaussianIndex = this.pickSync(nx, ny);
        const screenX = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
        const screenY = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));

        return {
            gaussianIndex,
            screenX,
            screenY,
            width,
            height
        };
    }

    private ensureCentersCached(): void {
        if (this.centers !== null && this.numSplats > 0) {
            return;
        }
        this.cacheCenters();
    }

    private cacheCenters(): void {
        const resolved = resolveGsplatResource(this.host.app);
        if (!resolved) {
            return;
        }

        const { centers, numSplats, worldTransform } = resolved;
        if (!centers || numSplats <= 0) {
            return;
        }

        if (centers.length !== numSplats * 3) {
            console.warn(
                `[SCA PICK] Centers picker: center layout mismatch ` +
                `(centers.length=${centers.length}, gaussianCount=${numSplats}, expected=${numSplats * 3})`
            );
        }

        this.centers = centers;
        this.numSplats = numSplats;
        this.worldTransform = worldTransform;
        if (!this.loggedReady) {
            console.log(`[SCA PICK] Centers picker ready (${numSplats} runtime gaussians)`);
            this.loggedReady = true;
        }
    }

    private loggedReady = false;

    private pickSync(nx: number, ny: number): number | null {
        this.ensureCentersCached();
        if (!this.centers || this.numSplats <= 0) {
            return null;
        }

        const { graphicsDevice, getSceneCamera } = this.host;
        const width = Math.floor(graphicsDevice.width);
        const height = Math.floor(graphicsDevice.height);
        if (width <= 0 || height <= 0) {
            return null;
        }

        const viewProj = resolveViewProjMatrix(getSceneCamera() as SceneCameraLike);
        if (!viewProj) {
            if (!this.warnedLayout) {
                console.warn('[SCA PICK] Centers picker: camera view/projection matrix unavailable');
                this.warnedLayout = true;
            }
            return null;
        }

        const combined = this.worldTransform ?
            mulMat4(viewProj, this.worldTransform) :
            viewProj;

        const sx = nx * width;
        const sy = ny * height;
        const tolerance = this.pickTolerancePx;
        const cameraPos = this.readCameraPosition();

        let bestIndex: number | null = null;
        let bestDistanceSq = Infinity;
        const centers = this.centers;
        const worldTransform = this.worldTransform;

        for (let i = 0; i < this.numSplats; i++) {
            const cx = centers[i * 3 + 0];
            const cy = centers[i * 3 + 1];
            const cz = centers[i * 3 + 2];
            const clip = transformMat4Vec4(combined, cx, cy, cz, 1);

            if (Math.abs(clip[3]) < 1e-8 || clip[3] <= 0) {
                continue;
            }

            const px = (clip[0] / clip[3] * 0.5 + 0.5) * width;
            const py = (-clip[1] / clip[3] * 0.5 + 0.5) * height;
            if (Math.abs(px - sx) >= tolerance || Math.abs(py - sy) >= tolerance) {
                continue;
            }

            let wx = cx;
            let wy = cy;
            let wz = cz;
            if (worldTransform) {
                const world = transformMat4Vec4(worldTransform, cx, cy, cz, 1);
                const invW = 1 / world[3];
                wx = world[0] * invW;
                wy = world[1] * invW;
                wz = world[2] * invW;
            }

            const dx = wx - cameraPos[0];
            const dy = wy - cameraPos[1];
            const dz = wz - cameraPos[2];
            const distanceSq = dx * dx + dy * dy + dz * dz;

            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    private readCameraPosition(): [number, number, number] {
        const camComp = this.host.getCameraComponent() as {
            entity?: { getPosition?: () => { x: number; y: number; z: number } };
        };
        if (typeof camComp.entity?.getPosition === 'function') {
            const pos = camComp.entity.getPosition();
            return [pos.x, pos.y, pos.z];
        }

        const camera = this.host.getSceneCamera() as SceneCameraLike;
        const viewMat = camera.viewMatrix?.data;
        if (viewMat) {
            return [
                -(viewMat[0] * viewMat[12] + viewMat[1] * viewMat[13] + viewMat[2] * viewMat[14]),
                -(viewMat[4] * viewMat[12] + viewMat[5] * viewMat[13] + viewMat[6] * viewMat[14]),
                -(viewMat[8] * viewMat[12] + viewMat[9] * viewMat[13] + viewMat[10] * viewMat[14])
            ];
        }

        return [0, 0, 0];
    }
}

export {
    RuntimeCentersPicker,
    DEFAULT_PICK_TOLERANCE_PX
};
