import type { Layer } from 'playcanvas';

import {
    RuntimePickDetailedResult,
    RuntimePickHost
} from './runtime-picker-types';
/**
 * Unified GSplat pick buffers encode (runtimeIndex + 1) in RGBA8.
 * Subtracting one yields the final runtime SOG gaussian index.
 */
const decodeRuntimePickPixel = (pixels: ArrayLike<number>): {
    gaussianIndex: number | null;
    rawRGBA: [number, number, number, number];
} => {
    const channel = (value: number): number => {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return 0;
        }
        return n <= 1 ? Math.round(n * 255) : Math.round(n);
    };

    const r = channel(pixels[0]);
    const g = channel(pixels[1]);
    const b = channel(pixels[2]);
    const a = channel(pixels[3]);
    const rawRGBA: [number, number, number, number] = [r, g, b, a];

    if (r === 0 && g === 0 && b === 0 && a === 0) {
        return { gaussianIndex: null, rawRGBA };
    }

    const storedId = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    if (storedId === 0 || storedId === 0xffffffff) {
        return { gaussianIndex: null, rawRGBA };
    }

    return { gaussianIndex: storedId - 1, rawRGBA };
};

class RuntimeWebGpuPicker {
    readonly backendId = 'webgpu' as const;

    private idPickPass: InstanceType<RuntimePickHost['pc']['RenderPassPicker']> | null = null;
    private idPickTarget: InstanceType<RuntimePickHost['pc']['RenderTarget']> | null = null;
    private idPickBuffer: InstanceType<RuntimePickHost['pc']['Texture']> | null = null;    private cacheValid = false;
    private cacheWidth = 0;
    private cacheHeight = 0;
    private pickQueue: Promise<unknown> = Promise.resolve();

    constructor(private readonly host: RuntimePickHost) {}
    isAvailable(): boolean {
        const { app, graphicsDevice } = this.host;
        if (!graphicsDevice.isWebGPU) {
            return false;
        }
        const director = app.renderer.gsplatDirector;
        if (!director) {
            return false;
        }
        const worldLayer = app.scene.layers.getLayerByName('World');
        if (!worldLayer) {
            return false;
        }
        const sceneCam = this.host.getSceneCamera();
        const cameraData = director.camerasMap?.get(sceneCam);
        const layerData = cameraData?.layersMap?.get(worldLayer);
        const manager = layerData?.gsplatManager;
        return !!manager?.renderer?.usesGpuSort;
    }

    pick(nx: number, ny: number): Promise<number | null> {
        return this.pickDetailed(nx, ny).then((result) => result?.gaussianIndex ?? null);
    }

