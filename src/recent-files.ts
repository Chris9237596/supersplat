import { wrapIdbRequest } from './idb';

const DB_NAME = 'supersplat';
const DB_VERSION = 2;
const STORE_NAME = 'recent-files';

interface RecentFile {
    handle: FileSystemFileHandle;
    name: string;
    date: number;
}

// wrap IDBRequest in a promise
const wrap = wrapIdbRequest;

class RecentFiles {
    db: Promise<IDBDatabase>;

    constructor() {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // NOTE: for now we store by filename even though files in
                // loaded from different directories could have the same name.
                // We do this because we can't distinguish files from different
                // directories anyway due to File System Access API limitations.
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains('project-recovery')) {
                db.createObjectStore('project-recovery', { keyPath: 'id' });
            }
        };
        this.db = wrap(request);
    }

    async add(handle: FileSystemFileHandle, reason?: string) {
        const db = await this.db;

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({
            handle: handle,
            name: handle.name,
            date: Date.now()
        });

        await wrap(request);

        if (reason) {
            console.log(`[SCA RECENT FILE] stored handle=${handle.name} reason=${reason}`);
        }
    }

    async get(): Promise<RecentFile[]> {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const result = await wrap(store.getAll()) as RecentFile[];

        // Sort by date descending
        result.sort((a, b) => b.date - a.date);
        return result;
    }

    async getLast(): Promise<RecentFile | null> {
        const files = await this.get();
        return files.length > 0 ? files[0] : null;
    }

    async remove(name: string) {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await wrap(store.delete(name));
    }

    async clear() {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await wrap(store.clear());
    }

    async count(): Promise<number> {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        return wrap(store.count());
    }
}

const recentFiles = new RecentFiles();

export { recentFiles };
