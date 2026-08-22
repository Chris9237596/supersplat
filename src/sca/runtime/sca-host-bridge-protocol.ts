export const HOST_SOURCE = 'SCA3DHost' as const;
export const VIEWER_SOURCE = 'SCA3DViewer' as const;

export const HOST_BRIDGE_INBOUND_TYPES = [
    'activateRegion',
    'activateHotspot',
    'setRegionVisited',
    'resetRegionVisited'
] as const;

export const HOST_BRIDGE_OUTBOUND_TYPES = [
    'regionVisitedChanged'
] as const;

export type HostBridgeInboundType = typeof HOST_BRIDGE_INBOUND_TYPES[number];
export type HostBridgeOutboundType = typeof HOST_BRIDGE_OUTBOUND_TYPES[number];

const inboundTypeSet = new Set<string>(HOST_BRIDGE_INBOUND_TYPES);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
    typeof value === 'string' && value.trim().length > 0
);

const isOptionalBoolean = (value: unknown): boolean => (
    value === undefined || typeof value === 'boolean'
);

export const isValidHostInboundMessage = (data: unknown): boolean => {
    if (!isPlainObject(data)) {
        return false;
    }

    if (data.source !== HOST_SOURCE) {
        return false;
    }

    if (typeof data.type !== 'string' || !inboundTypeSet.has(data.type)) {
        return false;
    }

    const payload = isPlainObject(data.payload) ? data.payload : {};

    switch (data.type as HostBridgeInboundType) {
        case 'activateRegion':
            if (!isNonEmptyString(payload.regionId)) {
                return false;
            }
            return isOptionalBoolean(payload.markVisited) &&
                isOptionalBoolean(payload.focusCamera) &&
                isOptionalBoolean(payload.showCard);
        case 'activateHotspot':
            if (!isNonEmptyString(payload.hotspotId)) {
                return false;
            }
            return isOptionalBoolean(payload.focusCamera);
        case 'setRegionVisited':
            return isNonEmptyString(payload.regionId) && typeof payload.visited === 'boolean';
        case 'resetRegionVisited':
            if (payload.regionId === undefined) {
                return true;
            }
            return isNonEmptyString(payload.regionId);
        default:
            return false;
    }
};

export const parseHostInboundMessage = (
    data: unknown
): { type: HostBridgeInboundType; payload: Record<string, unknown> } | null => {
    if (!isValidHostInboundMessage(data) || !isPlainObject(data)) {
        return null;
    }

    return {
        type: data.type as HostBridgeInboundType,
        payload: isPlainObject(data.payload) ? data.payload : {}
    };
};

export type RegionVisitedChangedMessage = {
    source: typeof VIEWER_SOURCE;
    type: 'regionVisitedChanged';
    payload: {
        regionId: string;
        visited: boolean;
    };
};

export const buildRegionVisitedChangedMessage = (
    regionId: string,
    visited: boolean
): RegionVisitedChangedMessage => ({
    source: VIEWER_SOURCE,
    type: 'regionVisitedChanged',
    payload: {
        regionId,
        visited: !!visited
    }
});
