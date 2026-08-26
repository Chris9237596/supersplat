/**
 * Rig parity: auto-detect animation_01 rig node + bound region, sample animation times.
 * Inputs (only):
 *   sca-workspace/project/current.ssproj
 *   sca-workspace/runtime/latest/
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
import { Mat4 } from 'playcanvas';

import { decodeRegionMask } from '../src/sca/regions/region-mask-format';
import { applyRigAnimationToPose } from '../src/sca/rig/rig-animation';
import { buildEffectiveRigWorldMatrixFromPose } from '../src/sca/rig/rig-hierarchy';
import { evaluateRigPose, requireEvaluatedNodePose, ScaRigEvaluatedPose, ScaRigNodePose } from '../src/sca/rig/rig-pose';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject } from '../src/sca/types/project';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../src/sca/types/rig';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_DIR = path.join(ROOT, 'runtime/latest');
const REPORT_DIR = path.join(ROOT, 'compare/reports');

const ANIMATION_CLIP_ID = 'animation_01';
/** Observed SOG position quantization in region_04 is ~2.7 cm; allow headroom. */
const SOG_CENTER_EPSILON = 0.04;
const MATRIX_EPSILON = 1e-4;
const POSE_EPSILON = 1e-4;
const SAMPLE_COUNT = 5;
const TIME_EPSILON = 1e-6;

type Vec3 = [number, number, number];

type ParityTarget = {
    animationClipId: string;
    animationClipName: string;
    nodeId: string;
    regionId: string;
};

type TimeSampleResult = {
    time: number;
    pass: boolean;
    editorPose: ScaRigNodePose;
    runtimePose: ScaRigNodePose;
    poseMaxAbsError: number;
    effectiveMatrixMaxAbsError: number;
    runtimePaletteIndex: number | null;
    centroidDelta: number;
    centroidMatchedPairCount: number;
    gaussianSamples: Array<Record<string, unknown>>;
    firstDivergence: string | null;
};

const poseMaxAbsError = (left: ScaRigNodePose, right: ScaRigNodePose): number => {
    let max = 0;
    for (let i = 0; i < 3; i++) {
        max = Math.max(max, Math.abs(left.position[i] - right.position[i]));
        max = Math.max(max, Math.abs(left.rotation[i] - right.rotation[i]));
    }
    return max;
};

const dedupeSampleTimes = (times: number[]): number[] => {
    const sorted = [...times].sort((left, right) => left - right);
    const unique: number[] = [];
    for (const time of sorted) {
        if (unique.length === 0 || Math.abs(time - unique[unique.length - 1]) > TIME_EPSILON) {
            unique.push(time);
        }
    }
    return unique;
};

const buildAnimationSampleTimes = (clip: ScaAnimationClip, nodeId: string): number[] => {
    let lastKeyframeTime = 0;
    for (const track of clip.tracks) {
        if (track.targetType !== 'rig-node' || track.nodeId !== nodeId) {
            continue;
        }

        for (const keyframe of track.keyframes) {
            lastKeyframeTime = Math.max(lastKeyframeTime, keyframe.time);
        }
    }

    return dedupeSampleTimes([0, 0.5, 1.0, clip.duration]);
};

type DetectResult =
    | { ok: true; target: ParityTarget }
    | { ok: false; reason: string };

const evaluateEditorAnimatedPose = (
    rig: ScaRig,
    clip: ScaAnimationClip,
    time: number
): ScaRigEvaluatedPose => {
    return applyRigAnimationToPose(evaluateRigPose(rig), rig, clip, time);
};

