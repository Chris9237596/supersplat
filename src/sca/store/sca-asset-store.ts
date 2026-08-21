type ScaAssetEntry = {
    path: string;
    data: Uint8Array;
    mimeType: string;
};

class ScaAssetStore {
    private assets = new Map<string, ScaAssetEntry>();

    set(path: string, data: Uint8Array, mimeType: string): void {
        this.assets.set(path, {
            path,
            data: data.slice(),
            mimeType
        });
    }

    get(path: string): ScaAssetEntry | undefined {
        const entry = this.assets.get(path);
        if (!entry) {
            return undefined;
        }

        return {
            path: entry.path,
            data: entry.data.slice(),
            mimeType: entry.mimeType
        };
    }

    delete(path: string): void {
        this.assets.delete(path);
    }

    list(): ScaAssetEntry[] {
        return [...this.assets.values()].map((entry) => ({
            path: entry.path,
            data: entry.data.slice(),
            mimeType: entry.mimeType
        }));
    }

    clear(): void {
        this.assets.clear();
    }

    load(entries: Record<string, { data: Uint8Array; mimeType: string }>): void {
        this.assets.clear();
        for (const [path, entry] of Object.entries(entries)) {
            this.set(path, entry.data, entry.mimeType);
        }
    }
}

const mimeTypeForFilename = (filename: string): string => {
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
    mimeTypeForFilename,
    ScaAssetEntry,
    ScaAssetStore
};
