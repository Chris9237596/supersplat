import {
    DEFAULT_REGION_OVERLAY_COLOR,
    DEFAULT_REGION_OVERLAY_OPACITY
} from '../region-defaults';
import { ScaRegion } from '../types/region';
import { isRegionOverlayLayer, ScaRegionOverlayLayer } from '../types/region-state-content';

import { parseRegionHexColor, RgbaColor } from './region-color';

const resolveFirstEnabledRegionOverlayLayer = (
    region: ScaRegion | null | undefined
): ScaRegionOverlayLayer | null => {
    if (!region) {
        return null;
    }

    const layers = region.visual.stateContent?.visited?.layers ?? [];
    for (const layer of layers) {
        if (isRegionOverlayLayer(layer) && layer.enabled !== false) {
            return layer;
        }
    }

    return null;
};

const parseRegionOverlayColor = (layer: ScaRegionOverlayLayer): RgbaColor => {
    return parseRegionHexColor(
        layer.color,
        layer.opacity,
        DEFAULT_REGION_OVERLAY_COLOR
    );
};

export {
    parseRegionOverlayColor,
    resolveFirstEnabledRegionOverlayLayer
};
