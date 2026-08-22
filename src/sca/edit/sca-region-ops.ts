import { SelectNoneOp, EditOp } from '../../edit-ops';
import { Events } from '../../events';
import { Splat } from '../../splat';

import { ScaAssetSnapshot } from './sca-edit-ops';
import { ScaAssetStore } from '../store/sca-asset-store';
import { HotspotStore } from '../store/hotspot-store';
import { ScaProject } from '../types/project';

class ScaRegionMembershipOp implements EditOp {
    name: string;

    constructor(
        name: string,
        private events: Events,
        private store: HotspotStore,
        private assetStore: ScaAssetStore,
        private applying: { value: boolean },
        private before: ScaProject,
        private after: ScaProject,
        private beforeRegionSelection: string | null,
        private afterRegionSelection: string | null,
        private beforeAssets: ScaAssetSnapshot[],
        private afterAssets: ScaAssetSnapshot[],
        private sourceSplat: Splat | null,
        private selectNoneOp: SelectNoneOp | null
    ) {
        this.name = name;
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
        regionSelection: string | null,
        assets: ScaAssetSnapshot[]
    ) {
        this.applying.value = true;
        this.store.loadProject(project);
        this.applyAssets(assets);
        this.store.selectRegion(regionSelection);
        this.events.fire('sca.project.changed', this.store.getProject());
        this.events.fire('sca.region.selected', this.store.getSelectedRegionId());
        this.applying.value = false;
    }

    async do() {
        this.apply(this.after, this.afterRegionSelection, this.afterAssets);

        if (this.selectNoneOp && this.sourceSplat) {
            await this.selectNoneOp.do();
            this.events.fire('selection', this.sourceSplat);
        }
    }

    async undo() {
        if (this.selectNoneOp && this.sourceSplat) {
            await this.selectNoneOp.undo();
            this.events.fire('selection', this.sourceSplat);
        }

        this.apply(this.before, this.beforeRegionSelection, this.beforeAssets);
    }

    destroy() {
        this.selectNoneOp?.destroy?.();
    }
}

export {
    ScaRegionMembershipOp
};
