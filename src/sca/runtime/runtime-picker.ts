import { RuntimeCentersPicker } from './runtime-centers-picker';
import {
    RuntimePickDetailedResult,
    RuntimePickHost,
    RuntimePickerAdapter
} from './runtime-picker-types';
import { RuntimeWebGpuPicker } from './runtime-webgpu-picker';

type DebugCompareState = {
    debugComparePickers?: boolean;
};

const isDebugCompareEnabled = (): boolean => {
    const sca = (window as DebugCompareState & { SCA3D?: DebugCompareState }).SCA3D;
    return !!sca?.debugComparePickers;
};

class RuntimePickerWithDebugCompare implements RuntimePickerAdapter {
    readonly backendId;

    constructor(
        private readonly primary: RuntimePickerAdapter,
        private readonly centers: RuntimeCentersPicker
    ) {
        this.backendId = primary.backendId;
    }

    isAvailable(): boolean {
        return this.primary.isAvailable();
    }

    pick(nx: number, ny: number): Promise<number | null> {
        return this.pickDetailed(nx, ny).then((result) => result?.gaussianIndex ?? null);
    }

    async pickDetailed(nx: number, ny: number): Promise<RuntimePickDetailedResult | null> {
        const result = await this.primary.pickDetailed(nx, ny);
        if (!isDebugCompareEnabled()) {
            return result;
        }

        const centersResult = await this.centers.pickDetailed(nx, ny);
        const webgpuIndex = result?.gaussianIndex ?? null;
        const centersIndex = centersResult?.gaussianIndex ?? null;
        if (webgpuIndex !== centersIndex) {
            console.warn('[SCA PICK] debug compare mismatch', {
                webgpuIndex,
                centersIndex,
                nx,
                ny
            });
        } else {
            console.log('[SCA PICK] debug compare match', { gaussianIndex: webgpuIndex, nx, ny });
        }

        return result;
    }

    dumpPickTarget?(): Promise<Record<string, unknown>> {
        return this.primary.dumpPickTarget?.() ?? Promise.resolve({ error: 'picker unavailable' });
    }
}

const attachSyncPick = (
    adapter: RuntimePickerAdapter,
    centersPicker: RuntimeCentersPicker
): RuntimePickerAdapter => {
    if (typeof adapter.pickSyncDetailed === 'function') {
        return adapter;
    }
    return Object.assign(adapter, {
        pickSyncDetailed: (nx: number, ny: number) => centersPicker.pickSyncDetailed(nx, ny)
    });
};

const installRuntimePicker = (host: RuntimePickHost): RuntimePickerAdapter => {
    const centersPicker = new RuntimeCentersPicker(host);
    const webgpuPicker = new RuntimeWebGpuPicker(host);

    if (webgpuPicker.isAvailable()) {
        console.log('[SCA PICK] backend=webgpu');
        if (centersPicker.isAvailable() && isDebugCompareEnabled()) {
            return attachSyncPick(new RuntimePickerWithDebugCompare(webgpuPicker, centersPicker), centersPicker);
        }
        return attachSyncPick(webgpuPicker, centersPicker);
    }

    console.log('[SCA PICK] backend=centers');
    return centersPicker;
};

export {
    installRuntimePicker,
    RuntimePickerWithDebugCompare
};
