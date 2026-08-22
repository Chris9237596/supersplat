import type {
    Application,
    BlendState,
    Camera,
    CameraComponent,
    Color,
    GraphicsDevice,
    RenderPassPicker,
    RenderTarget,
    Texture
} from 'playcanvas';

type RuntimePickPc = {
    RenderPassPicker: typeof RenderPassPicker;
    Texture: typeof Texture;
    RenderTarget: typeof RenderTarget;
    Color: typeof Color;
    BlendState: typeof BlendState;
    FILTER_NEAREST: number;
    ADDRESS_CLAMP_TO_EDGE: number;
    PIXELFORMAT_RGBA8: number;
};

type RuntimeDepthPickerPatches = {
    isActive: () => boolean;
    register: () => void;
    unregister: () => void;
};

type RuntimePickHost = {
    app: Application;
    graphicsDevice: GraphicsDevice;
    getSceneCamera: () => Camera;
    getCameraComponent: () => CameraComponent;
    cameraMatches: (width: number, height: number) => boolean;
    depthPickerPatches: RuntimeDepthPickerPatches;
    pc: RuntimePickPc;
    /** Screen-space hit tolerance in pixels (Centers backend). */
    pickTolerancePx?: number;
};

type RuntimePickDetailedResult = {
    gaussianIndex: number | null;
    rawRGBA?: [number, number, number, number];
    screenX: number;
    screenY: number;
    width: number;
    height: number;
};

type RuntimePickerBackend = 'webgpu' | 'centers';

interface RuntimePickerAdapter {
    readonly backendId: RuntimePickerBackend;
    isAvailable(): boolean;
    pick(nx: number, ny: number): Promise<number | null>;
    pickDetailed(nx: number, ny: number): Promise<RuntimePickDetailedResult | null>;
    pickSyncDetailed?(nx: number, ny: number): RuntimePickDetailedResult | null;
    dumpPickTarget?(): Promise<Record<string, unknown>>;
}

export {
    RuntimeDepthPickerPatches,
    RuntimePickDetailedResult,
    RuntimePickHost,
    RuntimePickPc,
    RuntimePickerAdapter,
    RuntimePickerBackend,
    // Legacy aliases
    RuntimeDepthPickerPatches as RuntimeWebGpuDepthPickerPatches,
    RuntimePickDetailedResult as RuntimeWebGpuPickDetailedResult,
    RuntimePickHost as RuntimeWebGpuPickHost,
    RuntimePickPc as RuntimeWebGpuPickPc
};
