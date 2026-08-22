type EditorRegionPreviewDebugCategory = 'hover' | 'highlight';

const isEditorRegionPreviewDebugEnabled = (
    category: EditorRegionPreviewDebugCategory
): boolean => {
    const debug = (window as typeof window & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    if (!debug) {
        return false;
    }

    if (debug.editorRegionPreview) {
        return true;
    }

    return category === 'hover' ?
        !!debug.editorHover :
        !!debug.editorHighlight;
};

const logEditorRegionHover = (
    previewEnabled: boolean,
    regionId: string | null
): void => {
    if (!isEditorRegionPreviewDebugEnabled('hover')) {
        return;
    }

    console.log(
        '[SCA EDITOR HOVER]\n' +
        `previewEnabled=${previewEnabled}\n` +
        `regionId=${regionId ?? 'null'}`
    );
};

const logEditorRegionHighlight = (payload: {
    selectedRegionId: string | null;
    hoverRegionId: string | null;
    authoringPreviewState?: string | null;
    selectedMembers: number;
    hoverMembers: number;
    hoverStatePixels?: number;
    selectedStatePixels?: number;
}): void => {
    if (!isEditorRegionPreviewDebugEnabled('highlight')) {
        return;
    }

    const lines = [
        '[SCA EDITOR HIGHLIGHT]',
        `selectedRegionId=${payload.selectedRegionId ?? 'null'}`,
        `hoverRegionId=${payload.hoverRegionId ?? 'null'}`,
        `authoringPreviewState=${payload.authoringPreviewState ?? 'null'}`,
        `selectedMembers=${payload.selectedMembers}`,
        `hoverMembers=${payload.hoverMembers}`
    ];

    if (payload.hoverStatePixels !== undefined) {
        lines.push(`hoverStatePixels=${payload.hoverStatePixels}`);
    }

    if (payload.selectedStatePixels !== undefined) {
        lines.push(`selectedStatePixels=${payload.selectedStatePixels}`);
    }

    console.log(lines.join('\n'));
};

export {
    isEditorRegionPreviewDebugEnabled,
    logEditorRegionHighlight,
    logEditorRegionHover
};
