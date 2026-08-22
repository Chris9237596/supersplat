const SCA_UI_LAYOUT_STORAGE_KEY = 'sca.ui.layout.v1';

const NAVIGATOR_MIN_WIDTH = 220;
const NAVIGATOR_DEFAULT_WIDTH = 260;
const NAVIGATOR_MAX_WIDTH = 420;
const NAVIGATOR_MAX_VIEWPORT_RATIO = 0.4;

const INSPECTOR_MIN_WIDTH = 280;
const INSPECTOR_DEFAULT_WIDTH = 360;
const INSPECTOR_MAX_WIDTH = 520;
const INSPECTOR_MAX_VIEWPORT_RATIO = 0.45;

const NAVIGATOR_LEFT_OFFSET = 24;
const INSPECTOR_RIGHT_OFFSET = 102;
const MIN_VIEWPORT_CENTER_GAP = 120;

type ScaUILayoutV1 = {
    navigatorVisible: boolean;
    inspectorVisible: boolean;
    navigatorWidth: number;
    inspectorWidth: number;
    timelineVisible: boolean;
    timelineHeight: number;
};

const TIMELINE_DEFAULT_HEIGHT = 240;
const TIMELINE_MIN_HEIGHT = 140;
const TIMELINE_MAX_VIEWPORT_RATIO = 0.5;

const DEFAULT_SCA_UI_LAYOUT: ScaUILayoutV1 = {
    navigatorVisible: true,
    inspectorVisible: true,
    navigatorWidth: NAVIGATOR_DEFAULT_WIDTH,
    inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
    timelineVisible: false,
    timelineHeight: TIMELINE_DEFAULT_HEIGHT
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const clampNumber = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
};

const getNavigatorMaxWidth = (viewportWidth: number): number => {
    return Math.min(NAVIGATOR_MAX_WIDTH, Math.floor(viewportWidth * NAVIGATOR_MAX_VIEWPORT_RATIO));
};

const getInspectorMaxWidth = (viewportWidth: number): number => {
    return Math.min(INSPECTOR_MAX_WIDTH, Math.floor(viewportWidth * INSPECTOR_MAX_VIEWPORT_RATIO));
};

const clampNavigatorWidth = (width: number, viewportWidth: number): number => {
    return clampNumber(width, NAVIGATOR_MIN_WIDTH, getNavigatorMaxWidth(viewportWidth));
};

const clampInspectorWidth = (width: number, viewportWidth: number): number => {
    return clampNumber(width, INSPECTOR_MIN_WIDTH, getInspectorMaxWidth(viewportWidth));
};

const normalizeLayout = (raw: unknown): ScaUILayoutV1 => {
    const next = { ...DEFAULT_SCA_UI_LAYOUT };

    if (!isRecord(raw)) {
        return next;
    }

    if (typeof raw.navigatorVisible === 'boolean') {
        next.navigatorVisible = raw.navigatorVisible;
    }
    if (typeof raw.inspectorVisible === 'boolean') {
        next.inspectorVisible = raw.inspectorVisible;
    }
    if (typeof raw.navigatorWidth === 'number' && Number.isFinite(raw.navigatorWidth)) {
        next.navigatorWidth = raw.navigatorWidth;
    }
    if (typeof raw.inspectorWidth === 'number' && Number.isFinite(raw.inspectorWidth)) {
        next.inspectorWidth = raw.inspectorWidth;
    }
    if (typeof raw.timelineVisible === 'boolean') {
        next.timelineVisible = raw.timelineVisible;
    }
    if (typeof raw.timelineHeight === 'number' && Number.isFinite(raw.timelineHeight)) {
        next.timelineHeight = raw.timelineHeight;
    }

    return next;
};

const clampTimelineHeight = (height: number, viewportHeight: number): number => {
    const maxHeight = Math.max(TIMELINE_MIN_HEIGHT, Math.floor(viewportHeight * TIMELINE_MAX_VIEWPORT_RATIO));
    return clampNumber(height, TIMELINE_MIN_HEIGHT, maxHeight);
};

