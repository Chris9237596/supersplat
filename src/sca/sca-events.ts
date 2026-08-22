import { Events } from '../events';
import { Splat } from '../splat';
import { i18n } from '../ui/localization';

import { createDefaultHotspot } from './hotspot-defaults';
import { registerScaHistory } from './edit/register-sca-history';
import { registerScaDocEvents } from './persistence/register-sca-doc-events';
import { registerScaFocusEvents } from './focus/sca-focus-events';
import { registerScaViewerEvents } from './viewer/sca-viewer-events';
import { exportScaRuntime } from './export/export-sca-runtime';
import { exportScaRuntimePackage, ScaRuntimeAssetLoadError, ScaRuntimePackageOptions, WebGPUUnavailableError } from './export/export-sca-runtime-package';
import { stringifyProjectJson } from './serialize/project-json';
import { HotspotStore } from './store/hotspot-store';
import { mimeTypeForFilename, ScaAssetStore } from './store/sca-asset-store';
import { createEmptyProject, ScaHotspot, ScaProject, ScaRegion, ScaViewerBackground } from './types/project';
import { ScaRegionPatch } from './types/region';
import { ScaRigBindMode, ScaRigNode, ScaRigVec3 } from './types/rig';
import { ScaRigReparentMode } from './rig/rig-hierarchy';
import { logRigTraceSelectionChange, logRigTraceStage } from './rig/rig-trace';

