import { Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

const TOOLTIP_MARGIN = 8;
const TOOLTIP_ARROW_OFFSET = 25;

const registerScaRegionCardPreview = (events: Events, scene: Scene, canvasContainer: { dom: HTMLElement }): void => {
    let overlay = document.getElementById('sca-region-card-preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sca-region-card-preview-overlay';
        overlay.className = 'sca-hotspot-markers-overlay';
        canvasContainer.dom.appendChild(overlay);
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'pc-annotation-title';

    const textEl = document.createElement('div');
    textEl.className = 'pc-annotation-text';

    const card = document.createElement('div');
    card.className = 'pc-annotation sca-hotspot-marker-card sca-region-card';
    card.append(titleEl, textEl);
    overlay.append(card);

    const world = new Vec3();
    const screen = new Vec3();

    const hide = () => {
        card.classList.add('is-hidden');
    };

    const layoutCard = (screenX: number, screenY: number) => {
        card.classList.remove('is-hidden');

        const rect = canvasContainer.dom.getBoundingClientRect();
        const viewportWidth = rect.width;
        const viewportHeight = rect.height;

        const tooltipWidth = card.offsetWidth;
        const tooltipHeight = card.offsetHeight;

        let left = screenX + TOOLTIP_ARROW_OFFSET;
        let top = screenY - tooltipHeight / 2;
        let flipped = false;

        if (left + tooltipWidth > viewportWidth - TOOLTIP_MARGIN) {
            left = screenX - TOOLTIP_ARROW_OFFSET - tooltipWidth;
            flipped = true;
        }

        left = Math.max(TOOLTIP_MARGIN, Math.min(left, viewportWidth - tooltipWidth - TOOLTIP_MARGIN));
        top = Math.max(TOOLTIP_MARGIN, Math.min(top, viewportHeight - tooltipHeight - TOOLTIP_MARGIN));

        const arrowY = Math.max(16, Math.min(screenY - top, tooltipHeight - 16));
        card.style.setProperty('--arrow-top', `${arrowY}px`);
        card.classList.toggle('arrow-right', !flipped);
        card.classList.toggle('arrow-left', flipped);
        card.style.transform = 'none';
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
    };

    const computeRegionCentroid = (region: ScaRegion): Vec3 | null => {
        const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
        if (!splat) {
            return null;
        }

        const ranges = events.invoke('sca.region.getMask', region.id);
        if (!ranges || ranges.empty) {
            return null;
        }

        const xData = splat.splatData.getProp('x') as Float32Array;
        const yData = splat.splatData.getProp('y') as Float32Array;
        const zData = splat.splatData.getProp('z') as Float32Array;

        let count = 0;
        let sx = 0;
        let sy = 0;
        let sz = 0;

        ranges.forEach((index: number) => {
            sx += xData[index];
            sy += yData[index];
            sz += zData[index];
            count++;
        });

        if (count === 0) {
            return null;
        }

        world.set(sx / count, sy / count, sz / count);
        splat.worldTransform.transformPoint(world, world);
        return world.clone();
    };

    const updatePreview = () => {
        const regionId = events.invoke('sca.region.getSelected') as string | null;
        if (!regionId) {
            hide();
            return;
        }

        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        if (!region?.enabled || region.interaction.showCard === false) {
            hide();
            return;
        }

        const centroid = computeRegionCentroid(region);
        if (!centroid) {
            hide();
            return;
        }

        const camera = scene.camera;
        if (!camera?.worldToScreen) {
            hide();
            return;
        }

        camera.worldToScreen(centroid, screen);
        const rect = canvasContainer.dom.getBoundingClientRect();
        if (screen.z <= 0) {
            hide();
            return;
        }

        titleEl.textContent = region.name;
        textEl.textContent = region.text ?? '';
        layoutCard(screen.x * rect.width, screen.y * rect.height);
    };

    events.on('sca.region.selected', () => {
        updatePreview();
    });

    events.on('sca.project.changed', () => {
        updatePreview();
    });

    events.on('postrender', () => {
        updatePreview();
    });

    events.on('scene.clear', () => {
        hide();
    });
};

export { registerScaRegionCardPreview };
