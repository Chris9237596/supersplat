import { Mat4 } from 'playcanvas';

import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { computeRegionAnchorFromIndices } from '../presentation/region-anchor';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';
import { ScaRegion } from '../types/region';

import { buildEffectiveRigWorldMatrixFromPose, collectRigSubtreeNodeIds } from './rig-hierarchy';
import { evaluateFinalRigPose, getAnimationPlaybackState, ScaRigEvaluatedPose } from './rig-pose';
import { maybeLogRigMatrixCheck, evaluateEditorRigPoseAtTime } from './rig-matrix-check';
import {
    findFirstGaussianIndexForRegion,
    maybeLogEditorTransformOrderCheck,
    TARGET_REGION_ID
} from './rig-transform-order-check';
import { maybeLogEditorGaussianRenderTrace } from './rig-gaussian-trace';
import { maybeLogEditorRigDataParity } from './rig-data-parity-check';
import { findSplatByScaSplatId } from '../regions/splat-identity';
import {
    logScaRigRestore,
    logScaRigUpdate,
    mergeGaussianIndicesBySplat,
    restoreRigSlotTransforms,
    SavedGaussianTransform
} from './region-rig-restore';
import { logRigTracePaletteWrite, logRigTraceStage, isRigTraceEnabled } from './rig-trace';

type RigSplatSlot = {
    splat: Splat;
    nodeId: string;
    regionId: string;
    paletteIndex: number;
    saved: SavedGaussianTransform[];
    gaussianIndices: number[];
};

const rigMat = new Mat4();

const canUpdateSortCenters = (splat: Splat): boolean => {
    return !!splat.entity?.gsplat?.instance?.sorter;
};

const safeUpdateSortCentersForIndices = async (
    splat: Splat,
    indices: Iterable<number>,
    context: string
): Promise<void> => {
    if (!canUpdateSortCenters(splat)) {
        console.warn(`[SCA RIG] skipped sort center update (${context}): gsplat instance unavailable`);
        return;
    }

    await splat.updateSortCentersForIndices(indices);
};

const computeRegionPivotLocal = (
    events: Events,
    region: ScaRegion,
    splat: Splat
): [number, number, number] | null => {
    const ranges = events.invoke('sca.region.getMask', region.id) as IndexRanges | null;
    if (!ranges || ranges.empty) {
        return null;
    }

    const xData = splat.splatData.getProp('x') as Float32Array;
    const yData = splat.splatData.getProp('y') as Float32Array;
    const zData = splat.splatData.getProp('z') as Float32Array;
    const numSplats = splat.splatData.numSplats;
    const members: number[] = [];
    ranges.forEach((index: number) => members.push(index));

    const anchor = computeRegionAnchorFromIndices(
        members,
        {
            count: numSplats,
            getCenter(index: number) {
                if (index < 0 || index >= numSplats) {
                    return null;
                }
                return [xData[index], yData[index], zData[index]];
            }
        }
    );

    if (!anchor) {
        return null;
    }

    return [anchor.x, anchor.y, anchor.z];
};

const resolveSlotBinding = (rig: ScaRig, slot: RigSplatSlot): ScaRigBinding | null => {
    return rig.bindings.find((entry) => entry.regionId === slot.regionId) ??
        rig.bindings.find((entry) => entry.nodeId === slot.nodeId) ??
        null;
};

const writeSlotEffectiveMatrix = (
    rig: ScaRig,
    pose: ScaRigEvaluatedPose,
    slot: RigSplatSlot,
    node: ScaRigNode,
    binding: ScaRigBinding | null,
    target = rigMat
): Mat4 => {
    buildEffectiveRigWorldMatrixFromPose(rig, pose, node, binding, target);
    slot.splat.transformPalette.setTransform(slot.paletteIndex, target);
    return target;
};

class RegionRigApplier {
    private slots: RigSplatSlot[] = [];

    hasActiveSlots(): boolean {
        return this.slots.length > 0;
    }

    clear() {
        restoreRigSlotTransforms(this.slots);
        this.slots = [];
    }

