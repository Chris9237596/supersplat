import { generateRegionId } from './ids/generate-region-id';
import { regionMaskZipPath } from './regions/region-mask-paths';
import { ScaRegion, ScaRegionPulse, ScaRegionPulseMode } from './types/region';
import { ScaProject } from './types/project';

const DEFAULT_HOVER_TINT = '#ff6600';
const DEFAULT_ACTIVE_TINT = '#ff6600';
const DEFAULT_HOVER_OPACITY = 0.35;
const DEFAULT_ACTIVE_OPACITY = 0.55;
const DEFAULT_PULSE_STRENGTH = 0.5;
const DEFAULT_PULSE_SPEED = 1.0;

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

const normalizePulseMode = (raw: unknown): ScaRegionPulseMode => {
    return raw === 'once' ? 'once' : 'loop';
};

const normalizePulseStrength = (raw: unknown): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_PULSE_STRENGTH;
    }

    return Math.max(0, Math.min(1, raw));
};

const normalizePulseSpeed = (raw: unknown): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_PULSE_SPEED;
    }

    return Math.max(0.1, Math.min(8, raw));
};

const normalizeRegionPulseField = (
    raw: unknown,
    activeTint: string
): { pulse?: ScaRegionPulse } => {
    if (!raw || typeof raw !== 'object') {
        return {};
    }

    const record = raw as Record<string, unknown>;

    return {
        pulse: {
            enabled: record.enabled === true,
            color: normalizeHexColor(record.color, activeTint),
            strength: normalizePulseStrength(record.strength),
            speed: normalizePulseSpeed(record.speed),
            mode: normalizePulseMode(record.mode),
            stopOnInteraction: record.stopOnInteraction === true
        }
    };
};

const normalizeRegion = (raw: unknown): ScaRegion | null => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const record = raw as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim().length > 0 ?
        record.id.trim() :
        null;

    if (!id) {
        return null;
    }

    const sourceRaw = record.source;
    const sourceRecord = sourceRaw && typeof sourceRaw === 'object' ?
        sourceRaw as Record<string, unknown> :
        {};

    if (sourceRecord.type === 'splat-object') {
        console.warn(`[SCA] legacy separate-splat region "${id}" is unsupported and will be ignored`);
        return null;
    }

    if (sourceRecord.type !== 'gaussian-mask') {
        console.warn(`[SCA] unsupported region source type for "${id}": ${String(sourceRecord.type)}`);
        return null;
    }

    const scaSplatId = typeof sourceRecord.scaSplatId === 'string' && sourceRecord.scaSplatId.trim().length > 0 ?
        sourceRecord.scaSplatId.trim() :
        null;

    const maskAsset = typeof sourceRecord.maskAsset === 'string' && sourceRecord.maskAsset.trim().length > 0 ?
        sourceRecord.maskAsset.trim() :
        regionMaskZipPath(id);

    if (!scaSplatId) {
        console.warn(`[SCA] region "${id}" missing scaSplatId; ignoring`);
        return null;
    }

    const captureRaw = record.capture;
    const captureRecord = captureRaw && typeof captureRaw === 'object' ?
        captureRaw as Record<string, unknown> :
        {};
    const gaussianCount = typeof captureRecord.gaussianCount === 'number' &&
        Number.isFinite(captureRecord.gaussianCount) &&
        captureRecord.gaussianCount >= 0 ?
        Math.floor(captureRecord.gaussianCount) :
        0;

    const interactionRaw = record.interaction;
    const interactionRecord = interactionRaw && typeof interactionRaw === 'object' ?
        interactionRaw as Record<string, unknown> :
        {};

    const visualRaw = record.visual;
    const visualRecord = visualRaw && typeof visualRaw === 'object' ?
        visualRaw as Record<string, unknown> :
        {};

    return {
        id,
        name: typeof record.name === 'string' && record.name.trim().length > 0 ?
            record.name.trim() :
            id,
        text: typeof record.text === 'string' && record.text.trim().length > 0 ?
            record.text.trim() :
            undefined,
        enabled: record.enabled !== false,
        source: {
            type: 'gaussian-mask',
            scaSplatId,
            maskAsset
        },
        capture: {
            gaussianCount
        },
        interaction: {
            clickable: interactionRecord.clickable !== false,
            showCard: interactionRecord.showCard !== false,
            showInNavigation: interactionRecord.showInNavigation !== false
        },
        visual: {
            hoverTint: normalizeHexColor(visualRecord.hoverTint, DEFAULT_HOVER_TINT),
            hoverOpacity: normalizeOpacity(visualRecord.hoverOpacity, DEFAULT_HOVER_OPACITY),
            activeTint: normalizeHexColor(visualRecord.activeTint, DEFAULT_ACTIVE_TINT),
            activeOpacity: normalizeOpacity(visualRecord.activeOpacity, DEFAULT_ACTIVE_OPACITY),
            ...(normalizeRegionPulseField(visualRecord.pulse, normalizeHexColor(visualRecord.activeTint, DEFAULT_ACTIVE_TINT)))
        }
    };
};

const normalizeRegions = (raw: unknown): ScaRegion[] => {
    if (!Array.isArray(raw)) {
        return [];
    }

    const regions: ScaRegion[] = [];
    const ids = new Set<string>();

    for (const entry of raw) {
        const region = normalizeRegion(entry);
        if (!region || ids.has(region.id)) {
            continue;
        }

        ids.add(region.id);
        regions.push(region);
    }

    return regions;
};

const createDefaultRegion = (
    project: ScaProject,
    scaSplatId: string,
    gaussianCount: number,
    name?: string
): ScaRegion => {
    const id = generateRegionId(project);
    const regionNumber = project.regions.length + 1;

    return {
        id,
        name: name ?? `Region ${regionNumber}`,
        enabled: true,
        source: {
            type: 'gaussian-mask',
            scaSplatId,
            maskAsset: regionMaskZipPath(id)
        },
        capture: {
            gaussianCount
        },
        interaction: {
            clickable: true,
            showCard: true,
            showInNavigation: true
        },
        visual: {
            hoverTint: DEFAULT_HOVER_TINT,
            hoverOpacity: DEFAULT_HOVER_OPACITY,
            activeTint: DEFAULT_ACTIVE_TINT,
            activeOpacity: DEFAULT_ACTIVE_OPACITY
        }
    };
};

export {
    createDefaultRegion,
    DEFAULT_ACTIVE_OPACITY,
    DEFAULT_ACTIVE_TINT,
    DEFAULT_HOVER_OPACITY,
    DEFAULT_HOVER_TINT,
    DEFAULT_PULSE_SPEED,
    DEFAULT_PULSE_STRENGTH,
    normalizeRegion,
    normalizeRegions
};
