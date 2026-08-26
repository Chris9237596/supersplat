import { Mat4 } from 'playcanvas';

import { ScaRig, ScaRigBinding, ScaRigNode, ScaRigVec3 } from '../types/rig';

import { applyRigAnimationToPose } from './rig-animation';
import { buildEffectiveRigWorldMatrixFromPose, buildNodeWorldMatrixFromPose } from './rig-hierarchy';
import { evaluateRigPose, getAnimationPlaybackState, requireEvaluatedNodePose, ScaRigEvaluatedPose } from './rig-pose';
import { bindOffsetToMatrix, matrixToArray } from './rig-transform';

type RigMatrixCheckSide = 'editor' | 'runtime';

type RigMatrixPoseEvaluator = (sampleTime: number) => ScaRigEvaluatedPose;

const SAMPLE_TIMES = [0, 1.0, 2.0] as const;
const TIME_EPSILON = 0.05;

const editorLoggedTimes = new Set<number>();
const runtimeLoggedTimes = new Set<number>();
let editorLastPlaybackTime = -Infinity;
let runtimeLastPlaybackTime = -Infinity;
let shaderOrderLogged = false;

const matNodeWorld = new Mat4();
const matBindOffset = new Mat4();
const matEffective = new Mat4();

const cloneVec3 = (value: ScaRigVec3): ScaRigVec3 => ([value[0], value[1], value[2]]);

const evaluateEditorRigPoseAtTime = (rig: ScaRig, sampleTime: number): ScaRigEvaluatedPose => {
    const basePose = evaluateRigPose(rig);
    const playback = getAnimationPlaybackState();
    if (!playback.previewActive || !playback.clip) {
        return basePose;
    }

    return applyRigAnimationToPose(basePose, rig, playback.clip, sampleTime);
};

const logShaderMultiplicationOrderOnce = (): void => {
    if (shaderOrderLogged) {
        return;
    }

    shaderOrderLogged = true;

    console.log('[SCA RIG MATRIX CHECK SHADER ORDER]', {
        editor: {
            transformIndexLookup: 'texelFetch(splatTransform, splat.uv, 0).r',
            paletteAssembly: 't[0..2] = texelFetch(transformPalette, ivec2(u, v), 0)',
            paletteApply: 'return model * t',
            centerModelView: 'mat4 modelView = matrix_view * applyPaletteTransform(matrix_model)',
            centerProject: 'modelView * vec4(modelCenter, 1.0)'
        },
        runtime: {
            transformIndexLookup: `texelFetch(uScaRigTransformIndex, ivec2(int(splat.index) % int(scaRigTransformIndexTexWidth), int(splat.index) / int(scaRigTransformIndexTexWidth)), 0).r`,
            paletteAssembly: 't[0..2] = texelFetch(uScaRigTransformPalette, ivec2(u, v), 0)',
            paletteApply: 'return model * t',
            centerModelView: 'mat4 modelView = matrix_view * applyPaletteTransform(matrix_model)',
            centerProject: 'modelView * vec4(modelCenter, 1.0)'
        },
        multiplicationOrderMatches: true,
        transformIndexLookupDiffers: true
    });
};

const logRigMatrixCheckAtTime = (
    side: RigMatrixCheckSide,
    sampleTime: number,
    actualPlaybackTime: number,
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    node: ScaRigNode,
    binding: ScaRigBinding | null | undefined
): void => {
    logShaderMultiplicationOrderOnce();

    const evaluated = requireEvaluatedNodePose(pose, node);
    buildNodeWorldMatrixFromPose(rig, pose, node, matNodeWorld);
    bindOffsetToMatrix(binding, matBindOffset);
    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, matEffective);

    const evaluatedRotation = cloneVec3(evaluated.rotation);

    const payload: Record<string, unknown> = {
        side,
        time: sampleTime,
        nodeId: node.id,
        regionId: binding?.regionId ?? null,
        pivot: cloneVec3(node.pivot),
        authoredPosition: cloneVec3(node.position),
        authoredRotation: cloneVec3(node.rotation),
        evaluatedPosition: cloneVec3(evaluated.position),
        evaluatedRotation,
        bindOffset: binding?.bindOffset ? cloneVec3(binding.bindOffset.position) : null,
        bindOffsetRotation: binding?.bindOffset ? cloneVec3(binding.bindOffset.rotation) : null,
        bindOffsetMatrix: binding?.bindOffsetMatrix ?
            [...binding.bindOffsetMatrix] :
            matrixToArray(matBindOffset),
        nodeWorldMatrix: matrixToArray(matNodeWorld),
        effectiveRigMatrix: matrixToArray(matEffective),
        sampleTime,
        actualPlaybackTime,
        poseEvaluatedAtSampleTime: true
    };

    if (side === 'editor') {
        payload.poseTimeMismatch = Math.abs(actualPlaybackTime - sampleTime) > TIME_EPSILON;
    }

    console.log('[SCA RIG MATRIX CHECK]', payload);
};

const isSampleDue = (
    side: RigMatrixCheckSide,
    sampleTime: number,
    playbackTime: number,
    lastPlaybackTime: number
): boolean => {
    const nearSample = Math.abs(playbackTime - sampleTime) <= TIME_EPSILON;
    const crossedSample = lastPlaybackTime < sampleTime && playbackTime >= sampleTime - TIME_EPSILON;
    if (nearSample || crossedSample) {
        return true;
    }

    // Runtime host/diagnostics may start after early samples; catch up once playback passes them.
    if (side === 'runtime' && playbackTime >= sampleTime - TIME_EPSILON) {
        return true;
    }

    return false;
};

const maybeLogRigMatrixCheck = (
    side: RigMatrixCheckSide,
    playbackTime: number,
    rig: ScaRig,
    node: ScaRigNode,
    binding: ScaRigBinding | null | undefined,
    evaluatePoseAtTime: RigMatrixPoseEvaluator
): void => {
    const logged = side === 'editor' ? editorLoggedTimes : runtimeLoggedTimes;
    const lastPlaybackTime = side === 'editor' ? editorLastPlaybackTime : runtimeLastPlaybackTime;

    for (const sampleTime of SAMPLE_TIMES) {
        if (logged.has(sampleTime)) {
            continue;
        }

        if (!isSampleDue(side, sampleTime, playbackTime, lastPlaybackTime)) {
            continue;
        }

        logged.add(sampleTime);
        const samplePose = evaluatePoseAtTime(sampleTime);
        logRigMatrixCheckAtTime(
            side,
            sampleTime,
            playbackTime,
            rig,
            samplePose,
            node,
            binding
        );
    }

    if (side === 'editor') {
        editorLastPlaybackTime = playbackTime;
    } else {
        runtimeLastPlaybackTime = playbackTime;
    }
};

const resetRigMatrixCheckDiagnostic = (): void => {
    editorLoggedTimes.clear();
    runtimeLoggedTimes.clear();
    editorLastPlaybackTime = -Infinity;
    runtimeLastPlaybackTime = -Infinity;
    shaderOrderLogged = false;
};

const resetRuntimeRigMatrixCheckDiagnostic = (): void => {
    runtimeLoggedTimes.clear();
    runtimeLastPlaybackTime = -Infinity;
};

export {
    evaluateEditorRigPoseAtTime,
    maybeLogRigMatrixCheck,
    resetRigMatrixCheckDiagnostic,
    resetRuntimeRigMatrixCheckDiagnostic,
    RigMatrixPoseEvaluator,
    SAMPLE_TIMES
};
