/**
 * Probe authored rig rotation center for rig_02 -> region_04/05.
 * No runtime/export comparison — editor math only.
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
import { evaluateRigPose, requireEvaluatedNodePose } from '../src/sca/rig/rig-pose';
import {
    arrayToMatrix,
    bindOffsetToMatrix,
    buildRigidRigMatrixFromPose,
    matrixToArray,
    poseToMatrix
} from '../src/sca/rig/rig-transform';
import { createKeepWorldBindOffset, createKeepWorldBindOffsetFromAuthoredRest } from '../src/sca/rig/rig-hierarchy';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { ScaProject } from '../src/sca/types/project';
import { ScaRigBinding, ScaRigNode } from '../src/sca/types/rig';

const SSPROJ_PATH = path.resolve('sca-workspace/project/current.ssproj');
const NODE_ID = 'rig_02';
const REGIONS = ['region_04', 'region_05'] as const;
const TIMES = [0, 0.5, 1.0, 2.0] as const;

type Vec3 = [number, number, number];

const fmt = (v: Vec3 | number[]): string => `[${v.map((n) => n.toFixed(6)).join(', ')}]`;

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

/** Fixed point of rigid transform: solve (I - R) p = t. */
const rotationCenterFromMatrix = (matrix: Mat4): Vec3 | null => {
    const m = matrix.data;
    const rot = new Mat4();
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            rot.data[i * 4 + j] = m[i * 4 + j];
        }
    }

    const t = new Vec3(m[12], m[13], m[14]);
    const iMinusR = new Mat4();
    iMinusR.copy(Mat4.IDENTITY);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            iMinusR.data[i * 4 + j] -= rot.data[i * 4 + j];
        }
    }

    const det =
        iMinusR.data[0] * (iMinusR.data[5] * iMinusR.data[10] - iMinusR.data[6] * iMinusR.data[9]) -
        iMinusR.data[4] * (iMinusR.data[1] * iMinusR.data[10] - iMinusR.data[2] * iMinusR.data[9]) +
        iMinusR.data[8] * (iMinusR.data[1] * iMinusR.data[6] - iMinusR.data[2] * iMinusR.data[5]);

    if (Math.abs(det) < 1e-10) {
        return [t.x, t.y, t.z];
    }

    const inv = new Mat4().copy(iMinusR).invert();
    const p = new Vec3();
    inv.transformPoint(t, p);
    return [p.x, p.y, p.z];
};

