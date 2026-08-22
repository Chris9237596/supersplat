import { installRuntimePicker } from './runtime-picker';
import { installRuntimeWebGpuPicker } from './runtime-webgpu-picker';
import type { RuntimePickHost } from './runtime-picker-types';

const scaGlobal = window as typeof window & {
    SCA3D?: {
        installRuntimePicker?: (host: RuntimePickHost) => ReturnType<typeof installRuntimePicker>;
        installRuntimeWebGpuPicker?: (host: RuntimePickHost) => ReturnType<typeof installRuntimeWebGpuPicker>;
        runtimePicker?: ReturnType<typeof installRuntimePicker>;
        debugComparePickers?: boolean;
        state?: Record<string, unknown>;
    };
};

scaGlobal.SCA3D = scaGlobal.SCA3D || {};
scaGlobal.SCA3D.installRuntimePicker = installRuntimePicker;
scaGlobal.SCA3D.installRuntimeWebGpuPicker = installRuntimeWebGpuPicker;

export {
    installRuntimePicker,
    installRuntimeWebGpuPicker
};
