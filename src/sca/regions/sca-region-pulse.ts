import { Color } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ResolvedRegionPulse, resolveRegionPulse, resolveRegionPulsePreview } from '../presentation';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

type SplatPulsePlan = {
    splat: Splat;
    ranges: IndexRanges;
    pulse: ResolvedRegionPulse;
    primaryRegionId: string;
};

type PulsePlayback = {
    regionId: string;
    mode: 'loop' | 'once';
    elapsed: number;
    completed: boolean;
};

const ONCE_CYCLE_DURATION_SCALE = Math.PI;

const shouldPlayRegionPulse = (
    region: ScaRegion,
    previewRegionId: string | null,
    manualPulseIds: Set<string>
): boolean => {
    if (previewRegionId === region.id) {
        return true;
    }

    if (manualPulseIds.has(region.id)) {
        return true;
    }

    const pulse = region.visual.pulse;
    return pulse?.enabled === true && pulse.mode === 'loop';
};

const resolvePulseForRegion = (
    region: ScaRegion,
    previewRegionId: string | null,
    manualPulseIds: Set<string>
): ResolvedRegionPulse | null => {
    if (previewRegionId === region.id || manualPulseIds.has(region.id)) {
        return resolveRegionPulsePreview(region);
    }

    return resolveRegionPulse(region);
};

const registerScaRegionPulse = (events: Events, scene: Scene): void => {
    let previewRegionId: string | null = null;
    const manualPulseIds = new Set<string>();
    const playbackByRegion = new Map<string, PulsePlayback>();
    let animating = false;

    const getRegions = (): ScaRegion[] => {
        return (events.invoke('sca.region.list') as ScaRegion[] | undefined) ?? [];
    };

    const resetPlayback = (regionId: string, pulse: ResolvedRegionPulse) => {
        playbackByRegion.set(regionId, {
            regionId,
            mode: pulse.mode,
            elapsed: 0,
            completed: false
        });
    };

    const buildPulsePlans = (): SplatPulsePlan[] => {
        const plansBySplat = new Map<Splat, SplatPulsePlan>();
        const regions = getRegions();

        for (const region of regions) {
            if (!shouldPlayRegionPulse(region, previewRegionId, manualPulseIds)) {
                continue;
            }

            const pulse = resolvePulseForRegion(region, previewRegionId, manualPulseIds);
            if (!pulse) {
                continue;
            }

            const ranges = events.invoke('sca.region.getMask', region.id) as IndexRanges | null;
            if (!ranges || ranges.empty) {
                continue;
            }

            const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
            if (!splat) {
                continue;
            }

            if (!playbackByRegion.has(region.id)) {
                resetPlayback(region.id, pulse);
            }

            const gaussianCount = splat.splatData.numSplats;
            const existing = plansBySplat.get(splat);
            if (!existing) {
                plansBySplat.set(splat, {
                    splat,
                    ranges,
                    pulse,
                    primaryRegionId: region.id
                });
                continue;
            }

            existing.ranges = IndexRanges.union(existing.ranges, ranges, gaussianCount);
        }

        return Array.from(plansBySplat.values());
    };

    const applyPulseMasks = () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        const activeSplats = new Set<Splat>();
        const plans = buildPulsePlans();

        for (const plan of plans) {
            activeSplats.add(plan.splat);
            plan.splat.setScaRegionPulseMask(plan.ranges);

            const playback = playbackByRegion.get(plan.primaryRegionId);
            const elapsed = playback?.elapsed ?? 0;
            plan.splat.updateScaRegionPulseUniforms(
                new Color(plan.pulse.color.r, plan.pulse.color.g, plan.pulse.color.b, plan.pulse.color.a),
                plan.pulse.strength,
                plan.pulse.speed,
                elapsed,
                plan.pulse.mode === 'once'
            );
        }

        for (const splat of splats) {
            if (!activeSplats.has(splat)) {
                splat.clearScaRegionPulse();
            }
        }

        animating = plans.some((plan) => {
            const playback = playbackByRegion.get(plan.primaryRegionId);
            return playback && !playback.completed;
        });
        scene.forceRender = true;
    };

    const stopPreview = () => {
        previewRegionId = null;
        applyPulseMasks();
    };

    const startPreview = (regionId: string | null) => {
        if (!regionId) {
            stopPreview();
            return;
        }

        if (previewRegionId === regionId) {
            stopPreview();
            return;
        }

        previewRegionId = regionId;
        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        const pulse = resolveRegionPulsePreview(region);
        if (pulse) {
            resetPlayback(regionId, pulse);
        }
        applyPulseMasks();
    };

    events.on('sca.region.pulse.preview', (regionId?: string | null) => {
        const selectedId = (regionId ?? events.invoke('sca.region.getSelected')) as string | null;
        startPreview(selectedId);
    });

    events.on('sca.region.pulse.preview.stop', () => {
        stopPreview();
    });

    events.function('sca.region.pulse.preview.get', () => previewRegionId);

    events.on('sca.region.selected', () => {
        if (previewRegionId) {
            stopPreview();
        }
        applyPulseMasks();
    });

    events.on('sca.project.changed', () => {
        applyPulseMasks();
    });

    events.on('scene.clear', () => {
        previewRegionId = null;
        manualPulseIds.clear();
        playbackByRegion.clear();
        animating = false;
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        for (const splat of splats) {
            splat.clearScaRegionPulse();
        }
    });

    scene.app.on('update', (dt: number) => {
        if (!animating) {
            return;
        }

        let anyActive = false;

        for (const playback of playbackByRegion.values()) {
            if (playback.completed) {
                continue;
            }

            playback.elapsed += dt;
            if (playback.mode === 'once') {
                const region = events.invoke('sca.region.get', playback.regionId) as ScaRegion | null;
                const pulse = resolvePulseForRegion(region, previewRegionId, manualPulseIds);
                const speed = pulse?.speed ?? 1;
                if (playback.elapsed * speed >= ONCE_CYCLE_DURATION_SCALE) {
                    playback.completed = true;
                    if (previewRegionId === playback.regionId) {
                        previewRegionId = null;
                    }
                    manualPulseIds.delete(playback.regionId);
                    continue;
                }
            }

            anyActive = true;
        }

        if (!anyActive) {
            animating = false;
            applyPulseMasks();
            return;
        }

        const plans = buildPulsePlans();
        for (const plan of plans) {
            const playback = playbackByRegion.get(plan.primaryRegionId);
            const elapsed = playback?.elapsed ?? 0;
            plan.splat.updateScaRegionPulseUniforms(
                new Color(plan.pulse.color.r, plan.pulse.color.g, plan.pulse.color.b, plan.pulse.color.a),
                plan.pulse.strength,
                plan.pulse.speed,
                elapsed,
                plan.pulse.mode === 'once'
            );
        }

        scene.forceRender = true;
    });

    applyPulseMasks();
};

export { registerScaRegionPulse };
