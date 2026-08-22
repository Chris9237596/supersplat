import { Events } from '../events';
import { Splat } from '../splat';
import { i18n } from '../ui/localization';

import { createDefaultHotspot } from './hotspot-defaults';
import { registerScaHistory } from './edit/register-sca-history';
import { registerScaDocEvents } from './persistence/register-sca-doc-events';
import { registerScaFocusEvents } from './focus/sca-focus-events';
import { registerScaViewerEvents } from './viewer/sca-viewer-events';
import { exportScaRuntime } from './export/export-sca-runtime';
import { exportScaRuntimePackage, ScaRuntimePackageOptions, WebGPUUnavailableError } from './export/export-sca-runtime-package';
import { stringifyProjectJson } from './serialize/project-json';
import { HotspotStore } from './store/hotspot-store';
import { mimeTypeForFilename, ScaAssetStore } from './store/sca-asset-store';
import { createEmptyProject, ScaHotspot, ScaProject, ScaRegion, ScaViewerBackground } from './types/project';
import { ScaRegionPatch } from './types/region';

const registerScaEvents = (events: Events): HotspotStore => {
    const store = new HotspotStore(createEmptyProject());
    const assetStore = new ScaAssetStore();
    const history = registerScaHistory(events, store, assetStore);

    const notifyProjectChanged = () => {
        events.fire('sca.project.changed', store.getProject());
    };

    const notifySelectionChanged = () => {
        events.fire('sca.hotspot.selected', store.getSelectedHotspotId());
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
        }
        console.log('[SCA] hotspot selected:', store.getSelectedHotspotId());
        notifySelectionChanged();
    });

    events.on('sca.hotspot.create', () => {
        history.record(() => {
            const hotspot = createDefaultHotspot(store.getProject());
            store.addHotspot(hotspot);
            store.selectHotspot(hotspot.id);
            notifyProjectChanged();
            notifySelectionChanged();
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
        if (id !== null && id === store.getSelectedRegionId()) {
            store.selectRegion(null);
        } else {
            store.selectRegion(id);
        }
        console.log('[SCA] region selected:', store.getSelectedRegionId());
        notifyRegionSelectionChanged();
    });

    events.on('sca.region.update', (id: string, patch: ScaRegionPatch) => {
        history.record(() => {
            store.updateRegion(id, patch);
            notifyProjectChanged();
        });
    });

    events.on('sca.region.delete', (id: string) => {
        events.fire('sca.region.delete.request', id);
    });

    events.on('sca.project.load', (project: ScaProject) => {
        store.loadProject(project);
        notifyProjectChanged();
        notifySelectionChanged();
        notifyRegionSelectionChanged();
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

    events.on('sca.export.runtimePackage', async (payload: boolean | ScaRuntimePackageOptions = true) => {
        const options: ScaRuntimePackageOptions = typeof payload === 'boolean'
            ? { includePreview: payload }
            : payload;
        const splats = events.invoke('scene.splats') as Splat[] | undefined;

        if (!Array.isArray(splats) || splats.length === 0) {
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

            console.error('[SCA] runtime package export failed:', error);
            await events.invoke('showPopup', {
                type: 'error',
                header: 'Export Failed',
                message: error instanceof Error ? error.message : 'Unknown export error'
            });
        }
    });

    console.log('[SCA] hotspot store ready');
    console.log('[SCA] project json:', events.invoke('sca.project.getJson'));

    return store;
};

export { registerScaEvents };
