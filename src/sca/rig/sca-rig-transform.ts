import { Container } from '@playcanvas/pcui';
import { Entity } from 'playcanvas';

import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';
import { ShapeGizmoMode, ShapeTransformGizmo } from '../../tools/shape-transform-gizmo';
import { TransformHandler } from '../../transform-handler';

import { ScaProject } from '../types/project';
import { ScaRig, ScaRigNode } from '../types/rig';

import {
    getNodeWorldPivotPosition,
    readNodePatchFromHelper,
    resolveSplatForNode,
    syncHelperFromNode
} from './rig-node-space';

const CLICK_TOLERANCE_PX = 14;
const PICK_RADIUS_PX = 18;

class ScaRigTransformHandler implements TransformHandler {
    activate() {}
    deactivate() {}
}

class ScaRigTransformController {
    private gizmo: ShapeTransformGizmo;
    private entity: Entity;
    private splat: Splat | null = null;
    private selectedNodeId: string | null = null;
    private gizmoMode: ShapeGizmoMode = 'translate';
    private gizmoAttached = false;
    private transformHandlerPushed = false;
    private dragging = false;
    private syncing = false;
    private pointerActive = false;
    private clicked = false;
    private clickX = 0;
    private clickY = 0;

    private transformHandler = new ScaRigTransformHandler();

    constructor(
        private events: Events,
        private scene: Scene,
        canvasContainer: Container
    ) {
        this.entity = new Entity('scaRigGizmoPivot');

        this.gizmo = new ShapeTransformGizmo(events, scene, {
            rotate: true,
            uniformScale: true,
            lowerBoundScale: this.entity.getLocalScale(),
            onTransformStart: () => {
                this.dragging = true;
                this.events.invoke('sca.history.beginTransaction');
            },
            onTransform: () => {
                this.applyHelperToNode();
            },
            onTransformEnd: () => {
                this.dragging = false;
                this.events.invoke('sca.history.commitTransaction');
            },
            onModeChanged: (mode) => {
                this.gizmoMode = mode;
            }
        });

        events.on('sca.rig.node.selected', (nodeId: string | null) => {
            this.selectedNodeId = nodeId;
            this.sync();
        });

        events.on('sca.project.changed', () => {
            if (this.selectedNodeId) {
                const project = this.events.invoke('sca.project.get') as ScaProject | null;
                const exists = project?.rig?.nodes.some((entry) => entry.id === this.selectedNodeId);
                if (!exists) {
                    this.selectedNodeId = null;
                }
            }
            this.sync();
        });

        events.on('scene.clear', () => {
            this.selectedNodeId = null;
            this.sync();
        });

        events.on('tool.move', () => {
            if (this.selectedNodeId) {
                this.gizmo.setMode('translate');
            }
        });

        events.on('tool.rotate', () => {
            if (this.selectedNodeId) {
                this.gizmo.setMode('rotate');
            }
        });

        events.on('tool.activated', (toolName: string | null) => {
            if (!this.selectedNodeId) {
                return;
            }
            if (toolName === 'move') {
                this.gizmo.setMode('translate');
            } else if (toolName === 'rotate') {
                this.gizmo.setMode('rotate');
            }
        });

        events.function('sca.rig.transform.dragging', () => this.dragging);

        const canvasDom = canvasContainer.dom;
        canvasDom.addEventListener('pointerdown', this.onPointerDown);
        canvasDom.addEventListener('pointermove', this.onPointerMove);
        canvasDom.addEventListener('pointerup', this.onPointerUp, true);
    }

    private getSelectedNode(): ScaRigNode | null {
        if (!this.selectedNodeId) {
            return null;
        }

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        return project?.rig?.nodes.find((entry) => entry.id === this.selectedNodeId) ?? null;
    }

    private getSelectedRig(): ScaRig | null {
        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        return project?.rig ?? null;
    }

    private canPick(): boolean {
        if (this.dragging) {
            return false;
        }
        if (this.events.invoke('tool.active')) {
            return false;
        }
        if (this.events.invoke('sca.focus.mode')) {
            return false;
        }
        if (this.events.invoke('sca.viewer.preview.active')) {
            return false;
        }
        return true;
    }

