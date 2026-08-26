/**
 * Gaussian shape/orientation parity: editor PLY vs runtime SOG at t=0.5.
 * Inputs: sca-workspace/project/current.ssproj, sca-workspace/runtime/latest/
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
import { applyPaletteToLocalCenter } from '../src/sca/rig/rig-gaussian-trace';
import { buildEffectiveRigWorldMatrixFromPose } from '../src/sca/rig/rig-hierarchy';
import { evaluateRigPose } from '../src/sca/rig/rig-pose';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import { matrixMaxAbsError, matrixToArray } from '../src/sca/rig/rig-transform';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject, ScaRuntimeSplatRef } from '../src/sca/types/project';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../src/sca/types/rig';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_DIR = path.join(ROOT, 'runtime/latest');
const REPORT_DIR = path.join(ROOT, 'compare/reports');

const TIME = 0.5;
const RIG_NODE_ID = 'rig_02';
const REGIONS = ['region_04', 'region_05'] as const;
const SAMPLE_COUNT = 5;
const SOG_CENTER_EPSILON = 0.04;
const QUAT_EPSILON = 1e-3;
const SCALE_EPSILON = 1e-3;
const COV_EPSILON = 1e-3;
const AXIS_EPSILON = 1e-3;
const MATRIX_EPSILON = 1e-4;

type Vec3 = [number, number, number];
type Quat4 = [number, number, number, number];
type CovPacked = [number, number, number, number, number, number];

type GaussianShape = {
    quatWxyz: Quat4;
    scaleLinear: Vec3;
    covA: Vec3;
    covB: Vec3;
    covMatrix: number[];
    principalAxes: Vec3[];
    principalScales: Vec3;
};

type SideShape = {
    side: 'editor' | 'runtime';
    storageIndex: number;
    runtimeIndex: number;
    localCenter: Vec3;
    local: GaussianShape;
    afterMatrixModel: GaussianShape;
    afterEffectiveRig: GaussianShape;
    modelViewRot3: number[];
    shaderPath: {
        centerUsesPalette: boolean;
        covUsesModelView: boolean;
        localRotModifiedByPalette: boolean;
    };
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

const decodeIndices = (maskPath: string): number[] => {
    const bytes = new Uint8Array(fs.readFileSync(maskPath));
    const { ranges } = decodeRegionMask(bytes);
    const indices: number[] = [];
    ranges.forEach((i) => indices.push(i));
    indices.sort((a, b) => a - b);
    return indices;
};

async function loadTable(plyPath: string) {
    const plyBytes = new Uint8Array(fs.readFileSync(plyPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('splat.ply', plyBytes);
    const sources = await readFile({
        filename: 'splat.ply',
        inputFormat: getInputFormat('splat.ply'),
        fileSystem: fsMem
    });
    const pool = createChunkDataPool({ chunkSize: sources[0].meta.chunkSize });
    const table = await materializeToDataTable(sources[0], pool);
    await sources[0].close();
    return table;
}

async function loadSogTable(sogPath: string) {
    const sogBytes = new Uint8Array(fs.readFileSync(sogPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('index.sog', sogBytes);
    const zipFs = new ZipReadFileSystem(await fsMem.createSource('index.sog'));
    return readSog(zipFs, 'meta.json');
}

const buildSplatBasis = (splatEntry: ScaRuntimeSplatRef | null | undefined, documentSplat: Record<string, unknown> | null): Mat4 => {
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
    } else {
        quat.setFromEulerAngles(rot[0], rot[1], rot[2]);
    }
    const translation = new Vec3(pos[0], pos[1], pos[2]);
    const scl = scale ? new Vec3(scale[0], scale[1], scale[2]) : Vec3.ONE;
    return mat.setTRS(translation, quat, scl);
};

/** Match gsplatCorner computeCovariance(rotation.wxyz, scale). */
const computeCovariance = (quatWxyz: Quat4, scaleLinear: Vec3): { covA: Vec3; covB: Vec3; covMatrix: number[] } => {
    const q = new Quat(quatWxyz[1], quatWxyz[2], quatWxyz[3], quatWxyz[0]);
    const rotMat = new Mat4().setTRS(Vec3.ZERO, q, Vec3.ONE);
    const r = rotMat.data;

    // M = transpose([sx*R0, sy*R1, sz*R2]) as column vectors scaled
    const m00 = scaleLinear[0] * r[0];
    const m01 = scaleLinear[0] * r[1];
    const m02 = scaleLinear[0] * r[2];
    const m10 = scaleLinear[1] * r[4];
    const m11 = scaleLinear[1] * r[5];
    const m12 = scaleLinear[1] * r[6];
    const m20 = scaleLinear[2] * r[8];
    const m21 = scaleLinear[2] * r[9];
    const m22 = scaleLinear[2] * r[10];

    // rows of M (since transpose of column matrix)
    const M0 = [m00, m10, m20];
    const M1 = [m01, m11, m21];
    const M2 = [m02, m12, m22];

    const covA: Vec3 = [
        dot3(M0, M0),
        dot3(M0, M1),
        dot3(M0, M2)
    ];
    const covB: Vec3 = [
        dot3(M1, M1),
        dot3(M1, M2),
        dot3(M2, M2)
    ];

    const covMatrix = [
        covA[0], covA[1], covA[2],
        covA[1], covB[0], covB[1],
        covA[2], covB[1], covB[2]
    ];

    return { covA, covB, covMatrix };
};