    private async restoreAll(scene: Scene): Promise<number> {
        if (this.slots.length === 0) {
            return 0;
        }

        const restore = restoreRigSlotTransforms(this.slots);
        this.slots = [];

        if (restore.restoredGaussianCount === 0) {
            return 0;
        }

        logScaRigRestore({
            restoredGaussians: restore.restoredGaussianCount,
            removedNodes: restore.removedNodeIds,
            previousRigAssigned: restore.restoredGaussianCount,
            newRigAssigned: 0,
            freedPaletteEntries: restore.freedPaletteCount
        });

        for (const [splat, indices] of restore.restoredBySplat) {
            await safeUpdateSortCentersForIndices(splat, indices, 'restore');
        }

        scene.forceRender = true;
        return restore.restoredGaussianCount;
    }

    async updateNodePoses(
        events: Events,
        scene: Scene,
        rig: ScaRig | undefined,
        nodeIds?: string[]
    ): Promise<void> {
        if (!rig || this.slots.length === 0) {
            return;
        }

        if (isRigTraceEnabled()) {
            logRigTraceStage('rig-pose-update-before', {
                nodeIds: nodeIds ?? null,
                slotCount: this.slots.length
            });
        }

        const nodeById = new Map<string, ScaRigNode>(
            rig.nodes.map((node) => [node.id, node])
        );
        const pose = evaluateFinalRigPose(rig);
        const playback = getAnimationPlaybackState();
        const primarySlot = this.slots[0];
        if (playback.previewActive && primarySlot) {
            const primaryNode = nodeById.get(primarySlot.nodeId);
            const primaryBinding = resolveSlotBinding(rig, primarySlot);
            if (primaryNode) {
                maybeLogRigMatrixCheck(
                    'editor',
                    playback.currentTime,
                    rig,
                    primaryNode,
                    primaryBinding,
                    (sampleTime) => evaluateEditorRigPoseAtTime(rig, sampleTime)
                );
            }
        }

        const affectedNodeIds = nodeIds ?
            new Set(nodeIds.flatMap((nodeId) => collectRigSubtreeNodeIds(rig, nodeId))) :
            null;
        const indicesBySplat = new Map<Splat, number[]>();
        let affectedGaussians = 0;
        const affectedNodes = new Set<string>();

        for (const slot of this.slots) {
            if (affectedNodeIds && !affectedNodeIds.has(slot.nodeId)) {
                continue;
            }

            const node = nodeById.get(slot.nodeId);
            if (!node) {
                continue;
            }

            const binding = resolveSlotBinding(rig, slot);
            const slotBefore = slot.paletteIndex;
            writeSlotEffectiveMatrix(rig, pose, slot, node, binding);

            if (isRigTraceEnabled()) {
                const paletteMatrix = new Mat4();
                slot.splat.transformPalette.getTransform(slot.paletteIndex, paletteMatrix);
                logRigTracePaletteWrite({
                    regionId: slot.regionId,
                    nodeId: slot.nodeId,
                    slotBefore,
                    slotAfter: slot.paletteIndex,
                    reason: 'updateNodePoses'
                });
                logRigTraceStage('palette-write', {
                    slotBefore,
                    slotAfter: slot.paletteIndex
                }, {
                    binding,
                    paletteIndex: slot.paletteIndex,
                    paletteMatrix
                });
            }

            affectedNodes.add(slot.nodeId);
            affectedGaussians += slot.gaussianIndices.length;

            let indices = indicesBySplat.get(slot.splat);
            if (!indices) {
                indices = [];
                indicesBySplat.set(slot.splat, indices);
            }
            indices.push(...slot.gaussianIndices);
        }

        for (const [splat, indices] of indicesBySplat) {
            await safeUpdateSortCentersForIndices(splat, indices, 'updateNodePoses');
        }

        if (playback.previewActive) {
            const region06Slot = this.slots.find((slot) => slot.regionId === TARGET_REGION_ID);
            const region06GaussianIndex = region06Slot ?
                findFirstGaussianIndexForRegion(region06Slot.gaussianIndices) :
                null;
            if (region06Slot && region06GaussianIndex !== null) {
                const region06Node = nodeById.get(region06Slot.nodeId);
                const region06Binding = resolveSlotBinding(rig, region06Slot);
                if (region06Node && region06Binding) {
                    const region06Pose = evaluateEditorRigPoseAtTime(rig, 0);
                    maybeLogEditorGaussianRenderTrace({
                        playbackTime: playback.currentTime,
                        rig,
                        pose: region06Pose,
                        splat: region06Slot.splat,
                        gaussianIndex: region06GaussianIndex,
                        paletteIndex: region06Slot.paletteIndex,
                        node: region06Node,
                        binding: region06Binding
                    });
                    maybeLogEditorTransformOrderCheck(
                        playback.currentTime,
                        rig,
                        region06Pose,
                        region06Slot.splat,
                        region06GaussianIndex,
                        region06Node,
                        region06Binding
                    );
                }
            }
        }

        if (affectedGaussians > 0) {
            logScaRigUpdate({
                type: 'pose',
                nodes: [...affectedNodes],
                affectedGaussians,
                paletteRebuilt: false
            });
            scene.forceRender = true;
        }
    }

