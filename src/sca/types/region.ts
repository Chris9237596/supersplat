type ScaRegionSource = {
    type: 'gaussian-mask';
    scaSplatId: string;
    maskAsset: string;
};

type ScaRegionCapture = {
    gaussianCount: number;
};

type ScaRegionInteraction = {
    clickable: boolean;
    showCard?: boolean;
    showInNavigation?: boolean;
};

type ScaRegionPulseMode = 'loop' | 'once';

type ScaRegionPulse = {
    enabled: boolean;
    color: string;
    strength: number;
    speed: number;
    mode: ScaRegionPulseMode;
    stopOnInteraction?: boolean;
};

type ScaRegionVisitedVisual = {
    enabled: boolean;
    color: string;
    opacity: number;
};

type ScaRegionVisual = {
    hoverTint: string;
    hoverOpacity: number;
    activeTint: string;
    activeOpacity: number;
    visited?: ScaRegionVisitedVisual;
    pulse?: ScaRegionPulse;
};

type ScaRegionPatch = Omit<Partial<ScaRegion>, 'interaction' | 'visual'> & {
    interaction?: Partial<ScaRegionInteraction>;
    visual?: Partial<ScaRegionVisual> & {
        visited?: Partial<ScaRegionVisitedVisual>;
        pulse?: Partial<ScaRegionPulse>;
    };
};

type ScaRegion = {
    id: string;
    name: string;
    text?: string;
    enabled: boolean;
    source: ScaRegionSource;
    capture: ScaRegionCapture;
    interaction: ScaRegionInteraction;
    visual: ScaRegionVisual;
};

export {
    ScaRegion,
    ScaRegionCapture,
    ScaRegionInteraction,
    ScaRegionPatch,
    ScaRegionPulse,
    ScaRegionPulseMode,
    ScaRegionSource,
    ScaRegionVisitedVisual,
    ScaRegionVisual
};
