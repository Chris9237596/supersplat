/**
 * SPIKE ONLY — Option A: dedicated splat.index Gaussian pick pass.
 * Do not import from production export path until spike comparison is complete.
 */

const replaceOnce = (source: string, search: string, replacement: string, label: string): string => {
    if (!source.includes(search)) {
        throw new Error(`[spike] splat.index pick patch failed: missing anchor "${label}"`);
    }
    return source.replace(search, replacement);
};

/** Revert production vPickId+1 global overrides before adding splat.index branch. */
const stripVPickIdGlobalOverrides = (source: string): string => {
    return source
        .replace(/encodePickOutput\(vPickId \+ 1u\)/g, 'encodePickOutput(vPickId)')
        .replace(/encodePickOutput\(vPickId \+ 1u\)/g, 'encodePickOutput(vPickId)');
};

const GLSL_GSPLAT_PS_PICK_ANCHOR = `#ifdef PICK_PASS
\t\t#ifdef GSPLAT_UNIFIED_ID
\t\t\tpcFragColor0 = encodePickOutput(vPickId);`;

const GLSL_GSPLAT_PS_PICK_SPIKE = `#ifdef PICK_PASS
\t\t#ifdef SCA_GAUSSIAN_INDEX_PICK
\t\t\tpcFragColor0 = encodePickOutput(vGaussianIndex + 1u);
\t\t#elif defined(GSPLAT_UNIFIED_ID)
\t\t\tpcFragColor0 = encodePickOutput(vPickId);`;

const WGSL_GSPLAT_PS_PICK_ANCHOR = `#ifdef PICK_PASS
\t\t#ifdef GSPLAT_UNIFIED_ID
\t\t\toutput.color = encodePickOutput(vPickId);`;

const WGSL_GSPLAT_PS_PICK_SPIKE = `#ifdef PICK_PASS
\t\t#ifdef SCA_GAUSSIAN_INDEX_PICK
\t\t\toutput.color = encodePickOutput(vGaussianIndex + 1u);
\t\t#elif defined(GSPLAT_UNIFIED_ID)
\t\t\toutput.color = encodePickOutput(vPickId);`;

const GLSL_GSPLAT_VS_VARYING_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tflat varying uint vPickId;
#endif`;

const GLSL_GSPLAT_VS_VARYING_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\tflat varying uint vGaussianIndex;
#endif
#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tflat varying uint vPickId;
#endif`;

const GLSL_GSPLAT_VS_ASSIGN_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\tvPickId = loadPcId().r;
\t#endif`;

const GLSL_GSPLAT_VS_ASSIGN_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\t\tvGaussianIndex = splat.index;
\t#endif
\t#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\tvPickId = loadPcId().r;
\t#endif`;

const WGSL_GSPLAT_VS_VARYING_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tvarying @interpolate(flat) vPickId: u32;
#endif`;

const WGSL_GSPLAT_VS_VARYING_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\tvarying @interpolate(flat) vGaussianIndex: u32;
#endif
#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tvarying @interpolate(flat) vPickId: u32;
#endif`;

const WGSL_GSPLAT_VS_ASSIGN_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = loadPcId().r;
\t#endif`;

const WGSL_GSPLAT_VS_ASSIGN_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\t\toutput.vGaussianIndex = splat.index;
\t#endif
\t#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = loadPcId().r;
\t#endif`;

const injectSplatIndexShaderBranches = (source: string): string => {
    let out = source;
    const pairs: Array<[string, string, string]> = [
        [GLSL_GSPLAT_PS_PICK_ANCHOR, GLSL_GSPLAT_PS_PICK_SPIKE, 'GLSL gsplatPS pick branch'],
        [WGSL_GSPLAT_PS_PICK_ANCHOR, WGSL_GSPLAT_PS_PICK_SPIKE, 'WGSL gsplatPS pick branch'],
        [GLSL_GSPLAT_VS_VARYING_ANCHOR, GLSL_GSPLAT_VS_VARYING_SPIKE, 'GLSL gsplatVS varying'],
        [GLSL_GSPLAT_VS_ASSIGN_ANCHOR, GLSL_GSPLAT_VS_ASSIGN_SPIKE, 'GLSL gsplatVS assign'],
        [WGSL_GSPLAT_VS_VARYING_ANCHOR, WGSL_GSPLAT_VS_VARYING_SPIKE, 'WGSL gsplatVS varying'],
        [WGSL_GSPLAT_VS_ASSIGN_ANCHOR, WGSL_GSPLAT_VS_ASSIGN_SPIKE, 'WGSL gsplatVS assign']
    ];
    for (const [anchor, spike, label] of pairs) {
        if (!out.includes(anchor)) {
            throw new Error(`[spike] missing shader anchor: ${label}`);
        }
        out = out.replace(anchor, spike);
    }
    return out;
};