    private pickNodeIdAt(clientX: number, clientY: number): string | null {
        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        const rig = project?.rig;
        if (!rig || rig.nodes.length === 0) {
            return null;
        }

        const viewport = this.scene.canvas.parentElement ?? this.scene.canvas;
        const rect = viewport.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        const pickX = clientX - rect.left;
        const pickY = clientY - rect.top;
        const { camera } = this.scene;

        let bestId: string | null = null;
        let bestDistance = PICK_RADIUS_PX;

        for (const node of rig.nodes) {
            const splat = resolveSplatForNode(this.events, this.scene, node, rig);
            if (!splat) {
                continue;
            }

            const world = getNodeWorldPivotPosition(node, splat);
            const cameraPos = camera.mainCamera.getPosition();
            const cameraFwd = camera.mainCamera.forward;
            const offset = world.clone().sub(cameraPos);
            if (offset.dot(cameraFwd) <= 0) {
                continue;
            }

            const screen = world.clone();
            camera.worldToScreen(world, screen);
            const screenX = screen.x * rect.width;
            const screenY = screen.y * rect.height;
            const distance = Math.hypot(screenX - pickX, screenY - pickY);
            if (distance <= bestDistance) {
                bestDistance = distance;
                bestId = node.id;
            }
        }

        return bestId;
    }

    private onPointerDown = (event: PointerEvent) => {
        if (!this.canPick()) {
            return;
        }

        const isPrimary = event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;
        if (!isPrimary) {
            return;
        }

        this.pointerActive = true;
        this.clicked = true;
        this.clickX = event.clientX;
        this.clickY = event.clientY;
    };

    private onPointerMove = (event: PointerEvent) => {
        if (!this.pointerActive || !this.clicked) {
            return;
        }

        if (Math.hypot(event.clientX - this.clickX, event.clientY - this.clickY) > CLICK_TOLERANCE_PX) {
            this.clicked = false;
        }
    };

    private onPointerUp = (event: PointerEvent) => {
        if (!this.pointerActive) {
            return;
        }

        this.pointerActive = false;

        const isPrimary = event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;
        if (!this.clicked || !isPrimary || !this.canPick()) {
            this.clicked = false;
            return;
        }

        this.clicked = false;
        const nodeId = this.pickNodeIdAt(event.clientX, event.clientY);
        if (!nodeId) {
            return;
        }

        this.events.fire('sca.rig.node.select', nodeId);
        event.preventDefault();
        event.stopPropagation();
    };

    private applyHelperToNode() {
        const node = this.getSelectedNode();
        if (!node || this.syncing) {
            return;
        }

        const patch = readNodePatchFromHelper(this.entity, node);
        this.events.fire('sca.rig.node.update', node.id, patch);
    }

    private sync() {
        const node = this.getSelectedNode();
        const rig = this.getSelectedRig();
        const showGizmo = !!node && !!rig;

        if (!showGizmo || !node || !rig) {
            this.detachGizmo();
            this.reparentHelper(null);
            this.scene.forceRender = true;
            return;
        }

        const splat = resolveSplatForNode(this.events, this.scene, node, rig);
        if (!splat) {
            this.detachGizmo();
            this.reparentHelper(null);
            this.scene.forceRender = true;
            return;
        }

        this.reparentHelper(splat);

        if (!this.dragging) {
            this.syncing = true;
            syncHelperFromNode(this.entity, node);
            this.syncing = false;
        }

        this.attachGizmo();
        this.scene.forceRender = true;
    }

    private reparentHelper(splat: Splat | null) {
        if (this.splat === splat) {
            return;
        }

        if (this.entity.parent) {
            this.entity.parent.removeChild(this.entity);
        }

        this.splat = splat;

        if (splat) {
            splat.entity.addChild(this.entity);
        }
    }

    private attachGizmo() {
        if (!this.gizmoAttached) {
            this.gizmo.attach(this.entity);
            this.gizmo.setMode(this.gizmoMode === 'none' ? 'translate' : this.gizmoMode);
            this.gizmoAttached = true;
        }

        if (!this.transformHandlerPushed) {
            this.events.fire('transformHandler.push', this.transformHandler);
            this.transformHandlerPushed = true;
        }
    }

    private detachGizmo() {
        if (this.gizmoAttached) {
            this.gizmo.detach();
            this.gizmoAttached = false;
        }

        if (this.transformHandlerPushed) {
            this.events.fire('transformHandler.pop');
            this.transformHandlerPushed = false;
        }
    }

    destroy() {
        this.detachGizmo();
        this.entity.destroy();
    }
}

export { ScaRigTransformController };
