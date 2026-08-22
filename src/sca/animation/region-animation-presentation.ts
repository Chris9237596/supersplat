import { ScaAnimationClip } from '../types/animation';

import { sampleNumberTrack } from '../rig/rig-animation';

const editorOpacityOverrides = new Map<string, number>();

const getRegionOpacityOverridesStore = (): Map<string, number> => {
    const globalScope = (typeof window !== 'undefined' ? window : globalThis) as typeof globalThis & {
        SCA3D?: { state?: Record<string, unknown> };
    };
    const sca = globalScope.SCA3D;
    if (sca) {
        sca.state = sca.state || {};
        const existing = sca.state.regionOpacityOverrides;
        if (!(existing instanceof Map)) {
            sca.state.regionOpacityOverrides = new Map<string, number>();
        }
        return sca.state.regionOpacityOverrides as Map<string, number>;
    }

    return editorOpacityOverrides;
};

const clearRegionAnimationOpacityOverrides = (): void => {
    getRegionOpacityOverridesStore().clear();
};

const setRegionAnimationOpacityOverrides = (overrides: Map<string, number>): void => {
    const store = getRegionOpacityOverridesStore();
    store.clear();
    for (const [regionId, opacity] of overrides.entries()) {
        store.set(regionId, opacity);
    }
};

const getRegionAnimationOpacityOverride = (regionId: string): number | null => {
    const store = getRegionOpacityOverridesStore();
    if (!store.has(regionId)) {
        return null;
    }

    return store.get(regionId)!;
};

const applyRegionAnimationOverrides = (
    clip: ScaAnimationClip | null,
    currentTime: number,
    previewActive: boolean
): void => {
    if (!previewActive || !clip) {
        clearRegionAnimationOpacityOverrides();
        return;
    }

    const clampedTime = Math.max(0, Math.min(currentTime, clip.duration));
    const overrides = new Map<string, number>();

    for (const track of clip.tracks) {
        if (track.targetType !== 'region' || track.property !== 'opacity' || track.keyframes.length === 0) {
            continue;
        }

        overrides.set(track.regionId, sampleNumberTrack(track.keyframes, clampedTime));
    }

    setRegionAnimationOpacityOverrides(overrides);
};

export {
    applyRegionAnimationOverrides,
    clearRegionAnimationOpacityOverrides,
    getRegionAnimationOpacityOverride,
    setRegionAnimationOpacityOverrides
};
