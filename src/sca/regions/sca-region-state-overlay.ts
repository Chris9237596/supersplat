import { Color } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { parseRegionOverlayColor, resolveFirstEnabledRegionOverlayLayer } from '../presentation/region-state-overlay';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

type SplatOverlayPlan = {
    splat: Splat;
    ranges: IndexRanges;
    color: Color;
};

const registerScaRegionStateOverlay = (events: Events, scene: Scene): void => {
    const getRegions = (): ScaRegion[] => {
        return (events.invoke('sca.region.list') as ScaRegion[] | undefined) ?? [];
    };

    const shouldShowOverlayForRegion = (regionId: string): boolean => {
        const selectedId = events.invoke('sca.region.getSelected') as string | null;
        const authoringPreview = events.invoke('sca.region.authoringPreview.get') as string | null;
        return selectedId === regionId && authoringPreview === 'visited';
    };

    const buildOverlayPlans = (): SplatOverlayPlan[] => {
        const plansBySplat = new Map<Splat, SplatOverlayPlan>();

        for (const region of getRegions()) {
            if (!shouldShowOverlayForRegion(region.id)) {
                continue;
            }

            const overlayLayer = resolveFirstEnabledRegionOverlayLayer(region);
            if (!overlayLayer) {
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

            const tint = parseRegionOverlayColor(overlayLayer);
            const color = new Color(tint.r, tint.g, tint.b, tint.a);
            const existing = plansBySplat.get(splat);
            if (!existing) {
                plansBySplat.set(splat, { splat, ranges, color });
                continue;
            }

            existing.ranges = IndexRanges.union(existing.ranges, ranges, splat.splatData.numSplats);
        }

        return Array.from(plansBySplat.values());
    };

    const applyStateOverlay = () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        const activeSplats = new Set<Splat>();
        const plans = buildOverlayPlans();

        for (const plan of plans) {
            activeSplats.add(plan.splat);
            plan.splat.setScaRegionStateOverlayMask(plan.ranges, plan.color);
        }

        for (const splat of splats) {
            if (!activeSplats.has(splat)) {
                splat.clearScaRegionStateOverlay();
            }
        }

        scene.forceRender = true;
    };

    events.on('sca.region.authoringPreview.set', () => {
        applyStateOverlay();
    });

    events.on('sca.region.selected', () => {
        applyStateOverlay();
    });

    events.on('sca.project.changed', () => {
        applyStateOverlay();
    });

    events.on('doc.saved', () => {
        applyStateOverlay();
    });

    events.on('scene.clear', () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        for (const splat of splats) {
            splat.clearScaRegionStateOverlay();
        }
    });

    applyStateOverlay();
};

export { registerScaRegionStateOverlay };
