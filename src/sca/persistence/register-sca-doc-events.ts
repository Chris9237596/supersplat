import { Events } from '../../events';

import { HotspotStore } from '../store/hotspot-store';
import { ScaAssetStore } from '../store/sca-asset-store';
import { regionMaskMimeType, regionMaskStorePath } from '../regions/region-mask-paths';
import { backgroundAssetPath } from '../viewer/viewer-background';

import { createEmptyProject } from '../types/project';

import { deserializeSsprojScaBlock, serializeSsprojScaBlock } from './sca-project-persistence';
import { ScaProject } from '../types/project';

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

    const notifyRegionSelectionChanged = () => {
        events.fire('sca.region.selected', store.getSelectedRegionId());
    };

    const notifyRigSelectionChanged = () => {
        events.fire('sca.rig.node.selected', store.getSelectedRigNodeId());
    };

    const resetScaProject = () => {
        store.loadProject(createEmptyProject());
        assetStore.clear();
        store.selectHotspot(null);
        store.selectRegion(null);
        store.selectRigNode(null);
        notifyProjectChanged();
        notifySelectionChanged();
        notifyRegionSelectionChanged();
        notifyRigSelectionChanged();
    };

    events.on('scene.clear', () => {
        resetScaProject();
    });

    events.function('docSerialize.sca', () => {
        return serializeSsprojScaBlock(store.getProject());
    });

    events.function('docSerialize.scaAssets', () => {
        return assetStore.list().map((entry) => ({
            zipPath: entry.path.startsWith('regions/') ?
                `sca/${entry.path}` :
                `${SCA_ASSET_ZIP_PREFIX}${entry.path.replace(/^assets\//, '')}`,
            path: entry.path,
            data: entry.data,
            mimeType: entry.mimeType
        }));
    });

    events.function('docDeserialize.sca', (raw: unknown) => {
        const project = deserializeSsprojScaBlock(raw);
        store.loadProject(project);
        store.selectHotspot(null);
        store.selectRegion(null);
        notifyProjectChanged();
        notifySelectionChanged();
        notifyRegionSelectionChanged();
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
    project: ScaProject
): Promise<Array<{ path: string; data: Uint8Array; mimeType: string }>> => {
    const loaded: Array<{ path: string; data: Uint8Array; mimeType: string }> = [];

    const filename = project.viewer?.background?.type === 'image' ||
        project.viewer?.background?.type === 'panorama' ?
        project.viewer.background.image?.filename :
        undefined;

    if (filename) {
        const assetPath = backgroundAssetPath(filename);
        const zipPath = scaAssetZipPath(assetPath);

        try {
            const assetSource = await zipFs.createSource(zipPath);
            const data = await assetSource.read().readAll();
            assetSource.close();

            loaded.push({
                path: assetPath,
                data,
                mimeType: mimeTypeFromFilename(filename)
            });
        } catch (error) {
            console.warn(`[SCA] failed to load background asset ${zipPath}:`, error);
        }
    }

    for (const region of project.regions) {
        const zipPath = region.source.maskAsset;
        try {
            const assetSource = await zipFs.createSource(zipPath);
            const data = await assetSource.read().readAll();
            assetSource.close();

            loaded.push({
                path: regionMaskStorePath(region.id),
                data,
                mimeType: regionMaskMimeType
            });
        } catch (error) {
            console.warn(`[SCA] failed to load region mask ${zipPath}:`, error);
        }
    }

    return loaded;
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
