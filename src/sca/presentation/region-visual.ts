import { DEFAULT_ACTIVE_OPACITY, DEFAULT_HOVER_OPACITY, DEFAULT_VISITED_OPACITY } from '../region-defaults';
import { ScaRegion } from '../types/region';

import {
    parseRegionActiveColor,
    parseRegionHoverColor,
    parseRegionVisitedColor,
    RgbaColor
} from './region-color';

type RegionVisualState = 'normal' | 'hover' | 'visited' | 'selected';

type ResolvedRegionVisual = {
    state: RegionVisualState;
    tint: RgbaColor;
    highlightActive: boolean;
};

const resolveRegionVisual = (
    region: ScaRegion | null | undefined,
    state: RegionVisualState
): ResolvedRegionVisual | null => {
    if (!region?.enabled || state === 'normal') {
        return null;
    }

    const visual = region.visual;

    if (state === 'hover') {
        return {
            state,
            tint: parseRegionHoverColor(visual.hoverTint, visual.hoverOpacity ?? DEFAULT_HOVER_OPACITY),
            highlightActive: true
        };
    }

    if (state === 'visited') {
        const visited = visual.visited;
        if (!visited || visited.enabled === false) {
            return null;
        }

        return {
            state,
            tint: parseRegionVisitedColor(
                visited.color,
                visited.opacity ?? DEFAULT_VISITED_OPACITY
            ),
            highlightActive: true
        };
    }

    return {
        state: 'selected',
        tint: parseRegionActiveColor(visual.activeTint, visual.activeOpacity ?? DEFAULT_ACTIVE_OPACITY),
        highlightActive: true
    };
};

export {
    RegionVisualState,
    ResolvedRegionVisual,
    resolveRegionVisual
};
