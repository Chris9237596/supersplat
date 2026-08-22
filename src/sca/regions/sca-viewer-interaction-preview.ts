import { Container } from '@playcanvas/pcui';

import { Events } from '../../events';
import { Scene } from '../../scene';

import { HotspotStore } from '../store/hotspot-store';
import { ScaAssetStore } from '../store/sca-asset-store';
import { ScaRegion } from '../types/region';

import {
    createEditorPickerAdapter,
    EditorPickerBackend
} from '../interaction/editor-picker-adapters';
import { ScaRegionInteractionCore } from '../interaction/sca-region-core';
import { createStorageRegionMaskLookup } from '../interaction/sca-storage-mask-lookup';

const CLICK_TOLERANCE_PX = 4;
const HOVER_THROTTLE_MS = 32;

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
    let pointerActive = false;
    let pickInFlight = false;
    let lastHoverLog = '';
    let lastHoverAt = 0;

    const getInteractionCore = (): ScaRegionInteractionCore => {
        const store = events.invoke('sca.store') as HotspotStore;
        const assetStore = events.invoke('sca.assetStore') as ScaAssetStore;
        const lookup = createStorageRegionMaskLookup(store, assetStore);

        return new ScaRegionInteractionCore(lookup, {
            getRegion: (regionId: string) =>
                events.invoke('sca.region.get', regionId) as ScaRegion | null,
            getSelectedRegionId: () =>
                events.invoke('sca.region.getSelected') as string | null,
            onHoverChange: (regionId: string | null) => {
                canvasContainer.dom.style.cursor = regionId ? 'pointer' : '';
                events.fire('sca.region.hoverPreview', regionId);
            },
            onSelectionChange: (regionId: string | null) => {
                events.fire('sca.region.select', regionId);
            }
        });
    };

    events.function('sca.viewerInteractionPreview.enabled', () => enabled);

    events.on('sca.viewerInteractionPreview.setEnabled', (value: boolean) => {
        enabled = !!value;
        lastHoverLog = '';
        if (enabled) {
            console.log('[SCA AUTHORING PREVIEW] enabled — storage-index region pick (Centers or Rings).');
        } else {
            console.log('[SCA AUTHORING PREVIEW] disabled');
            canvasContainer.dom.style.removeProperty('cursor');
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
        return false;
    };

    const runPick = async (
        clientX: number,
        clientY: number,
        kind: 'click' | 'hover'
    ): Promise<void> => {
        if (pickInFlight) {
            return;
        }

        const rect = canvasContainer.dom.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        const nx = (clientX - rect.left) / rect.width;
        const ny = (clientY - rect.top) / rect.height;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
            if (kind === 'hover') {
                getInteractionCore().setHoveredRegion(null);
            }
            return;
        }

        const picker = createEditorPickerAdapter(events, scene);
        if (!picker.isAvailable()) {
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
        }
    };

    const pointerdown = (event: PointerEvent) => {
        if (isInteractionBlocked() || event.button !== 0 || event.pointerType !== 'mouse') {
            return;
        }
        pointerActive = true;
        pointerDownX = event.clientX;
        pointerDownY = event.clientY;
    };

    const pointerup = (event: PointerEvent) => {
        if (!pointerActive || event.button !== 0) {
            pointerActive = false;
            return;
        }
        pointerActive = false;

        if (isInteractionBlocked()) {
            return;
        }

        const dx = event.clientX - pointerDownX;
        const dy = event.clientY - pointerDownY;
        if (Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) {
            return;
        }

        void runPick(event.clientX, event.clientY, 'click');
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
        getInteractionCore().setHoveredRegion(null);
    };

    canvasContainer.dom.addEventListener('pointerdown', pointerdown, true);
    canvasContainer.dom.addEventListener('pointerup', pointerup, true);
    canvasContainer.dom.addEventListener('pointermove', pointermove, true);
    canvasContainer.dom.addEventListener('pointerleave', pointerleave, true);
};

export {
    registerScaViewerInteractionPreview
};
