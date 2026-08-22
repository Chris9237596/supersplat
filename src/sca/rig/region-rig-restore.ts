import { Mat4 } from 'playcanvas';

import { Splat } from '../../splat';

type SavedGaussianTransform = {
    gaussianIndex: number;
    transformIndex: number;
};

type RigRestoreSlot = {
    splat: Splat;
    nodeId: string;
    paletteIndex: number;
    saved: SavedGaussianTransform[];
};

type RigRestoreResult = {
    restoredBySplat: Map<Splat, number[]>;
    restoredGaussianCount: number;
    removedNodeIds: string[];
    freedPaletteCount: number;
};

const isScaRigRestoreDebugEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!(debug?.rigRestore || debug?.rigUpdate);
};

const logScaRigRestore = (payload: Record<string, unknown>): void => {
    if (!isScaRigRestoreDebugEnabled()) {
        return;
    }

    console.log('[SCA RIG RESTORE]', payload);
};

const logScaRigUpdate = (payload: Record<string, unknown>): void => {
    if (!isScaRigRestoreDebugEnabled()) {
        return;
    }

    console.log('[SCA RIG UPDATE]', payload);
};

const restoreRigSlotTransforms = (slots: ReadonlyArray<RigRestoreSlot>): RigRestoreResult => {
    const restoredBySplat = new Map<Splat, number[]>();
    const slotsBySplat = new Map<Splat, RigRestoreSlot[]>();
    let restoredGaussianCount = 0;

    for (const slot of slots) {
        const indices = slot.splat.transformTexture.lock() as Uint16Array;
        for (const saved of slot.saved) {
            indices[saved.gaussianIndex] = saved.transformIndex;
            restoredGaussianCount++;

            let restored = restoredBySplat.get(slot.splat);
            if (!restored) {
                restored = [];
                restoredBySplat.set(slot.splat, restored);
            }
            restored.push(saved.gaussianIndex);
        }
        slot.splat.transformTexture.unlock();

        let splatSlots = slotsBySplat.get(slot.splat);
        if (!splatSlots) {
            splatSlots = [];
            slotsBySplat.set(slot.splat, splatSlots);
        }
        splatSlots.push(slot);
    }

    let freedPaletteCount = 0;
    for (const [splat, splatSlots] of slotsBySplat) {
        for (let i = splatSlots.length - 1; i >= 0; i--) {
            splat.transformPalette.setTransform(splatSlots[i].paletteIndex, Mat4.IDENTITY);
            splat.transformPalette.free(1);
            freedPaletteCount++;
        }
    }

    const removedNodeIds = [...new Set(slots.map((slot) => slot.nodeId))];

    return {
        restoredBySplat,
        restoredGaussianCount,
        removedNodeIds,
        freedPaletteCount
    };
};

const mergeGaussianIndicesBySplat = (
    slots: ReadonlyArray<{ splat: Splat; gaussianIndices: number[] }>
): Map<Splat, number[]> => {
    const indicesBySplat = new Map<Splat, number[]>();

    for (const slot of slots) {
        if (slot.gaussianIndices.length === 0) {
            continue;
        }

        let indices = indicesBySplat.get(slot.splat);
        if (!indices) {
            indices = [];
            indicesBySplat.set(slot.splat, indices);
        }
        indices.push(...slot.gaussianIndices);
    }

    return indicesBySplat;
};

export {
    RigRestoreResult,
    RigRestoreSlot,
    SavedGaussianTransform,
    logScaRigRestore,
    logScaRigUpdate,
    mergeGaussianIndicesBySplat,
    restoreRigSlotTransforms
};
