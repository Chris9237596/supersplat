import { Mat4 } from 'playcanvas';

import { Scene } from '../../scene';
import { Splat } from '../../splat';

import {
    applyPaletteToLocalCenter,
    buildShaderModelView,
    gaussianIndexToTexel,
    traceTransformPoint
} from './rig-gaussian-trace';
import { matrixToArray } from './rig-transform';

const RENDER_SEAM_PROBE_CONFIG = {
    animationClipId: 'animation_01',
    nodeId: 'rig_02',
    regionId: 'region_04',
    sampleTime: 0.5,
    timeEpsilon: 0.05,
    editorGaussianIndex: 44362,
    runtimeGaussianIndex: 51865,
    expectedPaletteIndex: 2
} as const;

type RenderSeamSide = 'editor' | 'runtime';

type RenderSeamCapture = {
    side: RenderSeamSide;
    hook: 'editor.splat.onPreRender' | 'runtime.camera.preRenderLayer';
    sampleTime: number;
    playbackTime: number;
    animationClipId: string;
    regionId: string;
    nodeId: string;
    gaussianIndex: number;
    shaderTransformIndexLookup: string;
    localCenterShaderSource: [number, number, number];
    transformIndexTexel: {
        x: number;
        y: number;
        linearIndex: number;
        value: number;
    };
    paletteIndex: number;
    paletteMatrixFromTexture: number[];
    matrixModel: number[];
    matrixView: number[];
    matrixProjection: number[];
    cameraParams: number[] | null;
    centerAfterPalette: [number, number, number];
    worldCenterPredicted: [number, number, number];
    viewCenterPredicted: [number, number, number];
    clipPosPredicted: [number, number, number, number];
    ndcPredicted: [number, number, number];
    screenPosPredicted: [number, number] | null;
    materialUniforms: {
        transformIndexTextureName: string;
        paletteTextureName: string;
        indexTexWidth: number | null;
        transformIndexTextureSize: [number, number] | null;
        paletteTextureSize: [number, number] | null;
    };
    renderFrameRequested: boolean;
};

type EditorPendingCapture = {
    splat: Splat;
    gaussianIndex: number;
    paletteIndex: number;
    playbackTime: number;
    animationClipId: string;
};

type RuntimeRenderSeamProbe = {
    regionId: string;
    gaussianIndex: number;
    paletteIndex: number;
    textureWidth: number;
    getLocalCenter: () => [number, number, number];
    getEntityMatrix: () => Mat4;
    getPaletteMatrix: (paletteIndex: number) => Mat4;
    readTransformIndex: (gaussianIndex: number) => number;
    getMaterial: () => {
        getParameter?: (name: string) => { data?: unknown } | undefined;
    } | null;
    getCamera: () => {
        viewMatrix?: Mat4;
        projectionMatrix?: Mat4;
        camera?: { viewMatrix?: Mat4; projectionMatrix?: Mat4 };
    } | null;
    getCanvasSize: () => { width: number; height: number };
    getRenderFrameRequested: () => boolean;
};

type RenderSeamProbeStore = {
    editor: RenderSeamCapture | null;
    runtime: RenderSeamCapture | null;
    firstDivergence: string | null;
};

declare global {
    interface Window {
        SCA3D?: Record<string, unknown> & {
            renderSeamProbe?: RenderSeamProbeStore;
            compareRenderSeamProbe?: () => Record<string, unknown>;
        };
    }
}

const matScratch = new Mat4();
const matViewScratch = new Mat4();
const matProjectionScratch = new Mat4();

let editorPending: EditorPendingCapture | null = null;
let editorCaptured = false;
let runtimeCaptured = false;
let runtimeProbe: RuntimeRenderSeamProbe | null = null;

const isSampleDue = (playbackTime: number): boolean => {
    return Math.abs(playbackTime - RENDER_SEAM_PROBE_CONFIG.sampleTime) <= RENDER_SEAM_PROBE_CONFIG.timeEpsilon;
};

const getProbeStore = (): RenderSeamProbeStore => {
    window.SCA3D = window.SCA3D ?? {};
    if (!window.SCA3D.renderSeamProbe) {
        window.SCA3D.renderSeamProbe = {
            editor: null,
            runtime: null,
            firstDivergence: null
        };
    }
    return window.SCA3D.renderSeamProbe;
};

