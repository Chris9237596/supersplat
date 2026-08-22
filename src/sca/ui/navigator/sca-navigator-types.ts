type ScaNavigatorItemType = 'scene' | 'hotspot' | 'region' | 'path' | 'rig' | 'animation';

type ScaNavigatorItem = {
    type: ScaNavigatorItemType;
    id: string;
    label: string;
};

const navigatorLabelForName = (name: string | undefined, id: string): string => {
    const trimmed = name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : id;
};

export { navigatorLabelForName, ScaNavigatorItem, ScaNavigatorItemType };