const transformPoint = (matrix: Mat4, x: number, y: number, z: number): Vec3 => {
    const m = matrix.data;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const fmtVec3 = (v: Vec3): string => `[${v.map((n) => n.toFixed(6)).join(', ')}]`;

const distance3 = (a: Vec3, b: Vec3): number => {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

const matrixMaxAbsError = (left: Mat4, right: Mat4): number => {
    let max = 0;
    for (let i = 0; i < 16; i++) {
        max = Math.max(max, Math.abs(left.data[i] - right.data[i]));
    }
    return max;
};

const decodeScarmIndices = (filePath: string): number[] => {
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const { ranges } = decodeRegionMask(bytes);
    const indices: number[] = [];
    ranges.forEach((index) => indices.push(index));
    indices.sort((a, b) => a - b);
    return indices;
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

const detectParityTarget = (editorProject: ScaProject): DetectResult => {
    const clip = editorProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    if (!clip) {
        const clipIds = editorProject.animations?.map((entry) => entry.id).join(', ') ?? 'none';
        return { ok: false, reason: `${ANIMATION_CLIP_ID} not found in editor project (animations: ${clipIds})` };
    }

    const rigNodeIds = [...new Set(
        clip.tracks
            .filter((track) => track.targetType === 'rig-node')
            .map((track) => track.nodeId)
    )];

    if (rigNodeIds.length === 0) {
        return { ok: false, reason: `${ANIMATION_CLIP_ID} has no rig-node tracks` };
    }

    if (rigNodeIds.length > 1) {
        return {
            ok: false,
            reason: `${ANIMATION_CLIP_ID} targets multiple rig nodes (${rigNodeIds.join(', ')}); expected one`
        };
    }

    const nodeId = rigNodeIds[0];
    const rig = editorProject.rig;
    if (!rig) {
        return { ok: false, reason: 'editor project has no rig block' };
    }

    const bindings = rig.bindings.filter((binding) => binding.nodeId === nodeId);
    if (bindings.length === 0) {
        const bound = rig.bindings.map((binding) => `${binding.regionId}:${binding.nodeId}`).join(', ') || 'none';
        return { ok: false, reason: `no region bound to rig node ${nodeId} (bindings: ${bound})` };
    }

    if (bindings.length > 1) {
        bindings.sort((left, right) => left.regionId.localeCompare(right.regionId));
    }

    return {
        ok: true,
        target: {
            animationClipId: clip.id,
            animationClipName: clip.name,
            nodeId,
            regionId: bindings[0].regionId
        }
    };
};

const summarizeClip = (clip: ScaAnimationClip | undefined): string => {
    if (!clip) {
        return 'missing';
    }

    const rigTracks = clip.tracks
        .filter((track) => track.targetType === 'rig-node')
        .map((track) => `${track.nodeId}.${track.property}`)
        .join(', ');

    return `${clip.id} (${clip.name}) rig tracks: ${rigTracks || 'none'}`;
};

async function loadPlyCenters(plyPath: string): Promise<{ count: number; x: Float32Array; y: Float32Array; z: Float32Array }> {
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

async function loadSogCenters(sogPath: string): Promise<{ count: number; x: Float32Array; y: Float32Array; z: Float32Array }> {
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

type CenterColumns = { x: Float32Array; y: Float32Array; z: Float32Array };

type RegionGaussianMapping = {
    storageToRuntime: Map<number, number>;
    runtimeToStorage: Map<number, number>;
    maxLocalCenterDelta: number;
};

const centerAt = (columns: CenterColumns, index: number): Vec3 => {
    return [columns.x[index], columns.y[index], columns.z[index]];
};

const nearestRuntimeInMask = (
    storageIndex: number,
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns
): { runtimeIndex: number; delta: number } => {
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

    if (bestRuntime < 0) {
        throw new Error(`no runtime-mask match for storage index ${storageIndex}`);
    }

    return { runtimeIndex: bestRuntime, delta: bestDelta };
};

/** Editor storage -> nearest runtime row within the exported runtime mask. */
const buildStorageToRuntimeMaskMap = (
    editorStorageIndices: number[],
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns
): Map<number, { runtimeIndex: number; delta: number }> => {
    const forward = new Map<number, { runtimeIndex: number; delta: number }>();
    for (const storageIndex of editorStorageIndices) {
        forward.set(storageIndex, nearestRuntimeInMask(storageIndex, runtimeIndices, ply, sog));
    }
    return forward;
};

/** Resolve runtime -> editor using inverse forward matches, then nearest-center fallback. */
const buildRegionGaussianMapping = (
    editorStorageIndices: number[],
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns
): RegionGaussianMapping => {
    const forward = buildStorageToRuntimeMaskMap(editorStorageIndices, runtimeIndices, ply, sog);
    const runtimeToStorage = new Map<number, number>();
    const storageToRuntime = new Map<number, number>();
    let maxLocalCenterDelta = 0;

    for (const storageIndex of editorStorageIndices) {
        const { runtimeIndex } = forward.get(storageIndex)!;
        storageToRuntime.set(storageIndex, runtimeIndex);
    }

    for (const runtimeIndex of runtimeIndices) {
        const inverseCandidates = editorStorageIndices.filter((storageIndex) => {
            return forward.get(storageIndex)!.runtimeIndex === runtimeIndex;
        });

        let storageIndex = -1;
        let bestDelta = Infinity;

        for (const candidate of inverseCandidates) {
            const delta = distance3(centerAt(ply, candidate), centerAt(sog, runtimeIndex));
            if (delta < bestDelta) {
                bestDelta = delta;
                storageIndex = candidate;
            }
        }

        if (storageIndex < 0) {
            const sogCenter = centerAt(sog, runtimeIndex);
            for (const candidate of editorStorageIndices) {
                const delta = distance3(centerAt(ply, candidate), sogCenter);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    storageIndex = candidate;
                }
            }
        }

        runtimeToStorage.set(runtimeIndex, storageIndex);
        maxLocalCenterDelta = Math.max(maxLocalCenterDelta, bestDelta);
    }

    return { storageToRuntime, runtimeToStorage, maxLocalCenterDelta };
};

const verifyMappingMatchesRuntimeMask = (
    mapping: RegionGaussianMapping,
    runtimeIndices: number[]
): { ok: true } | { ok: false; reason: string } => {
    const runtimeSet = new Set(runtimeIndices);

    if (mapping.runtimeToStorage.size !== runtimeIndices.length) {
        return {
            ok: false,
            reason: `runtime mapping size ${mapping.runtimeToStorage.size} != runtime mask ${runtimeIndices.length}`
        };
    }

    for (const runtimeIndex of runtimeIndices) {
        if (!runtimeSet.has(runtimeIndex)) {
            return {
                ok: false,
                reason: `runtime mask index ${runtimeIndex} is invalid`
            };
        }
        if (!mapping.runtimeToStorage.has(runtimeIndex)) {
            return {
                ok: false,
                reason: `runtime mask index ${runtimeIndex} missing from runtime->storage mapping`
            };
        }
    }

    for (const runtimeIndex of mapping.runtimeToStorage.keys()) {
        if (!runtimeSet.has(runtimeIndex)) {
            return {
                ok: false,
                reason: `mapped runtime index ${runtimeIndex} is not in runtime mask`
            };
        }
    }

    return { ok: true };
};

const selectSampleRuntimeIndices = (
    editorStorageIndices: number[],
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns,
    count: number
): number[] => {
    const forward = buildStorageToRuntimeMaskMap(editorStorageIndices, runtimeIndices, ply, sog);
    const scored = runtimeIndices.map((runtimeIndex) => {
        const inverseCandidates = editorStorageIndices.filter((storageIndex) => {
            return forward.get(storageIndex)!.runtimeIndex === runtimeIndex;
        });

        let bestDelta = Infinity;
        for (const storageIndex of inverseCandidates) {
            bestDelta = Math.min(
                bestDelta,
                distance3(centerAt(ply, storageIndex), centerAt(sog, runtimeIndex))
            );
        }

        return { runtimeIndex, bestDelta, hasInverse: inverseCandidates.length > 0 };
    });

    const good = scored
        .filter((entry) => entry.hasInverse && entry.bestDelta <= SOG_CENTER_EPSILON)
        .sort((left, right) => left.bestDelta - right.bestDelta)
        .map((entry) => entry.runtimeIndex);

    if (good.length >= count) {
        return good.slice(0, count);
    }

    return runtimeIndices.slice(0, count);
};

function findBinding(rig: ScaRig, nodeId: string, regionId: string): ScaRigBinding | null {
    return rig.bindings.find((entry) => entry.regionId === regionId && entry.nodeId === nodeId) ??
        rig.bindings.find((entry) => entry.regionId === regionId) ??
        null;
}

function findNode(rig: ScaRig, nodeId: string): ScaRigNode | null {
    return rig.nodes.find((entry) => entry.id === nodeId) ?? null;
}

function resolveRuntimePaletteIndex(
    rig: ScaRig,
    regionIdsWithMask: Set<string>,
    nodeId: string,
    regionId: string
): number | null {
    const bindings = [...rig.bindings]
        .filter((binding) => regionIdsWithMask.has(binding.regionId))
        .filter((binding) => rig.nodes.some((node) => node.id === binding.nodeId))
        .sort((left, right) => left.regionId.localeCompare(right.regionId));

    const paletteByNodeId = new Map<string, number>();
    let nextIdx = 1;

    for (const binding of bindings) {
        if (!paletteByNodeId.has(binding.nodeId)) {
            paletteByNodeId.set(binding.nodeId, nextIdx++);
        }
        if (binding.regionId === regionId && binding.nodeId === nodeId) {
            return paletteByNodeId.get(binding.nodeId)!;
        }
    }

    return null;
}


function computeVerifiedPairCentroids(
    runtimeIndices: number[],
    runtimeToStorage: Map<number, number>,
    storageForward: Map<number, { runtimeIndex: number; delta: number }>,
    ply: CenterColumns,
    sog: CenterColumns,
    matEditor: Mat4,
    matRuntime: Mat4,
    epsilon: number
): { editor: Vec3; runtime: Vec3; delta: number; matchedPairCount: number } {
    let editorSx = 0;
    let editorSy = 0;
    let editorSz = 0;
    let runtimeSx = 0;
    let runtimeSy = 0;
    let runtimeSz = 0;
    let matchedPairCount = 0;

    for (const runtimeIndex of runtimeIndices) {
        const storageIndex = runtimeToStorage.get(runtimeIndex)!;
        if (storageForward.get(storageIndex)!.runtimeIndex !== runtimeIndex) {
            continue;
        }

        const localDelta = distance3(centerAt(ply, storageIndex), centerAt(sog, runtimeIndex));
        if (localDelta > epsilon) {
            continue;
        }

        const editorTransformed = transformPoint(matEditor, ...centerAt(ply, storageIndex));
        const runtimeTransformed = transformPoint(matRuntime, ...centerAt(sog, runtimeIndex));
        editorSx += editorTransformed[0];
        editorSy += editorTransformed[1];
        editorSz += editorTransformed[2];
        runtimeSx += runtimeTransformed[0];
        runtimeSy += runtimeTransformed[1];
        runtimeSz += runtimeTransformed[2];
        matchedPairCount++;
    }

    if (matchedPairCount === 0) {
        throw new Error('no verified editor/runtime Gaussian pairs for centroid comparison');
    }

    const n = matchedPairCount;
    const editor: Vec3 = [editorSx / n, editorSy / n, editorSz / n];
    const runtime: Vec3 = [runtimeSx / n, runtimeSy / n, runtimeSz / n];
    return { editor, runtime, delta: distance3(editor, runtime), matchedPairCount };
}

function buildGaussianSamples(
    sampleRuntimeIndices: number[],
    regionMapping: RegionGaussianMapping,
    ply: CenterColumns,
    sog: CenterColumns,
    matEditor: Mat4,
    matRuntime: Mat4
): Array<Record<string, unknown>> {
    const samples: Array<Record<string, unknown>> = [];

    for (const runtimeIndex of sampleRuntimeIndices) {
        const storageIndex = regionMapping.runtimeToStorage.get(runtimeIndex);
        if (storageIndex === undefined) {
            throw new Error(`no editor storage mapped to runtime index ${runtimeIndex}`);
        }

        const editorLocal = centerAt(ply, storageIndex);
        const runtimeLocal = centerAt(sog, runtimeIndex);
        const editorTransformed = transformPoint(matEditor, ...editorLocal);
        const runtimeTransformed = transformPoint(matRuntime, ...runtimeLocal);

        samples.push({
            storageIndex,
            runtimeIndex,
            editorLocal,
            runtimeLocal,
            localDelta: distance3(editorLocal, runtimeLocal),
            editorTransformed,
            runtimeTransformed,
            transformedDelta: distance3(editorTransformed, runtimeTransformed)
        });
    }

    return samples;
}

function evaluateTimeSample(
    time: number,
    editorRig: ScaRig,
    runtimeRig: ScaRig,
    editorClip: ScaAnimationClip,
    runtimeClip: ScaAnimationClip,
    editorNode: ScaRigNode,
    runtimeNode: ScaRigNode,
    editorBinding: ScaRigBinding,
    runtimeBinding: ScaRigBinding,
    runtimePaletteIndex: number | null,
    sampleRuntimeIndices: number[],
    regionMapping: RegionGaussianMapping,
    storageForward: Map<number, { runtimeIndex: number; delta: number }>,
    runtimeIndices: number[],
    ply: CenterColumns,
    sog: CenterColumns
): TimeSampleResult {
    const editorPoseEval = evaluateEditorAnimatedPose(editorRig, editorClip, time);
    const runtimePoseEval = evaluateRuntimeRigPose(runtimeRig, runtimeClip, time);
    const editorPose = requireEvaluatedNodePose(editorPoseEval, editorNode);
    const runtimePose = requireEvaluatedNodePose(runtimePoseEval, runtimeNode);

    const matEditor = new Mat4();
    const matRuntime = new Mat4();
    buildEffectiveRigWorldMatrixFromPose(editorRig, editorPoseEval, editorNode, editorBinding, matEditor);
    buildEffectiveRigWorldMatrixFromPose(runtimeRig, runtimePoseEval, runtimeNode, runtimeBinding, matRuntime);

    const poseError = poseMaxAbsError(editorPose, runtimePose);
    const matrixError = matrixMaxAbsError(matEditor, matRuntime);
    const gaussianSamples = buildGaussianSamples(
        sampleRuntimeIndices,
        regionMapping,
        ply,
        sog,
        matEditor,
        matRuntime
    );
    const pairedCentroids = computeVerifiedPairCentroids(
        runtimeIndices,
        regionMapping.runtimeToStorage,
        storageForward,
        ply,
        sog,
        matEditor,
        matRuntime,
        SOG_CENTER_EPSILON
    );

    let firstDivergence: string | null = null;

    if (poseError > POSE_EPSILON) {
        firstDivergence = `evaluated rig pose differs (max abs error ${poseError.toExponential(4)} > ${POSE_EPSILON})`;
    }

    if (!firstDivergence && matrixError > MATRIX_EPSILON) {
        firstDivergence = `effective matrix differs (max abs error ${matrixError.toExponential(4)} > ${MATRIX_EPSILON})`;
    }

    for (const sample of gaussianSamples) {
        const localDelta = sample.localDelta as number;
        const transformedDelta = sample.transformedDelta as number;
        if (!firstDivergence && localDelta > SOG_CENTER_EPSILON) {
            firstDivergence = `runtime ${sample.runtimeIndex} (storage ${sample.storageIndex}): local center delta ${localDelta.toExponential(4)} > ${SOG_CENTER_EPSILON}`;
        }
        if (!firstDivergence && transformedDelta > SOG_CENTER_EPSILON) {
            firstDivergence = `runtime ${sample.runtimeIndex} (storage ${sample.storageIndex}): transformed center delta ${transformedDelta.toExponential(4)} > ${SOG_CENTER_EPSILON}`;
        }
    }

    if (!firstDivergence && pairedCentroids.delta > SOG_CENTER_EPSILON) {
        firstDivergence = `region centroid after transform delta ${pairedCentroids.delta.toExponential(4)} > ${SOG_CENTER_EPSILON}`;
    }

    if (!firstDivergence && runtimePaletteIndex === null) {
        firstDivergence = 'runtime palette index could not be resolved';
    }

    return {
        time,
        pass: firstDivergence === null,
        editorPose,
        runtimePose,
        poseMaxAbsError: poseError,
        effectiveMatrixMaxAbsError: matrixError,
        runtimePaletteIndex,
        centroidDelta: pairedCentroids.delta,
        centroidMatchedPairCount: pairedCentroids.matchedPairCount,
        gaussianSamples,
        firstDivergence
    };
}

function writeReport(reportPath: string, report: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

function printSummary(
    target: ParityTarget | null,
    report: Record<string, unknown>,
    reportPath: string
): void {
    console.log('\n========== ANIMATION RIG PARITY (auto-detected) ==========');
    if (target) {
        console.log(`Animation clip: ${target.animationClipId} (${target.animationClipName})`);
        console.log(`Rig node: ${target.nodeId}`);
        console.log(`Bound region: ${target.regionId}`);
    }
    console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
    if (report.firstDivergence) {
        console.log('First divergence:', report.firstDivergence);
    }

    const timeSamples = (report.timeSamples as TimeSampleResult[] | undefined) ?? [];
    for (const sample of timeSamples) {
        console.log(`\n--- t=${sample.time.toFixed(6)}: ${sample.pass ? 'PASS' : 'FAIL'} ---`);
        if (sample.firstDivergence) {
            console.log(`  Divergence: ${sample.firstDivergence}`);
        }
        console.log(`  Pose max abs error: ${sample.poseMaxAbsError.toExponential(4)}`);
        console.log(`  Editor pose: pos ${fmtVec3(sample.editorPose.position)} rot ${fmtVec3(sample.editorPose.rotation)}`);
        console.log(`  Runtime pose: pos ${fmtVec3(sample.runtimePose.position)} rot ${fmtVec3(sample.runtimePose.rotation)}`);
        console.log(`  Effective matrix max error: ${sample.effectiveMatrixMaxAbsError.toExponential(4)}`);
        console.log(`  Runtime palette index: ${sample.runtimePaletteIndex}`);
        console.log(`  Centroid delta: ${sample.centroidDelta.toExponential(4)} (${sample.centroidMatchedPairCount} pairs)`);
        for (const gaussian of sample.gaussianSamples) {
            console.log(
                `  storage ${gaussian.storageIndex} -> runtime ${gaussian.runtimeIndex}: ` +
                `transformed Δ=${(gaussian.transformedDelta as number).toExponential(3)}`
            );
        }
    }

    console.log('Report:', reportPath);
    console.log('==========================================================\n');
}

async function main() {
    let reportPath = path.join(REPORT_DIR, 'animation-rig-parity-auto.json');
    const report: Record<string, unknown> = {
        pass: false
    };

    if (!fs.existsSync(SSPROJ_PATH)) {
        report.firstDivergence = `missing editor project: ${SSPROJ_PATH}`;
        writeReport(reportPath, report);
        console.error(report.firstDivergence);
        printSummary(null, report, reportPath);
        process.exit(1);
    }

    if (!fs.existsSync(path.join(RUNTIME_DIR, 'project.json'))) {
        report.firstDivergence = `missing runtime export: ${RUNTIME_DIR}/project.json`;
        writeReport(reportPath, report);
        console.error(report.firstDivergence);
        printSummary(null, report, reportPath);
        process.exit(1);
    }

    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const editorProject = document.sca?.project as ScaProject | undefined;
    if (!editorProject) {
        report.firstDivergence = 'editor ssproj missing sca.project';
        writeReport(reportPath, report);
        console.error(report.firstDivergence);
        printSummary(null, report, reportPath);
        process.exit(1);
    }

    const runtimeProject = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'project.json'), 'utf8')) as ScaProject;

    const detected = detectParityTarget(editorProject);
    if (!detected.ok) {
        report.detectedAnimationClip = ANIMATION_CLIP_ID;
        report.firstDivergence = detected.reason;
        writeReport(reportPath, report);
        printSummary(null, report, reportPath);
        process.exit(1);
    }

    const target = detected.target;
    report.detectedAnimationClip = target.animationClipId;
    report.detectedAnimationName = target.animationClipName;
    report.rigNodeId = target.nodeId;
    report.boundRegionId = target.regionId;
    reportPath = path.join(REPORT_DIR, `animation-rig-parity-${target.nodeId}-${target.regionId}.json`);

    const editorClip = editorProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    const runtimeClip = runtimeProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    report.editorAnimationSummary = summarizeClip(editorClip);
    report.runtimeAnimationSummary = summarizeClip(runtimeClip);

    if (!editorClip) {
        report.firstDivergence = `${ANIMATION_CLIP_ID} missing in editor project`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    if (!runtimeClip) {
        report.firstDivergence = `${ANIMATION_CLIP_ID} missing in runtime project.json`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    report.sampleTimes = buildAnimationSampleTimes(editorClip, target.nodeId);

    if (!editorProject.rig) {
        report.firstDivergence = 'editor ssproj missing sca.project.rig';
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    const editorRig = editorProject.rig;
    const runtimeRig = runtimeProject.rig ?? null;

    const editorRegion = editorProject.regions?.find((region) => region.id === target.regionId);
    const runtimeRegion = runtimeProject.regions?.find((region) => region.id === target.regionId);

    if (!editorRegion) {
        report.firstDivergence = `${target.regionId} not found in editor project (regions: ${editorProject.regions?.map((r) => r.id).join(', ') ?? 'none'})`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    if (!runtimeRegion) {
        report.firstDivergence = `${target.regionId} not found in runtime project.json (regions: ${runtimeProject.regions?.map((r) => r.id).join(', ') ?? 'none'})`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    const editorMaskPath = path.join(extracted, 'sca/regions', `${target.regionId}.mask`);
    const runtimeMaskPath = path.join(RUNTIME_DIR, 'regions', `${target.regionId}.mask`);

    if (!fs.existsSync(editorMaskPath)) {
        report.firstDivergence = `missing editor mask: ${editorMaskPath}`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    if (!fs.existsSync(runtimeMaskPath)) {
        report.firstDivergence = `missing runtime mask: ${runtimeMaskPath}`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    const editorBinding = findBinding(editorRig, target.nodeId, target.regionId);
    const editorNode = findNode(editorRig, target.nodeId);
    if (!editorBinding || !editorNode) {
        report.firstDivergence = `${target.regionId} -> ${target.nodeId} binding/node missing in editor rig`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    if (!runtimeRig) {
        report.firstDivergence = 'runtime project.json has no rig block';
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    const runtimeBinding = findBinding(runtimeRig, target.nodeId, target.regionId);
    const runtimeNode = findNode(runtimeRig, target.nodeId);
    if (!runtimeBinding || !runtimeNode) {
        report.firstDivergence = `${target.regionId} -> ${target.nodeId} binding/node missing in runtime rig`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    const editorStorageIndices = decodeScarmIndices(editorMaskPath);
    const runtimeIndices = decodeScarmIndices(runtimeMaskPath);

    const plyPath = fs.existsSync(path.join(extracted, 'splat_0.ply')) ?
        path.join(extracted, 'splat_0.ply') :
        path.join(extracted, 'splat.ply');
    const ply = await loadPlyCenters(plyPath);
    const sog = await loadSogCenters(path.join(RUNTIME_DIR, 'index.sog'));

    const regionMapping = buildRegionGaussianMapping(editorStorageIndices, runtimeIndices, ply, sog);
    const mappingCheck = verifyMappingMatchesRuntimeMask(regionMapping, runtimeIndices);
    report.regionMemberCount = runtimeIndices.length;
    report.mappingMaxLocalCenterDelta = regionMapping.maxLocalCenterDelta;
    report.sogCenterEpsilon = SOG_CENTER_EPSILON;

    if (!mappingCheck.ok) {
        report.firstDivergence = `runtime mask mapping verification failed: ${mappingCheck.reason}`;
        writeReport(reportPath, report);
        printSummary(target, report, reportPath);
        process.exit(1);
    }

    report.mappingVerification = 'PASS';

    const runtimeRegionIdsWithMask = new Set(
        (runtimeProject.regions ?? [])
            .map((region) => region.id)
            .filter((regionId) => fs.existsSync(path.join(RUNTIME_DIR, 'regions', `${regionId}.mask`)))
    );
    const runtimePaletteIndex = resolveRuntimePaletteIndex(
        runtimeRig,
        runtimeRegionIdsWithMask,
        target.nodeId,
        target.regionId
    );

    const sampleRuntimeIndices = selectSampleRuntimeIndices(
        editorStorageIndices,
        runtimeIndices,
        ply,
        sog,
        SAMPLE_COUNT
    );
    report.sampleRuntimeIndices = sampleRuntimeIndices;

    const storageForward = buildStorageToRuntimeMaskMap(editorStorageIndices, runtimeIndices, ply, sog);
    const sampleTimes = report.sampleTimes as number[];
    const timeSamples: TimeSampleResult[] = [];
    let firstDivergence: string | null = null;

    for (const time of sampleTimes) {
        const timeSample = evaluateTimeSample(
            time,
            editorRig,
            runtimeRig,
            editorClip,
            runtimeClip,
            editorNode,
            runtimeNode,
            editorBinding,
            runtimeBinding,
            runtimePaletteIndex,
            sampleRuntimeIndices,
            regionMapping,
            storageForward,
            runtimeIndices,
            ply,
            sog
        );
        timeSamples.push(timeSample);

        if (!firstDivergence && !timeSample.pass) {
            firstDivergence = `t=${time}: ${timeSample.firstDivergence}`;
        }
    }

    report.timeSamples = timeSamples;
    report.pass = firstDivergence === null;
    report.firstDivergence = firstDivergence;

    writeReport(reportPath, report);
    printSummary(target, report, reportPath);

    process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
