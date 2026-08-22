import { Entity, Mat4, Quat, Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { IndexRanges } from '../../index-ranges';
import { Splat } from '../../splat';

import { ScaProject } from '../types/project';
import { ScaRegion } from '../types/region';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';

import { buildEffectiveRigWorldMatrix, buildNodeWorldMatrix } from './rig-hierarchy';
import { bindOffsetToMatrix, matricesNearEqual } from './rig-transform';

export type RigTraceStage =
    | 'before-pointerdown'
    | 'transform:start'
    | 'first-transform:move'
    | 'project-update-before'
    | 'project-update-after'
    | 'rig-pose-update-before'
    | 'palette-write'
    | 'project.changed'
    | 'history-apply'
    | 'history-revert'
    | 'transform:end-before-commit'
    | 'transform:end-after-commit'
    | 'next-animation-frame'
    | 'rig-sync-path'
    | 'history-cursor'
    | 'selection-change'
    | 'gizmo-delta'
    | 'reparent';

type RigReparentTrace = {
    stage: string;
    oldParent: string | null;
    newParent: string | null;
    localMatrixBefore: number[] | null;
    worldMatrixBefore: number[] | null;
    localMatrixAfter: number[] | null;
    worldMatrixAfter: number[] | null;
    dragging: boolean;
    gizmoEngaged: boolean;
    blocked?: boolean;
    reason?: string;
};

type RigTraceContext = {
    events: Events | null;
    nodeId: string | null;
    regionId: string | null;
    dragging: boolean;
    transactionActive: boolean;
    gizmoEngaged: boolean;
    dragBaselineHelper: Mat4 | null;
    dragStartHelper: Mat4 | null;
    frame: number;
    lastEffective: Mat4 | null;
    firstDivergence: {
        stage: RigTraceStage;
        frame: number;
        time: number;
    } | null;
};

const matA = new Mat4();
const matB = new Mat4();
const matEffective = new Mat4();
const vecCentroid = new Vec3();

const traceState: RigTraceContext = {
    events: null,
    nodeId: null,
    regionId: null,
    dragging: false,
    transactionActive: false,
    gizmoEngaged: false,
    dragBaselineHelper: null,
    dragStartHelper: null,
    frame: 0,
    lastEffective: null,
    firstDivergence: null
};

const isRigTraceEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!debug?.rigTrace;
};

const formatVec3 = (value: Vec3 | [number, number, number] | null | undefined): number[] | null => {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => Number(entry.toFixed(6)));
    }

    return [value.x, value.y, value.z].map((entry) => Number(entry.toFixed(6)));
};

const formatMatrix = (matrix: Mat4 | null | undefined): number[] | null => {
    if (!matrix) {
        return null;
    }

    return Array.from(matrix.data).map((entry) => Number(entry.toFixed(6)));
};

const getHistoryCursor = (events: Events | null): number | null => {
    if (!events) {
        return null;
    }

    try {
        return events.invoke('editHistory.cursor') as number;
    } catch {
        return null;
    }
};

const resolveBinding = (rig: ScaRig, nodeId: string, regionId: string | null): ScaRigBinding | null => {
    if (regionId) {
        return rig.bindings.find((entry) => entry.regionId === regionId) ?? null;
    }

    return rig.bindings.find((entry) => entry.nodeId === nodeId) ?? null;
};

const computeRegionCentroid = (
    events: Events,
    region: ScaRegion,
    splat: Splat
): [number, number, number] | null => {
    const ranges = events.invoke('sca.region.getMask', region.id) as IndexRanges | null;
    if (!ranges || ranges.empty) {
        return null;
    }

    const xData = splat.splatData.getProp('x') as Float32Array;
    const yData = splat.splatData.getProp('y') as Float32Array;
    const zData = splat.splatData.getProp('z') as Float32Array;

    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    ranges.forEach((index: number) => {
        if (index < 0 || index >= splat.splatData.numSplats) {
            return;
        }

        sumX += xData[index];
        sumY += yData[index];
        sumZ += zData[index];
        count++;
    });

    if (count === 0) {
        return null;
    }

    return [
        Number((sumX / count).toFixed(6)),
        Number((sumY / count).toFixed(6)),
        Number((sumZ / count).toFixed(6))
    ];
};

