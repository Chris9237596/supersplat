import { Container, Label } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';
import { pickSplatSurfacePoint } from '../../splat-pick';
import { defaultCameraForHotspot } from '../hotspot-defaults';

// pointer movement below this many pixels still counts as a click
const CLICK_TOLERANCE = 4;

const local = new Vec3();
const world = new Vec3();

class HotspotPlaceTool {
    activate: () => void;
    deactivate: () => void;

    constructor(
        events: Events,
        scene: Scene,
        toolsContainer: HTMLElement,
        canvasContainer: Container
    ) {
        let active = false;

        const hintLabel = new Label({
            class: 'select-toolbar-label',
            text: 'Click on the Splat to place the hotspot'
        });

        const selectToolbar = new Container({
            class: ['select-toolbar', 'select-toolbar-tool'],
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });

        selectToolbar.append(hintLabel);
        canvasContainer.append(selectToolbar);

        let clicked = false;
        let clickX = 0;
        let clickY = 0;

        const isPrimary = (e: PointerEvent) => {
            return e.pointerType === 'mouse' ? e.button === 0 : e.isPrimary;
        };

        const pickWorldOnSplat = (offsetX: number, offsetY: number): boolean => {
            const splats = scene.getElementsByType(ElementType.splat) as Splat[];
            const selection = events.invoke('selection') as Splat | null;
            const ordered = selection ?
                [selection, ...splats.filter((splat) => splat !== selection)] :
                splats;

            for (const splat of ordered) {
                if (!splat.visible) {
                    continue;
                }
                if (pickSplatSurfacePoint(scene, splat, offsetX, offsetY, local)) {
                    splat.worldTransform.transformPoint(local, world);
                    return true;
                }
            }

            return false;
        };

        const pointerdown = (e: PointerEvent) => {
            if (!active) {
                return;
            }
            if (!clicked && isPrimary(e)) {
                clicked = true;
                clickX = e.offsetX;
                clickY = e.offsetY;
            }
        };

        const pointermove = (e: PointerEvent) => {
            if (!active || !clicked) {
                return;
            }
            if (Math.hypot(e.offsetX - clickX, e.offsetY - clickY) > CLICK_TOLERANCE) {
                clicked = false;
            }
        };

        const pointerup = (e: PointerEvent) => {
            if (!active || !clicked || !isPrimary(e)) {
                return;
            }
            clicked = false;

            if (!pickWorldOnSplat(clickX, clickY)) {
                return;
            }

            const hotspotId = events.invoke('sca.hotspot.getSelected') as string | null;
            if (!hotspotId) {
                events.fire('tool.deactivate');
                return;
            }

            const position = [world.x, world.y, world.z] as [number, number, number];
            events.fire('sca.hotspot.update', hotspotId, {
                position,
                camera: defaultCameraForHotspot(position)
            });

            e.preventDefault();
            e.stopPropagation();

            events.fire('tool.deactivate');
        };

        this.activate = () => {
            if (!events.invoke('sca.hotspot.getSelected')) {
                events.fire('tool.deactivate');
                return;
            }

            active = true;
            selectToolbar.hidden = false;
            toolsContainer.classList.add('noevents');
            canvasContainer.dom.addEventListener('pointerdown', pointerdown);
            canvasContainer.dom.addEventListener('pointermove', pointermove);
            canvasContainer.dom.addEventListener('pointerup', pointerup, true);
            scene.forceRender = true;
        };

        this.deactivate = () => {
            active = false;
            clicked = false;
            selectToolbar.hidden = true;
            toolsContainer.classList.remove('noevents');
            canvasContainer.dom.removeEventListener('pointerdown', pointerdown);
            canvasContainer.dom.removeEventListener('pointermove', pointermove);
            canvasContainer.dom.removeEventListener('pointerup', pointerup, true);
            scene.forceRender = true;
        };
    }
}

export { HotspotPlaceTool };
