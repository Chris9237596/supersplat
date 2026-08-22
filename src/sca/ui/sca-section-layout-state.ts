const SCA_SECTION_LAYOUT_STORAGE_KEY = 'sca.ui.sections.v1';

type ScaSectionLayoutV1 = {
    project: boolean;
    viewer: boolean;
    hotspots: boolean;
    regions: boolean;
    regionGeneral: boolean;
    regionInteraction: boolean;
    regionVisual: boolean;
    regionPulse: boolean;
    regionMembership: boolean;
    export: boolean;
    advanced: boolean;
};

type ScaSectionId = keyof ScaSectionLayoutV1;

const DEFAULT_SCA_SECTION_LAYOUT: ScaSectionLayoutV1 = {
    project: true,
    viewer: false,
    hotspots: true,
    regions: true,
    regionGeneral: true,
    regionInteraction: false,
    regionVisual: true,
    regionPulse: false,
    regionMembership: false,
    export: true,
    advanced: false
};

const SECTION_IDS = Object.keys(DEFAULT_SCA_SECTION_LAYOUT) as ScaSectionId[];

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
};

const normalizeSectionLayout = (raw: unknown): ScaSectionLayoutV1 => {
    const next = { ...DEFAULT_SCA_SECTION_LAYOUT };

    if (!isRecord(raw)) {
        return next;
    }

    for (const id of SECTION_IDS) {
        if (typeof raw[id] === 'boolean') {
            next[id] = raw[id];
        }
    }

    return next;
};

class ScaSectionLayoutManager {
    private layout: ScaSectionLayoutV1;

    constructor() {
        this.layout = this.loadFromStorage();
    }

    private loadFromStorage(): ScaSectionLayoutV1 {
        try {
            const raw = localStorage.getItem(SCA_SECTION_LAYOUT_STORAGE_KEY);
            if (!raw) {
                return { ...DEFAULT_SCA_SECTION_LAYOUT };
            }

            return normalizeSectionLayout(JSON.parse(raw));
        } catch (error) {
            console.warn('[SCA UI] invalid section layout in localStorage; using defaults', error);
            return { ...DEFAULT_SCA_SECTION_LAYOUT };
        }
    }

    isOpen(sectionId: ScaSectionId): boolean {
        return this.layout[sectionId];
    }

    setOpen(sectionId: ScaSectionId, open: boolean): void {
        if (this.layout[sectionId] === open) {
            return;
        }

        this.layout = {
            ...this.layout,
            [sectionId]: open
        };

        try {
            localStorage.setItem(SCA_SECTION_LAYOUT_STORAGE_KEY, JSON.stringify(this.layout));
        } catch (error) {
            console.warn('[SCA UI] failed to persist section layout', error);
        }
    }

    toggle(sectionId: ScaSectionId): boolean {
        const next = !this.layout[sectionId];
        this.setOpen(sectionId, next);
        return next;
    }
}

export {
    DEFAULT_SCA_SECTION_LAYOUT,
    SCA_SECTION_LAYOUT_STORAGE_KEY,
    ScaSectionId,
    ScaSectionLayoutManager,
    ScaSectionLayoutV1
};
