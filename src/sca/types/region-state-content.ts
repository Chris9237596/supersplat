/** Phase 0/1 supported and future layer types. Unknown types are preserved on load. */
type ScaRegionStateContentLayerType =
    | 'placeholder'
    | 'region-overlay'
    | 'splat'
    | 'generated-gaussian'
    | 'path'
    | 'line'
    | 'label'
    | 'marker'
    | 'effect';

type ScaRegionStateContentLayerBase = {
    id: string;
    type: ScaRegionStateContentLayerType | (string & {});
    enabled: boolean;
    name?: string;
};

type ScaRegionPlaceholderLayer = ScaRegionStateContentLayerBase & {
    type: 'placeholder';
};

type ScaRegionOverlayLayer = ScaRegionStateContentLayerBase & {
    type: 'region-overlay';
    color: string;
    opacity: number;
};

type ScaRegionStateContentLayer =
    | ScaRegionPlaceholderLayer
    | ScaRegionOverlayLayer
    | ScaRegionStateContentLayerBase;

type ScaRegionStateContentState = {
    layers: ScaRegionStateContentLayer[];
};

/** Optional content bindings keyed by visual state name. */
type ScaRegionVisualStateContent = {
    visited?: ScaRegionStateContentState;
};

const isRegionOverlayLayer = (
    layer: ScaRegionStateContentLayer
): layer is ScaRegionOverlayLayer => (
    layer.type === 'region-overlay' &&
    typeof (layer as ScaRegionOverlayLayer).color === 'string' &&
    typeof (layer as ScaRegionOverlayLayer).opacity === 'number'
);

export {
    isRegionOverlayLayer,
    ScaRegionOverlayLayer,
    ScaRegionPlaceholderLayer,
    ScaRegionStateContentLayer,
    ScaRegionStateContentLayerType,
    ScaRegionStateContentState,
    ScaRegionVisualStateContent
};
