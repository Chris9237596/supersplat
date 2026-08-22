import { Color } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import {
    computeRegionAnchorFromIndices,
    resolveRegionVisual
} from '../presentation';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

const registerScaRegionHighlight = (events: Events, scene: Scene): void => {
    const clearAllHighlights = () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        for (const splat of splats) {
            splat.clearScaRegionHighlight();
        }
    };

    const applyHighlight = (regionId: string | null) => {
        clearAllHighlights();

        if (!regionId) {
            scene.forceRender = true;
            return;
        }

        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        const visual = resolveRegionVisual(region, 'selected');
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

        const tint = new Color(
            visual.tint.r,
            visual.tint.g,
            visual.tint.b,
            visual.tint.a
        );

        splat.setScaRegionHighlight(ranges, tint);
        scene.forceRender = true;
    };

    events.on('sca.region.selected', (regionId: string | null) => {
        applyHighlight(regionId);
    });

    events.on('sca.project.changed', () => {
        applyHighlight(events.invoke('sca.region.getSelected') as string | null);
    });

    events.on('scene.clear', () => {
        clearAllHighlights();
    });
};

export { registerScaRegionHighlight };
