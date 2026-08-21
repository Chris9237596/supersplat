import { Events } from '../events';
import { Splat } from '../splat';
import { i18n } from '../ui/localization';

import { createDefaultHotspot } from './hotspot-defaults';
import { registerScaFocusEvents } from './focus/sca-focus-events';
import { registerScaViewerEvents } from './viewer/sca-viewer-events';
import { exportScaRuntime } from './export/export-sca-runtime';
import { exportScaRuntimePackage, WebGPUUnavailableError } from './export/export-sca-runtime-package';
import { stringifyProjectJson } from './serialize/project-json';
import { HotspotStore } from './store/hotspot-store';
import { createEmptyProject, ScaHotspot, ScaProject } from './types/project';

const registerScaEvents = (events: Events): HotspotStore => {
    const store = new HotspotStore(createEmptyProject());

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
        store.selectHotspot(id);
        console.log('[SCA] hotspot selected:', id);
        notifySelectionChanged();
    });

    events.on('sca.hotspot.create', () => {
        const hotspot = createDefaultHotspot(store.getProject());
        store.addHotspot(hotspot);
        store.selectHotspot(hotspot.id);
        notifyProjectChanged();
        notifySelectionChanged();
    });

    events.on('sca.hotspot.add', (hotspot: ScaHotspot) => {
        store.addHotspot(hotspot);
        notifyProjectChanged();
    });

    events.on('sca.hotspot.update', (id: string, patch: Partial<ScaHotspot>) => {
        store.updateHotspot(id, patch);
        notifyProjectChanged();
    });

    events.on('sca.hotspot.delete', (id: string) => {
        store.deleteHotspot(id);
        notifyProjectChanged();
        notifySelectionChanged();
    });

    events.on('sca.project.load', (project: ScaProject) => {
        store.loadProject(project);
        notifyProjectChanged();
        notifySelectionChanged();
    });

    registerScaFocusEvents(events);
    registerScaViewerEvents(events, store);

    events.on('sca.export.runtime', () => {
        exportScaRuntime(store.getProject());
    });

    events.on('sca.export.runtimePackage', async (includePreview = true) => {
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
            await exportScaRuntimePackage(splats, store.getProject(), events, { includePreview });
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