const registerScaEvents = (events: Events): HotspotStore => {
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const history = registerScaHistory(events, store, assetStore);

    const notifyProjectChanged = () => {
        logRigTraceStage('project.changed', { reason: 'notifyProjectChanged' });
        const rigSelectionChanged = store.pruneInvalidRigSelection();
        events.fire('sca.project.changed', store.getProject());
        if (rigSelectionChanged) {
            notifyRigSelectionChanged();
        }
    };

    const notifySelectionChanged = () => {
        events.fire('sca.hotspot.selected', store.getSelectedHotspotId());
    };

    const notifyRigSelectionChanged = () => {
        events.fire('sca.rig.node.selected', store.getSelectedRigNodeId());
    };

    events.function('sca.project.get', () => {
        return store.getProject();
    });

    events.function('sca.project.getJson', (pretty = true) => {
        return stringifyProjectJson(store.getProject(), pretty);
    });

    events.function('sca.hotspot.getSelected', () => {
        return store.getSelectedHotspotId();
    });

    events.function('sca.hotspot.get', (id?: string) => {
        if (id) {
            return store.getHotspots().find((hotspot) => hotspot.id === id) ?? null;
        }

        return store.getSelectedHotspot();
    });

    events.function('sca.hotspot.list', () => {
        return store.getHotspots();
    });

    events.on('sca.hotspot.select', (id: string | null) => {
        if (id !== null && id === store.getSelectedHotspotId()) {
            store.selectHotspot(null);
        } else {
            store.selectHotspot(id);
            if (id) {
                store.selectRigNode(null);
            }
        }
        console.log('[SCA] hotspot selected:', store.getSelectedHotspotId());
        notifySelectionChanged();
        notifyRigSelectionChanged();
    });

    events.on('sca.hotspot.create', () => {
        history.record(() => {
            const hotspot = createDefaultHotspot(store.getProject());
            store.addHotspot(hotspot);
            store.selectHotspot(hotspot.id);
            store.selectRigNode(null);
            notifyProjectChanged();
            notifySelectionChanged();
            notifyRigSelectionChanged();
        });
    });

    events.on('sca.hotspot.add', (hotspot: ScaHotspot) => {
        history.record(() => {
            store.addHotspot(hotspot);
            notifyProjectChanged();
        });
    });

    events.on('sca.hotspot.update', (id: string, patch: Partial<ScaHotspot>) => {
        history.record(() => {
            store.updateHotspot(id, patch);
            notifyProjectChanged();
        });
    });

    events.on('sca.hotspot.delete', (id: string) => {
        history.record(() => {
            store.deleteHotspot(id);
            notifyProjectChanged();
            notifySelectionChanged();
        });
    });

    const notifyRegionSelectionChanged = () => {
        events.fire('sca.region.selected', store.getSelectedRegionId());
    };

    events.function('sca.region.getSelected', () => {
        return store.getSelectedRegionId();
    });

    events.function('sca.region.get', (id?: string) => {
        if (id) {
            return store.getRegions().find((region) => region.id === id) ?? null;
        }

        return store.getSelectedRegion();
    });

    events.function('sca.region.list', () => {
        return store.getRegions();
    });

    events.on('sca.region.select', (id: string | null) => {
        const previous = store.getSelectedRegionId();
        if (id !== null && id === store.getSelectedRegionId()) {
            store.selectRegion(null);
        } else {
            store.selectRegion(id);
            if (id) {
                store.selectRigNode(null);
            }
        }
        logRigTraceSelectionChange({
            kind: 'region',
            from: previous,
            to: store.getSelectedRegionId(),
            reason: 'sca.region.select'
        });
        console.log('[SCA] region selected:', store.getSelectedRegionId());
        notifyRegionSelectionChanged();
        notifyRigSelectionChanged();
    });

    events.on('sca.region.update', (id: string, patch: ScaRegionPatch) => {
        history.record(() => {
            store.updateRegion(id, patch);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.node.add', (node: ScaRigNode) => {
        history.record(() => {
            store.addRigNode(node);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.node.update', (id: string, patch: Partial<ScaRigNode>) => {
        history.record(() => {
            store.updateRigNode(id, patch);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.node.delete', (id: string) => {
        history.record(() => {
            store.deleteRigNode(id);
            notifyProjectChanged();
            notifyRigSelectionChanged();
        });
    });

    events.function('sca.rig.getSelected', () => {
        return store.getSelectedRigNodeId();
    });

    events.function('sca.rig.node.list', () => {
        return store.getRig()?.nodes ?? [];
    });

    events.on('sca.rig.node.select', (id: string | null) => {
        const previous = store.getSelectedRigNodeId();
        store.selectRigNode(id);
        if (id) {
            store.selectHotspot(null);
            store.selectRegion(null);
            events.fire('tool.deactivate');
        }
        logRigTraceSelectionChange({
            kind: 'rig',
            from: previous,
            to: store.getSelectedRigNodeId(),
            reason: 'sca.rig.node.select'
        });
        console.log('[SCA] rig node selected:', store.getSelectedRigNodeId());
        notifyRigSelectionChanged();
        notifySelectionChanged();
        notifyRegionSelectionChanged();
    });

    events.on('sca.rig.node.resetToRest', (id: string) => {
        history.record(() => {
            store.resetRigNodeToRest(id);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.node.setRestFromCurrent', (id: string) => {
        history.record(() => {
            store.setRigNodeRestFromCurrent(id);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.node.setParent', (
        id: string,
        parentId: string | null,
        mode: ScaRigReparentMode = 'keep-world'
    ) => {
        history.record(() => {
            store.setRigNodeParent(id, parentId, mode);
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.binding.set', (
        regionId: string,
        nodeId: string | null,
        bindMode?: ScaRigBindMode
    ) => {
        history.record(() => {
            store.setRigBinding(regionId, nodeId, { bindMode });
            notifyProjectChanged();
        });
    });

    events.on('sca.rig.binding.rebind', (regionId: string, bindMode: ScaRigBindMode) => {
        history.record(() => {
            store.rebindRegion(regionId, bindMode);
            notifyProjectChanged();
        });
    });

    events.function('sca.rig.getBinding', (regionId: string) => {
        return store.getRigBindingForRegion(regionId);
    });

    events.on('sca.region.delete', (id: string) => {
        events.fire('sca.region.delete.request', id);
    });

    events.on('sca.project.load', (project: ScaProject) => {
        store.loadProject(project);
        notifyProjectChanged();
        notifySelectionChanged();
        notifyRegionSelectionChanged();
        notifyRigSelectionChanged();
    });

    registerScaFocusEvents(events);
    registerScaViewerEvents(events, store, history, assetStore);
    registerScaDocEvents(events, store, assetStore);

    events.function('sca.store', () => store);

    events.function('sca.assetStore', () => assetStore);

    events.function('sca.history.applying', () => history.applying);

    events.on('sca.export.runtime', () => {
        exportScaRuntime(store.getProject());
    });

    let runtimePackageExportInProgress = false;

    events.function('sca.export.runtimePackage.inProgress', () => runtimePackageExportInProgress);

    events.on('sca.export.runtimePackage', async (payload: boolean | ScaRuntimePackageOptions = true) => {
        if (runtimePackageExportInProgress) {
            console.warn('[SCA EXPORT] export already in progress — ignoring duplicate request');
            return;
        }

        runtimePackageExportInProgress = true;

        const options: ScaRuntimePackageOptions = typeof payload === 'boolean'
            ? { includePreview: payload }
            : payload;
        const splats = events.invoke('scene.splats') as Splat[] | undefined;

        if (!Array.isArray(splats) || splats.length === 0) {
            runtimePackageExportInProgress = false;
            await events.invoke('showPopup', {
                type: 'error',
                header: 'Export Failed',
                message: 'Load a Gaussian splat before exporting the SCA runtime package.'
            });
            return;
        }

        try {
            await exportScaRuntimePackage(splats, store.getProject(), events, options);
        } catch (error) {
            if (error instanceof WebGPUUnavailableError) {
                await events.invoke('showPopup', {
                    type: 'error',
                    header: i18n.t('popup.error'),
                    message: i18n.t('popup.webgpu-unavailable')
                });
                return;
            }

            if (error instanceof ScaRuntimeAssetLoadError) {
                console.error('[SCA] runtime package export failed:', {
                    assetPath: error.assetPath,
                    cause: error.cause
                });
                await events.invoke('showPopup', {
                    type: 'error',
                    header: 'SCA Runtime export failed',
                    message: error.message
                });
                return;
            }

            console.error('[SCA] runtime package export failed:', error);
            await events.invoke('showPopup', {
                type: 'error',
                header: 'Export Failed',
                message: error instanceof Error ? error.message : 'Unknown export error'
            });
        } finally {
            runtimePackageExportInProgress = false;
        }
    });

    console.log('[SCA] hotspot store ready');
    console.log('[SCA] project json:', events.invoke('sca.project.getJson'));

    return store;
};

export { registerScaEvents };
