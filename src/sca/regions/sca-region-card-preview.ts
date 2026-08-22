import { Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import {
    applyRegionCardLayout,
    buildRegionCardModel,
    buildRegionPresentationEntry,
    computeRegionAnchorFromIndices,
    layoutRegionCard
} from '../presentation';
import { ScaRegion } from '../types/region';

import { findSplatByScaSplatId } from './splat-identity';

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

    const screen = new Vec3();

    const hide = () => {
        card.classList.add('is-hidden');
    };

    const computeRegionAnchor = (region: ScaRegion): Vec3 | null => {
        const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
        if (!splat) {
            return null;
        }

        const ranges = events.invoke('sca.region.getMask', region.id) as IndexRanges | null;
        if (!ranges || ranges.empty) {
            return null;
        }

        const xData = splat.splatData.getProp('x') as Float32Array;
        const yData = splat.splatData.getProp('y') as Float32Array;
        const zData = splat.splatData.getProp('z') as Float32Array;
        const numSplats = splat.splatData.numSplats;

        const members: number[] = [];
        ranges.forEach((index: number) => members.push(index));

        const anchor = computeRegionAnchorFromIndices(
            members,
            {
                count: numSplats,
                getCenter(index: number) {
                    if (index < 0 || index >= numSplats) {
                        return null;
                    }
                    return [xData[index], yData[index], zData[index]];
                }
            },
            (x, y, z) => {
                const local = new Vec3(x, y, z);
                const world = new Vec3();
                splat.worldTransform.transformPoint(local, world);
                return [world.x, world.y, world.z];
            }
        );

        if (!anchor) {
            return null;
        }

        return new Vec3(anchor.x, anchor.y, anchor.z);
    };

    const updatePreview = () => {
        const regionId = events.invoke('sca.region.getSelected') as string | null;
        if (!regionId) {
            hide();
            return;
        }

        const region = events.invoke('sca.region.get', regionId) as ScaRegion | null;
        if (!region) {
            hide();
            return;
        }

        const anchor = computeRegionAnchor(region);
        const entry = buildRegionPresentationEntry(region, null, regionId, anchor ? {
            x: anchor.x,
            y: anchor.y,
            z: anchor.z
        } : null);
        const cardModel = buildRegionCardModel(entry);

        if (!cardModel?.visible || !cardModel.anchor3D) {
            hide();
            return;
        }

        const camera = scene.camera;
        if (!camera?.worldToScreen) {
            hide();
            return;
        }

        const world = new Vec3(cardModel.anchor3D.x, cardModel.anchor3D.y, cardModel.anchor3D.z);
        camera.worldToScreen(world, screen);
        const rect = canvasContainer.dom.getBoundingClientRect();
        if (screen.z <= 0) {
            hide();
            return;
        }

        titleEl.textContent = cardModel.name;
        textEl.textContent = cardModel.text;
        card.classList.remove('is-hidden');

        const screenX = screen.x * rect.width;
        const screenY = screen.y * rect.height;
        const layout = layoutRegionCard({
            screenX,
            screenY,
            cardWidth: card.offsetWidth,
            cardHeight: card.offsetHeight,
            viewportWidth: rect.width,
            viewportHeight: rect.height
        });
        applyRegionCardLayout(card, layout);
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