const readTextureSize = (texture: { width?: number; height?: number } | null | undefined): [number, number] | null => {
    if (!texture || typeof texture.width !== 'number' || typeof texture.height !== 'number') {
        return null;
    }
    return [texture.width, texture.height];
};


const readMaterialTextureParam = (
    material: { getParameter?: (name: string) => { data?: unknown } | undefined } | null,
    name: string
): { width?: number; height?: number } | null => {
    const param = material?.getParameter?.(name);
    const data = param?.data as { width?: number; height?: number } | undefined;
    return data ?? null;
};

const readMaterialTextureSize = (
    material: { getParameter?: (name: string) => { data?: unknown } | undefined } | null,
    name: string
): [number, number] | null => {
    return readTextureSize(readMaterialTextureParam(material, name));
};

const readTransformIndexValue = (
    readIndex: (gaussianIndex: number) => number,
    gaussianIndex: number,
    textureWidth: number
): RenderSeamCapture['transformIndexTexel'] => {
    const texel = gaussianIndexToTexel(gaussianIndex, textureWidth);
    const linearIndex = texel.y * textureWidth + texel.x;
    return {
        x: texel.x,
        y: texel.y,
        linearIndex,
        value: readIndex(gaussianIndex)
    };
};

const projectCenter = (
    localCenter: [number, number, number],
    matrixModel: Mat4,
    paletteMatrix: Mat4,
    matrixView: Mat4,
    matrixProjection: Mat4,
    canvasWidth: number,
    canvasHeight: number
): Pick<
    RenderSeamCapture,
    | 'centerAfterPalette'
    | 'worldCenterPredicted'
    | 'viewCenterPredicted'
    | 'clipPosPredicted'
    | 'ndcPredicted'
    | 'screenPosPredicted'
> => {
    const centerAfterPalette = applyPaletteToLocalCenter(paletteMatrix, localCenter);
    const worldCenterPredicted = traceTransformPoint(matrixModel, ...centerAfterPalette);
    const modelView = buildShaderModelView(matrixModel, paletteMatrix, matrixView);
    const viewCenterPredicted = traceTransformPoint(modelView, ...localCenter);

    const clip = new Mat4().mul2(matrixProjection, modelView);
    const m = clip.data;
    const w = m[3] * localCenter[0] + m[7] * localCenter[1] + m[11] * localCenter[2] + m[15];
    const clipPosPredicted: [number, number, number, number] = [
        m[0] * localCenter[0] + m[4] * localCenter[1] + m[8] * localCenter[2] + m[12],
        m[1] * localCenter[0] + m[5] * localCenter[1] + m[9] * localCenter[2] + m[13],
        m[2] * localCenter[0] + m[6] * localCenter[1] + m[10] * localCenter[2] + m[14],
        w
    ];

    const invW = Math.abs(w) > 1e-12 ? 1 / w : 0;
    const ndcPredicted: [number, number, number] = [
        clipPosPredicted[0] * invW,
        clipPosPredicted[1] * invW,
        clipPosPredicted[2] * invW
    ];

    const screenPosPredicted = canvasWidth > 0 && canvasHeight > 0 ?
        [
            (ndcPredicted[0] * 0.5 + 0.5) * canvasWidth,
            (1 - (ndcPredicted[1] * 0.5 + 0.5)) * canvasHeight
        ] as [number, number] :
        null;

    return {
        centerAfterPalette,
        worldCenterPredicted,
        viewCenterPredicted,
        clipPosPredicted,
        ndcPredicted,
        screenPosPredicted
    };
};

const resolveCameraMatrices = (
    cameraLike: RuntimeRenderSeamProbe['getCamera'] extends () => infer R ? R : never
): { view: Mat4; projection: Mat4; cameraParams: number[] | null } => {
    const view = new Mat4();
    const projection = new Mat4();
    let cameraParams: number[] | null = null;

    const camera = cameraLike?.camera ?? cameraLike;
    if (camera?.viewMatrix) {
        view.copy(camera.viewMatrix);
    }
    if (camera?.projectionMatrix) {
        projection.copy(camera.projectionMatrix);
    }

    const params = (cameraLike as { camera?: { camera?: { _projectionParams?: { data?: Float32Array } } } })?.camera?.camera?._projectionParams?.data;
    if (params) {
        cameraParams = [...params];
    }

    return { view, projection, cameraParams };
};

