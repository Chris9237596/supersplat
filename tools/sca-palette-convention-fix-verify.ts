/**
 * Verify palette convention fix: shaderAppliedMatrix × pivot == pivot.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Mat4, Quat, Vec3 } from 'playcanvas';

import { applyRigAnimationToPose } from '../src/sca/rig/rig-animation';
import { buildEffectiveRigWorldMatrixFromPose, getNodeHandleWorldPositionFromPose } from '../src/sca/rig/rig-hierarchy';
import { applyPaletteToLocalCenter } from '../src/sca/rig/rig-gaussian-trace';
import { evaluateRigPose } from '../src/sca/rig/rig-pose';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject, ScaRuntimeSplatRef } from '../src/sca/types/project';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const REPORT_PATH = path.join(ROOT, 'compare/reports/palette-convention-fix-verify.json');

const NODE_ID = 'rig_02';
const BINDING_REGION = 'region_04';
const AUTHORED_PIVOT: [number, number, number] = [0.043530, -0.176535, 0.625845];
const TIMES = [0, 0.5, 1.0, 2.0] as const;
const GAUSSIAN_SAMPLES = [75094, 75682, 75916, 76856, 76902];

type Vec3 = [number, number, number];

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

const buildMatrixModel = (splat: ScaRuntimeSplatRef | Record<string, unknown> | null | undefined): Mat4 => {
    const mat = new Mat4();
    if (!splat) {
        return mat.copy(Mat4.IDENTITY);
    }
    const pos = (splat as ScaRuntimeSplatRef).position as number[] | undefined;
    const rot = (splat as ScaRuntimeSplatRef).rotation as number[] | undefined;
    const scale = (splat as ScaRuntimeSplatRef).scale as number[] | undefined;
    if (!pos || !rot) {
        return mat.copy(Mat4.IDENTITY);
    }
    const quat = new Quat();
    if (rot.length === 4) {
        quat.set(rot[0], rot[1], rot[2], rot[3]);
    } else {
        quat.setFromEulerAngles(rot[0], rot[1], rot[2]);
    }
    return mat.setTRS(
        new Vec3(pos[0], pos[1], pos[2]),
        quat,
        scale ? new Vec3(scale[0], scale[1], scale[2]) : Vec3.ONE
    );
};

const transformPoint = (m: Mat4, p: Vec3): Vec3 => {
    const d = m.data;
    return [
        d[0] * p[0] + d[4] * p[1] + d[8] * p[2] + d[12],
        d[1] * p[0] + d[5] * p[1] + d[9] * p[2] + d[13],
        d[2] * p[0] + d[6] * p[1] + d[10] * p[2] + d[14]
    ];
};

const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const applyPaletteOld = (palette: Mat4, local: Vec3): Vec3 => {
    const m = new Mat4().copy(palette).transpose();
    return transformPoint(m, local);
};

const applyPaletteNew = (palette: Mat4, local: Vec3): Vec3 =>
    applyPaletteToLocalCenter(palette, local);

async function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const project = document.sca?.project as ScaProject;

    const rig = project.rig!;
    const node = rig.nodes.find((n) => n.id === NODE_ID)!;
    const binding = rig.bindings.find((b) => b.regionId === BINDING_REGION && b.nodeId === NODE_ID)!;
    const clip = project.animations?.find((a) => a.id === 'animation_01')! as ScaAnimationClip;

    const matrixModel = buildMatrixModel(Array.isArray(document.splats) ? document.splats[0] : null);

    const pivotResults = TIMES.map((time) => {
        const pose = applyRigAnimationToPose(evaluateRigPose(rig), rig, clip, time);
        const effective = new Mat4();
        buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, effective);

        const handle = new Vec3();
        getNodeHandleWorldPositionFromPose(rig, pose, node, handle);
        const handleWorld = transformPoint(matrixModel, [handle.x, handle.y, handle.z]);

        const oldLocal = applyPaletteOld(effective, AUTHORED_PIVOT);
        const newLocal = applyPaletteNew(effective, AUTHORED_PIVOT);
        const oldWorld = transformPoint(matrixModel, oldLocal);
        const newWorld = transformPoint(matrixModel, newLocal);

        return {
            time,
            handleWorld,
            oldPaletteLocalError: distance3(AUTHORED_PIVOT, oldLocal),
            newPaletteLocalError: distance3(AUTHORED_PIVOT, newLocal),
            oldShaderPivotWorldDrift: distance3(handleWorld, oldWorld),
            newShaderPivotWorldDrift: distance3(handleWorld, newWorld)
        };
    });

    const {
        MemoryReadFileSystem,
        createChunkDataPool,
        getInputFormat,
        materializeToDataTable,
        readFile
    } = await import('@playcanvas/splat-transform');

    const plyPath = fs.existsSync(path.join(extracted, 'splat_0.ply')) ?
        path.join(extracted, 'splat_0.ply') :
        path.join(extracted, 'splats/splat_0.ply');
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
    const x = table.getColumnByName('x').data as Float32Array;
    const y = table.getColumnByName('y').data as Float32Array;
    const z = table.getColumnByName('z').data as Float32Array;

    const gaussianSamples: Array<{
        storageIndex: number;
        time: number;
        localCenter: Vec3;
        oldWorld: Vec3;
        newWorld: Vec3;
        worldDelta: number;
    }> = [];

    for (const time of [0.5, 1.0]) {
        const pose = applyRigAnimationToPose(evaluateRigPose(rig), rig, clip, time);
        const effective = new Mat4();
        buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, effective);

        for (const storageIndex of GAUSSIAN_SAMPLES) {
            const localCenter: Vec3 = [x[storageIndex], y[storageIndex], z[storageIndex]];
            const oldWorld = transformPoint(matrixModel, applyPaletteOld(effective, localCenter));
            const newWorld = transformPoint(matrixModel, applyPaletteNew(effective, localCenter));
            gaussianSamples.push({
                storageIndex,
                time,
                localCenter,
                oldWorld,
                newWorld,
                worldDelta: distance3(oldWorld, newWorld)
            });
        }
    }

    const report = {
        conventionChange: {
            before: 'shader: model * transpose(t)',
            after: 'shader: model * t (palette row packing assigns GLSL mat4 columns; matches CPU effectiveRigMatrix)',
            files: [
                'src/shaders/splat-shader.ts',
                'src/shaders/splat-overlay-shader.ts',
                'src/sca/runtime/runtime-rig-viewer-host.ts',
                'src/sca/rig/rig-gaussian-trace.ts'
            ]
        },
        pivotFixedRequirement: pivotResults.every((r) => r.newPaletteLocalError < 1e-4),
        pivotResults,
        gaussianSamples
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log('========== PALETTE CONVENTION FIX VERIFY ==========\n');
    console.log(`OLD: ${report.conventionChange.before}`);
    console.log(`NEW: ${report.conventionChange.after}`);
    console.log(`\nPivot fixed (all times): ${report.pivotFixedRequirement ? 'PASS' : 'FAIL'}`);
    console.log('\nt\toldLocalErr\tnewLocalErr\toldWorldDrift\tnewWorldDrift');
    for (const r of pivotResults) {
        console.log(
            `${r.time}\t${r.oldPaletteLocalError.toFixed(6)}\t${r.newPaletteLocalError.toExponential(2)}\t` +
            `${r.oldShaderPivotWorldDrift.toFixed(4)}m\t${r.newShaderPivotWorldDrift.toExponential(2)}m`
        );
    }

    console.log('\nGaussian samples (region_04/05 indices, t=0.5/1.0):');
    for (const g of gaussianSamples) {
        console.log(`  idx ${g.storageIndex} t=${g.time}: world Δ=${g.worldDelta.toFixed(4)}m (old vs new shader path)`);
    }

    console.log(`\nReport: ${REPORT_PATH}`);
    console.log('===================================================\n');

    if (!report.pivotFixedRequirement) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