const clampLayoutForViewport = (
    layout: ScaUILayoutV1,
    viewportWidth: number,
    viewportHeight = window.innerHeight
): ScaUILayoutV1 => {
    let navigatorWidth = clampNavigatorWidth(layout.navigatorWidth, viewportWidth);
    let inspectorWidth = clampInspectorWidth(layout.inspectorWidth, viewportWidth);

    if (layout.navigatorVisible && layout.inspectorVisible) {
        const maxCombined = viewportWidth
            - NAVIGATOR_LEFT_OFFSET
            - INSPECTOR_RIGHT_OFFSET
            - MIN_VIEWPORT_CENTER_GAP;

        if (maxCombined > 0 && navigatorWidth + inspectorWidth > maxCombined) {
            const navRatio = navigatorWidth / (navigatorWidth + inspectorWidth);
            navigatorWidth = clampNavigatorWidth(
                Math.floor(maxCombined * navRatio),
                viewportWidth
            );
            inspectorWidth = clampInspectorWidth(
                maxCombined - navigatorWidth,
                viewportWidth
            );

            if (navigatorWidth + inspectorWidth > maxCombined) {
                navigatorWidth = clampNavigatorWidth(
                    Math.floor(maxCombined * 0.45),
                    viewportWidth
                );
                inspectorWidth = clampInspectorWidth(
                    maxCombined - navigatorWidth,
                    viewportWidth
                );
            }
        }
    }

    return {
        ...layout,
        navigatorWidth,
        inspectorWidth,
        timelineHeight: clampTimelineHeight(layout.timelineHeight, viewportHeight)
    };
};

class ScaLayoutManager {
    private layout: ScaUILayoutV1;

    constructor() {
        this.layout = this.loadFromStorage();
    }

    private loadFromStorage(): ScaUILayoutV1 {
        try {
            const raw = localStorage.getItem(SCA_UI_LAYOUT_STORAGE_KEY);
            if (!raw) {
                return { ...DEFAULT_SCA_UI_LAYOUT };
            }

            return normalizeLayout(JSON.parse(raw));
        } catch (error) {
            console.warn('[SCA UI] invalid layout in localStorage; using defaults', error);
            return { ...DEFAULT_SCA_UI_LAYOUT };
        }
    }

    private persist(): void {
        try {
            localStorage.setItem(SCA_UI_LAYOUT_STORAGE_KEY, JSON.stringify(this.layout));
        } catch (error) {
            console.warn('[SCA UI] failed to persist layout', error);
        }
    }

    get(): ScaUILayoutV1 {
        return { ...this.layout };
    }

    getClamped(viewportWidth: number, viewportHeight = window.innerHeight): ScaUILayoutV1 {
        return clampLayoutForViewport(this.layout, viewportWidth, viewportHeight);
    }

    setNavigatorVisible(visible: boolean): void {
        if (this.layout.navigatorVisible === visible) {
            return;
        }
        this.layout = { ...this.layout, navigatorVisible: visible };
        this.persist();
    }

    setInspectorVisible(visible: boolean): void {
        if (this.layout.inspectorVisible === visible) {
            return;
        }
        this.layout = { ...this.layout, inspectorVisible: visible };
        this.persist();
    }

    setNavigatorWidth(width: number, viewportWidth: number): void {
        const navigatorWidth = clampNavigatorWidth(width, viewportWidth);
        const clamped = clampLayoutForViewport({
            ...this.layout,
            navigatorWidth
        }, viewportWidth);

        if (
            this.layout.navigatorWidth === clamped.navigatorWidth &&
            this.layout.inspectorWidth === clamped.inspectorWidth
        ) {
            return;
        }

        this.layout = clamped;
        this.persist();
    }

    setInspectorWidth(width: number, viewportWidth: number): void {
        const inspectorWidth = clampInspectorWidth(width, viewportWidth);
        const clamped = clampLayoutForViewport({
            ...this.layout,
            inspectorWidth
        }, viewportWidth);

        if (
            this.layout.navigatorWidth === clamped.navigatorWidth &&
            this.layout.inspectorWidth === clamped.inspectorWidth &&
            this.layout.timelineHeight === clamped.timelineHeight
        ) {
            return;
        }

        this.layout = clamped;
        this.persist();
    }

    setTimelineVisible(visible: boolean): void {
        if (this.layout.timelineVisible === visible) {
            return;
        }
        this.layout = { ...this.layout, timelineVisible: visible };
        this.persist();
    }

    setTimelineHeight(height: number, viewportHeight = window.innerHeight): void {
        const timelineHeight = clampTimelineHeight(height, viewportHeight);
        if (this.layout.timelineHeight === timelineHeight) {
            return;
        }
        this.layout = { ...this.layout, timelineHeight };
        this.persist();
    }
}

export {
    DEFAULT_SCA_UI_LAYOUT,
    INSPECTOR_DEFAULT_WIDTH,
    INSPECTOR_MIN_WIDTH,
    NAVIGATOR_DEFAULT_WIDTH,
    NAVIGATOR_MIN_WIDTH,
    SCA_UI_LAYOUT_STORAGE_KEY,
    ScaLayoutManager,
    ScaUILayoutV1,
    TIMELINE_DEFAULT_HEIGHT,
    TIMELINE_MIN_HEIGHT,
    clampLayoutForViewport,
    clampNavigatorWidth,
    clampInspectorWidth,
    clampTimelineHeight
};
