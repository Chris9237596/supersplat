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

type ScaRegionVisual = {
    hoverTint: string;
    hoverOpacity: number;
    activeTint: string;
    activeOpacity: number;
};

type ScaRegionPatch = Omit<Partial<ScaRegion>, 'interaction' | 'visual'> & {
    interaction?: Partial<ScaRegionInteraction>;
    visual?: Partial<ScaRegionVisual>;
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
    ScaRegionSource,
    ScaRegionVisual
};