const transformCentroid = (
    centroid: [number, number, number],
    effective: Mat4
): [number, number, number] => {
    vecCentroid.set(centroid[0], centroid[1], centroid[2]);
    effective.transformPoint(vecCentroid, vecCentroid);
    return [
        Number(vecCentroid.x.toFixed(6)),
        Number(vecCentroid.y.toFixed(6)),
        Number(vecCentroid.z.toFixed(6))
    ];
};

const registerRigTrace = (events: Events): void => {
    traceState.events = events;
};

const setRigTraceTargets = (nodeId: string | null, regionId: string | null): void => {
    traceState.nodeId = nodeId;
    traceState.regionId = regionId;
    traceState.lastEffective = null;
    traceState.firstDivergence = null;
    traceState.frame = 0;
};

const setRigTraceDragFlags = (payload: {
    dragging?: boolean;
    transactionActive?: boolean;
    gizmoEngaged?: boolean;
}): void => {
    if (payload.dragging !== undefined) {
        traceState.dragging = payload.dragging;
    }
    if (payload.transactionActive !== undefined) {
        traceState.transactionActive = payload.transactionActive;
    }
    if (payload.gizmoEngaged !== undefined) {
        traceState.gizmoEngaged = payload.gizmoEngaged;
    }
};

const setRigTraceDragBaseline = (matrix: Mat4 | null): void => {
    traceState.dragBaselineHelper = matrix ? matrix.clone() : null;
    traceState.dragStartHelper = matrix ? matrix.clone() : null;
};

const clearRigTraceDragBaseline = (): void => {
    traceState.dragBaselineHelper = null;
    traceState.dragStartHelper = null;
};

const logRigTraceHistoryCursor = (payload: {
    oldCursor: number;
    newCursor: number;
    action: string;
    operation?: string;
    reason: string;
}): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    console.log('[SCA RIG HISTORY]', {
        oldCursor: payload.oldCursor,
        newCursor: payload.newCursor,
        action: payload.action,
        operation: payload.operation ?? null,
        dragging: traceState.dragging,
        transactionActive: traceState.transactionActive,
        reason: payload.reason
    });

    logRigTraceStage('history-cursor', { reason: payload.reason, ...payload });
};

const logRigTraceSyncPath = (payload: {
    type: 'pose' | 'structural' | 'none';
    reason: string;
    topologyBefore: string;
    topologyAfter: string;
}): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    console.log('[SCA RIG SYNC PATH]', payload);
    logRigTraceStage('rig-sync-path', payload);
};

const logRigTraceSelectionChange = (payload: {
    kind: 'rig' | 'region' | 'hotspot';
    from: string | null;
    to: string | null;
    reason: string;
}): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    console.log('[SCA RIG TRACE selection]', payload);
    logRigTraceStage('selection-change', payload);
};

const logRigTracePaletteWrite = (payload: {
    regionId: string;
    nodeId: string;
    slotBefore: number;
    slotAfter: number;
    reason: string;
}): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    logRigTraceStage('palette-write', payload);
};

const logRigReparent = (payload: RigReparentTrace): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    console.log('[SCA RIG REPARENT]', payload);
    logRigTraceStage('reparent', payload);
};

const logRigTraceGizmoDelta = (payload: {
    moveIndex: number;
    helperDeltaFromDragStart: number[] | null;
    helperDeltaFromBaseline: number[] | null;
    skipped: boolean;
    skipReason?: string;
}): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    logRigTraceStage('gizmo-delta', payload);
};

