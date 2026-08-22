import { Mat4 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { computeRegionAnchorFromIndices } from '../presentation/region-anchor';
import { ScaRig, ScaRigNode } from '../types/rig';
import { ScaRegion } from '../types/region';

import { buildRigidRigMatrix, isZeroRigTransform } from './rig-transform';
import { findSplatByScaSplatId } from '../regions/splat-identity';

type SavedGaussianTransform = {
    gaussianIndex: number;
    transformIndex: number;
};

type RigSplatSlot = {
    splat: Splat;
    nodeId: string;
    paletteIndex: number;
    saved: SavedGaussianTransform[];
    gaussianIndices: number[];
};

const rigMat = new Mat4();

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

class RegionRigApplier {
    private slots: RigSplatSlot[] = [];

    clear() {
        for (const slot of this.slots) {
            const indices = slot.splat.transformTexture.lock() as Uint16Array;
            for (const saved of slot.saved) {
                indices[saved.gaussianIndex] = saved.transformIndex;
            }
            slot.splat.transformTexture.unlock();
            slot.splat.transformPalette.setTransform(slot.paletteIndex, Mat4.IDENTITY);
        }

        this.slots = [];
    }

    async apply(events: Events, scene: Scene, rig: ScaRig | undefined) {
        this.clear();

        if (!rig || rig.nodes.length === 0 || rig.bindings.length === 0) {
            scene.forceRender = true;
            return;
        }

        const nodeById = new Map<string, ScaRigNode>(
            rig.nodes.map((node) => [node.id, node])
        );

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

            if (isZeroRigTransform(node)) {
                splat.transformPalette.setTransform(slot.paletteIndex, Mat4.IDENTITY);
            } else {
                splat.transformPalette.setTransform(
                    slot.paletteIndex,
                    buildRigidRigMatrix(node, rigMat)
                );
            }
        }

        if (conflictRegions.size > 0) {
            console.warn(
                `[SCA RIG] skipped overlapping rig bindings for regions: ${[...conflictRegions].join(', ')}`
            );
        }

        const splatsToUpdate = new Set<Splat>();
        for (const slot of this.slots) {
            if (slot.gaussianIndices.length > 0) {
                splatsToUpdate.add(slot.splat);
            }
        }

        for (const splat of splatsToUpdate) {
            const slot = this.slots.find((entry) => entry.splat === splat);
            if (slot) {
                await splat.updateSortCentersForIndices(slot.gaussianIndices);
            }
        }

        scene.forceRender = true;
    }
}

export {
    RegionRigApplier,
    computeRegionPivotLocal
};
