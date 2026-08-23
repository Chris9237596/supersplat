import { Mat4 } from 'playcanvas';

import { Splat } from '../../splat';

import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';

import { buildEffectiveRigWorldMatrixFromPose } from './rig-hierarchy';
import { maybeLogRuntimeGaussianRenderTrace } from './rig-gaussian-trace';
import { ScaRigEvaluatedPose } from './rig-pose';
import { matrixToArray } from './rig-transform';

const TARGET_REGION_ID = 'region_06';
const SAMPLE_TIME = 0;
const TIME_EPSILON = 0.05;
const CENTER_MATCH_EPSILON = 1e-4;

let runtimeLogged = false;
let editorLogged = false;

type RuntimeTransformOrderProbe = {
    regionId: string;
    gaussianIndex: number;
    paletteIndex: number;
    textureWidth: number;
    getLocalCenter: () => [number, number, number];
    getEntityMatrix: () => Mat4;
    getResourceCenter: () => [number, number, number] | null;
    getSortCenterModelSpace: () => [number, number, number] | null;
};

let runtimeProbe: RuntimeTransformOrderProbe | null = null;

const matEntity = new Mat4();
const matEffective = new Mat4();
const matEM = new Mat4();
const matME = new Mat4();

const transformPoint = (matrix: Mat4, x: number, y: number, z: number): [number, number, number] => {
    const m = matrix.data;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const distance3 = (
    left: [number, number, number],
    right: [number, number, number]
): number => {
    const dx = left[0] - right[0];
    const dy = left[1] - right[1];
    const dz = left[2] - right[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const nearCenter = (
    left: [number, number, number] | null | undefined,
    right: [number, number, number] | null | undefined
): boolean | null => {
    if (!left || !right) {
        return null;
    }
    return distance3(left, right) <= CENTER_MATCH_EPSILON;
};

const isSampleDue = (playbackTime: number): boolean => {
    return Math.abs(playbackTime - SAMPLE_TIME) <= TIME_EPSILON || playbackTime >= SAMPLE_TIME - TIME_EPSILON;
};

const buildTransformOrderPayload = (input: {
    side: 'editor' | 'runtime';
    playbackTime: number;
    regionId: string;
    gaussianIndex: number;
    localCenter: [number, number, number];
    entityMatrix: Mat4;
    effectiveRigMatrix: Mat4;
    actualResourceCenter: [number, number, number] | null;
    actualSortCenterModelSpace: [number, number, number] | null;
    actualWorldCenter: [number, number, number] | null;
}): Record<string, unknown> => {
    matEntity.copy(input.entityMatrix);
    matEffective.copy(input.effectiveRigMatrix);
    matEM.mul2(matEntity, matEffective);
    matME.mul2(matEffective, matEntity);

    const expectedWorldCenterEM = transformPoint(matEM, ...input.localCenter);
    const alternateWorldCenterME = transformPoint(matME, ...input.localCenter);
    const modelSpaceFromEM = transformPoint(matEffective, ...input.localCenter);
    const worldFromSortCenter = input.actualSortCenterModelSpace ?
        transformPoint(matEntity, ...input.actualSortCenterModelSpace) :
        null;

    return {
        side: input.side,
        regionId: input.regionId,
        gaussianIndex: input.gaussianIndex,
        sampleTime: SAMPLE_TIME,
        playbackTime: input.playbackTime,
        localCenter: [...input.localCenter],
        entityMatrix: matrixToArray(matEntity),
        effectiveRigMatrix: matrixToArray(matEffective),
        expectedWorldCenter_EM: expectedWorldCenterEM,
        alternateWorldCenter_ME: alternateWorldCenterME,
        modelSpaceRigged_M_local: modelSpaceFromEM,
        actualResourceCenter: input.actualResourceCenter,
        actualSortCenterModelSpace: input.actualSortCenterModelSpace,
        actualWorldCenter: input.actualWorldCenter,
        worldFromSortCenter_E_sort: worldFromSortCenter,
        matches: {
            EM_vs_actualWorld: nearCenter(expectedWorldCenterEM, input.actualWorldCenter),
            ME_vs_actualWorld: nearCenter(alternateWorldCenterME, input.actualWorldCenter),
            EM_vs_worldFromSort: nearCenter(expectedWorldCenterEM, worldFromSortCenter),
            ME_vs_worldFromSort: nearCenter(alternateWorldCenterME, worldFromSortCenter),
            M_local_vs_sortModelSpace: nearCenter(modelSpaceFromEM, input.actualSortCenterModelSpace),
            local_vs_resourceCenter: nearCenter(input.localCenter, input.actualResourceCenter)
        },
        transformOrderHypothesis: 'Compare expectedWorldCenter_EM (E*M*local) vs alternateWorldCenter_ME (M*E*local)'
    };
};

const registerRuntimeTransformOrderProbe = (probe: RuntimeTransformOrderProbe | null): void => {
    runtimeProbe = probe;
    runtimeLogged = false;
};

const resetRuntimeTransformOrderProbe = (): void => {
    runtimeProbe = null;
    runtimeLogged = false;
};

const resetEditorTransformOrderCheck = (): void => {
    editorLogged = false;
};

const maybeLogRuntimeTransformOrderCheck = (
    playbackTime: number,
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    binding: ScaRigBinding
): void => {
    if (runtimeLogged || !runtimeProbe || binding.regionId !== TARGET_REGION_ID) {
        return;
    }

    if (!isSampleDue(playbackTime)) {
        return;
    }

    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, matEffective);

    const localCenter = runtimeProbe.getLocalCenter();
    const entityMatrix = runtimeProbe.getEntityMatrix();
    const actualResourceCenter = runtimeProbe.getResourceCenter();
    const sortCenterFromBuffer = runtimeProbe.getSortCenterModelSpace();
    const modelSpaceRiggedFromM = transformPoint(matEffective, ...localCenter);
    const actualSortCenterModelSpace = sortCenterFromBuffer ?? modelSpaceRiggedFromM;
    const actualWorldCenter = transformPoint(entityMatrix, ...modelSpaceRiggedFromM);

    runtimeLogged = true;
    maybeLogRuntimeGaussianRenderTrace({
        playbackTime,
        rig,
        pose,
        gaussianIndex: runtimeProbe.gaussianIndex,
        paletteIndex: runtimeProbe.paletteIndex,
        textureWidth: runtimeProbe.textureWidth,
        localCenter,
        paletteMatrix: matEffective.clone(),
        matrixModel: entityMatrix,
        sortCenterModelSpace: actualSortCenterModelSpace,
        node,
        binding
    });
    console.log('[SCA RIG TRANSFORM ORDER]', {
        ...buildTransformOrderPayload({
            side: 'runtime',
            playbackTime,
            regionId: runtimeProbe.regionId,
            gaussianIndex: runtimeProbe.gaussianIndex,
            localCenter,
            entityMatrix,
            effectiveRigMatrix: matEffective,
            actualResourceCenter,
            actualSortCenterModelSpace,
            actualWorldCenter
        }),
        runtimeSortCenterBuffer: sortCenterFromBuffer,
        runtimeSortBufferMatchesM_local: nearCenter(sortCenterFromBuffer, modelSpaceRiggedFromM)
    });
};

const maybeLogEditorTransformOrderCheck = (
    playbackTime: number,
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    splat: Splat,
    gaussianIndex: number,
    node: ScaRigNode,
    binding: ScaRigBinding | null
): void => {
    if (editorLogged || binding?.regionId !== TARGET_REGION_ID) {
        return;
    }

    if (!isSampleDue(playbackTime)) {
        return;
    }

    if (gaussianIndex < 0 || gaussianIndex >= splat.splatData.numSplats) {
        return;
    }

    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, matEffective);

    const xData = splat.splatData.getProp('x') as Float32Array;
    const yData = splat.splatData.getProp('y') as Float32Array;
    const zData = splat.splatData.getProp('z') as Float32Array;
    const localCenter: [number, number, number] = [
        xData[gaussianIndex],
        yData[gaussianIndex],
        zData[gaussianIndex]
    ];

    const entityMatrix = splat.worldTransform;
    const sorterCenters = splat.entity?.gsplat?.instance?.sorter?.centers as Float32Array | undefined;
    const offset = gaussianIndex * 3;
    const actualSortCenterModelSpace = sorterCenters && offset + 2 < sorterCenters.length ?
        [sorterCenters[offset], sorterCenters[offset + 1], sorterCenters[offset + 2]] as [number, number, number] :
        null;
    const actualWorldCenter = actualSortCenterModelSpace ?
        transformPoint(entityMatrix, ...actualSortCenterModelSpace) :
        null;

    editorLogged = true;
    console.log('[SCA RIG TRANSFORM ORDER]', buildTransformOrderPayload({
        side: 'editor',
        playbackTime,
        regionId: TARGET_REGION_ID,
        gaussianIndex,
        localCenter,
        entityMatrix,
        effectiveRigMatrix: matEffective,
        actualResourceCenter: localCenter,
        actualSortCenterModelSpace,
        actualWorldCenter
    }));
};

const findFirstGaussianIndexForRegion = (gaussianIndices: number[]): number | null => {
    if (gaussianIndices.length === 0) {
        return null;
    }
    return [...gaussianIndices].sort((left, right) => left - right)[0];
};

export {
    findFirstGaussianIndexForRegion,
    maybeLogEditorTransformOrderCheck,
    maybeLogRuntimeTransformOrderCheck,
    registerRuntimeTransformOrderProbe,
    resetEditorTransformOrderCheck,
    resetRuntimeTransformOrderProbe,
    TARGET_REGION_ID
};
