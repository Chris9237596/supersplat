import { ScaRegion } from '../types/region';

type RegionPulsePlaybackState = {
    pulseStoppedByInteraction: boolean;
};

const shouldPlayAuthoredRegionPulse = (
    region: ScaRegion | null | undefined,
    playback: RegionPulsePlaybackState
): boolean => {
    const pulse = region?.visual?.pulse;
    if (!region?.enabled || !pulse?.enabled || pulse.mode !== 'loop') {
        return false;
    }

    if (playback.pulseStoppedByInteraction) {
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
