/**
 * Minimal viewer seam: binds PlayCanvas classes from the bundled viewer module scope
 * to the modular runtime picker loaded from static/sca/sca-picker.js.
 *
 * PlayCanvas Application/Texture/RenderPassPicker instances must come from the same
 * bundled engine instance as the viewer — they cannot be imported separately.
 */
const SCA_VIEWER_PICK_SEAM = `const scaGetSceneCamera = () => camera.camera.camera;
        const scaGetCameraComponent = () => camera.camera;
        const scaInstallRuntimePicker = () => {
            const install = window.SCA3D?.installRuntimePicker;
            if (typeof install !== 'function') {
                console.warn('[SCA PICK] sca-picker.js not loaded; runtime Gaussian pick unavailable');
                return;
            }
            window.SCA3D.runtimePicker = install({
                app,
                graphicsDevice,
                getSceneCamera: scaGetSceneCamera,
                getCameraComponent: scaGetCameraComponent,
                cameraMatches,
                depthPickerPatches: {
                    isActive: () => !!pickerShaderPatchState.get(graphicsDevice),
                    register: () => registerPickerShaderPatches(app),
                    unregister: () => unregisterPickerShaderPatches(app)
                },
                pc: {
                    RenderPassPicker,
                    Texture,
                    RenderTarget,
                    Color,
                    BlendState,
                    FILTER_NEAREST,
                    ADDRESS_CLAMP_TO_EDGE,
                    PIXELFORMAT_RGBA8
                }
            });
            window.SCA3D.state = window.SCA3D.state || {};
            window.SCA3D.state.runtimePickerReady = true;
        };
        scaInstallRuntimePicker();
        let scaIdPickQueue = Promise.resolve();
        const serializeIdPick = (op) => {
            const next = scaIdPickQueue.then(() => op());
            scaIdPickQueue = next.catch(() => {});
            return next;
        };
        this.pickGaussianId = (nx, ny) => serializeIdPick(async () => {
            const picker = window.SCA3D?.runtimePicker;
            if (!picker) {
                return null;
            }
            return picker.pickDetailed(nx, ny);
        });
        this.dumpPickTarget = () => window.SCA3D?.runtimePicker?.dumpPickTarget?.() ?? Promise.resolve({ error: 'picker unavailable' });`;

export {
    SCA_VIEWER_PICK_SEAM
};
