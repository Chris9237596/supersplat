import { ScaHotspot } from '../types/project';

import {
    TOOLTIP_ARROW_OFFSET,
    TOOLTIP_MARGIN
} from './annotation-constants';

type HotspotSelectHandler = (hotspotId: string) => void;

class HotspotMarkerView {
    private anchor: HTMLElement;
    private badge: HTMLElement;
    private card: HTMLElement;
    private titleEl: HTMLElement;
    private textEl: HTMLElement;
    private hotspotId: string | null = null;
    private screenVisible = true;
    private hotspotEnabled = true;
    private selected = false;
    private screenX = 0;
    private screenY = 0;

    constructor(
        private overlay: HTMLElement,
        private onSelect: HotspotSelectHandler
    ) {
        this.anchor = document.createElement('div');
        this.anchor.className = 'sca-hotspot-marker-anchor';

        // Matches SuperSplat Viewer click target class; rendered visibly in the editor.
        this.badge = document.createElement('div');
        this.badge.className = 'pc-annotation-hotspot sca-hotspot-marker-badge';
        this.badge.setAttribute('role', 'button');

        this.titleEl = document.createElement('div');
        this.titleEl.className = 'pc-annotation-title';

        this.textEl = document.createElement('div');
        this.textEl.className = 'pc-annotation-text';

        this.card = document.createElement('div');
        this.card.className = 'pc-annotation sca-hotspot-marker-card';
        this.card.append(this.titleEl);
        this.card.append(this.textEl);

        this.anchor.append(this.badge);
        this.overlay.append(this.anchor);
        this.overlay.append(this.card);

        this.badge.addEventListener('pointerdown', (event: PointerEvent) => {
            event.stopPropagation();
        });

        this.badge.addEventListener('pointerup', (event: PointerEvent) => {
            event.stopPropagation();
            if (this.hotspotId) {
                this.onSelect(this.hotspotId);
            }
        });
    }

    updateFromHotspot(hotspot: ScaHotspot, index: number, selected: boolean): void {
        this.hotspotId = hotspot.id;
        this.hotspotEnabled = hotspot.enabled;
        this.selected = selected;

        this.badge.textContent = String(index + 1);
        this.badge.setAttribute('aria-label', `Select hotspot ${index + 1}: ${hotspot.name || 'Untitled'}`);

        this.titleEl.textContent = hotspot.name || 'Untitled';
        this.textEl.textContent = hotspot.text;

        this.badge.classList.toggle('is-selected', selected);
        this.applyVisibility();
        this.layoutCard(this.overlay.clientWidth, this.overlay.clientHeight);
    }

    setScreenPosition(x: number, y: number, visible: boolean, viewportWidth: number, viewportHeight: number): void {
        this.screenX = x;
        this.screenY = y;
        this.screenVisible = visible;

        this.anchor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        this.applyVisibility();
        this.layoutCard(viewportWidth, viewportHeight);
    }

    private layoutCard(viewportWidth: number, viewportHeight: number): void {
        if (!this.selected || !this.screenVisible || !this.hotspotEnabled) {
            this.card.classList.add('is-hidden');
            return;
        }

        this.card.classList.remove('is-hidden');

        // Measure after display so width/height are available.
        const tooltipWidth = this.card.offsetWidth;
        const tooltipHeight = this.card.offsetHeight;

        let left = this.screenX + TOOLTIP_ARROW_OFFSET;
        let top = this.screenY - tooltipHeight / 2;
        let flipped = false;

        if (left + tooltipWidth > viewportWidth - TOOLTIP_MARGIN) {
            left = this.screenX - TOOLTIP_ARROW_OFFSET - tooltipWidth;
            flipped = true;
        }

        left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - tooltipWidth - TOOLTIP_MARGIN));
        top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportHeight - tooltipHeight - TOOLTIP_MARGIN));

        const arrowY = Math.max(16, Math.min(this.screenY - top, tooltipHeight - 16));
        this.card.style.setProperty('--arrow-top', `${arrowY}px`);
        this.card.classList.toggle('arrow-right', !flipped);
        this.card.classList.toggle('arrow-left', flipped);
        this.card.style.transform = 'none';
        this.card.style.left = `${left}px`;
        this.card.style.top = `${top}px`;
    }

    private applyVisibility(): void {
        const show = this.screenVisible && this.hotspotEnabled;
        this.anchor.classList.toggle('is-hidden', !show);
        if (!show || !this.selected) {
            this.card.classList.add('is-hidden');
        }
    }

    destroy(): void {
        this.anchor.remove();
        this.card.remove();
    }
}

export { HotspotMarkerView };
