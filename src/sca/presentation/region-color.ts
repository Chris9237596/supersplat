import {
    DEFAULT_ACTIVE_TINT,
    DEFAULT_HOVER_TINT
} from '../region-defaults';

type RgbaColor = {
    r: number;
    g: number;
    b: number;
    a: number;
};

const normalizeHexColor = (raw: unknown, fallback: string): string => {
    if (typeof raw !== 'string') {
        return fallback;
    }

    const trimmed = raw.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : fallback;
};

const parseRegionHexColor = (
    hex: unknown,
    opacity: number,
    fallbackHex: string = DEFAULT_ACTIVE_TINT
): RgbaColor => {
    const normalized = normalizeHexColor(hex, fallbackHex);
    const clampedOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.55;

    return {
        r: parseInt(normalized.slice(1, 3), 16) / 255,
        g: parseInt(normalized.slice(3, 5), 16) / 255,
        b: parseInt(normalized.slice(5, 7), 16) / 255,
        a: clampedOpacity
    };
};

const parseRegionHoverColor = (hex: unknown, opacity: number): RgbaColor => {
    return parseRegionHexColor(hex, opacity, DEFAULT_HOVER_TINT);
};

const parseRegionActiveColor = (hex: unknown, opacity: number): RgbaColor => {
    return parseRegionHexColor(hex, opacity, DEFAULT_ACTIVE_TINT);
};

export {
    RgbaColor,
    normalizeHexColor,
    parseRegionActiveColor,
    parseRegionHexColor,
    parseRegionHoverColor
};
