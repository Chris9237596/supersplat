import {
    TOOLTIP_ARROW_OFFSET,
    TOOLTIP_MARGIN
} from '../markers/annotation-constants';

type RegionCardLayoutInput = {
    screenX: number;
    screenY: number;
    cardWidth: number;
    cardHeight: number;
    viewportWidth: number;
    viewportHeight: number;
};

type RegionCardLayoutResult = {
    left: number;
    top: number;
    arrowTop: number;
    arrowRight: boolean;
};

const layoutRegionCard = (input: RegionCardLayoutInput): RegionCardLayoutResult => {
    const {
        screenX,
        screenY,
        cardWidth,
        cardHeight,
        viewportWidth,
        viewportHeight
    } = input;

    let left = screenX + TOOLTIP_ARROW_OFFSET;
    let top = screenY - cardHeight / 2;
    let arrowRight = true;

    if (left + cardWidth > viewportWidth - TOOLTIP_MARGIN) {
        left = screenX - TOOLTIP_ARROW_OFFSET - cardWidth;
        arrowRight = false;
    }

    left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - cardWidth - TOOLTIP_MARGIN));
    top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportHeight - cardHeight - TOOLTIP_MARGIN));

    const arrowTop = Math.max(16, Math.min(screenY - top, cardHeight - 16));

    return {
        left: Math.round(left),
        top: Math.round(top),
        arrowTop,
        arrowRight
    };
};

const applyRegionCardLayout = (
    cardElement: HTMLElement,
    layout: RegionCardLayoutResult
): void => {
    cardElement.style.setProperty('--arrow-top', `${layout.arrowTop}px`);
    cardElement.classList.toggle('arrow-right', layout.arrowRight);
    cardElement.classList.toggle('arrow-left', !layout.arrowRight);
    cardElement.style.transform = 'none';
    cardElement.style.left = `${layout.left}px`;
    cardElement.style.top = `${layout.top}px`;
};

export {
    RegionCardLayoutInput,
    RegionCardLayoutResult,
    TOOLTIP_ARROW_OFFSET,
    TOOLTIP_MARGIN,
    applyRegionCardLayout,
    layoutRegionCard
};
