import { SelectNoneOp } from '../../edit-ops';
import { IndexRanges } from '../../index-ranges';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ScaRegionMembershipOp } from '../edit/sca-region-ops';
import { createDefaultRegion } from '../region-defaults';
import { captureSelectionRanges } from './region-selection-capture';
import {
    cloneAssets,
    deleteRegionMask,
    getRegionMask,
    remapRegionMasksForSave,
    setRegionMask,
    validateRegionMasksOnLoad
} from './region-mask-store';
import { regionMaskStorePath } from './region-mask-paths';
import { findSplatByScaSplatId, ensureScaSplatId } from './splat-identity';
import { HotspotStore } from '../store/hotspot-store';
import { ScaAssetStore } from '../store/sca-asset-store';

const applyRegionMaskEdit = (
    events: Events,
    scene: Scene,
    regionId: string,
    edit: 'add' | 'remove'
) => {
    const store = events.invoke('sca.store') as HotspotStore;
    const assetStore = events.invoke('sca.assetStore') as ScaAssetStore;
    const applying = events.invoke('sca.history.applying') as { value: boolean };

    const region = store.getRegions().find((entry) => entry.id === regionId);
    if (!region) {
        return;
    }

    const splat = findSplatByScaSplatId(scene, region.source.scaSplatId);
    if (!splat?.visible || splat.numSelected === 0) {
        void events.invoke('showPopup', {
            type: 'info',
            header: 'Edit Region Membership',
            message: 'Select one or more Gaussians in the source splat before editing region membership.'
        });
        return;
    }

    if (region.source.scaSplatId !== ensureScaSplatId(splat, scene)) {
        void events.invoke('showPopup', {
            type: 'info',
            header: 'Edit Region Membership',
            message: 'Selection must be on the Region source splat.'
        });
        return;
    }

    const selection = captureSelectionRanges(splat);
    if (selection.empty) {
        return;
    }

    const gaussianCount = splat.splatData.numSplats;
    const current = getRegionMask(assetStore, regionId);
    if (!current) {
        console.warn(`[SCA] region mask missing for ${regionId}`);
        return;
    }

    const next = edit === 'add' ?
        IndexRanges.union(current, selection, gaussianCount) :
        IndexRanges.subtract(current, selection, gaussianCount);

    if (next.empty) {
        void events.invoke('showPopup', {
            type: 'info',
            header: 'Edit Region Membership',
            message: 'Remove would leave this Region empty. Operation cancelled.'
        });
        return;
    }

    const beforeProject = store.getProject();
    const beforeRegionSelection = store.getSelectedRegionId();
    const beforeAssets = cloneAssets(assetStore);

    const afterProject = structuredClone(beforeProject);
    const afterRegion = afterProject.regions.find((entry) => entry.id === regionId);
    if (afterRegion) {
        afterRegion.capture.gaussianCount = gaussianCount;
    }

    setRegionMask(assetStore, regionId, next, gaussianCount);
    const afterAssets = cloneAssets(assetStore);

    events.fire('edit.add', new ScaRegionMembershipOp(
        edit === 'add' ? 'addRegionSelection' : 'removeRegionSelection',
        events,
        store,
        assetStore,
        applying,
        beforeProject,
        afterProject,
        beforeRegionSelection,
        regionId,
        beforeAssets,
        afterAssets,
        splat,
        new SelectNoneOp(splat)
    ));
};

const registerScaRegionEvents = (events: Events, scene: Scene): void => {
    const getStore = () => events.invoke('sca.store') as HotspotStore;
    const getAssetStore = () => events.invoke('sca.assetStore') as ScaAssetStore;
    const getApplying = () => events.invoke('sca.history.applying') as { value: boolean };

    events.on('sca.region.createFromSelection', async () => {
        const splat = events.invoke('selection') as Splat | undefined;

        if (!splat?.visible || splat.numSelected === 0) {
            await events.invoke('showPopup', {
                type: 'info',
                header: 'Region from Selection',
                message: 'Select one or more Gaussians in the active splat before creating a region.'
            });
            return;
        }

        const ranges = captureSelectionRanges(splat);
        if (ranges.empty) {
            await events.invoke('showPopup', {
                type: 'info',
                header: 'Region from Selection',
                message: 'Select one or more Gaussians in the active splat before creating a region.'
            });
            return;
        }

        const store = getStore();
        const assetStore = getAssetStore();
        const scaSplatId = ensureScaSplatId(splat, scene);
        const gaussianCount = splat.splatData.numSplats;

        const beforeProject = store.getProject();
        const beforeRegionSelection = store.getSelectedRegionId();
        const beforeAssets = cloneAssets(assetStore);

        const region = createDefaultRegion(beforeProject, scaSplatId, gaussianCount);
        const afterProject = structuredClone(beforeProject);
        afterProject.regions.push(region);

        setRegionMask(assetStore, region.id, ranges, gaussianCount);
        const afterAssets = cloneAssets(assetStore);

        events.fire('edit.add', new ScaRegionMembershipOp(
            'createRegion',
            events,
            store,
            assetStore,
            getApplying(),
            beforeProject,
            afterProject,
            beforeRegionSelection,
            null,
            beforeAssets,
            afterAssets,
            splat,
            new SelectNoneOp(splat)
        ));
    });

    events.on('sca.region.addSelection', (id: string) => {
        applyRegionMaskEdit(events, scene, id, 'add');
    });

    events.on('sca.region.removeSelection', (id: string) => {
        applyRegionMaskEdit(events, scene, id, 'remove');
    });

    events.on('sca.region.delete.request', (id: string) => {
        const store = getStore();
        const assetStore = getAssetStore();
        const region = store.getRegions().find((entry) => entry.id === id);

        if (!region) {
            return;
        }

        const beforeProject = store.getProject();
        const beforeRegionSelection = store.getSelectedRegionId();
        const beforeAssets = cloneAssets(assetStore);

        const afterProject = structuredClone(beforeProject);
        afterProject.regions = afterProject.regions.filter((entry) => entry.id !== id);
        const afterRegionSelection = beforeRegionSelection === id ? null : beforeRegionSelection;
        const afterAssets = beforeAssets.filter((entry) => entry.path !== regionMaskStorePath(id));

        events.fire('edit.add', new ScaRegionMembershipOp(
            'deleteRegion',
            events,
            store,
            assetStore,
            getApplying(),
            beforeProject,
            afterProject,
            beforeRegionSelection,
            afterRegionSelection,
            beforeAssets,
            afterAssets,
            null,
            null
        ));
    });

    events.function('sca.region.getMask', (regionId: string) => {
        return getRegionMask(getAssetStore(), regionId);
    });

    events.function('sca.regions.remapMasksForSave', () => {
        remapRegionMasksForSave(getStore(), getAssetStore(), scene);
    });

    events.on('doc.loaded', () => {
        validateRegionMasksOnLoad(getStore(), getAssetStore(), scene);
    });

    events.on('sca.region.deleteMask', (regionId: string) => {
        deleteRegionMask(getAssetStore(), regionId);
    });
};

export { registerScaRegionEvents };