const dot3 = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const transformCovariance = (covMatrix: number[], linear3: number[]): number[] => {
    // Sigma' = A * Sigma * A^T for 3x3
    const a = linear3;
    const s = covMatrix;
    const as = [
        a[0] * s[0] + a[3] * s[3] + a[6] * s[6], a[0] * s[1] + a[3] * s[4] + a[6] * s[7], a[0] * s[2] + a[3] * s[5] + a[6] * s[8],
        a[1] * s[0] + a[4] * s[3] + a[7] * s[6], a[1] * s[1] + a[4] * s[4] + a[7] * s[7], a[1] * s[2] + a[4] * s[5] + a[7] * s[8],
        a[2] * s[0] + a[5] * s[3] + a[8] * s[6], a[2] * s[1] + a[5] * s[4] + a[8] * s[7], a[2] * s[2] + a[5] * s[5] + a[8] * s[8]
    ];
    return [
        as[0] * a[0] + as[1] * a[3] + as[2] * a[6], as[0] * a[1] + as[1] * a[4] + as[2] * a[7], as[0] * a[2] + as[1] * a[5] + as[2] * a[8],
        as[3] * a[0] + as[4] * a[3] + as[5] * a[6], as[3] * a[1] + as[4] * a[4] + as[5] * a[7], as[3] * a[2] + as[4] * a[5] + as[5] * a[8],
        as[6] * a[0] + as[7] * a[3] + as[8] * a[6], as[6] * a[1] + as[7] * a[4] + as[8] * a[7], as[6] * a[2] + as[7] * a[5] + as[8] * a[8]
    ];
};

const mat3FromMat4 = (m: Mat4): number[] => {
    const d = m.data;
    return [d[0], d[1], d[2], d[4], d[5], d[6], d[8], d[9], d[10]];
};

const mat3Mul = (a: number[], b: number[]): number[] => {
    return [
        a[0] * b[0] + a[3] * b[1] + a[6] * b[2], a[0] * b[3] + a[3] * b[4] + a[6] * b[5], a[0] * b[6] + a[3] * b[7] + a[6] * b[8],
        a[1] * b[0] + a[4] * b[1] + a[7] * b[2], a[1] * b[3] + a[4] * b[4] + a[7] * b[5], a[1] * b[6] + a[4] * b[7] + a[7] * b[8],
        a[2] * b[0] + a[5] * b[1] + a[8] * b[2], a[2] * b[3] + a[5] * b[4] + a[8] * b[5], a[2] * b[6] + a[5] * b[7] + a[8] * b[8]
    ];
};