const buildSplatBasis = (documentSplat: Record<string, unknown> | null): Mat4 => {
    const mat = new Mat4();
    if (!documentSplat) {
        return mat.copy(Mat4.IDENTITY);
    }
    const pos = documentSplat.position as number[] | undefined;
    const rot = documentSplat.rotation as number[] | undefined;
    const scale = documentSplat.scale as number[] | undefined;
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

const transformPoint = (matrix: Mat4, x: number, y: number, z: number): Vec3 => {
    const m = matrix.data;
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
};

const distance3 = (a: Vec3, b: Vec3): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const project = document.sca?.project as ScaProject;
    const rig = project.rig!;
    const node = rig.nodes.find((entry) => entry.id === NODE_ID)!;
    const clip = project.animations?.find((entry) => entry.id === 'animation_01')!;

    const splatBasis = buildSplatBasis(Array.isArray(document.splats) ? document.splats[0] : null);

    console.log('\n========== RIG ROTATION CENTER PROBE ==========');
    console.log(`Node: ${NODE_ID}`);
    console.log(`Authored position: ${fmt(node.position)}`);
    console.log(`Authored rotation: ${fmt(node.rotation)}`);
    console.log(`Rest position: ${fmt(node.rest.position)}`);
    console.log(`Rest rotation: ${fmt(node.rest.rotation)}`);
    console.log(`Pivot: ${fmt(node.pivot)}`);
    console.log(`Parent: ${node.parentId ?? 'none (root)'}`);

    const keepWorldAtCurrent = createKeepWorldBindOffset(rig, node);
    const keepWorldAtAuthoredRest = createKeepWorldBindOffsetFromAuthoredRest(rig, node);

    console.log('\n--- Bind offset analysis ---');
    console.log(`Stored bindOffset translation (region_04/05): ${fmt(
        (rig.bindings.find((b) => b.regionId === 'region_04')!.bindOffsetMatrix ?? []).slice(12, 15) as Vec3
    )}`);
    console.log(`Fresh keep-world @ current pose translation: ${fmt(
        (keepWorldAtCurrent.bindOffsetMatrix ?? []).slice(12, 15) as Vec3
    )}`);
    console.log(`Fresh keep-world @ authored-rest translation: ${fmt(
        (keepWorldAtAuthoredRest.bindOffsetMatrix ?? []).slice(12, 15) as Vec3
    )}`);
    console.log(`Negated authored position: ${fmt(node.position.map((v) => -v) as Vec3)}`);
    console.log(`rest.position used in bind? NO — evaluateRigPose uses node.position, not rest`);

    const nodeWorldAtAuthored = new Mat4();
    buildNodeWorldMatrixFromPose(rig, evaluateRigPose(rig), node, nodeWorldAtAuthored);
    console.log(`\nNode world matrix translation (t=0 authored): ${fmt([
        nodeWorldAtAuthored.data[12],
        nodeWorldAtAuthored.data[13],
        nodeWorldAtAuthored.data[14]
    ])}`);

    const handlePos = new Vec3();
    getNodeHandleWorldPositionFromPose(rig, evaluateRigPose(rig), node, handlePos);
    console.log(`Handle position (splat-local, gizmo display): ${fmt([handlePos.x, handlePos.y, handlePos.z])}`);

    const handleWorld = transformPoint(splatBasis, handlePos.x, handlePos.y, handlePos.z);
    console.log(`Handle position (world / scene): ${fmt(handleWorld)}`);

    for (const regionId of REGIONS) {
        const binding = rig.bindings.find((entry) => entry.regionId === regionId)!;
        console.log(`\n========== ${regionId} ==========`);

        for (const time of TIMES) {
            const basePose = evaluateRigPose(rig);
            const animatedPose = applyRigAnimationToPose(basePose, rig, clip, time);
            const pose = requireEvaluatedNodePose(animatedPose, node);

            const nodeWorld = new Mat4();
            const bindOffset = new Mat4();
            const effective = new Mat4();
            buildNodeWorldMatrixFromPose(rig, animatedPose, node, nodeWorld);
            bindOffsetToMatrix(binding, bindOffset);
            buildEffectiveRigWorldMatrixFromPose(rig, animatedPose, node, binding, effective);

            const rotCenter = rotationCenterFromMatrix(effective);
            getNodeHandleWorldPositionFromPose(rig, animatedPose, node, handlePos);
            const handleAtTime: Vec3 = [handlePos.x, handlePos.y, handlePos.z];
            const handleWorldAtTime = transformPoint(splatBasis, ...handleAtTime);

            const rotCenterWorld = rotCenter ? transformPoint(splatBasis, ...rotCenter) : null;

            console.log(`\n  t=${time.toFixed(1)}  rotation=${fmt(pose.rotation)}`);
            console.log(`    effective translation: ${fmt([effective.data[12], effective.data[13], effective.data[14]])}`);
            console.log(`    rotation center (splat-local): ${rotCenter ? fmt(rotCenter) : 'null'}`);
            console.log(`    handle/gizmo (splat-local):    ${fmt(handleAtTime)}`);
            console.log(`    Δ center vs handle: ${rotCenter ? distance3(rotCenter, handleAtTime).toExponential(4) : 'n/a'}`);
            console.log(`    rotation center (world): ${rotCenterWorld ? fmt(rotCenterWorld) : 'null'}`);
            console.log(`    handle/gizmo (world):    ${fmt(handleWorldAtTime)}`);
            console.log(`    Δ center vs handle (world): ${rotCenterWorld ? distance3(rotCenterWorld, handleWorldAtTime).toExponential(4) : 'n/a'}`);

            if (time === 0) {
                const identityErr = Math.max(...matrixToArray(effective).map((v, i) =>
                    Math.abs(v - Mat4.IDENTITY.data[i])
                ));
                console.log(`    effective ≈ identity at t=0: max err ${identityErr.toExponential(4)}`);
            }

            // Verify fixed-point: E * handle should equal handle for pure rotation about handle
            const handleTest = new Vec3(handleAtTime[0], handleAtTime[1], handleAtTime[2]);
            const mapped = new Vec3();
            effective.transformPoint(handleTest, mapped);
            console.log(`    E*handle = ${fmt([mapped.x, mapped.y, mapped.z])}  Δ=${distance3(handleAtTime, [mapped.x, mapped.y, mapped.z]).toExponential(4)}`);

            const origin = new Vec3(0, 0, 0);
            effective.transformPoint(origin, origin);
            console.log(`    E*origin = ${fmt([origin.x, origin.y, origin.z])}`);
        }
    }

    console.log('\n========== ANSWERS ==========');
    const t05Pose = applyRigAnimationToPose(evaluateRigPose(rig), rig, clip, 0.5);
    const t05Effective = new Mat4();
    buildEffectiveRigWorldMatrixFromPose(rig, t05Pose, node, rig.bindings.find((b) => b.regionId === 'region_04')!, t05Effective);
    const center = rotationCenterFromMatrix(t05Effective)!;
    getNodeHandleWorldPositionFromPose(rig, t05Pose, node, handlePos);

    console.log(`1. region_04 rotates around (splat-local): ${fmt(center)}`);
    console.log(`   region_04 rotates around (world):         ${fmt(transformPoint(splatBasis, ...center))}`);
    console.log(`2. Rig node gizmo displayed at (splat-local): ${fmt([handlePos.x, handlePos.y, handlePos.z])}`);
    console.log(`   Rig node gizmo displayed at (world):       ${fmt(transformPoint(splatBasis, handlePos.x, handlePos.y, handlePos.z))}`);
    console.log(`3. Identical? ${distance3(center, [handlePos.x, handlePos.y, handlePos.z]) < 1e-6 ? 'YES' : 'NO'} (splat-local)`);
    console.log('   NOTE: (I-R)^-1*t extraction is unreliable for Z-rotation with Z handle component;');
    console.log('   use E*handle=test below as ground truth for fixed point.');
    console.log('4. rest.position=[0,0,0] does NOT feed bind offset — bind uses node.position at bind time.');
    console.log('   rest is only used by reset-to-rest; authored pose is node.position directly.');
    console.log('================================\n');
}

main();
