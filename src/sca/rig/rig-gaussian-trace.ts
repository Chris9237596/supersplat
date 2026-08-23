import { Mat4 } from 'playcanvas';

import { Splat } from '../../splat';

import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';

import { buildEffectiveRigWorldMatrixFromPose } from './rig-hierarchy';
import { ScaRigEvaluatedPose } from './rig-pose';
import { matrixMaxAbsError, matrixToArray } from './rig-transform';

const TARGET_REGION_ID = 'region_06';
const SAMPLE_TIME = 0;
const TIME_EPSILON = 0.05;
const CENTER_EPSILON = 1e-4;

type GaussianRenderTraceSide = 'editor' | 'runtime';

type GaussianRenderTraceStage = {
    gaussianIndex: number;
    textureWidth: number;
    storageTexel: { x: number; y: number };
    editorShaderTexelKey: 'splat.uv';
    runtimeShaderTexelKey: 'splat.index % width';
    shaderTexelMatch: boolean;
    localCenter: [number, number, number];
    paletteIndexCpu: number;
    paletteMatrix: number[];
    centerAfterPalette: [number, number, number];
    matrixModel: number[];
    worldCenter: [number, number, number];
    viewCenter: [number, number, number] | null;
    sortCenterModelSpace: [number, number, number] | null;
};

type GaussianRenderTracePayload = {
    side: GaussianRenderTraceSide;
    regionId: string;
    nodeId: string;
    sampleTime: number;
    playbackTime: number;
    effectiveRigMatrix: number[];
    covariancePath: 'center.modelView via initCornerCov (rig rotation in modelView)';
    stages: GaussianRenderTraceStage;
};

type EditorGaussianTraceInput = {
    playbackTime: number;
    rig: ScaRig;
    pose: ScaRigEvaluatedPose;
    splat: Splat;
    gaussianIndex: number;
    paletteIndex: number;
    node: ScaRigNode;
    binding: ScaRigBinding;
    matrixView?: Mat4;
};

type RuntimeGaussianTraceInput = {
    playbackTime: number;
    rig: ScaRig;
    pose: ScaRigEvaluatedPose;
    gaussianIndex: number;
    paletteIndex: number;
    textureWidth: number;
    localCenter: [number, number, number];
    paletteMatrix: Mat4;
    matrixModel: Mat4;
    sortCenterModelSpace?: [number, number, number] | null;
    node: ScaRigNode;
    binding: ScaRigBinding;
    matrixView?: Mat4;
};

let editorLogged = false;
let runtimeLogged = false;

const matEffective = new Mat4();
const matPalette = new Mat4();
const matModel = new Mat4();
const matView = new Mat4();
const matModelView = new Mat4();

const gaussianIndexToTexel = (gaussianIndex: number, width: number): { x: number; y: number } => ({
    x: gaussianIndex % width,
    y: Math.floor(gaussianIndex / width)
});

