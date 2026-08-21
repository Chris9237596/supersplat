import { ScaViewerBackground } from '../types/project';

const DEFAULT_BACKGROUND_COLOR = '#000000';
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const normalizeHexColor = (raw: unknown, fallback = DEFAULT_BACKGROUND_COLOR): string => {
    if (typeof raw !== 'string') {
        return fallback;
    }

    const trimmed = raw.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
        return fallback;
    }

    return trimmed.toLowerCase();
};

const normalizeBackgroundType = (raw: unknown): ScaViewerBackground['type'] => {
    if (raw === 'transparent' || raw === 'image' || raw === 'panorama') {
        return raw;
    }

    return 'color';
};

const normalizeBackgroundImage = (raw: unknown): ScaViewerBackground['image'] | undefined => {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const record = raw as Record<string, unknown>;
    const filename = typeof record.filename === 'string' && record.filename.trim().length > 0 ?
        record.filename.trim() :
        undefined;
    const assetId = typeof record.assetId === 'string' && record.assetId.trim().length > 0 ?
        record.assetId.trim() :
        undefined;

    if (!filename && !assetId) {
        return undefined;
    }

    return {
        assetId: assetId ?? 'background',
        filename
    };
};

const normalizeBackground = (raw: unknown): ScaViewerBackground => {
    if (!raw || typeof raw !== 'object') {
        return {
            type: 'color',
            color: DEFAULT_BACKGROUND_COLOR
        };
    }

    const record = raw as Record<string, unknown>;
    const type = normalizeBackgroundType(record.type);

    if (type === 'transparent') {
        return { type: 'transparent' };
    }

    if (type === 'image' || type === 'panorama') {
        const image = normalizeBackgroundImage(record.image);
        return {
            type,
            image: image ?? { assetId: 'background' }
        };
    }

    return {
        type: 'color',
        color: normalizeHexColor(record.color)
    };
};

const backgroundAssetPath = (filename: string): string => {
    return `assets/${filename}`;
};

const parseHexColor = (hex: string): { r: number; g: number; b: number } => {
    const normalized = normalizeHexColor(hex);
    const value = normalized.slice(1);
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    return { r, g, b };
};

const rgbToHex = (r: number, g: number, b: number): string => {
    const channel = (value: number) => {
        return Math.max(0, Math.min(255, Math.round(value * 255)))
            .toString(16)
            .padStart(2, '0');
    };

    return `#${channel(r)}${channel(g)}${channel(b)}`;
};

const inferBackgroundFilename = (sourceName: string): string => {
    const match = /\.(png|jpe?g|webp)$/i.exec(sourceName);
    const ext = match ? match[0].slice(1).toLowerCase().replace('jpeg', 'jpg') : 'png';
    return `background.${ext === 'jpeg' ? 'jpg' : ext}`;
};

export {
    backgroundAssetPath,
    DEFAULT_BACKGROUND_COLOR,
    inferBackgroundFilename,
    normalizeBackground,
    normalizeHexColor,
    parseHexColor,
    rgbToHex
};
