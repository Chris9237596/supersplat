import { Color } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { resolveRegionVisual } from '../presentation';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

type SplatHighlightPlan = {
    splat: Splat;
    selectedRanges: IndexRanges | null;
    hoverRanges: IndexRanges | null;
    selectedColor: Color | null;
    hoverColor: Color | null;
};

const registerScaRegionHighlight = (events: Events, scene: Scene): void => {
    let hoverRegionId: string | null = null;
    let hoverPreviewEnabled = false;

    const clearAllHighlights = () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        for (const splat of splats) {
            splat.clearScaRegionHighlight();
        }
    };

    const getEffectiveHoverId = (selectedId: string | null): string | null => {
        if (!hoverPreviewEnabled || !hoverRegionId) {
            return null;
        }

        if (hoverRegionId === selectedId) {
            return null;
        }

        return hoverRegionId;
    };

    const appendRegionPlan = (
        plans: Map<Splat, SplatHighlightPlan>,
        regionId: string,
        state: 'hover' | 'selected'
    ) => {
        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        const visual = resolveRegionVisual(region, state);
        if (!region || !visual) {
            return;
        }

        const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
        if (!splat) {
            console.warn(`[SCA] region highlight: source splat not found: ${region.source.scaSplatId}`);
            return;
        }

        const ranges = events.invoke('sca.region.getMask', regionId) as IndexRanges | null;
        if (!ranges) {
            console.warn(`[SCA] region highlight: mask not found for ${regionId}`);
            return;
        }

        let plan = plans.get(splat);
        if (!plan) {
            plan = {
                splat,
                selectedRanges: null,
                hoverRanges: null,
                selectedColor: null,
                hoverColor: null
            };
            plans.set(splat, plan);
        }

        const tint = new Color(visual.tint.r, visual.tint.g, visual.tint.b, visual.tint.a);
        if (state === 'selected') {
            plan.selectedRanges = ranges;
            plan.selectedColor = tint;
        } else {
            plan.hoverRanges = ranges;
            plan.hoverColor = tint;
        }
    };

    const applyCombinedHighlight = () => {
        clearAllHighlights();

        const selectedId = events.invoke('sca.region.getSelected') as string | null;
        const hoverId = getEffectiveHoverId(selectedId);

        if (!selectedId && !hoverId) {
            scene.forceRender = true;
            return;
        }

        const plans = new Map<Splat, SplatHighlightPlan>();

        if (selectedId) {
            appendRegionPlan(plans, selectedId, 'selected');
        }

        if (hoverId) {
            appendRegionPlan(plans, hoverId, 'hover');
        }

        for (const plan of plans.values()) {
            plan.splat.setScaRegionHighlightCombined(
                plan.selectedRanges,
                plan.hoverRanges,
                plan.selectedColor ?? undefined,
                plan.hoverColor ?? undefined
            );
        }

        scene.forceRender = true;
    };

    events.on('sca.region.selected', () => {
        applyCombinedHighlight();
    });

    events.on('sca.region.hoverPreview', (regionId: string | null) => {
        if (!hoverPreviewEnabled) {
            return;
        }

        hoverRegionId = regionId;
        applyCombinedHighlight();
    });

    events.on('sca.viewerInteractionPreview.setEnabled', (value: boolean) => {
        hoverPreviewEnabled = !!value;
        hoverRegionId = null;
        applyCombinedHighlight();
    });

    events.on('sca.project.changed', () => {
        applyCombinedHighlight();
    });

    events.on('scene.clear', () => {
        hoverRegionId = null;
        clearAllHighlights();
    });
};

export { registerScaRegionHighlight };
