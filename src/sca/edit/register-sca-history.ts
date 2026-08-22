import { Events } from '../../events';

import { ScaAssetSnapshot, ScaProjectOp } from './sca-edit-ops';
import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaProject } from '../types/project';

type ScaHistorySnapshot = {
    project: ScaProject;
    selection: string | null;
    regionSelection: string | null;
    rigSelection: string | null;
    assets: ScaAssetSnapshot[];
};

const cloneAssets = (assetStore: ScaAssetStore): ScaAssetSnapshot[] => {
    return assetStore.list().map((entry) => ({
        path: entry.path,
        data: entry.data.slice(),
        mimeType: entry.mimeType
    }));
};

const cloneSnapshot = (store: HotspotStore, assetStore: ScaAssetStore): ScaHistorySnapshot => ({
    project: store.getProject(),
    selection: store.getSelectedHotspotId(),
    regionSelection: store.getSelectedRegionId(),
    rigSelection: store.getSelectedRigNodeId(),
    assets: cloneAssets(assetStore)
});

const serializeAssets = (assets: ScaAssetSnapshot[]): string => {
    return JSON.stringify(assets.map((asset) => ({
        path: asset.path,
        mimeType: asset.mimeType,
        data: Array.from(asset.data)
    })));
};

const snapshotsEqual = (left: ScaHistorySnapshot, right: ScaHistorySnapshot): boolean => {
    return left.selection === right.selection &&
        left.regionSelection === right.regionSelection &&
        left.rigSelection === right.rigSelection &&
        JSON.stringify(left.project) === JSON.stringify(right.project) &&
        serializeAssets(left.assets) === serializeAssets(right.assets);
};

class ScaHistoryController {
    private transactionStart: ScaHistorySnapshot | null = null;
    readonly applying = { value: false };

    constructor(
        private events: Events,
        private store: HotspotStore,
        private assetStore: ScaAssetStore
    ) {
    }

    record(mutator: () => void) {
        if (this.applying.value) {
            mutator();
            return;
        }

        if (this.transactionStart) {
            mutator();
            return;
        }

        const before = cloneSnapshot(this.store, this.assetStore);
        mutator();
        const after = cloneSnapshot(this.store, this.assetStore);

        if (snapshotsEqual(before, after)) {
            return;
        }

        this.events.fire('edit.add', new ScaProjectOp(
            this.events,
            this.store,
            this.assetStore,
            before.project,
            after.project,
            before.selection,
            after.selection,
            before.regionSelection,
            after.regionSelection,
            before.rigSelection,
            after.rigSelection,
            before.assets,
            after.assets,
            this.applying
        ));
    }

    beginTransaction() {
        if (this.applying.value || this.transactionStart) {
            return;
        }

        this.transactionStart = cloneSnapshot(this.store, this.assetStore);
    }

    commitTransaction(mutator?: () => void) {
        if (this.applying.value) {
            mutator?.();
            return;
        }

        const before = this.transactionStart ?? cloneSnapshot(this.store, this.assetStore);
        this.transactionStart = null;

        if (mutator) {
            mutator();
        }

        const after = cloneSnapshot(this.store, this.assetStore);
        if (snapshotsEqual(before, after)) {
            return;
        }

        this.events.fire('edit.add', new ScaProjectOp(
            this.events,
            this.store,
            this.assetStore,
            before.project,
            after.project,
            before.selection,
            after.selection,
            before.regionSelection,
            after.regionSelection,
            before.rigSelection,
            after.rigSelection,
            before.assets,
            after.assets,
            this.applying
        ));
    }

    cancelTransaction() {
        this.transactionStart = null;
    }
}

const registerScaHistory = (
    events: Events,
    store: HotspotStore,
    assetStore: ScaAssetStore
): ScaHistoryController => {
    const history = new ScaHistoryController(events, store, assetStore);

    events.function('sca.history.beginTransaction', () => {
        history.beginTransaction();
    });

    events.function('sca.history.commitTransaction', () => {
        history.commitTransaction();
    });

    events.function('sca.history.cancelTransaction', () => {
        history.cancelTransaction();
    });

    events.function('sca.history.record', (mutator: () => void) => {
        history.record(mutator);
    });

    return history;
};

export {
    registerScaHistory,
    ScaHistoryController
};
