/**
 * Live playback state parity: simulates editor vs runtime play/apply/render paths.
 * Inputs:
 *   sca-workspace/project/current.ssproj
 *   sca-workspace/runtime/latest/project.json
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Mat4 } from 'playcanvas';

import { applyRegionAnimationOverrides } from '../src/sca/animation/region-animation-presentation';
import { buildEffectiveRigWorldMatrixFromPose } from '../src/sca/rig/rig-hierarchy';
import {
    evaluateFinalRigPose,
    requireEvaluatedNodePose,
    setAnimationPlaybackState
} from '../src/sca/rig/rig-pose';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import { matrixToArray } from '../src/sca/rig/rig-transform';
import { ScaAnimationClip, ScaAnimationPlaybackState } from '../src/sca/types/animation';
import { ScaProject } from '../src/sca/types/project';
import { ScaRig, ScaRigBinding, ScaRigNode, ScaRigVec3 } from '../src/sca/types/rig';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_PROJECT_PATH = path.join(ROOT, 'runtime/latest/project.json');
const REPORT_DIR = path.join(ROOT, 'compare/reports');

const ANIMATION_CLIP_ID = 'animation_01';
const TARGET_NODE_ID = 'rig_02';
const TARGET_REGION_ID = 'region_04';
const FRAME_DELTA_SEC = 1 / 60;
const MATRIX_EPSILON = 1e-4;
const POSE_EPSILON = 1e-4;
const TIME_EPSILON = 1e-4;

type Vec3 = ScaRigVec3;

type MilestoneId =
    | 'play_start'
    | 'first_rendered_frame'
    | 't_0_25'
    | 't_0_5'
    | 'animation_end';

type LivePlaybackSnapshot = {
    side: 'editor' | 'runtime';
    milestone: MilestoneId;
    activeClipId: string | null;
    currentTime: number;
    playing: boolean;
    evaluatedRotation: Vec3;
    effectiveRigMatrix: number[];
    paletteMatrix: number[];
    paletteIndex: number;
    renderRequested: boolean;
};

type MilestoneComparison = {
    milestone: MilestoneId;
    pass: boolean;
    editor: LivePlaybackSnapshot;
    runtime: LivePlaybackSnapshot;
    firstDivergence: string | null;
};

class MockPalette {
    private matrices = new Map<number, Float32Array>();

    setTransform(index: number, matrix: Mat4): void {
        this.matrices.set(index, matrix.clone().data.slice() as Float32Array);
    }

    getTransform(index: number): number[] {
        const data = this.matrices.get(index);
        if (!data) {
            throw new Error(`palette index ${index} was never uploaded`);
        }
        return [...data];
    }

    wasUploaded(index: number): boolean {
        return this.matrices.has(index);
    }
}

const matrixMaxAbsError = (left: number[], right: number[]): number => {
    let max = 0;
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
        max = Math.max(max, Math.abs(left[i] - right[i]));
    }
    return max;
};

const vec3MaxAbsError = (left: Vec3, right: Vec3): number => {
    return Math.max(
        Math.abs(left[0] - right[0]),
        Math.abs(left[1] - right[1]),
        Math.abs(left[2] - right[2])
    );
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

const resolvePaletteIndex = (
    rig: ScaRig,
    regionIdsWithMask: Set<string>,
    nodeId: string,
    regionId: string
): number | null => {
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
};

const findBinding = (rig: ScaRig, nodeId: string, regionId: string): ScaRigBinding | null => {
    return rig.bindings.find((entry) => entry.regionId === regionId && entry.nodeId === nodeId) ??
        rig.bindings.find((entry) => entry.regionId === regionId) ??
        null;
};

const findNode = (rig: ScaRig, nodeId: string): ScaRigNode | null => {
    return rig.nodes.find((entry) => entry.id === nodeId) ?? null;
};

const clonePlaybackState = (
    clip: ScaAnimationClip,
    currentTime: number,
    playing: boolean
): ScaAnimationPlaybackState => ({
    activeClipId: clip.id,
    clip: structuredClone(clip),
    playing,
    previewActive: true,
    currentTime,
    selectedTrackId: null,
    selectedKeyframeId: null,
    editMode: false
});

const simulateEditorApply = (
    milestone: MilestoneId,
    rig: ScaRig,
    playback: ScaAnimationPlaybackState,
    node: ScaRigNode,
    binding: ScaRigBinding,
    paletteIndex: number,
    palette: MockPalette
): LivePlaybackSnapshot => {
    setAnimationPlaybackState(structuredClone(playback));
    applyRegionAnimationOverrides(playback.clip, playback.currentTime, playback.previewActive);

    const pose = evaluateFinalRigPose(rig);
    const evaluated = requireEvaluatedNodePose(pose, node);
    const effective = new Mat4();
    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, effective);
    palette.setTransform(paletteIndex, effective);

    return {
        side: 'editor',
        milestone,
        activeClipId: playback.activeClipId,
        currentTime: playback.currentTime,
        playing: playback.playing,
        evaluatedRotation: [...evaluated.rotation],
        effectiveRigMatrix: matrixToArray(effective),
        paletteMatrix: palette.getTransform(paletteIndex),
        paletteIndex,
        renderRequested: true
    };
};

const simulateRuntimeApply = (
    milestone: MilestoneId,
    rig: ScaRig,
    clip: ScaAnimationClip,
    clipId: string,
    currentTime: number,
    playing: boolean,
    node: ScaRigNode,
    binding: ScaRigBinding,
    paletteIndex: number,
    palette: MockPalette
): LivePlaybackSnapshot => {
    applyRegionAnimationOverrides(clip, currentTime, true);
    const pose = evaluateRuntimeRigPose(rig, clip, currentTime);
    const evaluated = requireEvaluatedNodePose(pose, node);
    const effective = new Mat4();
    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, effective);
    palette.setTransform(paletteIndex, effective);

    return {
        side: 'runtime',
        milestone,
        activeClipId: clipId,
        currentTime,
        playing,
        evaluatedRotation: [...evaluated.rotation],
        effectiveRigMatrix: matrixToArray(effective),
        paletteMatrix: palette.getTransform(paletteIndex),
        paletteIndex,
        renderRequested: true
    };
};

const compareSnapshots = (editor: LivePlaybackSnapshot, runtime: LivePlaybackSnapshot): string | null => {
    if (editor.activeClipId !== runtime.activeClipId) {
        return `activeClipId editor=${editor.activeClipId} runtime=${runtime.activeClipId}`;
    }

    if (Math.abs(editor.currentTime - runtime.currentTime) > TIME_EPSILON) {
        return `currentTime editor=${editor.currentTime} runtime=${runtime.currentTime}`;
    }

    if (editor.playing !== runtime.playing) {
        return `playing editor=${editor.playing} runtime=${runtime.playing}`;
    }

    const poseError = vec3MaxAbsError(editor.evaluatedRotation, runtime.evaluatedRotation);
    if (poseError > POSE_EPSILON) {
        return `evaluatedRotation max abs error ${poseError.toExponential(4)} > ${POSE_EPSILON}`;
    }

    const matrixError = matrixMaxAbsError(editor.effectiveRigMatrix, runtime.effectiveRigMatrix);
    if (matrixError > MATRIX_EPSILON) {
        return `effectiveRigMatrix max abs error ${matrixError.toExponential(4)} > ${MATRIX_EPSILON}`;
    }

    const paletteError = matrixMaxAbsError(editor.paletteMatrix, runtime.paletteMatrix);
    if (paletteError > MATRIX_EPSILON) {
        return `paletteMatrix max abs error ${paletteError.toExponential(4)} > ${MATRIX_EPSILON}`;
    }

    if (editor.paletteIndex !== runtime.paletteIndex) {
        return `paletteIndex editor=${editor.paletteIndex} runtime=${runtime.paletteIndex}`;
    }

    if (editor.renderRequested !== runtime.renderRequested) {
        return `renderRequested editor=${editor.renderRequested} runtime=${runtime.renderRequested}`;
    }

    return null;
};

const buildMilestonePlan = (duration: number): Array<{ id: MilestoneId; editorTime: number; runtimeTime: number; playing: boolean }> => {
    return [
        { id: 'play_start', editorTime: 0, runtimeTime: 0, playing: true },
        { id: 'first_rendered_frame', editorTime: FRAME_DELTA_SEC, runtimeTime: FRAME_DELTA_SEC, playing: true },
        { id: 't_0_25', editorTime: 0.25, runtimeTime: 0.25, playing: true },
        { id: 't_0_5', editorTime: 0.5, runtimeTime: 0.5, playing: true },
        { id: 'animation_end', editorTime: duration, runtimeTime: duration, playing: false }
    ];
};

const fmtVec3 = (v: Vec3): string => `[${v.map((n) => n.toFixed(6)).join(', ')}]`;

function printSummary(report: Record<string, unknown>, reportPath: string): void {
    console.log('\n========== LIVE PLAYBACK PARITY ==========');
    console.log(`Target: ${ANIMATION_CLIP_ID} -> ${TARGET_NODE_ID} -> ${TARGET_REGION_ID}`);
    console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'}`);
    if (report.firstDivergence) {
        console.log('First divergence:', report.firstDivergence);
    }

    const comparisons = (report.milestones as MilestoneComparison[] | undefined) ?? [];
    for (const entry of comparisons) {
        console.log(`\n--- ${entry.milestone}: ${entry.pass ? 'PASS' : 'FAIL'} ---`);
        if (entry.firstDivergence) {
            console.log(`  Divergence: ${entry.firstDivergence}`);
        }
        console.log(`  editor: clip=${entry.editor.activeClipId} t=${entry.editor.currentTime.toFixed(6)} playing=${entry.editor.playing}`);
        console.log(`    rotation ${fmtVec3(entry.editor.evaluatedRotation)} palette=${entry.editor.paletteIndex} render=${entry.editor.renderRequested}`);
        console.log(`  runtime: clip=${entry.runtime.activeClipId} t=${entry.runtime.currentTime.toFixed(6)} playing=${entry.runtime.playing}`);
        console.log(`    rotation ${fmtVec3(entry.runtime.evaluatedRotation)} palette=${entry.runtime.paletteIndex} render=${entry.runtime.renderRequested}`);
    }

    console.log('Report:', reportPath);
    console.log('==========================================\n');
}

async function main() {
    const reportPath = path.join(REPORT_DIR, `live-playback-parity-${TARGET_NODE_ID}-${TARGET_REGION_ID}.json`);

    if (!fs.existsSync(SSPROJ_PATH)) {
        console.error(`missing editor project: ${SSPROJ_PATH}`);
        process.exit(1);
    }

    if (!fs.existsSync(RUNTIME_PROJECT_PATH)) {
        console.error(`missing runtime project: ${RUNTIME_PROJECT_PATH}`);
        process.exit(1);
    }

    const extracted = extractSsproj(SSPROJ_PATH);
    const document = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8'));
    const editorProject = document.sca?.project as ScaProject | undefined;
    const runtimeProject = JSON.parse(fs.readFileSync(RUNTIME_PROJECT_PATH, 'utf8')) as ScaProject;

    if (!editorProject?.rig || !runtimeProject.rig) {
        console.error('editor or runtime project missing rig block');
        process.exit(1);
    }

    const editorClip = editorProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    const runtimeClip = runtimeProject.animations?.find((entry) => entry.id === ANIMATION_CLIP_ID);
    if (!editorClip || !runtimeClip) {
        console.error(`${ANIMATION_CLIP_ID} missing from editor or runtime project`);
        process.exit(1);
    }

    const editorNode = findNode(editorProject.rig, TARGET_NODE_ID);
    const runtimeNode = findNode(runtimeProject.rig, TARGET_NODE_ID);
    const editorBinding = findBinding(editorProject.rig, TARGET_NODE_ID, TARGET_REGION_ID);
    const runtimeBinding = findBinding(runtimeProject.rig, TARGET_NODE_ID, TARGET_REGION_ID);

    if (!editorNode || !runtimeNode || !editorBinding || !runtimeBinding) {
        console.error('rig node or region binding missing for target');
        process.exit(1);
    }

    const editorRegionIds = new Set(
        (editorProject.regions ?? [])
            .filter((region) => fs.existsSync(path.join(extracted, 'sca/regions', `${region.id}.mask`)))
            .map((region) => region.id)
    );
    const runtimeRegionIds = new Set(
        (runtimeProject.regions ?? [])
            .filter((region) => fs.existsSync(path.join(ROOT, 'runtime/latest/regions', `${region.id}.mask`)))
            .map((region) => region.id)
    );

    const editorPaletteIndex = resolvePaletteIndex(editorProject.rig, editorRegionIds, TARGET_NODE_ID, TARGET_REGION_ID);
    const runtimePaletteIndex = resolvePaletteIndex(runtimeProject.rig, runtimeRegionIds, TARGET_NODE_ID, TARGET_REGION_ID);

    if (editorPaletteIndex === null || runtimePaletteIndex === null) {
        console.error('could not resolve palette index for target region');
        process.exit(1);
    }

    const editorPalette = new MockPalette();
    const runtimePalette = new MockPalette();
    const milestones = buildMilestonePlan(editorClip.duration);
    const comparisons: MilestoneComparison[] = [];
    let firstDivergence: string | null = null;

    for (const step of milestones) {
        const editorPlayback = clonePlaybackState(editorClip, step.editorTime, step.playing);
        const editorSnapshot = simulateEditorApply(
            step.id,
            editorProject.rig,
            editorPlayback,
            editorNode,
            editorBinding,
            editorPaletteIndex,
            editorPalette
        );

        const runtimeSnapshot = simulateRuntimeApply(
            step.id,
            runtimeProject.rig,
            runtimeClip,
            runtimeClip.id,
            step.runtimeTime,
            step.playing,
            runtimeNode,
            runtimeBinding,
            runtimePaletteIndex,
            runtimePalette
        );

        const divergence = compareSnapshots(editorSnapshot, runtimeSnapshot);
        const pass = divergence === null;
        if (!firstDivergence && !pass) {
            firstDivergence = `${step.id}: ${divergence}`;
        }

        comparisons.push({
            milestone: step.id,
            pass,
            editor: editorSnapshot,
            runtime: runtimeSnapshot,
            firstDivergence: divergence
        });
    }

    const report: Record<string, unknown> = {
        pass: firstDivergence === null,
        firstDivergence,
        animationClipId: ANIMATION_CLIP_ID,
        rigNodeId: TARGET_NODE_ID,
        regionId: TARGET_REGION_ID,
        frameDeltaSec: FRAME_DELTA_SEC,
        milestones: comparisons
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    printSummary(report, reportPath);
    process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