const compareCaptures = (editor: RenderSeamCapture, runtime: RenderSeamCapture): string | null => {
    const numericArrayMax = (left: number[], right: number[], epsilon = 1e-4): string | null => {
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            if (Math.abs(left[i] - right[i]) > epsilon) {
                return `[${i}] editor=${left[i]} runtime=${right[i]}`;
            }
        }
        return null;
    };

    const checks: Array<[string, () => string | null]> = [
        ['animationClipId', () => editor.animationClipId === runtime.animationClipId ? null : `${editor.animationClipId} vs ${runtime.animationClipId}`],
        ['transformIndexTexel.value', () => editor.transformIndexTexel.value === runtime.transformIndexTexel.value ? null : `${editor.transformIndexTexel.value} vs ${runtime.transformIndexTexel.value}`],
        ['paletteIndex', () => editor.paletteIndex === runtime.paletteIndex ? null : `${editor.paletteIndex} vs ${runtime.paletteIndex}`],
        ['paletteMatrixFromTexture', () => numericArrayMax(editor.paletteMatrixFromTexture, runtime.paletteMatrixFromTexture)],
        ['matrixModel', () => numericArrayMax(editor.matrixModel, runtime.matrixModel)],
        ['matrixView', () => numericArrayMax(editor.matrixView, runtime.matrixView, 1e-3)],
        ['matrixProjection', () => numericArrayMax(editor.matrixProjection, runtime.matrixProjection, 1e-3)],
        ['localCenterShaderSource', () => numericArrayMax(editor.localCenterShaderSource, runtime.localCenterShaderSource, 1e-3)],
        ['worldCenterPredicted', () => numericArrayMax(editor.worldCenterPredicted, runtime.worldCenterPredicted, 1e-3)],
        ['viewCenterPredicted', () => numericArrayMax(editor.viewCenterPredicted, runtime.viewCenterPredicted, 1e-3)],
        ['ndcPredicted', () => numericArrayMax(editor.ndcPredicted, runtime.ndcPredicted, 1e-3)]
    ];

    for (const [label, check] of checks) {
        const result = check();
        if (result !== null) {
            return `${label}: ${result}`;
        }
    }

    return null;
};

const publishCapture = (capture: RenderSeamCapture): void => {
    const store = getProbeStore();
    store[capture.side] = capture;

    console.log('[SCA RENDER SEAM PROBE]', capture);

    if (store.editor && store.runtime) {
        store.firstDivergence = compareCaptures(store.editor, store.runtime);
        console.log('[SCA RENDER SEAM PROBE COMPARE]', {
            firstDivergence: store.firstDivergence ?? 'none (bound render inputs match within epsilon)',
            editorGaussianIndex: store.editor.gaussianIndex,
            runtimeGaussianIndex: store.runtime.gaussianIndex,
            note: 'gaussianIndex differs by design (matched physical pair); compare palette/world/view/ndc'
        });
    }
};

const scheduleEditorRenderSeamCapture = (input: {
    splat: Splat;
    gaussianIndex: number;
    paletteIndex: number;
    playbackTime: number;
    animationClipId: string | null;
}): void => {
    if (editorCaptured) {
        return;
    }

    if (input.animationClipId !== RENDER_SEAM_PROBE_CONFIG.animationClipId) {
        return;
    }

    if (!isSampleDue(input.playbackTime)) {
        return;
    }

    editorPending = {
        splat: input.splat,
        gaussianIndex: input.gaussianIndex,
        paletteIndex: input.paletteIndex,
        playbackTime: input.playbackTime,
        animationClipId: input.animationClipId
    };
};

