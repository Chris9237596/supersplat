import { EditOp } from '../../edit-ops';
import { Events } from '../../events';

import {
    logRigTraceStage
} from '../rig/rig-trace';
import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaProject } from '../types/project';

type ScaAssetSnapshot = {
    path: string;
    data: Uint8Array;
    mimeType: string;
};

const serializeAssets = (assets: ScaAssetSnapshot[]): string => {
    return JSON.stringify(assets.map((asset) => ({
        path: asset.path,
        mimeType: asset.mimeType,
        data: Array.from(asset.data)
    })));
};

const projectStateMatches = (
    store: HotspotStore,
    assetStore: ScaAssetStore,
    project: ScaProject,
    selection: string | null,
    regionSelection: string | null,
    rigSelection: string | null,
    assets: ScaAssetSnapshot[]
): boolean => {
    if (store.getSelectedHotspotId() !== selection) {
        return false;
    }
    if (store.getSelectedRegionId() !== regionSelection) {
        return false;
    }
    if (store.getSelectedRigNodeId() !== rigSelection) {
        return false;
    }
    if (JSON.stringify(store.getProject()) !== JSON.stringify(project)) {
        return false;
    }

    const currentAssets = serializeAssets(assetStore.list().map((entry) => ({
        path: entry.path,
        data: entry.data,
        mimeType: entry.mimeType
    })));
    return currentAssets === serializeAssets(assets);
};

class ScaProjectOp implements EditOp {
    name = 'scaProject';

    constructor(
        private events: Events,
        private store: HotspotStore,
        private assetStore: ScaAssetStore,
        private before: ScaProject,
        private after: ScaProject,
        private beforeSelection: string | null,
        private afterSelection: string | null,
        private beforeRegionSelection: string | null,
        private afterRegionSelection: string | null,
        private beforeRigSelection: string | null,
        private afterRigSelection: string | null,
        private beforeAssets: ScaAssetSnapshot[],
        private afterAssets: ScaAssetSnapshot[],
        private applying: { value: boolean }
    ) {
    }

    private applyAssets(assets: ScaAssetSnapshot[]) {
        const loaded: Record<string, { data: Uint8Array; mimeType: string }> = {};
        for (const asset of assets) {
            loaded[asset.path] = {
                data: asset.data.slice(),
                mimeType: asset.mimeType
            };
        }
        this.assetStore.load(loaded);
    }

    private apply(
        project: ScaProject,
        selection: string | null,
        regionSelection: string | null,
        rigSelection: string | null,
        assets: ScaAssetSnapshot[],
        reason: string
    ) {
        if (projectStateMatches(
            this.store,
            this.assetStore,
            project,
            selection,
            regionSelection,
            rigSelection,
            assets
        )) {
            logRigTraceStage('history-apply', { skipped: true, reason: `${reason} no-op` });
            return;
        }

        logRigTraceStage('history-apply', { reason }, undefined);
        this.applying.value = true;
        this.store.loadProject(project);
        this.applyAssets(assets);
        this.store.selectHotspot(selection);
        this.store.selectRegion(regionSelection);
        this.store.selectRigNode(rigSelection);
        this.events.fire('sca.project.changed', this.store.getProject());
        this.events.fire('sca.hotspot.selected', this.store.getSelectedHotspotId());
        this.events.fire('sca.region.selected', this.store.getSelectedRegionId());
        this.events.fire('sca.rig.node.selected', this.store.getSelectedRigNodeId());
        this.applying.value = false;
    }

    do() {
        this.apply(
            this.after,
            this.afterSelection,
            this.afterRegionSelection,
            this.afterRigSelection,
            this.afterAssets,
            'ScaProjectOp.do'
        );
    }

    undo() {
        logRigTraceStage('history-revert', { reason: 'ScaProjectOp.undo' });
        this.apply(
            this.before,
            this.beforeSelection,
            this.beforeRegionSelection,
            this.beforeRigSelection,
            this.beforeAssets,
            'ScaProjectOp.undo'
        );
    }
}

export {
    ScaAssetSnapshot,
    ScaProjectOp
};