const SPIKE_INDEX_PICK_RUNTIME = `
        const scaConfigureIndexPickMaterial = (pickMI) => {
            const mat = pickMI?.material;
            if (!mat?.setDefine) {
                return;
            }
            mat.setDefine('SCA_GAUSSIAN_INDEX_PICK', true);
            mat.setDefine('GSPLAT_UNIFIED_ID', false);
            mat.setDefine('PICK_CUSTOM_ID', false);
            mat.update();
        };
        const scaWaitForIndexPickMI = async (worldLayer, width, height) => {
            const sceneCam = scaGetSceneCamera();
            const director = app.renderer.gsplatDirector;
            if (!director) {
                return null;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            for (let attempt = 0; attempt < 40; attempt++) {
                app.renderNextFrame = true;
                await new Promise((resolve) => app.once('frameend', resolve));
                const pickMI = director.prepareForPicking(sceneCam, width, height, worldLayer);
                if (pickMI && pickMI.instancingCount > 0) {
                    scaConfigureIndexPickMaterial(pickMI);
                    return pickMI;
                }
            }
            const pickMI = director.prepareForPicking(sceneCam, width, height, worldLayer);
            scaConfigureIndexPickMaterial(pickMI);
            return pickMI;
        };`;

const replaceIndexPickRuntime = (source: string): string => {
    let out = source;
    out = out.replace(
        `        const scaWaitForUnifiedGsplatPick = async (worldLayer, width, height) => {
            const sceneCam = scaGetSceneCamera();
            const director = app.renderer.gsplatDirector;
            if (!director) {
                return null;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            if (!app.scene.gsplat.enableIds) {
                app.scene.gsplat.enableIds = true;
                scaIdPickIdsEnabled = true;
            }
            for (let attempt = 0; attempt < 40; attempt++) {
                app.renderNextFrame = true;
                await new Promise((resolve) => app.once('frameend', resolve));
                const pickMI = director.prepareForPicking(sceneCam, width, height, worldLayer);
                if (pickMI && pickMI.instancingCount > 0) {
                    return pickMI;
                }
            }
            return director.prepareForPicking(sceneCam, width, height, worldLayer);
        };`,
        SPIKE_INDEX_PICK_RUNTIME.trim()
    );
    out = out.replace(
        `            if (!app.scene.gsplat.enableIds) {
                app.scene.gsplat.enableIds = true;
                scaIdPickIdsEnabled = true;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            const pickMI = await scaWaitForUnifiedGsplatPick(worldLayer, width, height);`,
        `            scaEnsureCameraOnWorldLayer(worldLayer);
            const pickMI = await scaWaitForIndexPickMI(worldLayer, width, height);`
    );
    out = out.replace(
        'pickPassVariant: !!pickMaterial?.getDefine?.(\'GSPLAT_UNIFIED_ID\'),',
        'pickPassVariant: !!pickMaterial?.getDefine?.(\'SCA_GAUSSIAN_INDEX_PICK\'),'
    );
    return out;
};

const markSpikeBundle = (source: string): string => {
    if (source.includes('SCA_SPIKE_SPLAT_INDEX_PICK')) {
        return source;
    }
    return source.replace(
        'SCA_PICK_GAUSSIAN',
        'SCA_SPIKE_SPLAT_INDEX_PICK SCA_PICK_GAUSSIAN'
    );
};

/**
 * Apply Option A spike on top of an already SCA-patched viewer bundle string.
 */
const applySpikeSplatIndexPickPatch = (patchedViewerBundle: string): string => {
    let out = patchedViewerBundle;
    out = stripVPickIdGlobalOverrides(out);
    out = injectSplatIndexShaderBranches(out);
    out = replaceIndexPickRuntime(out);
    out = markSpikeBundle(out);
    if (!out.includes('SCA_GAUSSIAN_INDEX_PICK')) {
        throw new Error('[spike] splat.index pick patch did not apply');
    }
    if (!out.includes('scaWaitForIndexPickMI')) {
        throw new Error('[spike] index pick runtime hook missing');
    }
    return out;
};

export {
    applySpikeSplatIndexPickPatch,
    injectSplatIndexShaderBranches,
    stripVPickIdGlobalOverrides
};