    pickDetailed(nx: number, ny: number): Promise<RuntimePickDetailedResult | null> {        return this.serializePick(async () => {
            const { app, graphicsDevice, pc } = this.host;
            const width = Math.floor(graphicsDevice.width);
            const height = Math.floor(graphicsDevice.height);
            if (width <= 0 || height <= 0) {
                return null;
            }

            const worldLayer = app.scene.layers.getLayerByName('World');
            if (!worldLayer) {
                return null;
            }

            const screenX = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
            const screenY = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));

            await this.ensureIdPickRendered(width, height, worldLayer);

            const flipY = graphicsDevice.isWebGL2 || graphicsDevice.isWebGPU;
            const texY = flipY ? height - screenY - 1 : screenY;
            const pixels = await this.idPickBuffer!.read(screenX, texY, 1, 1, {
                renderTarget: this.idPickTarget!,
                immediate: true
            });
            const decoded = decodeRuntimePickPixel(pixels);

            return {
                gaussianIndex: decoded.gaussianIndex,
                rawRGBA: decoded.rawRGBA,
                screenX,
                screenY,
                width,
                height
            };
        });
    }

    async dumpPickTarget(): Promise<Record<string, unknown>> {
        const { app, graphicsDevice } = this.host;
        const width = Math.floor(graphicsDevice.width);
        const height = Math.floor(graphicsDevice.height);
        const worldLayer = app.scene.layers.getLayerByName('World');
        if (!worldLayer || width <= 0 || height <= 0) {
            return { error: 'pick target unavailable' };
        }
        this.cacheValid = false;
        await this.ensureIdPickRendered(width, height, worldLayer);
        return { width, height, cacheValid: this.cacheValid };
    }

    private serializePick<T>(op: () => Promise<T>): Promise<T> {
        const next = this.pickQueue.then(() => op());
        this.pickQueue = next.catch(() => {});
        return next;
    }

    private ensureCameraOnWorldLayer(worldLayer: Layer): void {
        const sceneCam = this.host.getSceneCamera();
        if (!worldLayer.camerasSet?.has(sceneCam)) {
            worldLayer.addCamera(this.host.getCameraComponent());
        }
    }

    private async waitForUnifiedGsplatPick(
        worldLayer: Layer,
        width: number,
        height: number
    ) {
        const { app } = this.host;
        const sceneCam = this.host.getSceneCamera();
        const director = app.renderer.gsplatDirector;
        if (!director) {
            return null;
        }

        this.ensureCameraOnWorldLayer(worldLayer);
        if (!app.scene.gsplat.enableIds) {
            app.scene.gsplat.enableIds = true;
        }

        for (let attempt = 0; attempt < 40; attempt++) {
            app.renderNextFrame = true;
            await new Promise<void>((resolve) => app.once('frameend', resolve));
            const pickMI = director.prepareForPicking(sceneCam, width, height, worldLayer);
            if (pickMI && pickMI.instancingCount > 0) {
                return pickMI;
            }
        }

        return director.prepareForPicking(sceneCam, width, height, worldLayer);
    }

    private async ensureIdPickRendered(width: number, height: number, worldLayer: Layer): Promise<void> {
        const { app, graphicsDevice, pc, depthPickerPatches } = this.host;

        if (this.cacheValid &&
            this.cacheWidth === width &&
            this.cacheHeight === height &&
            this.host.cameraMatches(width, height)) {
            return;
        }

        const depthPickerPatchesActive = depthPickerPatches.isActive();
        if (!app.scene.gsplat.enableIds) {
            app.scene.gsplat.enableIds = true;
        }

        this.ensureCameraOnWorldLayer(worldLayer);
        await this.waitForUnifiedGsplatPick(worldLayer, width, height);

        try {
            if (!this.idPickPass) {
                this.idPickBuffer = new pc.Texture(graphicsDevice, {
                    format: pc.PIXELFORMAT_RGBA8,
                    width,
                    height,
                    mipmaps: false,
                    minFilter: pc.FILTER_NEAREST,
                    magFilter: pc.FILTER_NEAREST,
                    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
                    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
                    name: 'sca-picker-id'
                });
                this.idPickTarget = new pc.RenderTarget({
                    colorBuffer: this.idPickBuffer,
                    depth: true
                });
                this.idPickPass = new pc.RenderPassPicker(graphicsDevice, app.renderer);
                this.idPickPass.blendState = pc.BlendState.NOBLEND;
            } else if (this.cacheWidth !== width || this.cacheHeight !== height) {
                this.cacheValid = false;
                this.idPickTarget!.resize(width, height);
            }

            if (depthPickerPatchesActive) {
                depthPickerPatches.unregister();
            }

            app.renderNextFrame = true;
            this.idPickPass!.init(this.idPickTarget!);
            this.idPickPass!.setClearColor(new pc.Color(0, 0, 0, 0));
            this.idPickPass!.update(
                this.host.getCameraComponent(),
                app.scene,
                [worldLayer],
                new Map(),
                false
            );
            this.idPickPass!.render();

            if (graphicsDevice.isWebGPU) {
                (graphicsDevice as { submit?: () => void }).submit?.();
                await new Promise<void>((resolve) => app.once('frameend', resolve));
            }

            this.cacheWidth = width;
            this.cacheHeight = height;
            this.cacheValid = true;
        } finally {
            if (depthPickerPatchesActive) {
                depthPickerPatches.register();
            }
        }
    }
}

const installRuntimeWebGpuPicker = (host: RuntimePickHost): RuntimeWebGpuPicker => {    const picker = new RuntimeWebGpuPicker(host);
    if (!picker.isAvailable()) {
        console.warn('[SCA PICK] WebGPU unified GSplat picker unavailable on this device');
    }
    return picker;
};

export {
    RuntimeWebGpuPicker,
    decodeRuntimePickPixel,
    installRuntimeWebGpuPicker
};
