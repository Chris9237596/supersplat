import { Container, Label } from '@playcanvas/pcui';
import { Entity, TranslateGizmo, Vec3 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';
import { pickSplatSurfacePoint } from '../../splat-pick';
import { TransformHandler } from '../../transform-handler';

import { ScaFocusHelper } from './sca-focus-helper';
import { ScaFocusPosition, ScaFocusState } from './sca-focus-state';

const CLICK_TOLERANCE = 4;

const local = new Vec3();
const world = new Vec3();
const focusVec = new Vec3();

class ScaFocusTransformHandler implements TransformHandler {
    activate() {}
    deactivate() {}
}

class ScaFocusController {
    private helper: ScaFocusHelper;
    private gizmo: TranslateGizmo;
    private entity: Entity;
    private transformHandler = new ScaFocusTransformHandler();
    private selectToolbar: Container;
    private gizmoAttached = false;
    private transformHandlerPushed = false;
    private pointerActive = false;
    private canvasContainer: Container;

    private clicked = false;
    private clickX = 0;
    private clickY = 0;

    constructor(
        private events: Events,
        private scene: Scene,
        private state: ScaFocusState,
        canvasContainer: Container
    ) {
        this.canvasContainer = canvasContainer;
        this.helper = new ScaFocusHelper(scene);
        this.gizmo = new TranslateGizmo(scene.camera.camera, scene.gizmoLayer);
        this.entity = new Entity('scaFocusGizmoPivot');
        scene.contentRoot.addChild(this.entity);

        const hintLabel = new Label({
            class: 'select-toolbar-label',
            text: 'Click on the Splat to set the focus point'
        });

        this.selectToolbar = new Container({
            class: ['select-toolbar', 'select-toolbar-tool'],
            hidden: true
        });

        this.selectToolbar.dom.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        this.selectToolbar.append(hintLabel);
        canvasContainer.append(this.selectToolbar);

        this.gizmo.on('render:update', () => {
            this.scene.forceRender = true;
        });

        this.gizmo.on('transform:move', () => {
            this.applyEntityPositionToFocus();
        });

        events.on('sca.focus.mode.set', (active: boolean) => {
            this.state.setMode(active);
            this.sync();
            if (active && this.state.hasPosition()) {
                const position = this.state.getPosition()!;
                focusVec.set(position[0], position[1], position[2]);
                this.scene.camera.setFocalPoint(focusVec, 0);
            }
            this.events.fire('sca.focus.changed');
        });

        events.on('sca.focus.position.set', (position: ScaFocusPosition) => {
            this.setFocusPosition(position);
        });

        events.on('sca.focus.clear', () => {
            this.state.clear();
            this.sync();
            this.events.fire('sca.focus.changed');
        });

        events.on('camera.resize', () => this.updateGizmoSize());
        events.on('camera.ortho', () => this.updateGizmoSize());

        this.updateGizmoSize();
        this.sync();
    }

    private canPick(): boolean {
        return !this.events.invoke('tool.active');
    }

    private isPrimary(event: PointerEvent): boolean {
        return event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;
    }

    private pickWorldOnSplat(offsetX: number, offsetY: number): boolean {
        const splats = this.scene.getElementsByType(ElementType.splat) as Splat[];
        const selection = this.events.invoke('selection') as Splat | null;
        const ordered = selection ?
            [selection, ...splats.filter((splat) => splat !== selection)] :
            splats;

        for (const splat of ordered) {
            if (!splat.visible) {
                continue;
            }
            if (pickSplatSurfacePoint(this.scene, splat, offsetX, offsetY, local)) {
                splat.worldTransform.transformPoint(local, world);
                return true;
            }
        }

        return false;
    }

    private pointerdown = (event: PointerEvent) => {
        if (!this.pointerActive) {
            return;
        }
        if (!this.canPick()) {
            console.log('[SCA Focus] pointerdown ignored: tool.active =', this.events.invoke('tool.active'));
            return;
        }
        if (!this.clicked && this.isPrimary(event)) {
            this.clicked = true;
            this.clickX = event.offsetX;
            this.clickY = event.offsetY;
        }
    };

    private pointermove = (event: PointerEvent) => {
        if (!this.pointerActive || !this.clicked) {
            return;
        }
        if (Math.hypot(event.offsetX - this.clickX, event.offsetY - this.clickY) > CLICK_TOLERANCE) {
            this.clicked = false;
        }
    };

    private pointerup = (event: PointerEvent) => {
        console.log('[SCA Focus] pointerup received', {
            pointerActive: this.pointerActive,
            clicked: this.clicked,
            primary: this.isPrimary(event),
            offsetX: event.offsetX,
            offsetY: event.offsetY
        });

        if (!this.pointerActive || !this.clicked || !this.isPrimary(event)) {
            return;
        }
        this.clicked = false;

        console.log('[SCA Focus] attempting pick', { x: this.clickX, y: this.clickY });
        const picked = this.pickWorldOnSplat(this.clickX, this.clickY);
        console.log('[SCA Focus] pick result:', picked ? [world.x, world.y, world.z] : null);

        if (!picked) {
            return;
        }

        this.setFocusPosition([world.x, world.y, world.z]);
        event.preventDefault();
        event.stopPropagation();
    };

    private setFocusPosition(position: ScaFocusPosition): void {
        this.state.setPosition(position);
        console.log('[SCA Focus] focus position updated:', position);
        this.sync();
        if (this.state.isModeActive()) {
            focusVec.set(position[0], position[1], position[2]);
            this.scene.camera.setFocalPoint(focusVec, 0);
            console.log('[SCA Focus] setFocalPoint called', [focusVec.x, focusVec.y, focusVec.z]);
        }
        this.events.fire('sca.focus.changed');
    }

    private applyEntityPositionToFocus(): void {
        const pos = this.entity.getPosition();
        this.state.setPosition([pos.x, pos.y, pos.z]);
        this.helper.sync(this.state);
        if (this.state.isModeActive()) {
            this.scene.camera.setFocalPoint(pos, 0);
        }
        this.events.fire('sca.focus.changed');
        this.scene.forceRender = true;
    }

    private sync(): void {
        const position = this.state.getPosition();
        this.helper.sync(this.state);
        this.selectToolbar.hidden = !this.state.isModeActive();

        if (position) {
            this.entity.setPosition(position[0], position[1], position[2]);
        }

        this.updateGizmoAttachment();
        this.updatePointerListeners();
        this.scene.forceRender = true;
    }

    private updateGizmoAttachment(): void {
        const showGizmo = this.state.isModeActive() && this.state.hasPosition();

        if (showGizmo && !this.gizmoAttached) {
            this.gizmo.attach(this.entity);
            this.gizmoAttached = true;
            console.log('[SCA Focus] gizmo attached');
        } else if (!showGizmo && this.gizmoAttached) {
            this.gizmo.detach();
            this.gizmoAttached = false;
        }

        if (showGizmo && !this.transformHandlerPushed) {
            this.events.fire('transformHandler.push', this.transformHandler);
            this.transformHandlerPushed = true;
        } else if (!showGizmo && this.transformHandlerPushed) {
            this.events.fire('transformHandler.pop');
            this.transformHandlerPushed = false;
        }
    }

    private updatePointerListeners(): void {
        const canvasContainer = this.canvasContainer.dom;
        const shouldListen = this.state.isModeActive();

        if (shouldListen === this.pointerActive) {
            return;
        }

        this.pointerActive = shouldListen;

        if (shouldListen) {
            console.log('[SCA Focus] attaching pointer listeners to #canvas-container');
            canvasContainer.addEventListener('pointerdown', this.pointerdown);
            canvasContainer.addEventListener('pointermove', this.pointermove);
            canvasContainer.addEventListener('pointerup', this.pointerup, true);
        } else {
            canvasContainer.removeEventListener('pointerdown', this.pointerdown);
            canvasContainer.removeEventListener('pointermove', this.pointermove);
            canvasContainer.removeEventListener('pointerup', this.pointerup, true);
            this.clicked = false;
        }
    }

    private updateGizmoSize(): void {
        const { camera, canvas } = this.scene;
        if (camera.ortho) {
            this.gizmo.size = 1125 / canvas.clientHeight;
        } else {
            this.gizmo.size = 1200 / Math.max(canvas.clientWidth, canvas.clientHeight);
        }
    }

    destroy(): void {
        if (this.pointerActive) {
            this.updatePointerListeners();
        }
        if (this.gizmoAttached) {
            this.gizmo.detach();
        }
        if (this.transformHandlerPushed) {
            this.events.fire('transformHandler.pop');
        }
        this.helper.destroy();
        this.entity.destroy();
    }
}

export { ScaFocusController };
