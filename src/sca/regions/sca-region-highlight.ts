import { Color } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { resolveRegionVisualWithAnimation } from '../presentation';
import { ScaRegion } from '../types/region';

import { logEditorRegionHighlight } from '../debug/editor-region-preview-debug';

import { RegionAuthoringPreviewState } from './region-authoring-preview-state';
import { findSplatByScaSplatId } from './splat-identity';

type SplatHighlightPlan = {
    splat: Splat;
    selectedRanges: IndexRanges | null;
    hoverRanges: IndexRanges | null;
    visitedRanges: IndexRanges | null;
    selectedColor: Color | null;
    hoverColor: Color | null;
    visitedColor: Color | null;
};

const countIndexRanges = (ranges: IndexRanges | null): number => {
    if (!ranges || ranges.empty) {
        return 0;
    }

    let count = 0;
    ranges.forEach(() => {
        count++;
    });
    return count;
};

const registerScaRegionHighlight = (events: Events, scene: Scene): void => {
    let hoverRegionId: string | null = null;
    let hoverPreviewEnabled = false;
    let authoringPreviewState: RegionAuthoringPreviewState = null;
    let lastHighlightLog = '';

    const clearAllHighlights = () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        for (const splat of splats) {
            splat.clearScaRegionHighlight();
        }
    };

    const getEffectiveAuthoringPreview = (
        selectedId: string | null
    ): RegionAuthoringPreviewState => {
        if (!selectedId || !authoringPreviewState) {
            return null;
        }

        return authoringPreviewState;
    };

    const getInteractionHoverId = (selectedId: string | null): string | null => {
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
        state: 'hover' | 'selected' | 'visited'
    ) => {
        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        const visual = resolveRegionVisualWithAnimation(region, state);
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
                visitedRanges: null,
                selectedColor: null,
                hoverColor: null,
                visitedColor: null
            };
            plans.set(splat, plan);
        }

        const tint = new Color(visual.tint.r, visual.tint.g, visual.tint.b, visual.tint.a);
        if (state === 'selected') {
            plan.selectedRanges = ranges;
            plan.selectedColor = tint;
        } else if (state === 'hover') {
            plan.hoverRanges = ranges;
            plan.hoverColor = tint;
        } else {
            plan.visitedRanges = ranges;
            plan.visitedColor = tint;
        }
    };

    const applyCombinedHighlight = () => {
        clearAllHighlights();

        const selectedId = events.invoke('sca.region.getSelected') as string | null;
        const authoringPreview = getEffectiveAuthoringPreview(selectedId);
        const interactionHoverId = getInteractionHoverId(selectedId);

        if (!selectedId && !interactionHoverId) {
            scene.forceRender = true;
            return;
        }

        const plans = new Map<Splat, SplatHighlightPlan>();

        if (selectedId) {
            if (authoringPreview === 'hover') {
                appendRegionPlan(plans, selectedId, 'hover');
            } else if (authoringPreview === 'visited') {
                appendRegionPlan(plans, selectedId, 'visited');
            } else {
                appendRegionPlan(plans, selectedId, 'selected');
            }
        }

        if (interactionHoverId) {
            appendRegionPlan(plans, interactionHoverId, 'hover');
        }

        if (plans.size === 0) {
            scene.forceRender = true;
            return;
        }

        for (const plan of plans.values()) {
            plan.splat.setScaRegionHighlightCombined(
                plan.selectedRanges,
                plan.hoverRanges,
                plan.selectedColor ?? undefined,
                plan.hoverColor ?? undefined,
                plan.visitedRanges,
                plan.visitedColor ?? undefined
            );
        }

        const effectiveHoverId =
            authoringPreview === 'hover' && selectedId ? selectedId : interactionHoverId;

        const highlightKey = [
            selectedId ?? 'null',
            effectiveHoverId ?? 'null',
            hoverPreviewEnabled ? '1' : '0',
            authoringPreview ?? 'null'
        ].join('|');

        if (highlightKey !== lastHighlightLog) {
            lastHighlightLog = highlightKey;

            let hoverStatePixels = 0;
            let selectedStatePixels = 0;
            for (const plan of plans.values()) {
                const stats = plan.splat.getScaRegionHighlightStateCounts();
                hoverStatePixels += stats.hover;
                selectedStatePixels += stats.selected;
            }

            logEditorRegionHighlight({
                selectedRegionId: selectedId,
                hoverRegionId: effectiveHoverId,
                authoringPreviewState: authoringPreview,
                selectedMembers: selectedId ?
                    Array.from(plans.values()).reduce(
                        (total, plan) => total + countIndexRanges(plan.selectedRanges),
                        0
                    ) :
                    0,
                hoverMembers: effectiveHoverId ?
                    Array.from(plans.values()).reduce(
                        (total, plan) => total + countIndexRanges(plan.hoverRanges),
                        0
                    ) :
                    0,
                hoverStatePixels,
                selectedStatePixels
            });
        }

        scene.forceRender = true;
    };

    events.function('sca.region.authoringPreview.get', () => authoringPreviewState);

    events.on('sca.region.authoringPreview.set', (state: RegionAuthoringPreviewState) => {
        authoringPreviewState = state;
        lastHighlightLog = '';
        applyCombinedHighlight();
    });

    events.on('sca.region.selected', () => {
        authoringPreviewState = null;
        lastHighlightLog = '';
        applyCombinedHighlight();
    });

    events.on('sca.region.hoverPreview', (regionId: string | null) => {
        if (!hoverPreviewEnabled) {
            return;
        }

        if (hoverRegionId === regionId) {
            return;
        }

        hoverRegionId = regionId;
        applyCombinedHighlight();
    });

    events.on('sca.viewerInteractionPreview.setEnabled', (value: boolean) => {
        hoverPreviewEnabled = !!value;
        hoverRegionId = null;
        lastHighlightLog = '';
        applyCombinedHighlight();
    });

    events.on('sca.project.changed', () => {
        applyCombinedHighlight();
    });

    events.on('sca.animation.updated', () => {
        applyCombinedHighlight();
    });

    events.on('sca.region.highlight.refresh', () => {
        applyCombinedHighlight();
    });

    // remapRegionMasksForSave() reloads project metadata without firing refresh
    // events; re-apply highlight from current mask after a successful save.
    events.on('doc.saved', () => {
        const selectedId = events.invoke('sca.region.getSelected') as string | null;
        if (!selectedId) {
            return;
        }

        lastHighlightLog = '';
        applyCombinedHighlight();
    });

    events.on('scene.clear', () => {
        hoverRegionId = null;
        authoringPreviewState = null;
        lastHighlightLog = '';
        clearAllHighlights();
    });
};

export { registerScaRegionHighlight };
