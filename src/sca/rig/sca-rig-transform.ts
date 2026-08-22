import { Container } from '@playcanvas/pcui';

import { Entity, Mat4 } from 'playcanvas';



import { Events } from '../../events';

import { Scene } from '../../scene';

import { Splat } from '../../splat';

import { ShapeGizmoMode, ShapeTransformGizmo } from '../../tools/shape-transform-gizmo';

import { TransformHandler } from '../../transform-handler';



import { ScaProject } from '../types/project';

import { ScaRig, ScaRigNode } from '../types/rig';



import { logScaRigDragStage } from './rig-drag-debug';
import { canReparentHelper, RigGizmoInteractionState, shouldDeferHelperSync } from './rig-gizmo-lifecycle';
import {
    buildEffectiveRigWorldMatrix,
    buildNodeWorldMatrix
} from './rig-hierarchy';
import {
    clearRigTraceDragBaseline,
    logRigReparent,
    logRigTraceGizmoDelta,
    logRigTraceStage,
    scheduleRigTraceNextFrame,
    setRigTraceDragBaseline,
    setRigTraceDragFlags,
    setRigTraceTargets
} from './rig-trace';
import { matricesNearEqual } from './rig-transform';

import { pickRigNodeIdAtScreen } from './rig-node-pick';
import {
    entityHandleMatchesNode,
    getNodeWorldPivotPosition,
    logScaRigFirstMoveValues,
    readNodePatchFromHelper,
    resolveSplatForNode,
    syncHelperFromNode
} from './rig-node-space';



const CLICK_TOLERANCE_PX = 14;

const PICK_RADIUS_PX = 18;

const matDragBaseline = new Mat4();

const matDragStartNodeWorld = new Mat4();

const matDragCurrent = new Mat4();

const matEffectiveBefore = new Mat4();

const matEffectiveAfter = new Mat4();

