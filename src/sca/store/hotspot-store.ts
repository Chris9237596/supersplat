import { ScaHotspot, ScaNavigationMode, ScaProject, ScaViewerBackground, ScaViewerConfig } from '../types/project';
import { createEmptyProject } from '../types/project';
import {
    createDefaultViewerConfig,
    ensureNavigationValid,
    normalizeProject,
    normalizeViewerConfig
} from '../viewer/viewer-config';

class HotspotStore {
    private project: ScaProject;
    private selectedHotspotId: string | null = null;

    constructor(project: ScaProject = createEmptyProject()) {
        this.project = structuredClone(project);
    }

    getProject(): ScaProject {
        return structuredClone(this.project);
    }

    getViewerConfig(fallbackInitial?: Parameters<typeof createDefaultViewerConfig>[0]): ScaViewerConfig {
        return normalizeViewerConfig(this.project.viewer, fallbackInitial);
    }

    ensureViewerConfig(fallbackInitial?: Parameters<typeof createDefaultViewerConfig>[0]): ScaViewerConfig {
        const viewer = this.project.viewer ?
            normalizeViewerConfig(this.project.viewer, fallbackInitial) :
            createDefaultViewerConfig(fallbackInitial);
        this.project.viewer = viewer;
        return structuredClone(viewer);
    }

    updateViewerConfig(viewer: ScaViewerConfig): void {
        this.project.viewer = normalizeViewerConfig(viewer);
    }

    updateViewerCameraInitial(patch: Partial<ScaViewerConfig['camera']['initial']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = {
            ...current,
            camera: {
                ...current.camera,
                initial: {
                    position: patch.position ?
                        [...patch.position] as ScaViewerConfig['camera']['initial']['position'] :
                        [...current.camera.initial.position] as ScaViewerConfig['camera']['initial']['position'],
                    target: patch.target ?
                        [...patch.target] as ScaViewerConfig['camera']['initial']['target'] :
                        [...current.camera.initial.target] as ScaViewerConfig['camera']['initial']['target'],
                    fov: patch.fov ?? current.camera.initial.fov
                }
            }
        };
    }

    updateViewerNavigation(patch: Partial<ScaViewerConfig['navigation']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = {
            ...current,
            navigation: ensureNavigationValid({
                defaultMode: patch.defaultMode ?? current.navigation.defaultMode,
                allowedModes: patch.allowedModes ?? current.navigation.allowedModes
            })
        };
    }

    setViewerAllowedMode(mode: ScaNavigationMode, enabled: boolean): void {
        const current = this.getViewerConfig();
        let allowedModes = [...current.navigation.allowedModes];

        if (enabled) {
            if (!allowedModes.includes(mode)) {
                allowedModes.push(mode);
            }
        } else if (allowedModes.length > 1) {
            allowedModes = allowedModes.filter((entry) => entry !== mode);
        } else {
            return;
        }

        const defaultMode = allowedModes.includes(current.navigation.defaultMode) ?
            current.navigation.defaultMode :
            allowedModes[0];

        this.project.viewer = {
            ...current,
            navigation: ensureNavigationValid({ defaultMode, allowedModes })
        };
    }

    updateViewerAnimation(patch: Partial<ScaViewerConfig['camera']['animation']>): void {
        const current = this.getViewerConfig();
        const currentAnimation = current.camera.animation;
        this.project.viewer = normalizeViewerConfig({
            ...current,
            camera: {
                ...current.camera,
                animation: {
                    type: patch.type ?? currentAnimation.type,
                    duration: patch.duration ?? currentAnimation.duration,
                    turntable: patch.turntable ?
                        { ...currentAnimation.turntable, ...patch.turntable } :
                        currentAnimation.turntable
                }
            }
        });
    }

    updateViewerInteraction(patch: Partial<ScaViewerConfig['interaction']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            interaction: {
                focusTransition: {
                    duration: patch.focusTransition?.duration ??
                        current.interaction.focusTransition.duration
                },
                homeTransition: {
                    duration: patch.homeTransition?.duration ??
                        current.interaction.homeTransition.duration
                }
            }
        });
    }

    updateViewerBackground(background: ScaViewerBackground): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            background
        });
    }

    updateViewerHotspots(patch: Partial<NonNullable<ScaViewerConfig['hotspots']>>): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            hotspots: {
                showCards: patch.showCards ?? current.hotspots?.showCards ?? true
            }
        });
    }

    getViewerBackground(): ScaViewerBackground {
        return this.getViewerConfig().background!;
    }

    getHotspots(): ScaHotspot[] {
        return this.project.hotspots.map((hotspot) => structuredClone(hotspot));
    }

    getSelectedHotspotId(): string | null {
        return this.selectedHotspotId;
    }

    getSelectedHotspot(): ScaHotspot | null {
        if (!this.selectedHotspotId) {
            return null;
        }

        const hotspot = this.project.hotspots.find((entry) => entry.id === this.selectedHotspotId);
        return hotspot ? structuredClone(hotspot) : null;
    }

    selectHotspot(id: string | null): void {
        if (id !== null && !this.project.hotspots.some((hotspot) => hotspot.id === id)) {
            return;
        }

        this.selectedHotspotId = id;
    }

    addHotspot(hotspot: ScaHotspot): void {
        if (this.project.hotspots.some((entry) => entry.id === hotspot.id)) {
            throw new Error(`[SCA] duplicate hotspot id: ${hotspot.id}`);
        }

        this.project.hotspots.push(structuredClone(hotspot));
    }

    updateHotspot(id: string, patch: Partial<ScaHotspot>): void {
        const index = this.project.hotspots.findIndex((hotspot) => hotspot.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown hotspot id: ${id}`);
        }

        const current = this.project.hotspots[index];
        const nextId = patch.id ?? current.id;

        if (nextId !== id && this.project.hotspots.some((hotspot) => hotspot.id === nextId)) {
            throw new Error(`[SCA] duplicate hotspot id: ${nextId}`);
        }

        this.project.hotspots[index] = {
            ...structuredClone(current),
            ...structuredClone(patch),
            id: nextId
        };

        if (this.selectedHotspotId === id && nextId !== id) {
            this.selectedHotspotId = nextId;
        }
    }

    deleteHotspot(id: string): void {
        const index = this.project.hotspots.findIndex((hotspot) => hotspot.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown hotspot id: ${id}`);
        }

        this.project.hotspots.splice(index, 1);

        if (this.selectedHotspotId === id) {
            this.selectedHotspotId = null;
        }
    }

    loadProject(project: ScaProject): void {
        this.project = normalizeProject(project);

        if (this.selectedHotspotId &&
            !this.project.hotspots.some((hotspot) => hotspot.id === this.selectedHotspotId)) {
            this.selectedHotspotId = null;
        }
    }

    toJSON(): ScaProject {
        return this.getProject();
    }
}

export { HotspotStore };