const maybeCaptureEditorRenderSeamAtPreRender = (splat: Splat): void => {
    if (editorCaptured || !editorPending || editorPending.splat !== splat) {
        return;
    }

    const pending = editorPending;
    editorPending = null;
    editorCaptured = true;

    const gaussianIndex = pending.gaussianIndex;
    const material = splat.entity.gsplat.instance.material as {
        getParameter?: (name: string) => { data?: unknown } | undefined;
    };
    const transformIndices = splat.transformTexture.lock() as Uint16Array;
    const paletteIndexValue = transformIndices[gaussianIndex] ?? 0;
    splat.transformTexture.unlock();

    splat.transformPalette.getTransform(paletteIndexValue, matScratch);

    const resource = splat.entity.gsplat.instance.resource as { textureDimensions?: { x: number } };
    const textureWidth = resource.textureDimensions?.x ?? splat.transformTexture.width;

    const xData = splat.splatData.getProp('x') as Float32Array;
    const yData = splat.splatData.getProp('y') as Float32Array;
    const zData = splat.splatData.getProp('z') as Float32Array;
    const localCenter: [number, number, number] = [
        xData[gaussianIndex],
        yData[gaussianIndex],
        zData[gaussianIndex]
    ];

    const scene = splat.scene as Scene;
    const camera = scene.camera.camera;
    matViewScratch.copy(camera.viewMatrix);
    matProjectionScratch.copy(camera.projectionMatrix);

    const canvasWidth = scene.app.graphicsDevice.width;
    const canvasHeight = scene.app.graphicsDevice.height;

    const projection = projectCenter(
        localCenter,
        splat.worldTransform,
        matScratch,
        matViewScratch,
        matProjectionScratch,
        canvasWidth,
        canvasHeight
    );

    publishCapture({
        side: 'editor',
        hook: 'editor.splat.onPreRender',
        sampleTime: RENDER_SEAM_PROBE_CONFIG.sampleTime,
        playbackTime: pending.playbackTime,
        animationClipId: pending.animationClipId,
        regionId: RENDER_SEAM_PROBE_CONFIG.regionId,
        nodeId: RENDER_SEAM_PROBE_CONFIG.nodeId,
        gaussianIndex,
        shaderTransformIndexLookup: 'texelFetch(splatTransform, splat.uv, 0).r',
        localCenterShaderSource: localCenter,
        transformIndexTexel: readTransformIndexValue(
            (index) => {
                const locked = splat.transformTexture.lock() as Uint16Array;
                const value = locked[index] ?? 0;
                splat.transformTexture.unlock();
                return value;
            },
            gaussianIndex,
            textureWidth
        ),
        paletteIndex: paletteIndexValue,
        paletteMatrixFromTexture: matrixToArray(matScratch),
        matrixModel: matrixToArray(splat.worldTransform),
        matrixView: matrixToArray(matViewScratch),
        matrixProjection: matrixToArray(matProjectionScratch),
        cameraParams: null,
        ...projection,
        materialUniforms: {
            transformIndexTextureName: 'splatTransform',
            paletteTextureName: 'transformPalette',
            indexTexWidth: textureWidth,
            transformIndexTextureSize: readTextureSize(splat.transformTexture),
            paletteTextureSize: readMaterialTextureSize(material, 'transformPalette')
        },
        renderFrameRequested: scene.forceRender || !!scene.app.renderNextFrame
    });
};

const registerRuntimeRenderSeamProbe = (probe: RuntimeRenderSeamProbe | null): void => {
    runtimeProbe = probe;
    runtimeCaptured = false;
};

const resetRenderSeamProbe = (): void => {
    editorPending = null;
    editorCaptured = false;
    runtimeCaptured = false;
    runtimePendingCapture = null;
    runtimeProbe = null;
    const store = getProbeStore();
    store.editor = null;
    store.runtime = null;
    store.firstDivergence = null;
};

let runtimePendingCapture: {
    clipId: string;
    playbackTime: number;
    nodeId: string;
    regionId: string;
} | null = null;

