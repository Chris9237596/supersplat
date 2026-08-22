import { Container } from '@playcanvas/pcui';

import { Events } from '../../events';
import { Scene } from '../../scene';

import { HotspotStore } from '../store/hotspot-store';
import { ScaAssetStore } from '../store/sca-asset-store';
import { ScaRegion } from '../types/region';

import { logEditorRegionClick, logEditorRegionHover } from '../debug/editor-region-preview-debug';
import {
    createEditorPickerAdapter,
    EditorPickerBackend
} from '../interaction/editor-picker-adapters';
import { ScaRegionInteractionCore } from '../interaction/sca-region-core';
import { createStorageRegionMaskLookup } from '../interaction/sca-storage-mask-lookup';

import {
    getViewportCanvas,
    isPointerOnViewportCanvas
} from './editor-viewport-pointer';

const CLICK_TOLERANCE_PX = 4;
const HOVER_THROTTLE_MS = 32;

type ViewportClickContext = {
    downInsideCanvas: boolean;
    upInsideCanvas: boolean;
    wasDrag: boolean;
    target: 'canvas' | 'ui';
};

const logAuthoringPick = (
    backend: EditorPickerBackend,
    gaussianIndex: number | null,
    regionId: string | null
) => {
    console.log([
        '[SCA AUTHORING PICK]',
        `backend=${backend}`,
        gaussianIndex !== null ? `gaussianIndex=${gaussianIndex}` : 'gaussianIndex=null',
        regionId ? `regionId=${regionId}` : 'regionId=null'
    ].join('\n'));
};

