import { ZipFileSystem, ZipReadFileSystem } from '@playcanvas/splat-transform';

import { Events } from './events';
import { fileSystemAccess, logFileSystemAccessOnce } from './file-system-access';
import { BrowserFileSystem, BlobReadSource } from './io';
import { projectRecovery } from './project-recovery';
import { recentFiles } from './recent-files';
import { Scene } from './scene';
import { Splat } from './splat';
import { writeSplatFile } from './splat-serialize';
import { Transform } from './transform';
import { i18n } from './ui/localization';
import { loadScaAssetsFromZip } from './sca/persistence/register-sca-doc-events';
import { ScaProject } from './sca/types/project';

// ts compiler and vscode find this type, but eslint does not
type FilePickerAcceptType = unknown;

const SuperFileType: FilePickerAcceptType[] = [{
    description: 'SuperSplat document',
    accept: {
        'application/x-supersplat': ['.ssproj']
    }
}];

type FileSelectorCallback = (fileList: File) => void;

// helper class to show a file selector dialog.
// used when showOpenFilePicker is not available.
class FileSelector {
    show: (callbackFunc: FileSelectorCallback) => void;

    constructor() {
        const fileSelector = document.createElement('input');
        fileSelector.setAttribute('id', 'document-file-selector');
        fileSelector.setAttribute('type', 'file');
        fileSelector.setAttribute('accept', '.ssproj');
        fileSelector.setAttribute('multiple', 'false');

        document.body.append(fileSelector);

        let callbackFunc: FileSelectorCallback = null;

        fileSelector.addEventListener('change', () => {
            callbackFunc(fileSelector.files[0]);
        });

        fileSelector.addEventListener('cancel', () => {
            callbackFunc(null);
        });

        this.show = (func: FileSelectorCallback) => {
            callbackFunc = func;
            fileSelector.click();
        };
    }
}

