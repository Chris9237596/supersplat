/**
 * Transient editor-only Region visual preview while authoring controls are focused.
 * Not persisted, not dirty, not in history.
 *
 * Future states (not in schema yet): 'normal' | 'pressed' | 'disabled'
 */
type RegionAuthoringPreviewState = null | 'hover' | 'selected';

export {
    RegionAuthoringPreviewState
};
