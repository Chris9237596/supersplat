/**
 * rig_02 pivot/handle world parity — editor gizmo path vs runtime shader path.
 * Inputs: current.ssproj + runtime/latest/project.json
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Mat4, Quat, Vec3 } from 'playcanvas';

import { applyRigAnimationToPose } from '../src/sca/rig/rig-animation';
import {
    buildEffectiveRigWorldMatrixFromPose,
    buildNodeWorldMatrixFromPose,
    getNodeHandleWorldPositionFromPose
} from '../src/sca/rig/rig-hierarchy';
import { applyPaletteToLocalCenter } from '../src/sca/rig/rig-gaussian-trace';
import { evaluateRigPose, requireEvaluatedNodePose } from '../src/sca/rig/rig-pose';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import { arrayToMatrix, matrixMaxAbsError, matrixToArray } from '../src/sca/rig/rig-transform';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject, ScaRuntimeSplatRef } from '../src/sca/types/project';
import { ScaRigBinding, ScaRigNode } from '../src/sca/types/rig';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_PROJECT_PATH = path.join(ROOT, 'runtime/latest/project.json');
const REPORT_PATH = path.join(ROOT, 'compare/reports/rig-pivot-world-parity.json');

const NODE_ID = 'rig_02';
const BINDING_REGION = 'region_04';
const AUTHORED_HANDLE: [number, number, number] = [0.043530, -0.176535, 0.625845];
const TIMES = [0, 0.5, 1.0, 2.0] as const;

type Vec3 = [number, number, number];

const fmt = (v: Vec3): string => `[${v.map((n) => n.toFixed(6)).join(', ')}]`;

const distance3 = (a: Vec3, b: Vec3): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

const buildSplatBasisMatrix = (
    splatEntry: ScaRuntimeSplatRef | Record<string, unknown> | null | undefined
): Mat4 => {
    const mat = new Mat4();
    if (!splatEntry) {
        return mat.copy(Mat4.IDENTITY);
    }

    const pos = (splatEntry as ScaRuntimeSplatRef).position as number[] | undefined;
    const rot = (splatEntry as ScaRuntimeSplatRef).rotation as number[] | undefined;
    const scale = (splatEntry as ScaRuntimeSplatRef).scale as number[] | undefined;

    if (!pos || !rot) {
        return mat.copy(Mat4.IDENTITY);
    }

    const quat = new Quat();
    if (rot.length === 4) {
        quat.set(rot[0], rot[1], rot[2], rot[3]);
    } else {
        quat.setFromEulerAngles(rot[0], rot[1], rot[2]);
    }

    const translation = new Vec3(pos[0], pos[1], pos[2]);
    const scl = scale ? new Vec3(scale[0], scale[1], scale[2]) : Vec3.ONE;
    return mat.setTRS(translation, quat, scl);
};

const transformPoint = (matrix: Mat4, point: Vec3): Vec3 => {
    const m = matrix.data;
    const [x, y, z] = point;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const classifyMatrix = (m: number[]): string => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const rz180 = [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const eps = 1e-4;
    if (identity.every((v, i) => Math.abs(v - m[i]) <= eps)) {
        return 'identity';
    }
    if (rz180.every((v, i) => Math.abs(v - m[i]) <= eps)) {
        return 'Rz180';
    }
    return 'general';
};

const shaderWorldFromPivot = (matrixModel: Mat4, effectiveRig: Mat4, pivot: Vec3): Vec3 => {
    const afterPalette = applyPaletteToLocalCenter(effectiveRig, pivot);
    return transformPoint(matrixModel, afterPalette);
};

const rigBeforeModelWorld = (matrixModel: Mat4, effectiveRig: Mat4, pivot: Vec3): Vec3 => {
    const combined = new Mat4().mul2(effectiveRig, matrixModel);
    return transformPoint(combined, pivot);
};

const fixedPointError = (effectiveRig: Mat4, pivot: Vec3): number => {
    const after = applyPaletteToLocalCenter(effectiveRig, pivot);
    return distance3(pivot, after);
};

function evaluateAtTime(
    rig: NonNullable<ScaProject['rig']>,
    clip: ScaAnimationClip,
    node: ScaRigNode,
    binding: ScaRigBinding,
    matrixModel: Mat4,
    time: number,
    useRuntimePoseEval: boolean
) {
    const basePose = evaluateRigPose(rig);
    const animatedPose = useRuntimePoseEval ?
        evaluateRuntimeRigPose(rig, clip, time) :
        applyRigAnimationToPose(basePose, rig, clip, time);

    const handle = new Vec3();
    getNodeHandleWorldPositionFromPose(rig, animatedPose, node, handle);
    const handleSplatLocal: Vec3 = [handle.x, handle.y, handle.z];
    const handleWorld = transformPoint(matrixModel, handleSplatLocal);

    const matEffective = new Mat4();
    buildEffectiveRigWorldMatrixFromPose(rig, animatedPose, node, binding, matEffective);

    const pivot = AUTHORED_HANDLE;
    const effectivePivotSplatLocal = applyPaletteToLocalCenter(matEffective, pivot);
    const shaderWorld = shaderWorldFromPivot(matrixModel, matEffective, pivot);
    const wrongOrder = rigBeforeModelWorld(matrixModel, matEffective, pivot);

    const nodeWorld = new Mat4();
    buildNodeWorldMatrixFromPose(rig, animatedPose, node, nodeWorld);
    const pose = requireEvaluatedNodePose(animatedPose, node);

    return {
        time,
        handleSplatLocal,
        handleWorld,
        effectivePivotSplatLocal,
        effectiveFixedPointError: [
            effectivePivotSplatLocal[0] - pivot[0],
            effectivePivotSplatLocal[1] - pivot[1],
            effectivePivotSplatLocal[2] - pivot[2]
        ] as Vec3,
        effectiveFixedPointDistance: fixedPointError(matEffective, pivot),
        shaderWorldPivot: shaderWorld,
        wrongOrderRigBeforeModelWorld: wrongOrder,
        nodeWorldTranslation: [
            nodeWorld.data[12],
            nodeWorld.data[13],
            nodeWorld.data[14]
        ] as Vec3,
        poseRotation: [...pose.rotation] as Vec3,
        effectiveRigMatrix: matrixToArray(matEffective)
    };
}

function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const editorProject = document.sca?.project as ScaProject;
    const runtimeProject = JSON.parse(fs.readFileSync(RUNTIME_PROJECT_PATH, 'utf8')) as ScaProject;

    const rig = editorProject.rig!;
    const node = rig.nodes.find((entry) => entry.id === NODE_ID)!;
    const binding = rig.bindings.find((entry) => entry.regionId === BINDING_REGION && entry.nodeId === NODE_ID)!;
    const clip = editorProject.animations?.find((entry) => entry.id === 'animation_01')!;

    const editorSplat = Array.isArray(document.splats) ? document.splats[0] : null;
    const runtimeSplat = Array.isArray(runtimeProject.splats) ? runtimeProject.splats[0] : null;

    const editorMatrixModel = buildSplatBasisMatrix(editorSplat);
    const runtimeMatrixModel = buildSplatBasisMatrix(runtimeSplat);

    const shaderOrder = {
        editor: 'matrix_view * applyPaletteTransform(matrix_model); applyPaletteTransform(model) = model * t (t from palette texture, no transpose)',
        runtimeBuilt: 'same patch in runtime-rig-viewer-host.ts: matrix_view * applyPaletteTransform(matrix_model)',
        pointWorld: 'matrix_model * paletteMatrix * splatLocalPoint (palette rows packed as GLSL mat4 columns; no extra transpose)',
        pointSplatLocalAfterRig: 'paletteMatrix * splatLocalPoint'
    };

    const samples = TIMES.map((time) => {
        const editor = evaluateAtTime(rig, clip, node, binding, editorMatrixModel, time, false);
        const runtime = evaluateAtTime(rig, clip, node, binding, runtimeMatrixModel, time, true);
        return {
            time,
            editorHandleSplatLocal: editor.handleSplatLocal,
            editorHandleWorld: editor.handleWorld,
            runtimeHandleSplatLocal: runtime.handleSplatLocal,
            runtimeHandleWorld: runtime.handleWorld,
            editorRuntimeHandleWorldDelta: distance3(editor.handleWorld, runtime.handleWorld),
            effectivePivotSplatLocal: editor.effectivePivotSplatLocal,
            effectiveFixedPointError: editor.effectiveFixedPointError,
            effectiveFixedPointDistance: editor.effectiveFixedPointDistance,
            shaderWorldPivotEditorModel: editor.shaderWorldPivot,
            shaderWorldPivotRuntimeModel: runtime.shaderWorldPivot,
            editorRuntimeShaderWorldDelta: distance3(editor.shaderWorldPivot, runtime.shaderWorldPivot),
            wrongOrderRigBeforeModelWorld: editor.wrongOrderRigBeforeModelWorld,
            wrongOrderDeltaFromShader: distance3(editor.wrongOrderRigBeforeModelWorld, editor.shaderWorldPivot),
            nodeWorldTranslation: editor.nodeWorldTranslation,
            poseRotation: editor.poseRotation,
            editorEffectiveRigMatrix: editor.effectiveRigMatrix,
            runtimeEffectiveRigMatrix: runtime.effectiveRigMatrix
        };
    });

    const t0HandleWorld = samples[0].editorHandleWorld;
    const handleDrift = samples.map((s) => ({
        time: s.time,
        editorHandleWorldDriftFromT0: distance3(s.editorHandleWorld, t0HandleWorld),
        runtimeHandleWorldDriftFromT0: distance3(s.runtimeHandleWorld, t0HandleWorld),
        shaderWorldDriftFromT0: distance3(s.shaderWorldPivotEditorModel, samples[0].shaderWorldPivotEditorModel)
    }));

    const report = {
        authoredHandleSplatLocal: AUTHORED_HANDLE,
        shaderTransformOrder: shaderOrder,
        matrixModel: {
            editor: matrixToArray(editorMatrixModel),
            editorClass: classifyMatrix(matrixToArray(editorMatrixModel)),
            runtime: matrixToArray(runtimeMatrixModel),
            runtimeClass: classifyMatrix(matrixToArray(runtimeMatrixModel)),
            editorRuntimeMaxAbsError: matrixMaxAbsError(editorMatrixModel, runtimeMatrixModel),
            runtimeSplatsExported: !!runtimeSplat
        },
        bindOffsetTranslation: binding.bindOffsetMatrix?.slice(12, 15) ?? binding.bindOffset?.position,
        samples,
        pivotFixedDuringRotation: {
            editorHandleWorldConstant: handleDrift.every((d) => d.editorHandleWorldDriftFromT0 < 1e-6),
            runtimeHandleWorldConstant: handleDrift.every((d) => d.runtimeHandleWorldDriftFromT0 < 1e-6),
            effectiveFixedPointOnAuthoredPivot: samples.every((s) => s.effectiveFixedPointDistance < 1e-5),
            shaderWorldConstantEditor: handleDrift.every((d) => d.shaderWorldDriftFromT0 < 1e-5),
            handleDrift
        },
        editorRuntimeParity: {
            maxHandleWorldDelta: Math.max(...samples.map((s) => s.editorRuntimeHandleWorldDelta)),
            maxShaderWorldDelta: Math.max(...samples.map((s) => s.editorRuntimeShaderWorldDelta)),
            passHandleWorld: Math.max(...samples.map((s) => s.editorRuntimeHandleWorldDelta)) < 1e-4,
            passShaderWorld: Math.max(...samples.map((s) => s.editorRuntimeShaderWorldDelta)) < 1e-4
        },
        transformOrderCheck: {
            wrongOrderDiffersFromShader: samples.some((s) => s.wrongOrderDeltaFromShader > 1e-4),
            maxWrongOrderDelta: Math.max(...samples.map((s) => s.wrongOrderDeltaFromShader))
        }
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log('========== RIG_02 PIVOT / HANDLE WORLD PARITY ==========\n');
    console.log(`Authored handle (splat-local): ${fmt(AUTHORED_HANDLE)}`);
    console.log(`Binding: ${BINDING_REGION} -> ${NODE_ID}`);
    console.log('\nShader transform order (editor + runtime patch):');
    console.log(`  initCenter: ${shaderOrder.editor}`);
    console.log(`  applyPaletteTransform: ${shaderOrder.runtimeBuilt}`);
    console.log(`  world point: ${shaderOrder.pointWorld}`);

    console.log('\nmatrix_model:');
    console.log(`  editor: ${report.matrixModel.editorClass} maxAbs=${report.matrixModel.editor.map((n) => n.toFixed(4)).join(', ').slice(0, 80)}...`);
    console.log(`  runtime: ${report.matrixModel.runtimeClass} splats exported=${report.matrixModel.runtimeSplatsExported}`);
    console.log(`  editor/runtime matrix_model max error: ${report.matrixModel.editorRuntimeMaxAbsError.toExponential(3)}`);

    console.log('\nPer-time samples:');
    console.log('t\teditorHandleWorld\truntimeHandleWorld\tΔhandle\tfixedPtErr\tshaderWorld(ed)\tshaderWorld(rt)\tΔshader\twrongOrderΔ');
    for (const s of samples) {
        console.log(
            `${s.time}\t${fmt(s.editorHandleWorld)}\t${fmt(s.runtimeHandleWorld)}\t` +
            `${s.editorRuntimeHandleWorldDelta.toExponential(2)}\t${s.effectiveFixedPointDistance.toExponential(2)}\t` +
            `${fmt(s.shaderWorldPivotEditorModel)}\t${fmt(s.shaderWorldPivotRuntimeModel)}\t` +
            `${s.editorRuntimeShaderWorldDelta.toExponential(2)}\t${s.wrongOrderDeltaFromShader.toFixed(4)}`
        );
        console.log(`    handle splat-local: ${fmt(s.editorHandleSplatLocal)}  rot: ${fmt(s.poseRotation)}`);
        console.log(`    effective*pivot splat-local: ${fmt(s.effectivePivotSplatLocal)} (error ${fmt(s.effectiveFixedPointError)})`);
    }

    console.log('\nPivot fixed during rotation?');
    console.log(`  editor handle world constant: ${report.pivotFixedDuringRotation.editorHandleWorldConstant ? 'YES' : 'NO'}`);
    console.log(`  runtime handle world constant: ${report.pivotFixedDuringRotation.runtimeHandleWorldConstant ? 'YES' : 'NO'}`);
    console.log(`  effectiveRig fixed point on authored pivot: ${report.pivotFixedDuringRotation.effectiveFixedPointOnAuthoredPivot ? 'YES' : 'NO'}`);
    console.log(`  shader world pivot constant (editor): ${report.pivotFixedDuringRotation.shaderWorldConstantEditor ? 'YES' : 'NO'}`);

    console.log('\nEditor/runtime parity:');
    console.log(`  handle world: max Δ=${report.editorRuntimeParity.maxHandleWorldDelta.toExponential(3)} ${report.editorRuntimeParity.passHandleWorld ? 'PASS' : 'FAIL'}`);
    console.log(`  shader world pivot: max Δ=${report.editorRuntimeParity.maxShaderWorldDelta.toExponential(3)} ${report.editorRuntimeParity.passShaderWorld ? 'PASS' : 'FAIL'}`);

    if (!report.matrixModel.runtimeSplatsExported) {
        console.log('\n*** RUNTIME matrix_model likely IDENTITY (no splats[] in project.json) — handle/shader world parity will fail vs editor Rz180 basis ***');
    }

    console.log(`\nReport: ${REPORT_PATH}`);
    console.log('======================================================\n');
}

main();
