import { Events } from '../../events';

import { HotspotStore } from '../store/hotspot-store';
import { ScaAssetStore } from '../store/sca-asset-store';
import { backgroundAssetPath } from '../viewer/viewer-background';

import { createEmptyProject } from '../types/project';

import { deserializeSsprojScaBlock, serializeSsprojScaBlock } from './sca-project-persistence';

const SCA_ASSET_ZIP_PREFIX = 'sca/assets/';

const registerScaDocEvents = (
    events: Events,
    store: HotspotStore,
    assetStore: ScaAssetStore
): void => {
    const notifyProjectChanged = () => {
        events.fire('sca.project.changed', store.getProject());
    };

    const notifySelectionChanged = () => {
        events.fire('sca.hotspot.selected', store.getSelectedHotspotId());
    };

    const resetScaProject = () => {
        store.loadProject(createEmptyProject());
        assetStore.clear();
        store.selectHotspot(null);
        notifyProjectChanged();
        notifySelectionChanged();
    };

    events.on('scene.clear', () => {
        resetScaProject();
    });

    events.function('docSerialize.sca', () => {
        return serializeSsprojScaBlock(store.getProject());
    });

    events.function('docSerialize.scaAssets', () => {
        return assetStore.list().map((entry) => ({
            zipPath: `${SCA_ASSET_ZIP_PREFIX}${entry.path.replace(/^assets\//, '')}`,
            ...entry
        }));
    });

    events.function('docDeserialize.sca', (raw: unknown) => {
        const project = deserializeSsprojScaBlock(raw);
        store.loadProject(project);
        store.selectHotspot(null);
        notifyProjectChanged();
        notifySelectionChanged();
    });

    events.on('docDeserialize.scaAssets', (entries: Array<{
        path: string;
        data: Uint8Array;
        mimeType: string;
    }>) => {
        const loaded: Record<string, { data: Uint8Array; mimeType: string }> = {};
        for (const entry of entries) {
            loaded[entry.path] = {
                data: entry.data,
                mimeType: entry.mimeType
            };
        }
        assetStore.load(loaded);
        notifyProjectChanged();
    });
};

const scaAssetZipPath = (assetPath: string): string => {
    return `${SCA_ASSET_ZIP_PREFIX}${assetPath.replace(/^assets\//, '')}`;
};

const loadScaAssetsFromZip = async (
    zipFs: { createSource: (path: string) => Promise<{ read: () => { readAll: () => Promise<Uint8Array> }; close: () => void }> },
    project: { viewer?: { background?: { type?: string; image?: { filename?: string } } } }
): Promise<Array<{ path: string; data: Uint8Array; mimeType: string }>> => {
    const filename = project.viewer?.background?.type === 'image' ?
        project.viewer.background.image?.filename :
        undefined;

    if (!filename) {
        return [];
    }

    const assetPath = backgroundAssetPath(filename);
    const zipPath = scaAssetZipPath(assetPath);

    try {
        const assetSource = await zipFs.createSource(zipPath);
        const data = await assetSource.read().readAll();
        assetSource.close();

        return [{
            path: assetPath,
            data,
            mimeType: mimeTypeFromFilename(filename)
        }];
    } catch (error) {
        console.warn(`[SCA] failed to load background asset ${zipPath}:`, error);
        return [];
    }
};

const mimeTypeFromFilename = (filename: string): string => {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) {
        return 'image/png';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    if (lower.endsWith('.webp')) {
        return 'image/webp';
    }

    return 'application/octet-stream';
};

export {
    loadScaAssetsFromZip,
    registerScaDocEvents,
    scaAssetZipPath,
    SCA_ASSET_ZIP_PREFIX
};
