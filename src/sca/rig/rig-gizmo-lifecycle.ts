/** Rig gizmo pointer-drag lifecycle — idle until pointerdown-driven drag, idle again after pointerup. */
type RigGizmoDragPhase = 'idle' | 'dragging';

class RigGizmoInteractionState {
    private phase: RigGizmoDragPhase = 'idle';

    getPhase(): RigGizmoDragPhase {
        return this.phase;
    }

    isDragging(): boolean {
        return this.phase === 'dragging';
    }

    canApplyMove(): boolean {
        return this.phase === 'dragging';
    }

    /** Returns false if a drag is already active (duplicate transform:start). */
    beginDrag(): boolean {
        if (this.phase === 'dragging') {
            return false;
        }
        this.phase = 'dragging';
        return true;
    }

    /** Returns false if not dragging (duplicate transform:end / forced cleanup). */
    endDrag(): boolean {
        if (this.phase !== 'dragging') {
            return false;
        }
        this.phase = 'idle';
        return true;
    }

    reset(): void {
        this.phase = 'idle';
    }
}

const shouldDeferHelperSync = (dragging: boolean): boolean => dragging;

const canReparentHelper = (dragging: boolean, sameSplat: boolean): boolean => {
    if (sameSplat) {
        return false;
    }
    return !dragging;
};

export {
    RigGizmoDragPhase,
    RigGizmoInteractionState,
    canReparentHelper,
    shouldDeferHelperSync
};
