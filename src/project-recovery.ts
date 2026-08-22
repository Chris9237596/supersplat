import { wrapIdbRequest } from './idb';

const DB_NAME = 'supersplat';
const DB_VERSION = 2;
const STORE_NAME = 'project-recovery';
const RECOVERY_KEY = 'latest';

type RecoveryRecord = {
    id: string;
    name: string;
    data: ArrayBuffer;
    updatedAt: number;
};

type RecoveryEntry = {
    name: string;
    data: ArrayBuffer;
    updatedAt: number;
};

class ProjectRecovery {
    private db: Promise<IDBDatabase>;

    constructor() {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('recent-files')) {
                db.createObjectStore('recent-files', { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        this.db = wrapIdbRequest(request);
    }

    async save(name: string, data: ArrayBuffer): Promise<void> {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const record: RecoveryRecord = {
            id: RECOVERY_KEY,
            name,
            data,
            updatedAt: Date.now()
        };
        await wrapIdbRequest(store.put(record));
        console.log(`[SCA RECOVERY] stored name=${name} bytes=${data.byteLength}`);
    }

    async get(): Promise<RecoveryEntry | null> {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const record = await wrapIdbRequest(store.get(RECOVERY_KEY)) as RecoveryRecord | undefined;
        if (!record?.data || !record.name) {
            return null;
        }
        return {
            name: record.name,
            data: record.data,
            updatedAt: record.updatedAt
        };
    }

    async clear(): Promise<void> {
        const db = await this.db;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await wrapIdbRequest(store.delete(RECOVERY_KEY));
    }
}

const projectRecovery = new ProjectRecovery();

export { projectRecovery, ProjectRecovery };