const registerDocEvents = (scene: Scene, events: Events) => {
    logFileSystemAccessOnce();

    // doc name — registered first so UI can query it safely
    let docName: string = null;
    let loadedFromRecovery = false;

    const setDocName = (name: string) => {
        if (name !== docName) {
            docName = name;
            events.fire('doc.name', docName);
            events.fire('doc.saveStateChanged');
        }
    };

    events.function('doc.name', () => {
        return docName;
    });

    events.on('doc.setName', (name) => {
        setDocName(name);
    });

    // this file handle is updated as the current document is loaded and saved
    let documentFileHandle: FileSystemFileHandle = null;

    events.function('doc.isRecoverySession', () => {
        return loadedFromRecovery && !documentFileHandle;
    });

    // construct the file selector
    const fileSelector = fileSystemAccess.openPicker ? null : new FileSelector();

    // show the user a reset confirmation popup
    const getResetConfirmation = async () => {
        const result = await events.invoke('showPopup', {
            type: 'yesno',
            header: i18n.t('doc.reset'),
            message: i18n.t(events.invoke('scene.dirty') ? 'doc.unsaved-message' : 'doc.reset-message')
        });

        if (result.action !== 'yes') {
            return false;
        }

        return true;
    };

    // reset the scene
    const resetScene = () => {
        events.fire('scene.clear');
        events.fire('camera.reset');
        events.fire('doc.setName', null);
        documentFileHandle = null;
        loadedFromRecovery = false;
    };

    const persistRecoveryBytes = async (name: string, data: ArrayBuffer) => {
        if (fileSystemAccess.openPicker) {
            return;
        }
        try {
            await projectRecovery.save(name, data);
        } catch (error) {
            console.warn('[SCA RECOVERY] failed to persist project copy:', error);
        }
    };

    // load the document from the given file
    const loadDocument = async (file: File): Promise<boolean> => {
        events.fire('startSpinner');

        // Create streaming ZIP reader from the file
        const blobSource = new BlobReadSource(file);
        const zipFs = new ZipReadFileSystem(blobSource);

        try {
            // the document's view settings are applied through the same events
            // as user changes - suspend preference capture so they don't
            // overwrite the user's stored preferences. resumed in the finally
            // below so a failed load can't leave capture suspended.
            events.fire('preferences.suspend');

            // reset the scene
            resetScene();

            // read document.json via streaming (only reads what's needed)
            const docSource = await zipFs.createSource('document.json');
            const docData = await docSource.read().readAll();
            docSource.close();
            const document = JSON.parse(new TextDecoder().decode(docData));

            // run through each splat and load it
            for (let i = 0; i < document.splats.length; ++i) {
                const filename = `splat_${i}.ply`;
                const splatSettings = document.splats[i];

                // load splat directly from the zip filesystem (streams on-demand)
                // skipReorder=true because ssproj PLY files are already in morton order
                const splat = await scene.assetLoader.load(filename, zipFs, false, true);
                if (!splat) {
                    throw new Error(`Failed to load ${filename}`);
                }

                await scene.add(splat);

                splat.docDeserialize(splatSettings);
            }

            // FIXME: trigger scene bound calc in a better way
            const tmp = scene.bound;
            if (tmp === null) {
                console.error('this should never fire');
            }

            events.invoke('docDeserialize.timeline', document.timeline);
            events.invoke('docDeserialize.poseSets', document.poseSets, document.camera?.fov);
            events.invoke('docDeserialize.view', document.view);
            scene.camera.docDeserialize(document.camera);
            events.invoke('docDeserialize.sca', document.sca);

            const scaAssets = await loadScaAssetsFromZip(
                zipFs,
                events.invoke('sca.project.get') as ScaProject
            );
            if (scaAssets.length > 0) {
                events.fire('docDeserialize.scaAssets', scaAssets);
            }

            // refresh the pivot to reflect the loaded transform
            const currentSelection = events.invoke('selection');
            if (currentSelection) {
                const pivot = events.invoke('pivot');
                const transform = new Transform();
                currentSelection.getPivot(transform);
                pivot.place(transform);
            }

            scene.forceRender = true;
            events.fire('doc.loaded');

            if (!fileSystemAccess.openPicker) {
                await persistRecoveryBytes(file.name, await file.arrayBuffer());
            }

            return true;
        } catch (error) {
            await events.invoke('showPopup', {
                type: 'error',
                header: i18n.t('doc.load-failed'),
                message: `'${error.message ?? error}'`
            });
            return false;
        } finally {
            // fire events before cleanup so a throwing close can't leave
            // preference capture suspended or the spinner running
            events.fire('preferences.resume');
            events.fire('stopSpinner');

            // Clean up resources
            zipFs.close();
        }
    };

    const saveDocument = async (options: { stream?: FileSystemWritableFileStream, filename?: string }) => {
        events.fire('startSpinner');

        try {
            const splats = events.invoke('scene.allSplats') as Splat[];

            events.invoke('sca.regions.remapMasksForSave');

            const document = {
                version: 0,
                camera: scene.camera.docSerialize(),
                view: events.invoke('docSerialize.view'),
                poseSets: events.invoke('docSerialize.poseSets'),
                timeline: events.invoke('docSerialize.timeline'),
                splats: splats.map(s => s.docSerialize()),
                sca: events.invoke('docSerialize.sca')
            };

            const serializeSettings = {
                // even though we support saving selection state, we disable that for now
                // because including a uint8 array in the document PLY results in slow loading
                // path.
                keepStateData: false,
                keepWorldTransform: true,
                keepColorTint: true
            };

            const filename = options.filename ?? docName ?? 'scene.ssproj';
            const onDownload = !options.stream && !fileSystemAccess.openPicker ?
                (data: Uint8Array, downloadName: string) => {
                    const copy = data.buffer.slice(
                        data.byteOffset,
                        data.byteOffset + data.byteLength
                    ) as ArrayBuffer;
                    void persistRecoveryBytes(downloadName, copy);
                } :
                undefined;

            // Create browser filesystem and zip filesystem
            const browserFs = new BrowserFileSystem(filename, options.stream, onDownload);
            const browserWriter = await browserFs.createWriter(filename);
            const zipFs = new ZipFileSystem(browserWriter);

            // Write document.json
            const docWriter = await zipFs.createWriter('document.json');
            await docWriter.write(new TextEncoder().encode(JSON.stringify(document)));
            await docWriter.close();

            // Write each splat as PLY
            for (let i = 0; i < splats.length; ++i) {
                await writeSplatFile([splats[i]], serializeSettings, 'ply', `splat_${i}.ply`, {}, zipFs);
            }

            const scaAssets = events.invoke('docSerialize.scaAssets') as Array<{
                zipPath: string;
                data: Uint8Array;
            }> | undefined;

            if (Array.isArray(scaAssets)) {
                for (const asset of scaAssets) {
                    const assetWriter = await zipFs.createWriter(asset.zipPath);
                    await assetWriter.write(asset.data);
                    await assetWriter.close();
                }
            }

            // Close zip (also closes underlying browser writer)
            await zipFs.close();
        } catch (error) {
            await events.invoke('showPopup', {
                type: 'error',
                header: i18n.t('doc.save-failed'),
                message: `'${error.message ?? error}'`
            });
        } finally {
            events.fire('stopSpinner');
        }
    };

    // handle user requesting a new document
    events.function('doc.new', async () => {
        if (!await getResetConfirmation()) {
            return false;
        }
        resetScene();
        // new documents start from the user's stored preferences rather than
        // whatever view state the previous document left behind
        events.fire('preferences.apply');
        events.fire('doc.loaded');
        return true;
    });

    // handle document file being dropped
    // NOTE: on chrome it's possible to get the FileSystemFileHandle from the DataTransferItem
    // (which would result in more seamless user experience), but this is not yet supported in
    // other browsers.
    events.function('doc.load', async (file: File, handle?: FileSystemFileHandle) => {
        if (!events.invoke('scene.empty') && !await getResetConfirmation()) {
            return false;
        }

        if (!await loadDocument(file)) {
            return false;
        }

        events.fire('doc.setName', file.name);
        loadedFromRecovery = false;

        if (handle) {
            documentFileHandle = handle;
            recentFiles.add(handle, 'open');
        }

        return true;
    });

    events.function('doc.open', async () => {
        if (!events.invoke('scene.empty') && !await getResetConfirmation()) {
            return false;
        }

        if (fileSelector) {
            fileSelector.show(async (file?: File) => {
                if (file) {
                    if (await loadDocument(file)) {
                        events.fire('doc.setName', file.name);
                        loadedFromRecovery = false;
                    }
                }
            });
        } else {
            try {
                const fileHandles = await window.showOpenFilePicker({
                    id: 'SuperSplatDocumentOpen',
                    multiple: false,
                    types: SuperFileType
                });

                    if (fileHandles?.length === 1) {
                    const fileHandle = fileHandles[0];

                    if (await loadDocument(await fileHandle.getFile())) {
                        documentFileHandle = fileHandle;
                        events.fire('doc.setName', fileHandle.name);
                        recentFiles.add(fileHandle, 'open');
                        loadedFromRecovery = false;
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(error);
                }
            }
        }
    });

    events.function('doc.openRecent', async (fileHandle: FileSystemFileHandle) => {
        if (!events.invoke('scene.empty') && !await getResetConfirmation()) {
            return false;
        }

        try {
            if (await fileHandle.queryPermission({ mode: 'read' }) !== 'granted') {
                if (await fileHandle.requestPermission({ mode: 'read' }) !== 'granted') {
                    return false;
                }
            }

            if (await loadDocument(await fileHandle.getFile())) {
                documentFileHandle = fileHandle;
                events.fire('doc.setName', fileHandle.name);
                recentFiles.add(fileHandle, 'openRecent');
                loadedFromRecovery = false;
                return true;
            }
            return false;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error(error);
                try {
                    await recentFiles.remove(fileHandle.name);
                } catch (removeError) {
                    console.warn('[doc] failed to clear invalid recent file handle', removeError);
                }
                await events.invoke('showPopup', {
                    type: 'error',
                    header: i18n.t('popup.error-loading'),
                    message: `${error.message ?? error}`
                });
            }
            return false;
        }
    });

    const logAutoReopen = (message: string) => {
        console.log(`[SCA AUTO REOPEN] ${message}`);
    };

    const tryRecoveryReopen = async (): Promise<boolean> => {
        logAutoReopen('tryingRecovery=true');

        const recovery = await projectRecovery.get();
        if (!recovery) {
            logAutoReopen('recoveryCopy=none');
            return false;
        }

        logAutoReopen(`recoveryCopy=${recovery.name} loadStarted=true`);

        const file = new File([recovery.data], recovery.name, { type: 'application/octet-stream' });
        const ok = await loadDocument(file);
        if (!ok) {
            console.warn('[SCA RECOVERY] corrupt recovery copy removed');
            await projectRecovery.clear();
            logAutoReopen('recoveryCopy=corrupt removed=true');
            return false;
        }

        loadedFromRecovery = true;
        events.fire('doc.setName', recovery.name);

        const sceneSplats = (events.invoke('scene.allSplats') as unknown[]).length;
        logAutoReopen(
            `loadFinished=true sceneSplats=${sceneSplats} docName=${recovery.name} recovery=true`
        );

        return true;
    };

    events.function('doc.tryAutoReopenLast', async () => {
        logAutoReopen('invoked=true');

        if (!events.invoke('scene.empty')) {
            logAutoReopen('skipped reason=sceneNotEmpty');
            return false;
        }

        if (!fileSystemAccess.openPicker) {
            logAutoReopen('fileSystemAccess=unavailable');
            try {
                return await tryRecoveryReopen();
            } catch (error) {
                console.warn('[doc] recovery reopen skipped:', error);
                logAutoReopen(`skipped reason=error message=${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        }

        try {
            const last = await recentFiles.getLast();
            if (!last) {
                logAutoReopen('recentHandle=none');
                return false;
            }

            const permission = await last.handle.queryPermission({ mode: 'read' });
            logAutoReopen(`recentHandle=${last.name} permission=${permission}`);

            if (permission !== 'granted') {
                events.fire('doc.lastProjectAvailable', {
                    name: last.name,
                    permission
                });
                logAutoReopen(
                    permission === 'prompt' ?
                        'skipped reason=permissionPrompt' :
                        'skipped reason=permissionNotGranted'
                );
                return false;
            }

            logAutoReopen(`handle=${last.name} permission=${permission} loadStarted=true`);

            const reopened = await events.invoke('doc.openRecent', last.handle) as boolean;
            const sceneSplats = (events.invoke('scene.allSplats') as unknown[]).length;
            const currentDocName = events.invoke('doc.name') as string | null;
            const fileHandleRestored = events.invoke('doc.hasFileHandle') as boolean;

            logAutoReopen(
                `loadFinished=true sceneSplats=${sceneSplats} docName=${currentDocName ?? ''} fileHandleRestored=${fileHandleRestored}`
            );

            return reopened;
        } catch (error) {
            console.warn('[doc] auto reopen skipped:', error);
            logAutoReopen(`skipped reason=error message=${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    });

    events.function('doc.getLastProject', async () => {
        try {
            return await recentFiles.getLast();
        } catch (error) {
            console.warn('[doc] failed to read last project handle:', error);
            return null;
        }
    });

    events.function('doc.reopenLast', async () => {
        try {
            if (fileSystemAccess.openPicker) {
                const last = await recentFiles.getLast();
                if (!last) {
                    return false;
                }

                return events.invoke('doc.openRecent', last.handle) as Promise<boolean>;
            }

            return await tryRecoveryReopen();
        } catch (error) {
            console.warn('[doc] reopen last project failed:', error);
            return false;
        }
    });

    events.function('doc.save', async () => {
        if (documentFileHandle) {
            try {
                if (typeof documentFileHandle.requestPermission === 'function') {
                    const permission = await documentFileHandle.requestPermission({ mode: 'readwrite' });
                    if (permission !== 'granted') {
                        await events.invoke('showPopup', {
                            type: 'error',
                            header: i18n.t('doc.save-failed'),
                            message: 'Write permission was not granted for this file.'
                        });
                        return;
                    }
                }

                await saveDocument({
                    stream: await documentFileHandle.createWritable(),
                    filename: documentFileHandle.name
                });
                events.fire('doc.saved');
                loadedFromRecovery = false;
            } catch (error) {
                if (error.name === 'AbortError') {
                    return;
                }

                console.error(error);
                await events.invoke('showPopup', {
                    type: 'error',
                    header: i18n.t('doc.save-failed'),
                    message: `${error.message ?? error}`
                });
            }
        } else {
            await events.invoke('doc.saveAs');
        }
    });

    events.function('doc.saveAs', async () => {
        if (fileSystemAccess.savePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    id: 'SuperSplatDocumentSave',
                    types: SuperFileType,
                    suggestedName: docName ?? 'scene.ssproj'
                });
                await saveDocument({ stream: await handle.createWritable(), filename: handle.name });
                documentFileHandle = handle;
                events.fire('doc.setName', handle.name);
                events.fire('doc.saved');
                loadedFromRecovery = false;
                recentFiles.add(handle, 'saveAs');
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error(error);
                }
            }
        } else {
            const filename = docName ?? 'scene.ssproj';
            await saveDocument({ filename });
            events.fire('doc.setName', filename);
            events.fire('doc.saved');
            loadedFromRecovery = false;
            console.log('[SCA RECENT FILE] stored handle=none reason=downloadFallback (auto-reopen unavailable)');
        }
    });

    events.function('doc.hasFileHandle', () => {
        return documentFileHandle !== null;
    });

    events.function('doc.canSave', () => {
        if (events.invoke('scene.empty')) {
            return false;
        }

        const hasName = !!events.invoke('doc.name');
        const dirty = events.invoke('scene.dirty');
        const hasHandle = events.invoke('doc.hasFileHandle');

        return hasName || dirty || !hasHandle;
    });
};

export { registerDocEvents };