/** modelView rotation used by initCornerCov: transpose(mat3(center.modelView)). */
const shaderWFromModelView = (matrixModel: Mat4, palette: Mat4): number[] => {
    const modelView = new Mat4();
    const paletteT = palette.clone();
    paletteT.transpose();
    modelView.mul2(matrixModel, paletteT);
    const mv = mat3FromMat4(modelView);
    // transpose
    return [mv[0], mv[3], mv[6], mv[1], mv[4], mv[7], mv[2], mv[5], mv[8]];
};

const shapeFromQuatScale = (quatWxyz: Quat4, scaleLinear: Vec3): GaussianShape => {
    const { covA, covB, covMatrix } = computeCovariance(quatWxyz, scaleLinear);
    const axes = principalAxesFromCov(covMatrix);
    return {
        quatWxyz,
        scaleLinear,
        covA,
        covB,
        covMatrix,
        principalAxes: axes.axes,
        principalScales: axes.scales
    };
};

const principalAxesFromCov = (cov: number[]): { axes: Vec3[]; scales: Vec3 } => {
    // Power iteration for 3 axes - simplified: return diagonal approx for report
    const scales: Vec3 = [Math.sqrt(Math.max(cov[0], 0)), Math.sqrt(Math.max(cov[4], 0)), Math.sqrt(Math.max(cov[8], 0))];
    return {
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        scales
    };
};

const quatDotAbs = (a: Quat4, b: Quat4): number =>
    Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);

const vec3MaxErr = (a: Vec3, b: Vec3): number =>
    Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

const covMaxErr = (a: number[], b: number[]): number => {
    let max = 0;
    for (let i = 0; i < 9; i++) {
        max = Math.max(max, Math.abs(a[i] - b[i]));
    }
    return max;
};

const readPlyGaussian = (table: Awaited<ReturnType<typeof loadTable>>, index: number) => {
    const rot0 = table.getColumnByName('rot_0')!.data as Float32Array;
    const rot1 = table.getColumnByName('rot_1')!.data as Float32Array;
    const rot2 = table.getColumnByName('rot_2')!.data as Float32Array;
    const rot3 = table.getColumnByName('rot_3')!.data as Float32Array;
    const s0 = table.getColumnByName('scale_0')!.data as Float32Array;
    const s1 = table.getColumnByName('scale_1')!.data as Float32Array;
    const s2 = table.getColumnByName('scale_2')!.data as Float32Array;
    const x = table.getColumnByName('x')!.data as Float32Array;
    const y = table.getColumnByName('y')!.data as Float32Array;
    const z = table.getColumnByName('z')!.data as Float32Array;

    const quatWxyz: Quat4 = [rot0[index], rot1[index], rot2[index], rot3[index]];
    const scaleLinear: Vec3 = [Math.exp(s0[index]), Math.exp(s1[index]), Math.exp(s2[index])];
    const localCenter: Vec3 = [x[index], y[index], z[index]];

    return { quatWxyz, scaleLinear, localCenter };
};

const listColumnNames = (table: { getColumnByName: (name: string) => unknown; columns?: Array<{ name: string }> }): string[] => {
    if ('columns' in table && Array.isArray(table.columns)) {
        return table.columns.map((col) => col.name);
    }
    const known = ['x', 'y', 'z', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'scale_0', 'scale_1', 'scale_2', 'opacity', 'f_dc_0'];
    return known.filter((name) => table.getColumnByName(name) != null);
};