    async apply(events: Events, scene: Scene, rig: ScaRig | undefined) {
        const restored = await this.restoreAll(scene);

        if (!rig || rig.nodes.length === 0 || rig.bindings.length === 0) {
            if (restored > 0) {
                logScaRigUpdate({
                    type: 'structural',
                    restored,
                    reapplied: 0,
                    paletteRebuilt: true
                });
            }
            scene.forceRender = true;
            return;
        }

        const nodeById = new Map<string, ScaRigNode>(
            rig.nodes.map((node) => [node.id, node])
        );
        maybeLogEditorRigDataParity(rig);
        const pose = evaluateFinalRigPose(rig);

        const bindings = [...rig.bindings].sort((left, right) => (
            left.regionId.localeCompare(right.regionId)
        ));

        const ownerByGaussian = new Map<number, string>();
        const slotByKey = new Map<string, RigSplatSlot>();
        const conflictRegions = new Set<string>();

        for (const binding of bindings) {
            const node = nodeById.get(binding.nodeId);
            if (!node) {
                continue;
            }

            const region = (events.invoke('sca.region.get', binding.regionId) as ScaRegion | null);
            if (!region) {
                continue;
            }

            const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
            if (!splat) {
                console.warn(`[SCA RIG] source splat not found for region ${binding.regionId}`);
                continue;
            }

            const ranges = events.invoke('sca.region.getMask', binding.regionId) as IndexRanges | null;
            if (!ranges || ranges.empty) {
                continue;
            }

            const slotKey = `${binding.nodeId}:${splat.uid}`;
            let slot = slotByKey.get(slotKey);
            if (!slot) {
                const paletteIndex = splat.transformPalette.alloc();
                slot = {
                    splat,
                    nodeId: binding.nodeId,
                    regionId: binding.regionId,
                    paletteIndex,
                    saved: [],
                    gaussianIndices: []
                };
                slotByKey.set(slotKey, slot);
                this.slots.push(slot);
            }

            const transformIndices = slot.splat.transformTexture.lock() as Uint16Array;
            ranges.forEach((gaussianIndex: number) => {
                if (gaussianIndex < 0 || gaussianIndex >= transformIndices.length) {
                    return;
                }

                const existingOwner = ownerByGaussian.get(gaussianIndex);
                if (existingOwner && existingOwner !== binding.regionId) {
                    conflictRegions.add(binding.regionId);
                    return;
                }

                if (existingOwner === binding.regionId) {
                    return;
                }

                ownerByGaussian.set(gaussianIndex, binding.regionId);
                slot!.saved.push({
                    gaussianIndex,
                    transformIndex: transformIndices[gaussianIndex]
                });
                slot!.gaussianIndices.push(gaussianIndex);
                transformIndices[gaussianIndex] = slot!.paletteIndex;
            });
            slot.splat.transformTexture.unlock();

            writeSlotEffectiveMatrix(rig, pose, slot, node, binding);
        }

        if (conflictRegions.size > 0) {
            console.warn(
                `[SCA RIG] skipped overlapping rig bindings for regions: ${[...conflictRegions].join(', ')}`
            );
        }

        const indicesBySplat = mergeGaussianIndicesBySplat(this.slots);
        let newRigAssigned = 0;

        for (const [splat, indices] of indicesBySplat) {
            newRigAssigned += indices.length;
            await safeUpdateSortCentersForIndices(splat, indices, 'apply');
        }

        logScaRigUpdate({
            type: 'structural',
            restored,
            reapplied: newRigAssigned,
            paletteRebuilt: true,
            activeBindings: rig.bindings.length
        });

        scene.forceRender = true;
    }
}

export {
    RegionRigApplier,
    computeRegionPivotLocal,
    resolveSlotBinding,
    writeSlotEffectiveMatrix
};
