import { Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Scene } from '../../scene';
import { Splat } from '../../splat';
import { ToolOverlay, OverlayWriter } from '../../tool-overlay';

import { computeRegionAnchorFromIndices } from '../presentation/region-anchor';
import { findSplatByScaSplatId } from '../regions/splat-identity';
import { collectRigHierarchyMarkerSegments } from './rig-node-markers';
import {
    getRigNodeHandleWorldTransform,
    resolveSplatForNode,
    transformSplatLocalDirectionToWorld
} from './rig-node-space';
import { ScaRig, ScaRigNode } from '../types/rig';
import { ScaRegion } from '../types/region';

const SELECTED_CROSSHAIR_ARM = 0.12;
const SELECTED_AXIS_ARM = 0.18;
const SUBTLE_CROSS_ARM = 0.06;

const axisX = new Vec3(1, 0, 0);
const axisY = new Vec3(0, 1, 0);
const axisZ = new Vec3(0, 0, 1);

const p0 = new Vec3();
const p1 = new Vec3();
const localPoint = new Vec3();
const worldPoint = new Vec3();
const localDir = new Vec3();
const worldDir = new Vec3();
const handleEulerScratch = new Vec3();

const computeRegionCentroidWorld = (
    events: Events,
    region: ScaRegion,
    splat: Splat
): Vec3 | null => {
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
            localPoint.set(x, y, z);
            splat.worldTransform.transformPoint(localPoint, worldPoint);
            return [worldPoint.x, worldPoint.y, worldPoint.z];
        }
    );

    if (!anchor) {
        return null;
    }

    return new Vec3(anchor.x, anchor.y, anchor.z);
};

class ScaRigGizmo {
    private overlay: ToolOverlay;
    private selectedNodeId: string | null = null;
    private visible = false;

    constructor(
        private events: Events,
        private scene: Scene
    ) {
        this.overlay = new ToolOverlay();
        this.overlay.provider = (writer: OverlayWriter) => {
            if (!this.visible) {
                return;
            }

            const project = this.events.invoke('sca.project.get') as { rig?: ScaRig } | null;
            const rig = project?.rig;
            if (!rig || rig.nodes.length === 0) {
                return;
            }

            this.drawAllNodes(writer, rig);
        };

        scene.add(this.overlay);

        events.on('sca.rig.node.selected', (nodeId: string | null) => {
            this.selectedNodeId = nodeId;
            this.syncVisibility();
        });

        events.on('sca.project.changed', () => {
            if (this.selectedNodeId) {
                const project = this.events.invoke('sca.project.get') as { rig?: ScaRig } | null;
                const exists = project?.rig?.nodes.some((entry) => entry.id === this.selectedNodeId);
                if (!exists) {
                    this.selectedNodeId = null;
                }
            }
            this.syncVisibility();
        });

        events.on('scene.clear', () => {
            this.selectedNodeId = null;
            this.syncVisibility();
        });

        events.on('sca.viewer.preview.changed', () => {
            this.syncVisibility();
        });

        this.syncVisibility();
    }

    private syncVisibility() {
        const project = this.events.invoke('sca.project.get') as { rig?: ScaRig } | null;
        const hasNodes = (project?.rig?.nodes.length ?? 0) > 0;
        const previewActive = !!this.events.invoke('sca.viewer.preview.active');
        this.visible = hasNodes && !previewActive;
        this.scene.forceRender = true;
    }

    private resolveSplat(node: ScaRigNode, rig: ScaRig): Splat | null {
        return resolveSplatForNode(this.events, this.scene, node, rig);
    }

    private drawAllNodes(writer: OverlayWriter, rig: ScaRig) {
        this.drawHierarchyLines(writer, rig);

        for (const node of rig.nodes) {
            if (node.id === this.selectedNodeId) {
                continue;
            }
            this.drawSubtleMarker(writer, node, rig);
        }

        if (this.selectedNodeId) {
            const selected = rig.nodes.find((entry) => entry.id === this.selectedNodeId);
            if (selected) {
                this.drawSelectedNode(writer, selected, rig);
            }
        }
    }

    private drawHierarchyLines(writer: OverlayWriter, rig: ScaRig) {
        const segments = collectRigHierarchyMarkerSegments(rig, (node) => (
            this.resolveSplat(node, rig)
        ));

        for (const segment of segments) {
            p0.set(segment.from[0], segment.from[1], segment.from[2]);
            p1.set(segment.to[0], segment.to[1], segment.to[2]);
            writer.segment(p0, p1);
        }
    }

    private drawSubtleMarker(writer: OverlayWriter, node: ScaRigNode, rig: ScaRig) {
        const splat = this.resolveSplat(node, rig);
        if (!splat) {
            return;
        }

        const handle = getRigNodeHandleWorldTransform(rig, node, splat, {
            worldPosition: worldPoint,
            splatLocalEuler: handleEulerScratch
        });

        writer.dot(worldPoint);
        this.drawCrosshair(writer, worldPoint, handle.splatLocalEuler, splat, SUBTLE_CROSS_ARM);
    }

    private drawSelectedNode(writer: OverlayWriter, node: ScaRigNode, rig: ScaRig) {
        const bindings = rig.bindings.filter((binding) => binding.nodeId === node.id);
        const splat = this.resolveSplat(node, rig);
        if (!splat) {
            return;
        }

        const handle = getRigNodeHandleWorldTransform(rig, node, splat, {
            worldPosition: worldPoint,
            splatLocalEuler: handleEulerScratch
        });

        writer.dot(worldPoint);
        this.drawCrosshair(writer, worldPoint, handle.splatLocalEuler, splat, SELECTED_CROSSHAIR_ARM);

        const axisDefs = [
            { local: axisX, scale: SELECTED_AXIS_ARM },
            { local: axisY, scale: SELECTED_AXIS_ARM * 0.85 },
            { local: axisZ, scale: SELECTED_AXIS_ARM * 0.85 }
        ];

        for (const { local, scale } of axisDefs) {
            localDir.copy(local);
            transformSplatLocalDirectionToWorld(
                splat,
                handle.splatLocalEuler,
                localDir,
                worldDir
            ).mulScalar(scale);
            p1.copy(worldPoint).add(worldDir);
            writer.segment(worldPoint, p1);
        }

        for (const binding of bindings) {
            const boundRegion = this.events.invoke('sca.region.get', binding.regionId) as ScaRegion | null;
            if (!boundRegion) {
                continue;
            }

            const boundSplat = findSplatByScaSplatId(this.scene, boundRegion.source.scaSplatId);
            if (!boundSplat) {
                continue;
            }

            const centroid = computeRegionCentroidWorld(this.events, boundRegion, boundSplat);
            if (!centroid) {
                continue;
            }

            writer.segment(worldPoint, centroid);
        }
    }

    private drawCrosshair(
        writer: OverlayWriter,
        center: Vec3,
        splatLocalEuler: [number, number, number],
        splat: Splat,
        arm: number
    ) {
        const arms = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
        ] as const;

        for (const [ax, ay, az] of arms) {
            localDir.set(ax, ay, az).mulScalar(arm * 0.5);
            transformSplatLocalDirectionToWorld(
                splat,
                splatLocalEuler,
                localDir,
                worldDir
            ).mulScalar(arm * 0.5);

            p0.copy(center).sub(worldDir);
            p1.copy(center).add(worldDir);
            writer.segment(p0, p1);
        }
    }

    destroy() {
        this.overlay.destroy();
    }
}

export { ScaRigGizmo };