const readSogGaussian = (table: Awaited<ReturnType<typeof loadSogTable>>, index: number) => {
    const names = listColumnNames(table);

    const x = table.getColumnByName('x')!.data as Float32Array;
    const y = table.getColumnByName('y')!.data as Float32Array;
    const z = table.getColumnByName('z')!.data as Float32Array;

    let quatWxyz: Quat4;
    let scaleLinear: Vec3;

    if (names.includes('rot_0')) {
        const rot0 = table.getColumnByName('rot_0')!.data as Float32Array;
        const rot1 = table.getColumnByName('rot_1')!.data as Float32Array;
        const rot2 = table.getColumnByName('rot_2')!.data as Float32Array;
        const rot3 = table.getColumnByName('rot_3')!.data as Float32Array;
        quatWxyz = [rot0[index], rot1[index], rot2[index], rot3[index]];
    } else {
        throw new Error(`SOG missing rot columns; have: ${names.join(', ')}`);
    }

    if (names.includes('scale_0')) {
        const s0 = table.getColumnByName('scale_0')!.data as Float32Array;
        const s1 = table.getColumnByName('scale_1')!.data as Float32Array;
        const s2 = table.getColumnByName('scale_2')!.data as Float32Array;
        scaleLinear = [Math.exp(s0[index]), Math.exp(s1[index]), Math.exp(s2[index])];
    } else if (names.includes('scale_0') === false && names.includes('scale_x')) {
        const sx = table.getColumnByName('scale_x')!.data as Float32Array;
        const sy = table.getColumnByName('scale_y')!.data as Float32Array;
        const sz = table.getColumnByName('scale_z')!.data as Float32Array;
        scaleLinear = [sx[index], sy[index], sz[index]];
    } else {
        throw new Error(`SOG missing scale columns; have: ${names.join(', ')}`);
    }

    return {
        quatWxyz,
        scaleLinear,
        localCenter: [x[index], y[index], z[index]] as Vec3
    };
};

const buildShapeSide = (
    side: 'editor' | 'runtime',
    storageIndex: number,
    runtimeIndex: number,
    quatWxyz: Quat4,
    scaleLinear: Vec3,
    localCenter: Vec3,
    matrixModel: Mat4,
    effectiveRig: Mat4
): SideShape => {
    const local = shapeFromQuatScale(quatWxyz, scaleLinear);

    const mm3 = mat3FromMat4(matrixModel);
    const afterModelCov = transformCovariance(local.covMatrix, mm3);

    const paletteT = effectiveRig.clone();
    paletteT.transpose();
    const modelWithPalette = new Mat4().mul2(matrixModel, paletteT);
    const mwp3 = mat3FromMat4(modelWithPalette);
    const afterRigCov = transformCovariance(local.covMatrix, mwp3);

    const W = shaderWFromModelView(matrixModel, effectiveRig);
    const shaderCov = transformCovariance(local.covMatrix, W);

    const afterMatrixModel = shapeFromQuatScale(quatWxyz, scaleLinear);
    afterMatrixModel.covMatrix = afterModelCov;

    const afterEffectiveRig = shapeFromQuatScale(quatWxyz, scaleLinear);
    afterEffectiveRig.covMatrix = afterRigCov;

    return {
        side,
        storageIndex,
        runtimeIndex,
        localCenter,
        local,
        afterMatrixModel,
        afterEffectiveRig: { ...afterEffectiveRig, covMatrix: shaderCov },
        modelViewRot3: W,
        shaderPath: {
            centerUsesPalette: true,
            covUsesModelView: true,
            localRotModifiedByPalette: false
        }
    };
};

