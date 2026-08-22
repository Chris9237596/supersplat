import {
    DEFAULT_ACTIVE_TINT,
    DEFAULT_PULSE_SPEED,
    DEFAULT_PULSE_STRENGTH
} from '../region-defaults';
import { ScaRegion, ScaRegionPulse, ScaRegionPulseMode } from '../types/region';

import { parseRegionHexColor, RgbaColor } from './region-color';

type ResolvedRegionPulse = {
    color: RgbaColor;
    strength: number;
    speed: number;
    mode: ScaRegionPulseMode;
};

const normalizePulseMode = (raw: unknown): ScaRegionPulseMode => {
    return raw === 'once' ? 'once' : 'loop';
};

const normalizePulseStrength = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return fallback;
    }

    return Math.max(0, Math.min(1, raw));
};

const normalizePulseSpeed = (raw: unknown, fallback: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return fallback;
    }

    return Math.max(0.1, Math.min(8, raw));
};

const normalizeRegionPulse = (
    raw: unknown,
    activeTint: string
): ScaRegionPulse | undefined => {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const record = raw as Record<string, unknown>;
    const colorRaw = typeof record.color === 'string' && record.color.trim().length > 0 ?
        record.color.trim() :
        activeTint;

    return {
        enabled: record.enabled === true,
        color: colorRaw,
        strength: normalizePulseStrength(record.strength, DEFAULT_PULSE_STRENGTH),
        speed: normalizePulseSpeed(record.speed, DEFAULT_PULSE_SPEED),
        mode: normalizePulseMode(record.mode)
    };
};

const resolveRegionPulse = (
    region: ScaRegion | null | undefined
): ResolvedRegionPulse | null => {
    if (!region?.enabled || !region.visual.pulse?.enabled) {
        return null;
    }

    const pulse = region.visual.pulse;
    return {
        color: parseRegionHexColor(pulse.color, 1, activeTintFallback(region)),
        strength: pulse.strength,
        speed: pulse.speed,
        mode: pulse.mode
    };
};

const resolveRegionPulsePreview = (
    region: ScaRegion | null | undefined,
    pulseOverride?: Partial<ScaRegionPulse>
): ResolvedRegionPulse | null => {
    if (!region?.enabled) {
        return null;
    }

    const base = region.visual.pulse;
    const merged: ScaRegionPulse = {
        enabled: true,
        color: pulseOverride?.color ?? base?.color ?? region.visual.activeTint ?? DEFAULT_ACTIVE_TINT,
        strength: pulseOverride?.strength ?? base?.strength ?? DEFAULT_PULSE_STRENGTH,
        speed: pulseOverride?.speed ?? base?.speed ?? DEFAULT_PULSE_SPEED,
        mode: pulseOverride?.mode ?? base?.mode ?? 'loop'
    };

    return {
        color: parseRegionHexColor(merged.color, 1, activeTintFallback(region)),
        strength: merged.strength,
        speed: merged.speed,
        mode: merged.mode
    };
};

const activeTintFallback = (region: ScaRegion): string => {
    return region.visual.activeTint || DEFAULT_ACTIVE_TINT;
};

export {
    ResolvedRegionPulse,
    normalizePulseMode,
    normalizePulseSpeed,
    normalizePulseStrength,
    normalizeRegionPulse,
    resolveRegionPulse,
    resolveRegionPulsePreview
};
