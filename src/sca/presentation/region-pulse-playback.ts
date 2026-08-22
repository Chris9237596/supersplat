import { ScaRegion } from '../types/region';

type RegionPulsePlaybackState = {
    regionVisited?: boolean;
    /** @deprecated Prefer regionVisited — kept for transitional callers. */
    pulseStoppedByInteraction?: boolean;
};

const shouldPlayAuthoredRegionPulse = (
    region: ScaRegion | null | undefined,
    playback: RegionPulsePlaybackState
): boolean => {
    const pulse = region?.visual?.pulse;
    if (!region?.enabled || !pulse?.enabled || pulse.mode !== 'loop') {
        return false;
    }

    const visited = playback.regionVisited === true || playback.pulseStoppedByInteraction === true;
    if (visited && shouldStopPulseOnRegionInteraction(region)) {
        return false;
    }

    return true;
};

const shouldStopPulseOnRegionInteraction = (region: ScaRegion | null | undefined): boolean => {
    const pulse = region?.visual?.pulse;
    return pulse?.enabled === true &&
        pulse.mode === 'loop' &&
        pulse.stopOnInteraction === true;
};

export {
    RegionPulsePlaybackState,
    shouldPlayAuthoredRegionPulse,
    shouldStopPulseOnRegionInteraction
};