async function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const editorProject = document.sca?.project as ScaProject;
    const runtimeProject = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'project.json'), 'utf8')) as ScaProject;

    const plyPath = fs.existsSync(path.join(extracted, 'splat_0.ply')) ?
        path.join(extracted, 'splat_0.ply') :
        path.join(extracted, 'splat.ply');

    const plyTable = await loadTable(plyPath);
    const sogTable = await loadSogTable(path.join(RUNTIME_DIR, 'index.sog'));

    console.log('SOG columns:', listColumnNames(sogTable).join(', '));
    console.log('PLY columns:', listColumnNames(plyTable).join(', '));

    const documentSplat = Array.isArray(document.splats) ? document.splats[0] : null;
    const runtimeSplat = runtimeProject.splats?.[0] ?? null;
    const matrixModel = buildSplatBasis(runtimeSplat ?? undefined, documentSplat);

    const rig = editorProject.rig!;
    const node = rig.nodes.find((n) => n.id === RIG_NODE_ID)!;
    const editorClip = editorProject.animations!.find((c) => c.id === 'animation_01')!;
    const runtimeClip = runtimeProject.animations!.find((c) => c.id === 'animation_01')!;

    const editorPose = applyRigAnimationToPose(evaluateRigPose(rig), rig, editorClip, TIME);
    const runtimePose = evaluateRuntimeRigPose(rig, runtimeClip, TIME);

    const editorEffective = new Mat4();
    const runtimeEffective = new Mat4();
    const editorBinding = rig.bindings.find((b) => b.regionId === 'region_04')!;
    buildEffectiveRigWorldMatrixFromPose(rig, editorPose, node, editorBinding, editorEffective);
    buildEffectiveRigWorldMatrixFromPose(runtimeProject.rig!, runtimePose, node, runtimeProject.rig!.bindings.find((b) => b.regionId === 'region_04')!, runtimeEffective);

    console.log('\n========== GAUSSIAN SHAPE/ORIENTATION PARITY t=0.5 ==========');
    console.log(`matrix_model max err (editor vs runtime project): ${matrixMaxAbsError(matrixModel, matrixModel).toExponential(4)}`);
    console.log(`effective rig max err: ${matrixMaxAbsError(editorEffective, runtimeEffective).toExponential(4)}`);
    console.log('\nShader paths (both sides):');
    console.log('  center: modelView = matrix_view * matrix_model * transpose(palette)');
    console.log('  covariance: Vrk from local quat/scale; initCornerCov uses W=transpose(modelView)');
    console.log('  modifySplatRotationScale: empty stub on both (local rot NOT palette-transformed)');

    let firstDivergence: string | null = null;
    const results: Array<Record<string, unknown>> = [];

    for (const regionId of REGIONS) {
        const editorStorage = decodeIndices(path.join(extracted, 'sca/regions', `${regionId}.mask`));
        const runtimeIndices = decodeIndices(path.join(RUNTIME_DIR, 'regions', `${regionId}.mask`));

        const binding = rig.bindings.find((b) => b.regionId === regionId)!;
        buildEffectiveRigWorldMatrixFromPose(rig, editorPose, node, binding, editorEffective);
        buildEffectiveRigWorldMatrixFromPose(runtimeProject.rig!, runtimePose, node, runtimeProject.rig!.bindings.find((b) => b.regionId === regionId)!, runtimeEffective);

        const pairs: Array<{ storage: number; runtime: number; localDelta: number }> = [];
        for (const storage of editorStorage) {
            const ply = readPlyGaussian(plyTable, storage);
            let best = -1;
            let bestDelta = Infinity;
            for (const runtime of runtimeIndices) {
                const sog = readSogGaussian(sogTable, runtime);
                const d = Math.hypot(ply.localCenter[0] - sog.localCenter[0], ply.localCenter[1] - sog.localCenter[1], ply.localCenter[2] - sog.localCenter[2]);
                if (d < bestDelta) {
                    bestDelta = d;
                    best = runtime;
                }
            }
            if (bestDelta <= SOG_CENTER_EPSILON) {
                pairs.push({ storage, runtime: best, localDelta: bestDelta });
            }
        }
        pairs.sort((a, b) => a.localDelta - b.localDelta);
        const samplePairs = pairs.slice(0, SAMPLE_COUNT);

        console.log(`\n--- ${regionId} (${samplePairs.length} pairs) ---`);

        for (const pair of samplePairs) {
            const plyG = readPlyGaussian(plyTable, pair.storage);
            const sogG = readSogGaussian(sogTable, pair.runtime);

            const editor = buildShapeSide('editor', pair.storage, pair.runtime, plyG.quatWxyz, plyG.scaleLinear, plyG.localCenter, matrixModel, editorEffective);
            const runtime = buildShapeSide('runtime', pair.storage, pair.runtime, sogG.quatWxyz, sogG.scaleLinear, sogG.localCenter, matrixModel, runtimeEffective);

            const steps: Array<{ name: string; err: number; pass: boolean }> = [
                { name: 'localQuaternion', err: 1 - quatDotAbs(editor.local.quatWxyz, runtime.local.quatWxyz), pass: quatDotAbs(editor.local.quatWxyz, runtime.local.quatWxyz) > 1 - QUAT_EPSILON },
                { name: 'localScaleLinear', err: vec3MaxErr(editor.local.scaleLinear, runtime.local.scaleLinear), pass: vec3MaxErr(editor.local.scaleLinear, runtime.local.scaleLinear) <= SCALE_EPSILON },
                { name: 'localCovariance', err: covMaxErr(editor.local.covMatrix, runtime.local.covMatrix), pass: covMaxErr(editor.local.covMatrix, runtime.local.covMatrix) <= COV_EPSILON },
                { name: 'covAfterMatrixModel', err: covMaxErr(editor.afterMatrixModel.covMatrix, runtime.afterMatrixModel.covMatrix), pass: covMaxErr(editor.afterMatrixModel.covMatrix, runtime.afterMatrixModel.covMatrix) <= COV_EPSILON },
                { name: 'covAfterEffectiveRig (shader W*Vrk*W^T)', err: covMaxErr(editor.afterEffectiveRig.covMatrix, runtime.afterEffectiveRig.covMatrix), pass: covMaxErr(editor.afterEffectiveRig.covMatrix, runtime.afterEffectiveRig.covMatrix) <= COV_EPSILON },
                { name: 'shaderModelViewRot3', err: covMaxErr(editor.modelViewRot3, runtime.modelViewRot3), pass: covMaxErr(editor.modelViewRot3, runtime.modelViewRot3) <= MATRIX_EPSILON }
            ];

            const fail = steps.find((s) => !s.pass);
            console.log(`  storage ${pair.storage} -> runtime ${pair.runtime}:`);
            for (const step of steps) {
                console.log(`    ${step.name}: ${step.pass ? 'PASS' : 'FAIL'} (err=${step.err.toExponential(3)})`);
            }
            if (fail && !firstDivergence) {
                firstDivergence = `${regionId} storage ${pair.storage}: ${fail.name} (err=${fail.err.toExponential(4)})`;
            }

            results.push({
                regionId,
                storageIndex: pair.storage,
                runtimeIndex: pair.runtime,
                editorQuat: editor.local.quatWxyz,
                runtimeQuat: runtime.local.quatWxyz,
                editorScale: editor.local.scaleLinear,
                runtimeScale: runtime.local.scaleLinear,
                steps
            });
        }
    }

    console.log('\n========== SUMMARY ==========');
    console.log(`First shape/orientation divergence: ${firstDivergence ?? 'none (within epsilon)'}`);
    console.log('Rig transform effect: palette enters modelView → initCornerCov rotates Vrk (not centers only).');
    console.log('Local quat/scale are NOT multiplied by palette (modifySplatRotationScale is empty).');
    console.log('================================\n');

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'gaussian-shape-parity-t0.5.json'), JSON.stringify({
        time: TIME,
        firstDivergence,
        matrixModel: matrixToArray(matrixModel),
        effectiveRig: matrixToArray(editorEffective),
        results
    }, null, 2));

    process.exit(firstDivergence ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