const logRigTraceStage = (
    stage: RigTraceStage,
    extra: Record<string, unknown> = {},
    context?: {
        rig?: ScaRig | null;
        node?: ScaRigNode | null;
        splat?: Splat | null;
        entity?: Entity | null;
        binding?: ScaRigBinding | null;
        paletteIndex?: number | null;
        paletteMatrix?: Mat4 | null;
        caller?: string;
    }
): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    const events = traceState.events;
    const nodeId = context?.node?.id ?? traceState.nodeId;
    const regionId = context?.binding?.regionId ?? traceState.regionId;

    if (!nodeId && !traceState.nodeId) {
        return;
    }

    const project = events?.invoke('sca.project.get') as ScaProject | null;
    const rig = context?.rig ?? project?.rig ?? null;
    const node = context?.node ??
        (nodeId ? rig?.nodes.find((entry) => entry.id === nodeId) ?? null : null);

    if (!rig || !node) {
        return;
    }

    traceState.frame++;

    const binding = context?.binding ?? resolveBinding(rig, node.id, regionId);
    buildEffectiveRigWorldMatrix(rig, node, binding, matEffective);

    if (traceState.lastEffective && !matricesNearEqual(traceState.lastEffective, matEffective, 1e-5)) {
        if (!traceState.firstDivergence) {
            traceState.firstDivergence = {
                stage,
                frame: traceState.frame,
                time: performance.now()
            };
            console.warn('[SCA RIG TRACE FIRST DIVERGENCE]', {
                stage,
                frame: traceState.frame,
                time: performance.now(),
                caller: context?.caller ?? extra.reason ?? null
            });
        }
    }

    if (!traceState.lastEffective) {
        traceState.lastEffective = matEffective.clone();
    } else {
        traceState.lastEffective.copy(matEffective);
    }

    bindOffsetToMatrix(binding, matA);

    let sourceCentroid: [number, number, number] | null = null;
    let transformedCentroid: [number, number, number] | null = null;
    const splat = context?.splat ?? null;
    const region = regionId ?
        events?.invoke('sca.region.get', regionId) as ScaRegion | null :
        null;

    if (events && region && splat) {
        sourceCentroid = computeRegionCentroid(events, region, splat);
        if (sourceCentroid) {
            transformedCentroid = transformCentroid(sourceCentroid, matEffective);
        }
    }

    const entity = context?.entity ?? null;
    const helperLocal = entity?.getLocalTransform() ?? null;
    const helperWorld = entity?.getWorldTransform() ?? null;

    console.log('[SCA RIG TRACE]', {
        stage,
        frame: traceState.frame,
        time: Number(performance.now().toFixed(3)),
        historyCursor: getHistoryCursor(events),
        nodeId: node.id,
        regionId: regionId ?? null,
        storedLocalPosition: formatVec3(node.position),
        storedLocalRotation: formatVec3(node.rotation),
        helperLocalMatrix: formatMatrix(helperLocal),
        helperWorldMatrix: formatMatrix(helperWorld),
        nodeWorldMatrix: formatMatrix(buildNodeWorldMatrix(rig, node, matB)),
        bindOffsetMatrix: formatMatrix(matA),
        effectiveMatrix: formatMatrix(matEffective),
        paletteSlotIndex: context?.paletteIndex ?? null,
        paletteMatrix: formatMatrix(context?.paletteMatrix ?? null),
        regionSourceCentroid: sourceCentroid,
        regionTransformedCentroid: transformedCentroid,
        dragging: traceState.dragging,
        transactionActive: traceState.transactionActive,
        gizmoEngaged: traceState.gizmoEngaged,
        dragBaselineHelper: formatMatrix(traceState.dragBaselineHelper),
        firstDivergence: traceState.firstDivergence,
        caller: context?.caller ?? extra.reason ?? null,
        ...extra
    });
};

const scheduleRigTraceNextFrame = (stage: RigTraceStage, extra?: Record<string, unknown>): void => {
    if (!isRigTraceEnabled()) {
        return;
    }

    requestAnimationFrame(() => {
        logRigTraceStage(stage, extra ?? {});
    });
};

export {
    clearRigTraceDragBaseline,
    isRigTraceEnabled,
    logRigReparent,
    logRigTraceGizmoDelta,
    logRigTraceHistoryCursor,
    logRigTracePaletteWrite,
    logRigTraceSelectionChange,
    logRigTraceStage,
    logRigTraceSyncPath,
    registerRigTrace,
    scheduleRigTraceNextFrame,
    setRigTraceDragBaseline,
    setRigTraceDragFlags,
    setRigTraceTargets,
    traceState
};
