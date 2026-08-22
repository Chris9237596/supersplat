import {
    DEFAULT_REGION_OVERLAY_COLOR,
    DEFAULT_REGION_OVERLAY_OPACITY
} from './region-defaults';
import {
    isRegionOverlayLayer,
    ScaRegionOverlayLayer,
    ScaRegionStateContentLayer,
    ScaRegionStateContentLayerType,
    ScaRegionVisualStateContent
} from './types/region-state-content';

const PHASE0_LAYER_TYPE: ScaRegionStateContentLayerType = 'placeholder';
const REGION_OVERLAY_LAYER_TYPE: ScaRegionStateContentLayerType = 'region-overlay';

const KNOWN_LAYER_TYPES = new Set<string>([
    'placeholder',
    'region-overlay',
    'splat',
    'generated-gaussian',
    'path',
    'line',
    'label',
    'marker',
    'effect'
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeLayerId = (raw: unknown, fallbackIndex: number): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!/^state_layer_\d+$/.test(trimmed)) {
        console.warn(`[SCA] ignoring invalid state layer id at index ${fallbackIndex}: ${raw}`);
        return null;
    }

    return trimmed;
};

const normalizeLayerName = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') {
        return undefined;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeHexColor = (raw: unknown, fallback: string): string => {
    if (typeof raw !== 'string') {
        return fallback;
    }

    const trimmed = raw.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : fallback;
};

const normalizeOpacity = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return fallback;
    }

    return Math.max(0, Math.min(1, raw));
};

const normalizePlaceholderLayer = (
    record: Record<string, unknown>,
    index: number
): ScaRegionStateContentLayer | null => {
    const id = normalizeLayerId(record.id, index);
    if (!id) {
        return null;
    }

    return {
        id,
        type: PHASE0_LAYER_TYPE,
        enabled: record.enabled !== false,
        name: normalizeLayerName(record.name)
    };
};

const normalizeRegionOverlayLayer = (
    record: Record<string, unknown>,
    index: number
): ScaRegionOverlayLayer | null => {
    const id = normalizeLayerId(record.id, index);
    if (!id) {
        return null;
    }

    return {
        id,
        type: REGION_OVERLAY_LAYER_TYPE,
        enabled: record.enabled !== false,
        name: normalizeLayerName(record.name),
        color: normalizeHexColor(record.color, DEFAULT_REGION_OVERLAY_COLOR),
        opacity: normalizeOpacity(record.opacity, DEFAULT_REGION_OVERLAY_OPACITY)
    };
};

/** Preserve unknown future layer types with minimal validation. */
const normalizeUnknownLayer = (
    record: Record<string, unknown>,
    index: number
): ScaRegionStateContentLayer | null => {
    const id = normalizeLayerId(record.id, index);
    if (!id || typeof record.type !== 'string' || record.type.trim().length === 0) {
        console.warn(`[SCA] ignoring unsupported state layer at index ${index}`);
        return null;
    }

    return {
        id,
        type: record.type.trim(),
        enabled: record.enabled !== false,
        name: normalizeLayerName(record.name)
    };
};

const normalizeStateContentLayer = (
    raw: unknown,
    index: number
): ScaRegionStateContentLayer | null => {
    if (!isRecord(raw)) {
        return null;
    }

    const type = typeof raw.type === 'string' ? raw.type.trim() : '';

    if (type === PHASE0_LAYER_TYPE) {
        return normalizePlaceholderLayer(raw, index);
    }

    if (type === REGION_OVERLAY_LAYER_TYPE) {
        return normalizeRegionOverlayLayer(raw, index);
    }

    if (KNOWN_LAYER_TYPES.has(type)) {
        return normalizeUnknownLayer(raw, index);
    }

    if (type.length > 0) {
        return normalizeUnknownLayer(raw, index);
    }

    console.warn(`[SCA] ignoring state layer at index ${index}: missing type`);
    return null;
};

const normalizeVisitedStateContent = (raw: unknown): ScaRegionVisualStateContent['visited'] | undefined => {
    if (!isRecord(raw)) {
        return undefined;
    }

    const layersRaw = raw.layers;
    if (!Array.isArray(layersRaw) || layersRaw.length === 0) {
        return undefined;
    }

    const layers: ScaRegionStateContentLayer[] = [];
    const seenIds = new Set<string>();

    for (let index = 0; index < layersRaw.length; index++) {
        const layer = normalizeStateContentLayer(layersRaw[index], index);
        if (!layer || seenIds.has(layer.id)) {
            continue;
        }

        seenIds.add(layer.id);
        layers.push(layer);
    }

    return layers.length > 0 ? { layers } : undefined;
};

const normalizeVisualStateContent = (raw: unknown): ScaRegionVisualStateContent | undefined => {
    if (!isRecord(raw)) {
        return undefined;
    }

    const visited = normalizeVisitedStateContent(raw.visited);
    if (!visited) {
        return undefined;
    }

    return { visited };
};

const createDefaultPlaceholderLayer = (
    id: string,
    name?: string
): ScaRegionStateContentLayer => ({
    id,
    type: PHASE0_LAYER_TYPE,
    enabled: true,
    name: name ?? 'Placeholder Layer'
});

const createDefaultRegionOverlayLayer = (
    id: string,
    name?: string
): ScaRegionOverlayLayer => ({
    id,
    type: REGION_OVERLAY_LAYER_TYPE,
    enabled: true,
    name: name ?? 'Region Overlay',
    color: DEFAULT_REGION_OVERLAY_COLOR,
    opacity: DEFAULT_REGION_OVERLAY_OPACITY
});

const mergeVisualStateContent = (
    current: ScaRegionVisualStateContent | undefined,
    patch: Partial<ScaRegionVisualStateContent> | undefined
): ScaRegionVisualStateContent | undefined => {
    if (!patch) {
        return current;
    }

    if (patch.visited === undefined) {
        return current;
    }

    const layers = patch.visited.layers ?? [];
    if (layers.length === 0) {
        if (!current?.visited) {
            return current;
        }

        const next = { ...current };
        delete next.visited;
        return Object.keys(next).length > 0 ? next : undefined;
    }

    return {
        ...current,
        visited: {
            layers: layers.map((layer) => ({ ...layer }))
        }
    };
};

export {
    createDefaultPlaceholderLayer,
    createDefaultRegionOverlayLayer,
    isRegionOverlayLayer,
    KNOWN_LAYER_TYPES,
    mergeVisualStateContent,
    normalizeVisualStateContent,
    PHASE0_LAYER_TYPE,
    REGION_OVERLAY_LAYER_TYPE
};
