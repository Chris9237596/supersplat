import { RegionAnchor3D } from './region-anchor';
import { RegionPresentationEntry } from './region-presentation-state';
import { RegionVisualState } from './region-visual';

type RegionCardModel = {
    regionId: string;
    name: string;
    text: string;
    visible: boolean;
    anchor3D: RegionAnchor3D | null;
    state: RegionVisualState;
};

const buildRegionCardModel = (entry: RegionPresentationEntry | null): RegionCardModel | null => {
    if (!entry || !entry.cardVisible) {
        return null;
    }

    return {
        regionId: entry.regionId,
        name: entry.name,
        text: entry.text,
        visible: entry.cardVisible,
        anchor3D: entry.anchor3D,
        state: entry.state
    };
};

export {
    RegionCardModel,
    buildRegionCardModel
};