const registerScaViewerInteractionPreview = (
    events: Events,
    scene: Scene,
    canvasContainer: Container
): void => {
    let enabled = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let pointerDownOnViewport = false;
    let pointerActive = false;
    let pickInFlight = false;
    let pendingHoverPick: { clientX: number; clientY: number } | null = null;
    let lastHoverLog = '';
    let lastHoverAt = 0;
    let interactionCore: ScaRegionInteractionCore | null = null;

    const viewportCanvas = (): HTMLCanvasElement | null =>
        getViewportCanvas(canvasContainer.dom);

    const resetPointerState = () => {
        pointerActive = false;
        pointerDownOnViewport = false;
    };

    const getInteractionCore = (): ScaRegionInteractionCore => {
        if (interactionCore) {
            return interactionCore;
        }

        const store = events.invoke('sca.store') as HotspotStore;
        const assetStore = events.invoke('sca.assetStore') as ScaAssetStore;
        const lookup = createStorageRegionMaskLookup(store, assetStore);

        interactionCore = new ScaRegionInteractionCore(lookup, {
            getRegion: (regionId: string) =>
                events.invoke('sca.region.get', regionId) as ScaRegion | null,
            getSelectedRegionId: () =>
                events.invoke('sca.region.getSelected') as string | null,
            onHoverChange: (regionId: string | null) => {
                canvasContainer.dom.style.cursor = regionId ? 'pointer' : '';
                logEditorRegionHover(enabled, regionId);
                events.fire('sca.region.hoverPreview', regionId);
            },
            onSelectionChange: (regionId: string | null) => {
                events.fire('sca.region.select', regionId);
            }
        });

        return interactionCore;
    };

    events.function('sca.viewerInteractionPreview.enabled', () => enabled);

    events.on('sca.viewerInteractionPreview.setEnabled', (value: boolean) => {
        enabled = !!value;
        lastHoverLog = '';
        pendingHoverPick = null;
        resetPointerState();
        if (enabled) {
            console.log('[SCA AUTHORING PREVIEW] enabled — storage-index region pick (Centers or Rings).');
        } else {
            console.log('[SCA AUTHORING PREVIEW] disabled');
            canvasContainer.dom.style.removeProperty('cursor');
            getInteractionCore().setHoveredRegion(null);
        }
    });

    const isInteractionBlocked = (): boolean => {
        if (!enabled) {
            return true;
        }
        if (events.invoke('tool.active')) {
            return true;
        }
        if (events.invoke('sca.focus.mode')) {
            return true;
        }
        if (events.invoke('sca.viewer.preview.active')) {
            return true;
        }
        if (events.invoke('sca.rig.transform.dragging')) {
            return true;
        }
        return false;
    };

    const flushPendingHoverPick = () => {
        const pending = pendingHoverPick;
        pendingHoverPick = null;
        if (pending) {
            void runPick(pending.clientX, pending.clientY, 'hover');
        }
    };

    const runPick = async (
        clientX: number,
        clientY: number,
        kind: 'click' | 'hover',
        clickContext?: ViewportClickContext
    ): Promise<void> => {
        if (pickInFlight) {
            if (kind === 'hover') {
                pendingHoverPick = { clientX, clientY };
            }
            return;
        }

        const rect = canvasContainer.dom.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            if (clickContext) {
                logEditorRegionClick({
                    ...clickContext,
                    resolvedRegionId: null,
                    action: 'ignore'
                });
            }
            return;
        }

        const nx = (clientX - rect.left) / rect.width;
        const ny = (clientY - rect.top) / rect.height;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
            if (kind === 'hover') {
                getInteractionCore().setHoveredRegion(null);
            } else if (clickContext) {
                logEditorRegionClick({
                    ...clickContext,
                    resolvedRegionId: null,
                    action: 'ignore'
                });
            }
            return;
        }

        const picker = createEditorPickerAdapter(events, scene);
        if (!picker.isAvailable()) {
            if (clickContext) {
                logEditorRegionClick({
                    ...clickContext,
                    resolvedRegionId: null,
                    action: 'ignore'
                });
            }
            return;
        }

        pickInFlight = true;
        try {
            const hit = await picker.pick(nx, ny);
            const core = getInteractionCore();
            const gaussianIndex = hit?.gaussianIndex ?? null;
            const scaSplatId = hit?.scaSplatId ?? null;

            if (kind === 'click') {
                const regionHit = core.resolveClickableRegionHit(gaussianIndex, scaSplatId);
                const regionId = regionHit?.regionId ?? null;
                const selectedId = events.invoke('sca.region.getSelected') as string | null;

                if (clickContext) {
                    let action: 'select' | 'deselect' | 'ignore' = 'ignore';
                    if (regionId === null) {
                        action = selectedId ? 'deselect' : 'ignore';
                    } else if (regionId === selectedId) {
                        action = 'deselect';
                    } else {
                        action = 'select';
                    }

                    logEditorRegionClick({
                        ...clickContext,
                        resolvedRegionId: regionId,
                        action
                    });
                }

                core.activateRegion(regionId, 'click');
                logAuthoringPick(picker.backendId, gaussianIndex, regionId);
                return;
            }

            const regionHit = core.resolveClickableRegionHit(gaussianIndex, scaSplatId);
            const hoverRegionId = regionHit?.regionId ?? null;
            core.setHoveredRegion(hoverRegionId);

            const hoverKey = `${picker.backendId}:${gaussianIndex ?? 'null'}:${hoverRegionId ?? 'null'}`;
            if (hoverKey !== lastHoverLog) {
                lastHoverLog = hoverKey;
                logAuthoringPick(picker.backendId, gaussianIndex, hoverRegionId);
            }
        } finally {
            pickInFlight = false;
            flushPendingHoverPick();
        }
    };

    const pointerdown = (event: PointerEvent) => {
        if (isInteractionBlocked() || event.button !== 0 || event.pointerType !== 'mouse') {
            return;
        }

        const canvas = viewportCanvas();
        if (!isPointerOnViewportCanvas(event, canvas)) {
            resetPointerState();
            return;
        }

        pointerDownOnViewport = true;
        pointerActive = true;
        pointerDownX = event.clientX;
        pointerDownY = event.clientY;
    };

    const pointerup = (event: PointerEvent) => {
        const canvas = viewportCanvas();
        const upInsideCanvas = isPointerOnViewportCanvas(event, canvas);
        const downInsideCanvas = pointerDownOnViewport;
        const wasDrag = pointerActive &&
            Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > CLICK_TOLERANCE_PX;
        const target: 'canvas' | 'ui' = upInsideCanvas ? 'canvas' : 'ui';

        if (!pointerActive || event.button !== 0) {
            resetPointerState();
            return;
        }

        pointerActive = false;
        const hadViewportPointerDown = pointerDownOnViewport;
        pointerDownOnViewport = false;

        if (isInteractionBlocked()) {
            logEditorRegionClick({
                downInsideCanvas,
                upInsideCanvas,
                wasDrag,
                target,
                resolvedRegionId: null,
                action: 'ignore'
            });
            return;
        }

        if (!hadViewportPointerDown || !upInsideCanvas || wasDrag) {
            logEditorRegionClick({
                downInsideCanvas,
                upInsideCanvas,
                wasDrag,
                target,
                resolvedRegionId: null,
                action: 'ignore'
            });
            return;
        }

        void runPick(event.clientX, event.clientY, 'click', {
            downInsideCanvas,
            upInsideCanvas,
            wasDrag,
            target
        });
    };

    const pointermove = (event: PointerEvent) => {
        if (isInteractionBlocked() || event.pointerType !== 'mouse') {
            if (!enabled) {
                canvasContainer.dom.style.removeProperty('cursor');
            } else if (isInteractionBlocked()) {
                getInteractionCore().setHoveredRegion(null);
            }
            return;
        }

        if (!isPointerOnViewportCanvas(event, viewportCanvas())) {
            return;
        }

        const now = performance.now();
        if (now - lastHoverAt < HOVER_THROTTLE_MS) {
            return;
        }
        lastHoverAt = now;

        void runPick(event.clientX, event.clientY, 'hover');
    };

    const pointerleave = () => {
        if (!enabled) {
            return;
        }
        resetPointerState();
        getInteractionCore().setHoveredRegion(null);
    };

    const pointercancel = () => {
        resetPointerState();
    };

    canvasContainer.dom.addEventListener('pointerdown', pointerdown, true);
    canvasContainer.dom.addEventListener('pointerup', pointerup, true);
    canvasContainer.dom.addEventListener('pointermove', pointermove, true);
    canvasContainer.dom.addEventListener('pointerleave', pointerleave, true);
    canvasContainer.dom.addEventListener('pointercancel', pointercancel, true);
};

export {
    registerScaViewerInteractionPreview
};
