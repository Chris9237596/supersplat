import { Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { Scene } from '../../scene';
import { ScaHotspot } from '../types/project';

import { HotspotMarkerView } from './hotspot-marker-view';

const world = new Vec3();
const screen = new Vec3();
const cameraOffset = new Vec3();

class HotspotMarkerManager {
    private overlay: HTMLElement;
    private views = new Map<string, HotspotMarkerView>();
    private selectedId: string | null = null;

    constructor(
        private events: Events,
        private scene: Scene,
        canvasContainer: { dom: HTMLElement }
    ) {
        this.overlay = document.createElement('div');
        this.overlay.id = 'sca-hotspot-markers-overlay';
        this.overlay.className = 'sca-hotspot-markers-overlay';
        canvasContainer.dom.appendChild(this.overlay);

        events.on('sca.project.changed', () => {
            this.syncMarkers();
        });

        events.on('sca.hotspot.selected', (id: string | null) => {
            this.selectedId = id;
            this.updateSelectionVisuals();
        });

        events.on('postrender', () => {
            this.updateScreenPositions();
        });

        this.syncMarkers();
    }

    private createView(): HotspotMarkerView {
        return new HotspotMarkerView(this.overlay, (hotspotId) => {
            const wasSelected = this.selectedId === hotspotId;
            this.events.fire('sca.hotspot.select', hotspotId);
            if (!wasSelected) {
                this.events.fire('sca.animation.previewTriggerFromTarget', 'hotspot', hotspotId);
            }
        });
    }

    private getShowCards(): boolean {
        const viewer = this.events.invoke('sca.viewer.get') as { hotspots?: { showCards?: boolean } } | null;
        return viewer?.hotspots?.showCards !== false;
    }

    private syncMarkers(): void {
        const hotspots = this.events.invoke('sca.hotspot.list') as ScaHotspot[];
        const showCards = this.getShowCards();
        const ids = new Set(hotspots.map((hotspot) => hotspot.id));

        for (const [id, view] of this.views) {
            if (!ids.has(id)) {
                view.destroy();
                this.views.delete(id);
            }
        }

        hotspots.forEach((hotspot, index) => {
            let view = this.views.get(hotspot.id);
            if (!view) {
                view = this.createView();
                this.views.set(hotspot.id, view);
            }

            view.updateFromHotspot(hotspot, index, hotspot.id === this.selectedId, showCards);
        });

        this.scene.forceRender = true;
    }

    private updateSelectionVisuals(): void {
        const hotspots = this.events.invoke('sca.hotspot.list') as ScaHotspot[];
        const showCards = this.getShowCards();

        hotspots.forEach((hotspot, index) => {
            const view = this.views.get(hotspot.id);
            if (view) {
                view.updateFromHotspot(hotspot, index, hotspot.id === this.selectedId, showCards);
            }
        });

        this.scene.forceRender = true;
    }

    private updateScreenPositions(): void {
        if (this.views.size === 0) {
            return;
        }

        const hotspots = this.events.invoke('sca.hotspot.list') as ScaHotspot[];
        const { camera } = this.scene;
        const viewport = this.overlay.parentElement ?? this.overlay;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;

        if (width <= 0 || height <= 0) {
            return;
        }

        const cameraPos = camera.mainCamera.getPosition();
        const cameraFwd = camera.mainCamera.forward;

        for (const hotspot of hotspots) {
            const view = this.views.get(hotspot.id);
            if (!view || !hotspot.enabled) {
                continue;
            }

            world.set(hotspot.position[0], hotspot.position[1], hotspot.position[2]);

            cameraOffset.sub2(world, cameraPos);
            if (cameraOffset.dot(cameraFwd) <= 0) {
                view.setScreenPosition(0, 0, false, width, height);
                continue;
            }

            camera.worldToScreen(world, screen);
            view.setScreenPosition(screen.x * width, screen.y * height, true, width, height);
        }
    }
}

export { HotspotMarkerManager };
