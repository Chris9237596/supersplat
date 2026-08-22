import { ScaRegion } from '../types/region';

import { RegionAnchor3D } from './region-anchor';
import { RegionVisualState, resolveRegionVisual } from './region-visual';

type RegionPresentationEntry = {
    regionId: string;
    state: RegionVisualState;
    tint: { r: number; g: number; b: number; a: number } | null;
    cardVisible: boolean;
    anchor3D: RegionAnchor3D | null;
    name: string;
    text: string;
    clickable: boolean;
    enabled: boolean;
};

type RegionPresentationState = {
    hoveredRegionId: string | null;
    selectedRegionId: string | null;
    regions: Record<string, RegionPresentationEntry>;
};

const resolveEntryState = (
    regionId: string,
    hoveredRegionId: string | null,
    selectedRegionId: string | null,
    visitedRegionIds: ReadonlySet<string> | null = null
): RegionVisualState => {
    if (selectedRegionId === regionId) {
        return 'selected';
    }
    if (hoveredRegionId === regionId) {
        return 'hover';
    }
    if (visitedRegionIds?.has(regionId)) {
        return 'visited';
    }
    return 'normal';
};

const buildRegionPresentationEntry = (
    region: ScaRegion,
    hoveredRegionId: string | null,
    selectedRegionId: string | null,
    anchor3D: RegionAnchor3D | null,
    visitedRegionIds: ReadonlySet<string> | null = null
): RegionPresentationEntry => {
    const state = resolveEntryState(region.id, hoveredRegionId, selectedRegionId, visitedRegionIds);
    const visual = resolveRegionVisual(region, state === 'normal' ? 'normal' : state);
    const cardVisible = region.enabled &&
        region.interaction.showCard !== false &&
        state === 'selected';

    return {
        regionId: region.id,
        state,
        tint: visual?.tint ?? null,
        cardVisible,
        anchor3D,
        name: region.name,
        text: region.text ?? '',
        clickable: region.interaction.clickable !== false,
        enabled: region.enabled
    };
};

const buildRegionPresentationState = (
    regions: ScaRegion[],
    hoveredRegionId: string | null,
    selectedRegionId: string | null,
    anchorByRegionId: Map<string, RegionAnchor3D | null> = new Map(),
    visitedRegionIds: ReadonlySet<string> | null = null
): RegionPresentationState => {
    const entries: Record<string, RegionPresentationEntry> = {};

    for (const region of regions) {
        if (!region?.id) {
            continue;
        }
        entries[region.id] = buildRegionPresentationEntry(
            region,
            hoveredRegionId,
            selectedRegionId,
            anchorByRegionId.get(region.id) ?? null,
            visitedRegionIds
        );
    }

    return {
        hoveredRegionId,
        selectedRegionId,
        regions: entries
    };
};

const getActivePresentationEntry = (
    state: RegionPresentationState
): RegionPresentationEntry | null => {
    if (!state.selectedRegionId) {
        return null;
    }
    return state.regions[state.selectedRegionId] ?? null;
};

const getHoverPresentationEntry = (
    state: RegionPresentationState
): RegionPresentationEntry | null => {
    if (!state.hoveredRegionId || state.hoveredRegionId === state.selectedRegionId) {
        return null;
    }
    return state.regions[state.hoveredRegionId] ?? null;
};

const getVisitedPresentationEntries = (
    state: RegionPresentationState
): RegionPresentationEntry[] => {
    return Object.values(state.regions).filter((entry) => entry.state === 'visited' && !!entry.tint);
};

export {
    RegionPresentationEntry,
    RegionPresentationState,
    buildRegionPresentationEntry,
    buildRegionPresentationState,
    getActivePresentationEntry,
    getHoverPresentationEntry,
    getVisitedPresentationEntries,
    resolveEntryState
};
