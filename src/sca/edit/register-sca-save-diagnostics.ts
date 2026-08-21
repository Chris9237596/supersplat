import { Events } from '../../events';

const registerScaSaveDiagnostics = (events: Events): void => {
    const logSaveState = (reason: string) => {
        console.log('[SCA SAVE]', JSON.stringify({
            reason,
            editHistoryCursor: events.invoke('editHistory.cursor'),
            lastExportCursor: events.invoke('editHistory.lastSavedCursor'),
            sceneDirty: events.invoke('scene.dirty'),
            docName: events.invoke('doc.name'),
            docHasFileHandle: events.invoke('doc.hasFileHandle'),
            docCanSave: events.invoke('doc.canSave')
        }));
    };

    events.on('edit.apply', () => {
        logSaveState('edit.apply');
    });

    events.on('doc.saved', () => {
        logSaveState('doc.saved');
    });

    events.on('doc.setName', () => {
        logSaveState('doc.setName');
    });
};

export { registerScaSaveDiagnostics };