const formatMatrixForReparent = (matrix: Mat4): number[] => {
    return Array.from(matrix.data).map((entry) => Number(entry.toFixed(6)));
};



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

    private readonly dragState = new RigGizmoInteractionState();

    private dragBaselineCaptured = false;

    private syncing = false;

    private activePointerId: number | null = null;

    private windowListenersAttached = false;

    private pointerActive = false;

    private clicked = false;

    private clickX = 0;

    private clickY = 0;

    private dragMoveCount = 0;



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
                if (!this.dragState.beginDrag()) {
                    return;
                }

                this.logDragStage('before-start');
                this.prepareHelperForDrag();
                this.dragMoveCount = 0;
                this.dragBaselineCaptured = false;

                // Gizmo owns this gesture — do not treat release as rig-node click-pick.
                this.pointerActive = false;
                this.clicked = false;

                setRigTraceDragFlags({ dragging: true, gizmoEngaged: false });

                this.events.invoke('sca.history.cancelTransaction');
                this.events.invoke('sca.history.beginTransaction');

                this.captureDragBaseline();
                this.attachDragWindowListeners();
                this.tryAcquirePointerCapture();
                this.logDragStage('start');
                logRigTraceStage('transform:start', {}, this.buildTraceContext('transform:start'));
            },

            onTransform: () => {
                if (!this.dragState.canApplyMove()) {
                    return;
                }

                this.dragMoveCount++;

                if (this.dragMoveCount === 1) {
                    this.logDragStage('first-move');
                    logRigTraceStage('first-transform:move', { moveIndex: 1 }, this.buildTraceContext('first-transform:move'));
                }

                this.applyHelperToNode();
            },

            onTransformEnd: () => {
                this.commitDragSession('transform:end');
            },

            onModeChanged: (mode) => {

                this.gizmoMode = mode;

            }

        });



        events.on('sca.rig.node.selected', (nodeId: string | null) => {
            if (this.dragState.isDragging() && nodeId !== this.selectedNodeId) {
                this.cancelDragSession('selection-changed');
            }

            this.selectedNodeId = nodeId;

            const project = this.events.invoke('sca.project.get') as ScaProject | null;
            const rig = project?.rig;
            const binding = rig?.bindings.find((entry) => entry.nodeId === nodeId);
            setRigTraceTargets(nodeId, binding?.regionId ?? null);

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

            if (shouldDeferHelperSync(this.dragState.isDragging())) {
                return;
            }

            this.sync();

        });



        events.on('scene.clear', () => {

            this.selectedNodeId = null;

            this.sync();

        });



        events.on('tool.move', () => {
            if (this.dragState.isDragging()) {
                this.commitDragSession('tool-mode-change');
            }

            if (this.selectedNodeId) {
                this.gizmo.setMode('translate');
            }
        });

        events.on('tool.rotate', () => {
            if (this.dragState.isDragging()) {
                this.commitDragSession('tool-mode-change');
            }

            if (this.selectedNodeId) {
                this.gizmo.setMode('rotate');
            }
        });

        events.on('tool.scale', () => {
            if (this.dragState.isDragging()) {
                this.commitDragSession('tool-mode-change');
            }

            // Rig scale is deferred until hierarchy math supports TRS (see types/rig.ts).
        });



        events.on('tool.activated', (toolName: string | null) => {
            if (!this.selectedNodeId || !toolName) {
                return;
            }

            if (toolName === 'move') {
                this.gizmo.setMode('translate');
            } else if (toolName === 'rotate') {
                this.gizmo.setMode('rotate');
            }
            // scale intentionally omitted — rigid-only rig nodes do not support scale yet
        });



        events.function('sca.rig.transform.dragging', () => this.dragState.isDragging());

        events.function('sca.rig.transform.engaged', () => this.dragState.isDragging());

        const canvasDom = canvasContainer.dom;

        canvasDom.addEventListener('pointerdown', this.onPointerDown);
        canvasDom.addEventListener('pointerdown', this.onCanvasPointerDown, true);
        canvasDom.addEventListener('pointermove', this.onPointerMove);
        canvasDom.addEventListener('pointerup', this.onPointerUp, true);
        canvasDom.addEventListener('pointercancel', this.onPointerCancel, true);
    }

    private onCanvasPointerDown = (event: PointerEvent) => {
        const isPrimary = event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;
        if (!isPrimary) {
            return;
        }
        this.activePointerId = event.pointerId;
    };

    private attachDragWindowListeners() {
        if (this.windowListenersAttached) {
            return;
        }
        this.windowListenersAttached = true;
        window.addEventListener('pointerup', this.onWindowPointerEnd, true);
        window.addEventListener('pointercancel', this.onWindowPointerEnd, true);
        window.addEventListener('blur', this.onWindowBlur);
    }

    private detachDragWindowListeners() {
        if (!this.windowListenersAttached) {
            return;
        }
        this.windowListenersAttached = false;
        window.removeEventListener('pointerup', this.onWindowPointerEnd, true);
        window.removeEventListener('pointercancel', this.onWindowPointerEnd, true);
        window.removeEventListener('blur', this.onWindowBlur);
    }

    private releasePointerCapture() {
        const canvas = this.scene.canvas;
        if (this.activePointerId === null || !canvas.hasPointerCapture?.(this.activePointerId)) {
            return;
        }
        try {
            canvas.releasePointerCapture(this.activePointerId);
        } catch {
            // pointer may already be released
        }
    }

    private tryAcquirePointerCapture() {
        const canvas = this.scene.canvas;
        if (this.activePointerId === null) {
            return;
        }
        try {
            canvas.setPointerCapture(this.activePointerId);
        } catch {
            // gizmo layer may already own capture
        }
    }

    private onWindowPointerEnd = (event: PointerEvent) => {
        if (!this.dragState.isDragging()) {
            return;
        }
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
            return;
        }
        if (event.type === 'pointerup' && event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        if (!this.dragState.isDragging()) {
            return;
        }
        // Ensure transform:end runs if native gizmo missed pointerup.
        this.gizmo.forceEndDrag();
        if (this.dragState.isDragging()) {
            this.commitDragSession('window-pointer-end');
        }
    };

    private onWindowBlur = () => {
        if (!this.dragState.isDragging()) {
            return;
        }
        this.gizmo.forceEndDrag();
        if (this.dragState.isDragging()) {
            this.commitDragSession('window-blur');
        }
    };

    private commitDragSession(reason: string) {
        if (!this.dragState.endDrag()) {
            return;
        }

        if (this.dragMoveCount > 0) {
            this.logDragStage('last-move');
        }
        this.applyHelperToNode();
        this.logDragStage('end-before-commit');
        logRigTraceStage('transform:end-before-commit', { reason }, this.buildTraceContext('transform:end-before-commit'));

        this.events.invoke('sca.history.commitTransaction');

        this.logDragStage('end-after-commit');
        logRigTraceStage('transform:end-after-commit', { reason }, this.buildTraceContext('transform:end-after-commit'));

        setRigTraceDragFlags({ dragging: false, gizmoEngaged: false });

        this.releasePointerCapture();
        this.detachDragWindowListeners();
        this.activePointerId = null;

        this.syncHelperFromProject();
        this.sync();

        this.dragMoveCount = 0;
        clearRigTraceDragBaseline();
        this.dragBaselineCaptured = false;

        scheduleRigTraceNextFrame('next-animation-frame');
    }

    private cancelDragSession(reason: string) {
        if (!this.dragState.isDragging()) {
            return;
        }

        this.gizmo.resetDragActive();
        this.events.invoke('sca.history.cancelTransaction');
        this.dragState.endDrag();
        setRigTraceDragFlags({ dragging: false, gizmoEngaged: false });
        this.releasePointerCapture();
        this.detachDragWindowListeners();
        this.activePointerId = null;
        this.dragMoveCount = 0;
        clearRigTraceDragBaseline();
        this.dragBaselineCaptured = false;
        logRigTraceStage('transform:end-after-commit', { reason, cancelled: true }, this.buildTraceContext(reason));
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



    private logDragStage(stage: Parameters<typeof logScaRigDragStage>[0]) {
        logScaRigDragStage(
            stage,
            this.getSelectedRig(),
            this.getSelectedNode(),
            this.splat,
            this.entity
        );
    }

    private buildTraceContext(caller: string) {
        const node = this.getSelectedNode();
        const rig = this.getSelectedRig();
        const binding = rig?.bindings.find((entry) => entry.nodeId === node?.id) ?? null;

        return {
            rig,
            node,
            splat: this.splat,
            entity: this.entity,
            binding,
            caller
        };
    }

    private captureDragBaseline() {
        if (this.dragBaselineCaptured) {
            return;
        }

        const node = this.getSelectedNode();
        const rig = this.getSelectedRig();
        if (node && rig) {
            buildNodeWorldMatrix(rig, node, matDragStartNodeWorld);
        }

        matDragBaseline.copy(this.entity.getLocalTransform());
        setRigTraceDragBaseline(matDragBaseline);
        this.dragBaselineCaptured = true;
    }

    private prepareHelperForDrag() {
        const node = this.getSelectedNode();
        const rig = this.getSelectedRig();
        if (!node || !rig) {
            return;
        }

        const splat = resolveSplatForNode(this.events, this.scene, node, rig);
        if (!splat) {
            return;
        }

        this.reparentHelper(splat, 'prepare-for-drag');
        this.syncing = true;
        syncHelperFromNode(this.entity, rig, node, splat);
        this.syncing = false;
    }



    private canPick(): boolean {

        if (this.dragState.isDragging()) {

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

        const cameraPos = camera.mainCamera.getPosition();

        const cameraFwd = camera.mainCamera.forward;

        return pickRigNodeIdAtScreen(
            rig,
            (node) => resolveSplatForNode(this.events, this.scene, node, rig),
            {
                pickX,
                pickY,
                viewportWidth: rect.width,
                viewportHeight: rect.height,
                radiusPx: PICK_RADIUS_PX,
                isNodeInFront: (world) => world.clone().sub(cameraPos).dot(cameraFwd) > 0,
                projectWorldToScreen: (world, out) => {
                    camera.worldToScreen(world, out);
                }
            }
        );

    }



    private onPointerDown = (event: PointerEvent) => {

        if (!this.canPick()) {

            return;

        }



        const isPrimary = event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;

        if (!isPrimary) {

            return;

        }

        logRigTraceStage('before-pointerdown', {
            clientX: event.clientX,
            clientY: event.clientY
        }, this.buildTraceContext('before-pointerdown'));

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

        if (this.dragState.isDragging()) {
            // Let PlayCanvas / window listeners end the drag — never swallow pointerup.
            return;
        }

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

    private onPointerCancel = (event: PointerEvent) => {
        this.pointerActive = false;
        this.clicked = false;

        if (!this.dragState.isDragging()) {
            return;
        }
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) {
            return;
        }
        this.gizmo.forceEndDrag();
        if (this.dragState.isDragging()) {
            this.commitDragSession('pointercancel');
        }
    };



    private applyHelperToNode() {

        const node = this.getSelectedNode();

        const rig = this.getSelectedRig();

        if (!node || !rig || this.syncing || !this.dragState.canApplyMove()) {

            return;

        }

        matDragCurrent.copy(this.entity.getLocalTransform());

        const matchesDragBaseline = this.dragBaselineCaptured &&
            matricesNearEqual(matDragCurrent, matDragBaseline);

        if (this.dragMoveCount === 1) {
            logRigTraceGizmoDelta({
                moveIndex: 1,
                helperDeltaFromDragStart: Array.from(matDragCurrent.data).map((value, index) => (
                    Number((value - matDragBaseline.data[index]).toFixed(6))
                )),
                helperDeltaFromBaseline: matchesDragBaseline ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : null,
                skipped: matchesDragBaseline,
                skipReason: matchesDragBaseline ? 'zero helper delta from drag baseline' : undefined
            });
        }

        if (matchesDragBaseline) {
            return;
        }

        if (entityHandleMatchesNode(this.entity, rig, node)) {
            return;
        }

        const binding = rig.bindings.find((entry) => entry.nodeId === node.id) ?? null;
        buildEffectiveRigWorldMatrix(rig, node, binding, matEffectiveBefore);

        const patch = readNodePatchFromHelper(this.entity, rig, node);
        const previewNode = {
            ...node,
            position: patch.position ? [...patch.position] as typeof node.position : node.position,
            rotation: patch.rotation ? [...patch.rotation] as typeof node.rotation : node.rotation
        };
        buildEffectiveRigWorldMatrix(
            { ...rig, nodes: rig.nodes.map((entry) => entry.id === node.id ? previewNode : entry) },
            previewNode,
            binding,
            matEffectiveAfter
        );

        if (this.dragMoveCount === 1) {
            logScaRigFirstMoveValues({
                rig,
                node,
                entity: this.entity,
                binding,
                dragStartHelperLocal: matDragBaseline,
                dragStartNodeWorld: matDragStartNodeWorld,
                effectiveBefore: matEffectiveBefore,
                effectiveAfter: matEffectiveAfter
            });
        }

        if (matricesNearEqual(matEffectiveBefore, matEffectiveAfter)) {
            logRigTraceStage('project-update-before', {
                skipped: true,
                reason: 'effective matrix unchanged'
            }, this.buildTraceContext('applyHelperToNode effective-unchanged'));
            return;
        }

        logRigTraceStage('project-update-before', {}, this.buildTraceContext('sca.rig.node.update'));
        this.events.fire('sca.rig.node.update', node.id, patch);
        logRigTraceStage('project-update-after', {}, this.buildTraceContext('sca.rig.node.update'));
    }



    private syncHelperFromProject() {

        const node = this.getSelectedNode();

        const rig = this.getSelectedRig();

        if (!node || !rig || !this.splat || this.dragState.isDragging()) {

            return;

        }



        this.syncing = true;

        syncHelperFromNode(this.entity, rig, node, this.splat);

        this.syncing = false;

    }



    private sync() {

        if (shouldDeferHelperSync(this.dragState.isDragging())) {
            return;
        }

        const node = this.getSelectedNode();

        const rig = this.getSelectedRig();

        const showGizmo = !!node && !!rig;



        if (!showGizmo || !node || !rig) {

            this.detachGizmo();

            this.reparentHelper(null, 'sync-detach');

            this.scene.forceRender = true;

            return;

        }



        const splat = resolveSplatForNode(this.events, this.scene, node, rig);

        if (!splat) {

            this.detachGizmo();

            this.reparentHelper(null, 'sync-detach');

            this.scene.forceRender = true;

            return;

        }



        this.reparentHelper(splat, 'sync');



        this.syncHelperFromProject();



        this.attachGizmo();

        this.scene.forceRender = true;

    }



    private reparentHelper(splat: Splat | null, stage = 'unknown') {

        const sameSplat = this.splat === splat;
        const localBefore = this.entity.getLocalTransform().clone();
        const worldBefore = this.entity.getWorldTransform().clone();
        const oldParent = this.entity.parent?.name ?? null;

        if (sameSplat) {
            return;
        }

        if (!canReparentHelper(this.dragState.isDragging(), sameSplat)) {
            logRigReparent({
                stage,
                oldParent,
                newParent: splat?.entity.name ?? null,
                localMatrixBefore: formatMatrixForReparent(localBefore),
                worldMatrixBefore: formatMatrixForReparent(worldBefore),
                localMatrixAfter: formatMatrixForReparent(localBefore),
                worldMatrixAfter: formatMatrixForReparent(worldBefore),
                dragging: this.dragState.isDragging(),
                gizmoEngaged: false,
                blocked: true,
                reason: 'deferred during gizmo drag'
            });
            return;
        }



        if (this.entity.parent) {

            this.entity.parent.removeChild(this.entity);

        }



        this.splat = splat;



        if (splat) {

            splat.entity.addChild(this.entity);

        }

        const localAfter = this.entity.getLocalTransform();
        const worldAfter = this.entity.getWorldTransform();

        logRigReparent({
            stage,
            oldParent,
            newParent: splat?.entity.name ?? null,
            localMatrixBefore: formatMatrixForReparent(localBefore),
            worldMatrixBefore: formatMatrixForReparent(worldBefore),
            localMatrixAfter: formatMatrixForReparent(localAfter),
            worldMatrixAfter: formatMatrixForReparent(worldAfter),
            dragging: this.dragState.isDragging(),
            gizmoEngaged: false
        });

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

        if (this.dragState.isDragging()) {
            this.commitDragSession('gizmo-detach');
        }

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


