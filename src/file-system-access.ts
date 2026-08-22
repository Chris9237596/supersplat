const fileSystemAccess = {
    openPicker: typeof window.showOpenFilePicker === 'function',
    savePicker: typeof window.showSaveFilePicker === 'function'
};

let loggedFileAccess = false;

const logFileSystemAccessOnce = (): void => {
    if (loggedFileAccess) {
        return;
    }
    loggedFileAccess = true;
    console.log(
        `[SCA FILE ACCESS] openPicker=${fileSystemAccess.openPicker} savePicker=${fileSystemAccess.savePicker} secureContext=${window.isSecureContext}`
    );
};

export { fileSystemAccess, logFileSystemAccessOnce };
