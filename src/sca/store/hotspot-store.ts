import { ScaHotspot, ScaProject } from '../types/project';
import { createEmptyProject } from '../types/project';

class HotspotStore {
    private project: ScaProject;
    private selectedHotspotId: string | null = null;

    constructor(project: ScaProject = createEmptyProject()) {
        this.project = structuredClone(project);
    }

    getProject(): ScaProject {
        return structuredClone(this.project);
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
        this.project = structuredClone(project);

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
