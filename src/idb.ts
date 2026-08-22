const wrapIdbRequest = (request: IDBRequest): Promise<any> => {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.error('IndexedDB error', request.error);
            reject(request.error);
        };
    });
};

export { wrapIdbRequest };
