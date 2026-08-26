/**
 * End-to-end transform chain parity: editor ssproj vs runtime export.
 * Inputs:
 *   sca-workspace/project/current.ssproj
 *   sca-workspace/runtime/latest/
 *
 * Traces the complete chain from stored Gaussian center to world-space center:
 *   splat basis (matrix_model) → rig node world → bindOffset → effective rig /
 *   palette → local center → centerAfterPalette → world center
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    MemoryReadFileSystem,
    ZipReadFileSystem,
    createChunkDataPool,
    getInputFormat,
    materializeToDataTable,
    readFile,
    readSog
} from '@playcanvas/splat-transform';
import { Mat4, Quat, Vec3 } from 'playcanvas';

import { decodeRegionMask } from '../src/sca/regions/region-mask-format';
import { applyRigAnimationToPose } from '../src/sca/rig/rig-animation';
import {
    applyPaletteToLocalCenter,
    traceTransformPoint
} from '../src/sca/rig/rig-gaussian-trace';
import {
    buildEffectiveRigWorldMatrixFromPose,
    buildNodeWorldMatrixFromPose
} from '../src/sca/rig/rig-hierarchy';
import { evaluateRigPose, requireEvaluatedNodePose } from '../src/sca/rig/rig-pose';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import {
    arrayToMatrix,
    bindOffsetToMatrix,
    matrixMaxAbsError,
    matrixToArray
} from '../src/sca/rig/rig-transform';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject, ScaRuntimeSplatRef } from '../src/sca/types/project';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../src/sca/types/rig';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_DIR = path.join(ROOT, 'runtime/latest');
const REPORT_DIR = path.join(ROOT, 'compare/reports');

const ANIMATION_CLIP_ID = 'animation_01';
const RIG_NODE_ID = 'rig_02';
const TARGET_REGIONS = ['region_04', 'region_05'] as const;
const SAMPLE_TIMES = [0, 0.5, 1.0, 2.0] as const;
const SAMPLE_COUNT = 5;

const SOG_CENTER_EPSILON = 0.04;
const MATRIX_EPSILON = 1e-4;
const POSE_EPSILON = 1e-4;
const WORLD_EPSILON = 0.05;

type Vec3Tuple = [number, number, number];

type CenterColumns = { x: Float32Array; y: Float32Array; z: Float32Array };

type GaussianPair = {
    storageIndex: number;
    runtimeIndex: number;
    localDelta: number;
};

type ChainStep = {
    name: string;
    editor: unknown;
    runtime: unknown;
    maxAbsError: number;
    pass: boolean;
};

type GaussianChainResult = {
    storageIndex: number;
    runtimeIndex: number;
    localDelta: number;
    steps: ChainStep[];
    editorWorldCenter: Vec3Tuple;
    runtimeWorldCenter: Vec3Tuple;
    worldDelta: number;
    firstDivergence: string | null;
};

type RegionTimeResult = {
    regionId: string;
    time: number;
    pass: boolean;
    maxWorldError: number;
    chainSummary: {
        matrixModelPass: boolean;
        nodeWorldPass: boolean;
        bindOffsetPass: boolean;
        effectiveRigPass: boolean;
        paletteEqualsEffectivePass: boolean;
        posePass: boolean;
    };
    gaussianResults: GaussianChainResult[];
    firstDivergence: string | null;
};

const distance3 = (a: Vec3Tuple, b: Vec3Tuple): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const centerAt = (columns: CenterColumns, index: number): Vec3Tuple =>
    [columns.x[index], columns.y[index], columns.z[index]];

const fmtVec3 = (v: Vec3Tuple): string => `[${v.map((n) => n.toFixed(6)).join(', ')}]`;

const fmtMat4 = (m: number[]): string => {
    const rows: string[] = [];
    for (let r = 0; r < 4; r++) {
        rows.push(`  [${m.slice(r * 4, r * 4 + 4).map((n) => n.toFixed(6)).join(', ')}]`);
    }
    return rows.join('\n');
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
    const det =
        m[0] * (m[5] * m[10] - m[6] * m[9]) -
        m[4] * (m[1] * m[10] - m[2] * m[9]) +
        m[8] * (m[1] * m[6] - m[2] * m[5]);
    return det < 0 ? 'mirrored (det<0)' : 'general';
};

const buildSplatBasisMatrix = (
    splatEntry: ScaRuntimeSplatRef | null | undefined,
    documentSplat: Record<string, unknown> | null | undefined
): Mat4 => {
    const mat = new Mat4();

    const pos = (splatEntry?.position ?? documentSplat?.position) as number[] | undefined;
    const rot = (splatEntry?.rotation ?? documentSplat?.rotation) as number[] | undefined;
    const scale = (splatEntry?.scale ?? documentSplat?.scale) as number[] | undefined;

    if (!pos || !rot) {
        return mat.copy(Mat4.IDENTITY);
    }

    const quat = new Quat();
    if (rot.length === 4) {
        quat.set(rot[0], rot[1], rot[2], rot[3]);
    } else if (rot.length === 3) {
        quat.setFromEulerAngles(rot[0], rot[1], rot[2]);
    }

    const translation = new Vec3(pos[0], pos[1], pos[2]);
    const scl = scale ?
        new Vec3(scale[0], scale[1], scale[2]) :
        Vec3.ONE;

    return mat.setTRS(translation, quat, scl);
};

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

const decodeScarmIndices = (filePath: string): number[] => {
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const { ranges } = decodeRegionMask(bytes);
    const indices: number[] = [];
    ranges.forEach((index) => indices.push(index));
    indices.sort((a, b) => a - b);
    return indices;
};

async function loadPlyCenters(plyPath: string): Promise<CenterColumns & { count: number }> {
    const plyBytes = new Uint8Array(fs.readFileSync(plyPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('splat.ply', plyBytes);
    const sources = await readFile({
        filename: 'splat.ply',
        inputFormat: getInputFormat('splat.ply'),
        fileSystem: fsMem
    });
    const pool = createChunkDataPool({ chunkSize: sources[0].meta.chunkSize });
    const table = await materializeToDataTable(sources[0], pool, new Set(['position']));
    await sources[0].close();
    return {
        count: table.numRows,
        x: table.getColumnByName('x').data as Float32Array,
        y: table.getColumnByName('y').data as Float32Array,
        z: table.getColumnByName('z').data as Float32Array
    };
}

async function loadSogCenters(sogPath: string): Promise<CenterColumns & { count: number }> {
    const sogBytes = new Uint8Array(fs.readFileSync(sogPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('index.sog', sogBytes);
    const zipFs = new ZipReadFileSystem(await fsMem.createSource('index.sog'));
    const table = await readSog(zipFs, 'meta.json');
    return {
        count: table.numRows,
        x: table.getColumnByName('x').data as Float32Array,
        y: table.getColumnByName('y').data as Float32Array,
        z: table.getColumnByName('z').data as Float32Array
    };
}

const buildStorageToRuntimeMap = (
    editorStorageIndices: number[],
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns
): Map<number, { runtimeIndex: number; delta: number }> => {
    const forward = new Map<number, { runtimeIndex: number; delta: number }>();
    for (const storageIndex of editorStorageIndices) {
        const editorCenter = centerAt(ply, storageIndex);
        let bestRuntime = -1;
        let bestDelta = Infinity;
        for (const runtimeIndex of runtimeIndices) {
            const delta = distance3(editorCenter, centerAt(sog, runtimeIndex));
            if (delta < bestDelta) {
                bestDelta = delta;
                bestRuntime = runtimeIndex;
            }
        }
        forward.set(storageIndex, { runtimeIndex: bestRuntime, delta: bestDelta });
    }
    return forward;
};

const selectGaussianPairs = (
    editorStorageIndices: number[],
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns,
    count: number
): GaussianPair[] => {
    const forward = buildStorageToRuntimeMap(editorStorageIndices, runtimeIndices, ply, sog);
    const scored = editorStorageIndices
        .map((storageIndex) => {
            const { runtimeIndex, delta } = forward.get(storageIndex)!;
            return { storageIndex, runtimeIndex, localDelta: delta };
        })
        .filter((entry) => entry.localDelta <= SOG_CENTER_EPSILON)
        .sort((left, right) => left.localDelta - right.localDelta);

    if (scored.length >= count) {
        return scored.slice(0, count);
    }

    return editorStorageIndices.slice(0, count).map((storageIndex) => {
        const { runtimeIndex, delta } = forward.get(storageIndex)!;
        return { storageIndex, runtimeIndex, localDelta: delta };
    });
};

const findBinding = (rig: ScaRig, nodeId: string, regionId: string): ScaRigBinding | null =>
    rig.bindings.find((entry) => entry.regionId === regionId && entry.nodeId === nodeId) ?? null;

const findNode = (rig: ScaRig, nodeId: string): ScaRigNode | null =>
    rig.nodes.find((entry) => entry.id === nodeId) ?? null;

const compareStep = (
    name: string,
    editorValue: unknown,
    runtimeValue: unknown,
    epsilon: number
): ChainStep => {
    let maxAbsError = 0;

    if (Array.isArray(editorValue) && Array.isArray(runtimeValue)) {
        for (let i = 0; i < Math.min(editorValue.length, runtimeValue.length); i++) {
            if (typeof editorValue[i] === 'number' && typeof runtimeValue[i] === 'number') {
                maxAbsError = Math.max(maxAbsError, Math.abs(editorValue[i] - runtimeValue[i]));
            }
        }
    }

    return {
        name,
        editor: editorValue,
        runtime: runtimeValue,
        maxAbsError,
        pass: maxAbsError <= epsilon
    };
};

const traceGaussianChain = (input: {
    pair: GaussianPair;
    editorMatrixModel: Mat4;
    runtimeMatrixModel: Mat4;
    editorNodeWorld: Mat4;
    runtimeNodeWorld: Mat4;
    editorBindOffset: Mat4;
    runtimeBindOffset: Mat4;
    editorEffective: Mat4;
    runtimeEffective: Mat4;
    editorLocal: Vec3Tuple;
    runtimeLocal: Vec3Tuple;
    ply: CenterColumns;
    sog: CenterColumns;
}): GaussianChainResult => {
    const editorPalette = matrixToArray(input.editorEffective);
    const runtimePalette = matrixToArray(input.runtimeEffective);

    const editorCenterAfterPalette = applyPaletteToLocalCenter(input.editorEffective, input.editorLocal);
    const runtimeCenterAfterPalette = applyPaletteToLocalCenter(input.runtimeEffective, input.runtimeLocal);

    const editorWorld = traceTransformPoint(input.editorMatrixModel, ...editorCenterAfterPalette);
    const runtimeWorld = traceTransformPoint(input.runtimeMatrixModel, ...runtimeCenterAfterPalette);

    const steps: ChainStep[] = [
        compareStep('matrix_model (splat basis)', matrixToArray(input.editorMatrixModel), matrixToArray(input.runtimeMatrixModel), MATRIX_EPSILON),
        compareStep('rigNodeWorldMatrix', matrixToArray(input.editorNodeWorld), matrixToArray(input.runtimeNodeWorld), MATRIX_EPSILON),
        compareStep('bindOffsetMatrix', matrixToArray(input.editorBindOffset), matrixToArray(input.runtimeBindOffset), MATRIX_EPSILON),
        compareStep('effectiveRigMatrix (nodeWorld * bindOffset)', matrixToArray(input.editorEffective), matrixToArray(input.runtimeEffective), MATRIX_EPSILON),
        compareStep('transformPaletteMatrix (= effective)', editorPalette, runtimePalette, MATRIX_EPSILON),
        compareStep('editorLocalCenter (PLY storage)', input.editorLocal, input.runtimeLocal, SOG_CENTER_EPSILON),
        compareStep('runtimeLocalCenter (SOG export)', input.editorLocal, input.runtimeLocal, SOG_CENTER_EPSILON),
        compareStep('centerAfterPalette (transpose(palette) * local)', editorCenterAfterPalette, runtimeCenterAfterPalette, WORLD_EPSILON),
        compareStep('finalWorldCenter (matrix_model * centerAfterPalette)', editorWorld, runtimeWorld, WORLD_EPSILON)
    ];

    const worldDelta = distance3(editorWorld, runtimeWorld);
    const firstDivergence = steps.find((step) => !step.pass)?.name ?? null;

    return {
        storageIndex: input.pair.storageIndex,
        runtimeIndex: input.pair.runtimeIndex,
        localDelta: input.pair.localDelta,
        steps,
        editorWorldCenter: editorWorld,
        runtimeWorldCenter: runtimeWorld,
        worldDelta,
        firstDivergence
    };
};

const evaluateRegionTime = (input: {
    regionId: string;
    time: number;
    editorRig: ScaRig;
    runtimeRig: ScaRig;
    editorClip: ScaAnimationClip;
    runtimeClip: ScaAnimationClip;
    editorNode: ScaRigNode;
    runtimeNode: ScaRigNode;
    editorBinding: ScaRigBinding;
    runtimeBinding: ScaRigBinding;
    editorMatrixModel: Mat4;
    runtimeMatrixModel: Mat4;
    pairs: GaussianPair[];
    ply: CenterColumns;
    sog: CenterColumns;
}): RegionTimeResult => {
    const editorPoseEval = applyRigAnimationToPose(
        evaluateRigPose(input.editorRig),
        input.editorRig,
        input.editorClip,
        input.time
    );
    const runtimePoseEval = evaluateRuntimeRigPose(input.runtimeRig, input.runtimeClip, input.time);
    const editorPose = requireEvaluatedNodePose(editorPoseEval, input.editorNode);
    const runtimePose = requireEvaluatedNodePose(runtimePoseEval, input.runtimeNode);

    const editorNodeWorld = new Mat4();
    const runtimeNodeWorld = new Mat4();
    const editorBindOffset = new Mat4();
    const runtimeBindOffset = new Mat4();
    const editorEffective = new Mat4();
    const runtimeEffective = new Mat4();

    buildNodeWorldMatrixFromPose(input.editorRig, editorPoseEval, input.editorNode, editorNodeWorld);
    buildNodeWorldMatrixFromPose(input.runtimeRig, runtimePoseEval, input.runtimeNode, runtimeNodeWorld);
    bindOffsetToMatrix(input.editorBinding, editorBindOffset);
    bindOffsetToMatrix(input.runtimeBinding, runtimeBindOffset);
    buildEffectiveRigWorldMatrixFromPose(input.editorRig, editorPoseEval, input.editorNode, input.editorBinding, editorEffective);
    buildEffectiveRigWorldMatrixFromPose(input.runtimeRig, runtimePoseEval, input.runtimeNode, input.runtimeBinding, runtimeEffective);

    const poseError = Math.max(
        ...editorPose.position.map((v, i) => Math.abs(v - runtimePose.position[i])),
        ...editorPose.rotation.map((v, i) => Math.abs(v - runtimePose.rotation[i]))
    );

    const gaussianResults = input.pairs.map((pair) => traceGaussianChain({
        pair,
        editorMatrixModel: input.editorMatrixModel,
        runtimeMatrixModel: input.runtimeMatrixModel,
        editorNodeWorld,
        runtimeNodeWorld,
        editorBindOffset,
        runtimeBindOffset,
        editorEffective,
        runtimeEffective,
        editorLocal: centerAt(input.ply, pair.storageIndex),
        runtimeLocal: centerAt(input.sog, pair.runtimeIndex),
        ply: input.ply,
        sog: input.sog
    }));

    const maxWorldError = Math.max(...gaussianResults.map((entry) => entry.worldDelta), 0);
    const chainSummary = {
        matrixModelPass: matrixMaxAbsError(input.editorMatrixModel, input.runtimeMatrixModel) <= MATRIX_EPSILON,
        nodeWorldPass: matrixMaxAbsError(editorNodeWorld, runtimeNodeWorld) <= MATRIX_EPSILON,
        bindOffsetPass: matrixMaxAbsError(editorBindOffset, runtimeBindOffset) <= MATRIX_EPSILON,
        effectiveRigPass: matrixMaxAbsError(editorEffective, runtimeEffective) <= MATRIX_EPSILON,
        paletteEqualsEffectivePass: matrixMaxAbsError(editorEffective, runtimeEffective) <= MATRIX_EPSILON,
        posePass: poseError <= POSE_EPSILON
    };

    let firstDivergence: string | null = null;
    if (!chainSummary.posePass) {
        firstDivergence = `evaluated rig pose (max error ${poseError.toExponential(4)})`;
    } else if (!chainSummary.matrixModelPass) {
        firstDivergence = 'matrix_model (splat basis)';
    } else if (!chainSummary.nodeWorldPass) {
        firstDivergence = 'rigNodeWorldMatrix';
    } else if (!chainSummary.bindOffsetPass) {
        firstDivergence = 'bindOffsetMatrix';
    } else if (!chainSummary.effectiveRigPass) {
        firstDivergence = 'effectiveRigMatrix';
    } else {
        for (const gaussian of gaussianResults) {
            if (gaussian.firstDivergence) {
                firstDivergence = `gaussian storage ${gaussian.storageIndex}: ${gaussian.firstDivergence}`;
                break;
            }
        }
    }

    return {
        regionId: input.regionId,
        time: input.time,
        pass: firstDivergence === null && maxWorldError <= WORLD_EPSILON,
        maxWorldError,
        chainSummary,
        gaussianResults,
        firstDivergence
    };
};

async function main() {
    const reportPath = path.join(REPORT_DIR, 'transform-chain-parity-animation_01.json');

    if (!fs.existsSync(SSPROJ_PATH)) {
        console.error(`missing editor project: ${SSPROJ_PATH}`);
        process.exit(1);
    }
    if (!fs.existsSync(path.join(RUNTIME_DIR, 'project.json'))) {
        console.error(`missing runtime export: ${RUNTIME_DIR}/project.json`);
        process.exit(1);
    }

    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const editorProject = document.sca?.project as ScaProject | undefined;
    const runtimeProject = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'project.json'), 'utf8')) as ScaProject;

    if (!editorProject?.rig || !runtimeProject.rig) {
        console.error('editor or runtime missing rig block');
        process.exit(1);
    }

    const editorClip = editorProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    const runtimeClip = runtimeProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    if (!editorClip || !runtimeClip) {
        console.error(`${ANIMATION_CLIP_ID} missing from editor or runtime`);
        process.exit(1);
    }

    const editorNode = findNode(editorProject.rig, RIG_NODE_ID);
    const runtimeNode = findNode(runtimeProject.rig, RIG_NODE_ID);
    if (!editorNode || !runtimeNode) {
        console.error(`rig node ${RIG_NODE_ID} missing`);
        process.exit(1);
    }

    const documentSplats = Array.isArray(document.splats) ? document.splats as Record<string, unknown>[] : [];
    const documentSplat = documentSplats[0] ?? null;
    const runtimeSplatEntry = runtimeProject.splats?.[0] ?? null;

    const editorMatrixModel = buildSplatBasisMatrix(undefined, documentSplat);
    const runtimeMatrixModel = buildSplatBasisMatrix(runtimeSplatEntry ?? undefined, documentSplat);

    const plyPath = fs.existsSync(path.join(extracted, 'splat_0.ply')) ?
        path.join(extracted, 'splat_0.ply') :
        path.join(extracted, 'splat.ply');
    const ply = await loadPlyCenters(plyPath);
    const sog = await loadSogCenters(path.join(RUNTIME_DIR, 'index.sog'));

    const regionResults: RegionTimeResult[] = [];
    let globalFirstDivergence: string | null = null;
    let globalMaxWorldError = 0;

    for (const regionId of TARGET_REGIONS) {
        const editorBinding = findBinding(editorProject.rig, RIG_NODE_ID, regionId);
        const runtimeBinding = findBinding(runtimeProject.rig, RIG_NODE_ID, regionId);
        if (!editorBinding || !runtimeBinding) {
            console.error(`binding missing for ${regionId}`);
            process.exit(1);
        }

        const editorMaskPath = path.join(extracted, 'sca/regions', `${regionId}.mask`);
        const runtimeMaskPath = path.join(RUNTIME_DIR, 'regions', `${regionId}.mask`);
        const editorStorageIndices = decodeScarmIndices(editorMaskPath);
        const runtimeIndices = decodeScarmIndices(runtimeMaskPath);
        const pairs = selectGaussianPairs(editorStorageIndices, runtimeIndices, ply, sog, SAMPLE_COUNT);

        for (const time of SAMPLE_TIMES) {
            const result = evaluateRegionTime({
                regionId,
                time,
                editorRig: editorProject.rig,
                runtimeRig: runtimeProject.rig,
                editorClip,
                runtimeClip,
                editorNode,
                runtimeNode,
                editorBinding,
                runtimeBinding,
                editorMatrixModel,
                runtimeMatrixModel,
                pairs,
                ply,
                sog
            });
            regionResults.push(result);
            globalMaxWorldError = Math.max(globalMaxWorldError, result.maxWorldError);
            if (!globalFirstDivergence && !result.pass) {
                globalFirstDivergence = `${regionId} t=${time}: ${result.firstDivergence}`;
            }
        }
    }

    const report = {
        pass: globalFirstDivergence === null,
        animationClipId: ANIMATION_CLIP_ID,
        rigNodeId: RIG_NODE_ID,
        regions: TARGET_REGIONS,
        sampleTimes: SAMPLE_TIMES,
        splatBasis: {
            editor: matrixToArray(editorMatrixModel),
            runtime: matrixToArray(runtimeMatrixModel),
            editorClassification: classifyMatrix(matrixToArray(editorMatrixModel)),
            runtimeClassification: classifyMatrix(matrixToArray(runtimeMatrixModel)),
            maxAbsError: matrixMaxAbsError(editorMatrixModel, runtimeMatrixModel),
            /** Simulates pre-fix export (no splats[] in project.json → runtime identity matrix_model). */
            withoutExportSimulated: (() => {
                const identityRuntime = new Mat4();
                let maxDelta = 0;
                for (const regionId of TARGET_REGIONS) {
                    const editorBinding = findBinding(editorProject.rig!, RIG_NODE_ID, regionId)!;
                    const editorMaskPath = path.join(extracted, 'sca/regions', `${regionId}.mask`);
                    const runtimeMaskPath = path.join(RUNTIME_DIR, 'regions', `${regionId}.mask`);
                    const pairs = selectGaussianPairs(
                        decodeScarmIndices(editorMaskPath),
                        decodeScarmIndices(runtimeMaskPath),
                        ply,
                        sog,
                        3
                    );
                    const pose = applyRigAnimationToPose(
                        evaluateRigPose(editorProject.rig!),
                        editorProject.rig!,
                        editorClip,
                        0.5
                    );
                    const effective = new Mat4();
                    buildEffectiveRigWorldMatrixFromPose(
                        editorProject.rig!,
                        pose,
                        editorNode!,
                        editorBinding,
                        effective
                    );
                    for (const pair of pairs) {
                        const local = centerAt(ply, pair.storageIndex);
                        const afterPalette = applyPaletteToLocalCenter(effective, local);
                        const editorWorld = traceTransformPoint(editorMatrixModel, ...afterPalette);
                        const brokenWorld = traceTransformPoint(identityRuntime, ...afterPalette);
                        maxDelta = Math.max(maxDelta, distance3(editorWorld, brokenWorld));
                    }
                }
                return {
                    firstDivergenceStage: 'matrix_model (splat basis) — runtime identity vs editor Rz180',
                    maxWorldDeltaAtT0_5: maxDelta
                };
            })()
        },
        globalMaxWorldError,
        firstDivergence: globalFirstDivergence,
        regionTimeResults: regionResults
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('\n========== TRANSFORM CHAIN PARITY (animation_01) ==========');
    console.log(`Animation: ${ANIMATION_CLIP_ID} → ${RIG_NODE_ID}`);
    console.log(`Regions: ${TARGET_REGIONS.join(', ')}`);
    console.log(`Times: ${SAMPLE_TIMES.join(', ')}`);
    console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
    console.log(`Global max world-space error: ${globalMaxWorldError.toExponential(4)}`);
    if (globalFirstDivergence) {
        console.log(`First divergence: ${globalFirstDivergence}`);
    }

    console.log('\n--- Splat basis (matrix_model) ---');
    console.log(`Editor: ${report.splatBasis.editorClassification}`);
    console.log(`Runtime: ${report.splatBasis.runtimeClassification}`);
    console.log(`Max abs error: ${report.splatBasis.maxAbsError.toExponential(4)}`);
    if (report.splatBasis.maxAbsError > MATRIX_EPSILON) {
        console.log('Editor matrix_model:\n' + fmtMat4(report.splatBasis.editor));
        console.log('Runtime matrix_model:\n' + fmtMat4(report.splatBasis.runtime));
    }
    console.log(`Without splats export (simulated): max world Δ at t=0.5 = ${(report.splatBasis.withoutExportSimulated.maxWorldDeltaAtT0_5 as number).toFixed(4)} m`);
    console.log(`  → ${report.splatBasis.withoutExportSimulated.firstDivergenceStage}`);

    for (const result of regionResults) {
        console.log(`\n--- ${result.regionId} t=${result.time.toFixed(1)}: ${result.pass ? 'PASS' : 'FAIL'} ---`);
        console.log(`  Max world error: ${result.maxWorldError.toExponential(4)}`);
        if (result.firstDivergence) {
            console.log(`  First divergence: ${result.firstDivergence}`);
        }
        console.log(`  Chain: pose=${result.chainSummary.posePass} nodeWorld=${result.chainSummary.nodeWorldPass} bindOffset=${result.chainSummary.bindOffsetPass} effective=${result.chainSummary.effectiveRigPass} matrixModel=${result.chainSummary.matrixModelPass}`);

        for (const gaussian of result.gaussianResults) {
            console.log(`  storage ${gaussian.storageIndex} → runtime ${gaussian.runtimeIndex}: world Δ=${gaussian.worldDelta.toExponential(3)} local Δ=${gaussian.localDelta.toExponential(3)}`);
            if (gaussian.firstDivergence) {
                const step = gaussian.steps.find((entry) => entry.name === gaussian.firstDivergence);
                if (step) {
                    console.log(`    FIRST FAIL at "${step.name}": maxAbsError=${step.maxAbsError.toExponential(4)}`);
                    console.log(`    editor world: ${fmtVec3(gaussian.editorWorldCenter)}`);
                    console.log(`    runtime world: ${fmtVec3(gaussian.runtimeWorldCenter)}`);
                }
            }
        }
    }

    console.log('\nReport:', reportPath);
    console.log('===========================================================\n');

    process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