const captureRuntimeRenderSeam = (input: {
    clipId: string;
    playbackTime: number;
    nodeId: string;
    regionId: string;
}): void => {
    if (!runtimeProbe) {
        return;
    }

    runtimeCaptured = true;
    runtimePendingCapture = null;

    const probe = runtimeProbe;
    const gaussianIndex = probe.gaussianIndex;
    const localCenter = probe.getLocalCenter();
    const matrixModel = probe.getEntityMatrix();
    const paletteMatrix = probe.getPaletteMatrix(probe.paletteIndex);
    const paletteIndexValue = probe.readTransformIndex(gaussianIndex);
    const material = probe.getMaterial();
    const { view, projection, cameraParams } = resolveCameraMatrices(probe.getCamera());
    const { width: canvasWidth, height: canvasHeight } = probe.getCanvasSize();

    const projectionResult = projectCenter(
        localCenter,
        matrixModel,
        paletteMatrix,
        view,
        projection,
        canvasWidth,
        canvasHeight
    );

    publishCapture({
        side: 'runtime',
        hook: 'runtime.camera.preRenderLayer',
        sampleTime: RENDER_SEAM_PROBE_CONFIG.sampleTime,
        playbackTime: input.playbackTime,
        animationClipId: input.clipId,
        regionId: probe.regionId,
        nodeId: RENDER_SEAM_PROBE_CONFIG.nodeId,
        gaussianIndex,
        shaderTransformIndexLookup: 'texelFetch(uScaRigTransformIndex, ivec2(splat.index % scaRigTransformIndexTexWidth, splat.index / scaRigTransformIndexTexWidth), 0).r',
        localCenterShaderSource: localCenter,
        transformIndexTexel: readTransformIndexValue(
            (index) => probe.readTransformIndex(index),
            gaussianIndex,
            probe.textureWidth
        ),
        paletteIndex: paletteIndexValue,
        paletteMatrixFromTexture: matrixToArray(paletteMatrix),
        matrixModel: matrixToArray(matrixModel),
        matrixView: matrixToArray(view),
        matrixProjection: matrixToArray(projection),
        cameraParams,
        ...projectionResult,
        materialUniforms: {
            transformIndexTextureName: 'uScaRigTransformIndex',
            paletteTextureName: 'uScaRigTransformPalette',
            indexTexWidth: probe.textureWidth,
            transformIndexTextureSize: readMaterialTextureSize(material, 'uScaRigTransformIndex'),
            paletteTextureSize: readMaterialTextureSize(material, 'uScaRigTransformPalette')
        },
        renderFrameRequested: probe.getRenderFrameRequested()
    });
};

const scheduleRuntimeRenderSeamCapture = (input: {
    clipId: string;
    playbackTime: number;
    nodeId: string;
    regionId: string;
}): void => {
    if (runtimeCaptured || !runtimeProbe) {
        return;
    }

    if (input.clipId !== RENDER_SEAM_PROBE_CONFIG.animationClipId) {
        return;
    }

    if (input.nodeId !== RENDER_SEAM_PROBE_CONFIG.nodeId || input.regionId !== RENDER_SEAM_PROBE_CONFIG.regionId) {
        return;
    }

    if (!isSampleDue(input.playbackTime)) {
        return;
    }

    runtimePendingCapture = input;
};

const maybeCaptureRuntimeRenderSeamAtPreRender = (): void => {
    if (runtimeCaptured || !runtimePendingCapture) {
        return;
    }

    captureRuntimeRenderSeam(runtimePendingCapture);
};

const maybeCaptureRuntimeRenderSeamAfterApply = scheduleRuntimeRenderSeamCapture;

const compareRenderSeamProbe = (): Record<string, unknown> => {
    const store = getProbeStore();
    if (!store.editor || !store.runtime) {
        return {
            ready: false,
            editor: !!store.editor,
            runtime: !!store.runtime,
            firstDivergence: null
        };
    }

    store.firstDivergence = compareCaptures(store.editor, store.runtime);
    return {
        ready: true,
        firstDivergence: store.firstDivergence,
        editor: store.editor,
        runtime: store.runtime
    };
};

window.SCA3D = window.SCA3D ?? {};
window.SCA3D.compareRenderSeamProbe = compareRenderSeamProbe;

export {
    compareRenderSeamProbe,
    maybeCaptureEditorRenderSeamAtPreRender,
    maybeCaptureRuntimeRenderSeamAfterApply,
    maybeCaptureRuntimeRenderSeamAtPreRender,
    RENDER_SEAM_PROBE_CONFIG,
    registerRuntimeRenderSeamProbe,
    resetRenderSeamProbe,
    scheduleEditorRenderSeamCapture,
    scheduleRuntimeRenderSeamCapture
};

export type {
    RenderSeamCapture,
    RuntimeRenderSeamProbe
};