const transformPoint = (matrix: Mat4, x: number, y: number, z: number): [number, number, number] => {
    const m = matrix.data;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const applyPaletteToLocalCenter = (paletteMatrix: Mat4, localCenter: [number, number, number]): [number, number, number] => {
    matPalette.copy(paletteMatrix);
    matPalette.transpose();
    return transformPoint(matPalette, ...localCenter);
};

const buildShaderModelView = (matrixModel: Mat4, paletteMatrix: Mat4, matrixView?: Mat4): Mat4 => {
    matModel.copy(matrixModel);
    matPalette.copy(paletteMatrix);
    matPalette.transpose();
    matModelView.mul2(matModel, matPalette);
    if (matrixView) {
        matModelView.mul2(matrixView, matModelView);
    }
    return matModelView;
};

const isSampleDue = (playbackTime: number): boolean => {
    return Math.abs(playbackTime - SAMPLE_TIME) <= TIME_EPSILON || playbackTime >= SAMPLE_TIME - TIME_EPSILON;
};

const readEditorLocalCenter = (splat: Splat, gaussianIndex: number): [number, number, number] => {
    const xData = splat.splatData.getProp('x') as Float32Array;
    const yData = splat.splatData.getProp('y') as Float32Array;
    const zData = splat.splatData.getProp('z') as Float32Array;
    return [xData[gaussianIndex], yData[gaussianIndex], zData[gaussianIndex]];
};

const readEditorPaletteIndex = (splat: Splat, gaussianIndex: number): number => {
    const transformIndices = splat.transformTexture.lock() as Uint16Array;
    const paletteIndex = transformIndices[gaussianIndex] ?? 0;
    splat.transformTexture.unlock();
    return paletteIndex;
};

const readEditorPaletteMatrix = (splat: Splat, paletteIndex: number): Mat4 => {
    const matrix = new Mat4();
    splat.transformPalette.getTransform(paletteIndex, matrix);
    return matrix;
};

const readEditorSortCenterModelSpace = (splat: Splat, gaussianIndex: number): [number, number, number] | null => {
    const centers = splat.entity?.gsplat?.instance?.sorter?.centers as Float32Array | undefined;
    if (!centers) {
        return null;
    }

    const offset = gaussianIndex * 3;
    if (offset + 2 >= centers.length) {
        return null;
    }

    return [centers[offset], centers[offset + 1], centers[offset + 2]];
};

const resolveEditorTextureWidth = (splat: Splat): number => {
    const resource = splat.entity.gsplat.instance.resource as { textureDimensions?: { x: number } };
    return resource.textureDimensions?.x ?? splat.transformTexture.width;
};

const buildTraceStage = (input: {
    gaussianIndex: number;
    textureWidth: number;
    localCenter: [number, number, number];
    paletteIndexCpu: number;
    paletteMatrix: Mat4;
    matrixModel: Mat4;
    sortCenterModelSpace?: [number, number, number] | null;
    matrixView?: Mat4;
}): GaussianRenderTraceStage => {
    const storageTexel = gaussianIndexToTexel(input.gaussianIndex, input.textureWidth);
    const centerAfterPalette = applyPaletteToLocalCenter(input.paletteMatrix, input.localCenter);
    const worldCenter = transformPoint(input.matrixModel, ...centerAfterPalette);

    let viewCenter: [number, number, number] | null = null;
    if (input.matrixView) {
        const modelView = buildShaderModelView(input.matrixModel, input.paletteMatrix, input.matrixView);
        viewCenter = transformPoint(modelView, ...input.localCenter);
    }

    return {
        gaussianIndex: input.gaussianIndex,
        textureWidth: input.textureWidth,
        storageTexel: storageTexel,
        editorShaderTexelKey: 'splat.uv',
        runtimeShaderTexelKey: 'splat.index % width',
        shaderTexelMatch: true,
        localCenter: [...input.localCenter],
        paletteIndexCpu: input.paletteIndexCpu,
        paletteMatrix: matrixToArray(input.paletteMatrix),
        centerAfterPalette,
        matrixModel: matrixToArray(input.matrixModel),
        worldCenter,
        viewCenter,
        sortCenterModelSpace: input.sortCenterModelSpace ?? null
    };
};

const maybeLogEditorGaussianRenderTrace = (input: EditorGaussianTraceInput): void => {
    if (editorLogged || input.binding.regionId !== TARGET_REGION_ID) {
        return;
    }

    if (!isSampleDue(input.playbackTime)) {
        return;
    }

    editorLogged = true;

    buildEffectiveRigWorldMatrixFromPose(input.rig, input.pose, input.node, input.binding, matEffective);
    const paletteMatrix = readEditorPaletteMatrix(input.splat, input.paletteIndex);
    const paletteIndexCpu = readEditorPaletteIndex(input.splat, input.gaussianIndex);
    const localCenter = readEditorLocalCenter(input.splat, input.gaussianIndex);
    const textureWidth = resolveEditorTextureWidth(input.splat);

    console.log('[SCA GAUSSIAN RENDER TRACE]', {
        side: 'editor',
        regionId: input.binding.regionId,
        nodeId: input.node.id,
        sampleTime: SAMPLE_TIME,
        playbackTime: input.playbackTime,
        effectiveRigMatrix: matrixToArray(matEffective),
        paletteIndexMatchesSlot: paletteIndexCpu === input.paletteIndex,
        covariancePath: 'center.modelView via initCornerCov (rig rotation in modelView)',
        stages: buildTraceStage({
            gaussianIndex: input.gaussianIndex,
            textureWidth,
            localCenter,
            paletteIndexCpu,
            paletteMatrix,
            matrixModel: input.splat.worldTransform,
            sortCenterModelSpace: readEditorSortCenterModelSpace(input.splat, input.gaussianIndex),
            matrixView: input.matrixView
        })
    });
};

const maybeLogRuntimeGaussianRenderTrace = (input: RuntimeGaussianTraceInput): void => {
    if (runtimeLogged || input.binding.regionId !== TARGET_REGION_ID) {
        return;
    }

    if (!isSampleDue(input.playbackTime)) {
        return;
    }

    runtimeLogged = true;

    buildEffectiveRigWorldMatrixFromPose(input.rig, input.pose, input.node, input.binding, matEffective);

    console.log('[SCA GAUSSIAN RENDER TRACE]', {
        side: 'runtime',
        regionId: input.binding.regionId,
        nodeId: input.node.id,
        sampleTime: SAMPLE_TIME,
        playbackTime: input.playbackTime,
        effectiveRigMatrix: matrixToArray(matEffective),
        effectiveMatchesPalette: matrixMaxAbsError(matEffective, input.paletteMatrix) < CENTER_EPSILON,
        covariancePath: 'center.modelView via initCornerCov (rig rotation in modelView)',
        stages: buildTraceStage({
            gaussianIndex: input.gaussianIndex,
            textureWidth: input.textureWidth,
            localCenter: input.localCenter,
            paletteIndexCpu: input.paletteIndex,
            paletteMatrix: input.paletteMatrix,
            matrixModel: input.matrixModel,
            sortCenterModelSpace: input.sortCenterModelSpace ?? null,
            matrixView: input.matrixView
        })
    });
};

const compareGaussianRenderTraces = (
    editor: GaussianRenderTraceStage,
    runtime: GaussianRenderTraceStage
): Record<string, unknown> => {
    const firstMismatch = (label: string, left: unknown, right: unknown, epsilon = CENTER_EPSILON): string | null => {
        if (Array.isArray(left) && Array.isArray(right)) {
            if (left.length !== right.length) {
                return `${label}: length`;
            }
            for (let i = 0; i < left.length; i++) {
                if (typeof left[i] === 'number' && typeof right[i] === 'number' &&
                    Math.abs(left[i] - right[i]) > epsilon) {
                    return `${label}[${i}]`;
                }
            }
            return null;
        }

        if (typeof left === 'number' && typeof right === 'number') {
            return Math.abs(left - right) > epsilon ? label : null;
        }

        return left === right ? null : label;
    };

    const checks: Array<[string, unknown, unknown, number?]> = [
        ['gaussianIndex', editor.gaussianIndex, runtime.gaussianIndex],
        ['textureWidth', editor.textureWidth, runtime.textureWidth],
        ['storageTexel.x', editor.storageTexel.x, runtime.storageTexel.x],
        ['storageTexel.y', editor.storageTexel.y, runtime.storageTexel.y],
        ['localCenter', editor.localCenter, runtime.localCenter],
        ['paletteIndexCpu', editor.paletteIndexCpu, runtime.paletteIndexCpu],
        ['paletteMatrix', editor.paletteMatrix, runtime.paletteMatrix],
        ['centerAfterPalette', editor.centerAfterPalette, runtime.centerAfterPalette],
        ['matrixModel', editor.matrixModel, runtime.matrixModel],
        ['worldCenter', editor.worldCenter, runtime.worldCenter],
        ['sortCenterModelSpace', editor.sortCenterModelSpace, runtime.sortCenterModelSpace]
    ];

    let divergenceStage: string | null = null;
    for (const [label, left, right, epsilon] of checks) {
        const mismatch = firstMismatch(label, left, right, epsilon);
        if (mismatch) {
            divergenceStage = mismatch;
            break;
        }
    }

    return {
        divergenceStage: divergenceStage ?? 'none (CPU-modeled render inputs match)',
        editor,
        runtime
    };
};

const resetGaussianRenderTrace = (): void => {
    editorLogged = false;
    runtimeLogged = false;
};

export {
    applyPaletteToLocalCenter,
    buildShaderModelView,
    compareGaussianRenderTraces,
    gaussianIndexToTexel,
    maybeLogEditorGaussianRenderTrace,
    maybeLogRuntimeGaussianRenderTrace,
    resetGaussianRenderTrace,
    TARGET_REGION_ID as GAUSSIAN_TRACE_REGION_ID,
    transformPoint as traceTransformPoint
};
