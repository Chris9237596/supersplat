/**
 * @deprecated Experimental Gaussian-index pick spike. Not used in production exports.
 * Production uses RuntimeWebGpuPickerAdapter or RuntimeCentersPickerAdapter via sca-picker.js.
 * Applied at export time only when `useGaussianPickSpike` is explicitly enabled in Debug/Advanced UI.
 */

/** PlayCanvas WebgpuShaderProcessorWGSL VARYING name extractor (see engine bundle). */
const WGSL_VARYING_NAME = /(?:@interpolate\([^)]*\)\s*)?([\w]+)\s*:\s*([\w<>]+)/;

const SPIKE_GLSL_VARYING = 'flat varying uint vScaSpikeGaussianIndex';
const SPIKE_WGSL_VARYING = 'varying @interpolate(flat) vScaSpikeGaussianIndex: u32';

const replaceAll = (source: string, search: string, replacement: string, label: string): string => {
    if (!source.includes(search)) {
        throw new Error(`[SCA] gaussian-index-spike patch failed: missing anchor "${label}"`);
    }
    return source.split(search).join(replacement);
};

/** Revert production vPickId+1 global overrides before adding splat.index branch. */
const stripVPickIdGlobalOverrides = (source: string): string => {
    return source
        .replace(/encodePickOutput\(vPickId \+ 1u\)/g, 'encodePickOutput(vPickId)');
};

const GLSL_GSPLAT_PS_PICK_ANCHOR = `#ifdef PICK_PASS
\t\t#ifdef GSPLAT_UNIFIED_ID
\t\t\tpcFragColor0 = encodePickOutput(vPickId);`;

const GLSL_GSPLAT_PS_PICK_SPIKE = `#ifdef PICK_PASS
\t\t#ifdef SCA_SPIKE_PICK_CONSTANT_ID
\t\t\tpcFragColor0 = encodePickOutput(1u);
\t\t#elif defined(SCA_GAUSSIAN_INDEX_PICK)
\t\t\tpcFragColor0 = encodePickOutput(vScaSpikeGaussianIndex + 1u);
\t\t#elif defined(GSPLAT_UNIFIED_ID)
\t\t\tpcFragColor0 = encodePickOutput(vPickId);`;

const WGSL_GSPLAT_PS_PICK_ANCHOR = `#ifdef PICK_PASS
\t\t#ifdef GSPLAT_UNIFIED_ID
\t\t\toutput.color = encodePickOutput(vPickId);`;

const WGSL_GSPLAT_PS_PICK_SPIKE = `#ifdef PICK_PASS
\t\t#ifdef SCA_SPIKE_PICK_CONSTANT_ID
\t\t\toutput.color = encodePickOutput(1u);
\t\t#elif defined(SCA_GAUSSIAN_INDEX_PICK)
\t\t\toutput.color = encodePickOutput(vScaSpikeGaussianIndex + 1u);
\t\t#elif defined(GSPLAT_UNIFIED_ID)
\t\t\toutput.color = encodePickOutput(vPickId);`;

const GLSL_GSPLAT_VS_VARYING_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tflat varying uint vPickId;
#endif`;

const GLSL_GSPLAT_VS_VARYING_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\tflat varying uint vScaSpikeGaussianIndex;
#endif
#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tflat varying uint vPickId;
#endif`;

const GLSL_GSPLAT_VS_ASSIGN_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\tvPickId = loadPcId().r;
\t#endif`;

const GLSL_GSPLAT_VS_ASSIGN_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\t\tvScaSpikeGaussianIndex = splat.index;
\t#endif
\t#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\tvPickId = loadPcId().r;
\t#endif`;

const WGSL_GSPLAT_VS_VARYING_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tvarying @interpolate(flat) vPickId: u32;
#endif`;

const WGSL_GSPLAT_VS_VARYING_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\tvarying @interpolate(flat) vScaSpikeGaussianIndex: u32;
#endif
#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\tvarying @interpolate(flat) vPickId: u32;
#endif`;

const WGSL_GSPLAT_VS_ASSIGN_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = loadPcId().r;
\t#endif`;

const WGSL_GSPLAT_VS_ASSIGN_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\t\toutput.vScaSpikeGaussianIndex = splat.index;
\t#endif
\t#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = loadPcId().r;
\t#endif`;

const WGSL_GSPLAT_HYBRID_VS_ASSIGN_ANCHOR = `#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = pickId;
\t#endif`;

const WGSL_GSPLAT_HYBRID_VS_ASSIGN_SPIKE = `#if defined(SCA_GAUSSIAN_INDEX_PICK) && defined(PICK_PASS)
\t\toutput.vScaSpikeGaussianIndex = cacheIdx;
\t#endif
\t#if defined(GSPLAT_UNIFIED_ID) && defined(PICK_PASS)
\t\toutput.vPickId = pickId;
\t#endif`;

/**
 * Mirror WebgpuShaderProcessorWGSL.extract() varying collection for a shader chunk.
 * Location index = position in this list (see processVaryings in engine bundle).
 */
const extractWgslVaryingNames = (shaderChunk: string): string[] => {
    const names: string[] = [];
    const keyword = /^[ \t]*(attribute|varying|uniform)[\t ]+/gm;
    const keywordLine = /^[ \t]*(attribute|varying|uniform)[ \t]*([^;]+)(;+)/gm;
    let match: RegExpExecArray | null;
    while ((match = keyword.exec(shaderChunk)) !== null) {
        keywordLine.lastIndex = match.index;
        const lineMatch = keywordLine.exec(shaderChunk);
        if (!lineMatch || lineMatch[1] !== 'varying') {
            continue;
        }
        const varyingMatch = lineMatch[2].match(WGSL_VARYING_NAME);
        if (varyingMatch) {
            names.push(varyingMatch[1]);
        }
    }
    return names;
};

/** Primary gsplat pick vertex chunk — same allocation order PlayCanvas uses at compile time. */
const computeSpikeGaussianVaryingLocation = (source: string): number => {
    const chunkMatch = source.match(/var gsplat_default = `([\s\S]*?)`;/);
    if (!chunkMatch) {
        throw new Error('[SCA] gaussian-index-spike: missing gsplat_default WGSL vertex chunk');
    }
    const chunk = chunkMatch[1];
    if (!chunk.includes('@vertex')) {
        throw new Error('[SCA] gaussian-index-spike: gsplat_default is not a vertex chunk');
    }
    if (!chunk.includes(SPIKE_WGSL_VARYING)) {
        throw new Error('[SCA] gaussian-index-spike: gsplat_default vertex missing vScaSpikeGaussianIndex varying');
    }
    const names = extractWgslVaryingNames(chunk);
    const location = names.indexOf('vScaSpikeGaussianIndex');
    if (location < 0) {
        throw new Error('[SCA] gaussian-index-spike: vScaSpikeGaussianIndex not found in WGSL varying list');
    }
    return location;
};

const assertSpikeNoRegionSymbolCollision = (source: string): void => {
    if (!source.includes(SPIKE_GLSL_VARYING) && !source.includes(SPIKE_WGSL_VARYING)) {
        throw new Error('[SCA] gaussian-index-spike patch missing spike varying declaration');
    }
    if (source.includes('vGaussianIndex')) {
        throw new Error('[SCA] gaussian-index-spike: legacy vGaussianIndex symbol must be renamed to vScaSpikeGaussianIndex');
    }
    if (source.includes('scaSpikeGaussianIndex') || source.includes('flat varying float scaSpikeGaussianIndex')) {
        throw new Error('[SCA] gaussian-index-spike: do not reuse sca-prefixed float varyings reserved for region highlight');
    }
    const vsChunk = source.match(/var gsplat_default\$2 = `([\s\S]*?)`;/);
    if (vsChunk) {
        const regionDeclCount = (vsChunk[1].match(/flat varying float scaGaussianIndex/g) || []).length;
        if (regionDeclCount > 1) {
            throw new Error('[SCA] gaussian-index-spike: duplicate flat varying float scaGaussianIndex in GLSL VS (region highlight collision)');
        }
    }
    const psChunk = source.match(/var gsplat_default\$3 = `([\s\S]*?)`;/);
    if (psChunk) {
        const regionDeclCount = (psChunk[1].match(/flat varying float scaGaussianIndex/g) || []).length;
        if (regionDeclCount > 1) {
            throw new Error('[SCA] gaussian-index-spike: duplicate flat varying float scaGaussianIndex in GLSL PS (region highlight collision)');
        }
    }
};

const assertSpikeWgslVaryingParity = (source: string): void => {
    const fragmentUsesGaussian = source.includes('encodePickOutput(vScaSpikeGaussianIndex + 1u)');
    if (!fragmentUsesGaussian) {
        throw new Error('[SCA] gaussian-index-spike: fragment pick branch missing vScaSpikeGaussianIndex');
    }

    const vertexChunkPatterns = [
        /var gsplat_default = `([\s\S]*?)`;/,
        /var gsplatHybrid_default = `([\s\S]*?)`;/
    ];
    for (const pattern of vertexChunkPatterns) {
        const match = source.match(pattern);
        if (!match || !match[1].includes('@vertex')) {
            continue;
        }
        const chunk = match[1];
        const assignsGaussian = chunk.includes('output.vScaSpikeGaussianIndex') ||
            chunk.includes('vScaSpikeGaussianIndex =');
        if (!assignsGaussian) {
            continue;
        }
        if (!chunk.includes(SPIKE_WGSL_VARYING)) {
            throw new Error('[SCA] gaussian-index-spike: WGSL vertex chunk assigns vScaSpikeGaussianIndex without matching varying declaration');
        }
    }

    const declCount = source.split(SPIKE_WGSL_VARYING).length - 1;
    const wgslPickIdDeclCount = source.split('varying @interpolate(flat) vPickId: u32').length - 1;
    if (declCount < wgslPickIdDeclCount) {
        throw new Error('[SCA] gaussian-index-spike: vScaSpikeGaussianIndex WGSL declarations fewer than vPickId sites — location allocation will fail');
    }
};

const assertNoUndefinedWgslLocations = (source: string): void => {
    if (source.includes('@location(undefined)')) {
        throw new Error('[SCA] gaussian-index-spike: bundle contains forbidden @location(undefined)');
    }
};

const injectSplatIndexShaderBranches = (source: string): string => {
    let out = source;
    const pairs: Array<[string, string, string]> = [
        [GLSL_GSPLAT_PS_PICK_ANCHOR, GLSL_GSPLAT_PS_PICK_SPIKE, 'GLSL gsplatPS pick branch'],
        [WGSL_GSPLAT_PS_PICK_ANCHOR, WGSL_GSPLAT_PS_PICK_SPIKE, 'WGSL gsplatPS pick branch'],
        [GLSL_GSPLAT_VS_VARYING_ANCHOR, GLSL_GSPLAT_VS_VARYING_SPIKE, 'GLSL gsplat varying'],
        [GLSL_GSPLAT_VS_ASSIGN_ANCHOR, GLSL_GSPLAT_VS_ASSIGN_SPIKE, 'GLSL gsplatVS assign'],
        [WGSL_GSPLAT_VS_VARYING_ANCHOR, WGSL_GSPLAT_VS_VARYING_SPIKE, 'WGSL gsplat varying'],
        [WGSL_GSPLAT_VS_ASSIGN_ANCHOR, WGSL_GSPLAT_VS_ASSIGN_SPIKE, 'WGSL gsplat VS assign'],
        [WGSL_GSPLAT_HYBRID_VS_ASSIGN_ANCHOR, WGSL_GSPLAT_HYBRID_VS_ASSIGN_SPIKE, 'WGSL gsplatHybrid VS assign']
    ];
    for (const [anchor, spike, label] of pairs) {
        out = replaceAll(out, anchor, spike, label);
    }
    return out;
};

const SPIKE_INDEX_PICK_RUNTIME = `
        const scaSpikePickConstantIdEnabled = () => window.SCA3D?.spikePickConstantId !== false;
        const scaLogSpikePickMaterialState = (pickMI, phase) => {
            const mat = pickMI?.material;
            if (!mat?.getDefine) {
                return;
            }
            console.log('[SCA SPIKE PICK MAT]', phase, {
                spikePickConstantId: scaSpikePickConstantIdEnabled(),
                SCA_SPIKE_PICK_CONSTANT_ID: !!mat.getDefine('SCA_SPIKE_PICK_CONSTANT_ID'),
                SCA_GAUSSIAN_INDEX_PICK: !!mat.getDefine('SCA_GAUSSIAN_INDEX_PICK'),
                GSPLAT_UNIFIED_ID: !!mat.getDefine('GSPLAT_UNIFIED_ID'),
                PICK_CUSTOM_ID: !!mat.getDefine('PICK_CUSTOM_ID'),
                depthTest: mat.depthTest,
                depthWrite: mat.depthWrite,
                blendType: mat.blendType,
                definesKey: mat.definesKey ?? null
            });
        };
        const scaConfigureIndexPickMaterial = (pickMI) => {
            const mat = pickMI?.material;
            if (!mat?.setDefine) {
                return;
            }
            mat.setDefine('SCA_GAUSSIAN_INDEX_PICK', true);
            mat.setDefine('GSPLAT_UNIFIED_ID', false);
            mat.setDefine('PICK_CUSTOM_ID', false);
            if (scaSpikePickConstantIdEnabled()) {
                mat.setDefine('SCA_SPIKE_PICK_CONSTANT_ID', true);
            } else {
                mat.setDefine('SCA_SPIKE_PICK_CONSTANT_ID', false);
            }
            mat.depthTest = false;
            mat.depthWrite = false;
            mat.update();
            scaLogSpikePickMaterialState(pickMI, 'configure');
        };
        const scaSpikeReconfigurePickPassMaterials = (pass) => {
            pass?._pickMeshInstances?.forEach((pickMI) => {
                scaConfigureIndexPickMaterial(pickMI);
            });
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
        `                scaIdPickPass.update(scaGetCameraComponent(), app.scene, [worldLayer], new Map(), false);
                scaIdPickPass.render();`,
        `                scaIdPickPass.update(scaGetCameraComponent(), app.scene, [worldLayer], new Map(), false);
                scaConfigureIndexPickMaterial(pickMI);
                scaIdPickPass.render();`
    );
    out = out.replace(
        'pickPassVariant: !!pickMaterial?.getDefine?.(\'GSPLAT_UNIFIED_ID\'),',
        `pickPassVariant: !!pickMaterial?.getDefine?.('SCA_GAUSSIAN_INDEX_PICK'),
                pickSpikeConstantId: !!pickMaterial?.getDefine?.('SCA_SPIKE_PICK_CONSTANT_ID'),
                pickDepthTest: pickMaterial?.depthTest,
                pickDepthWrite: pickMaterial?.depthWrite`
    );
    out = out.replace(
        `                origBefore();
                scaLastPickExec.qualifiedLayers = this._qualifiedLayerIndices?.length ?? 0;`,
        `                origBefore();
                scaSpikeReconfigurePickPassMaterials(this);
                scaLastPickExec.qualifiedLayers = this._qualifiedLayerIndices?.length ?? 0;`
    );
    out = out.replace(
        `            if (!app.scene.gsplat.enableIds) {
                app.scene.gsplat.enableIds = true;
                scaIdPickIdsEnabled = true;
            }
            scaEnsureCameraOnWorldLayer(worldLayer);
            const pickMI = await scaWaitForIndexPickMI(worldLayer, width, height);`,
        `            scaEnsureCameraOnWorldLayer(worldLayer);
            const pickMI = await scaWaitForIndexPickMI(worldLayer, width, height);`
    );
    out = out.replace(
        `                \`instancingCount=\${instancingCount}\`,
                \`nonZeroPixels=\${nonZeroPixels}\`,`,
        `                \`instancingCount=\${instancingCount}\`,
                \`pickSpikeConstantId=\${!!diag?.pickSpikeConstantId}\`,
                \`pickPassVariant=\${!!diag?.pickPassVariant}\`,
                \`pickUnifiedIdDefine=\${!!diag?.pickUnifiedIdDefine}\`,
                \`pickDepthTest=\${diag?.pickDepthTest}\`,
                \`nonZeroPixels=\${nonZeroPixels}\`,`
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

const injectSpikeRuntimeBanner = (source: string, gaussianVaryingLocation: number): string => {
    const anchor = "events.fire('scaPickerReady'); // SCA_PICK_GAUSSIAN";
    const replacement = `console.log('[SCA SPIKE] Gaussian index picker active');
            console.log('[SCA SPIKE] gaussian varying location:', ${gaussianVaryingLocation});
            window.SCA3D = window.SCA3D || {};
            window.SCA3D.pickerMode = 'gaussian-index-spike';
            window.SCA3D.spikePickConstantId = window.SCA3D.spikePickConstantId !== false;
            window.SCA3D.gaussianVaryingLocation = ${gaussianVaryingLocation};
            console.log('[SCA SPIKE] spikePickConstantId isolation test:', window.SCA3D.spikePickConstantId, '(set false to test vScaSpikeGaussianIndex path)');
            events.fire('scaPickerReady'); // SCA_PICK_GAUSSIAN`;
    if (!source.includes(anchor)) {
        throw new Error('[SCA] gaussian-index-spike patch failed: missing scaPickerReady anchor');
    }
    return source.replace(anchor, replacement);
};

/**
 * Apply Option A spike on top of an already SCA-patched viewer bundle string.
 */
const applySpikeSplatIndexPickPatch = (patchedViewerBundle: string): string => {
    let out = patchedViewerBundle;
    out = stripVPickIdGlobalOverrides(out);
    out = injectSplatIndexShaderBranches(out);
    assertSpikeNoRegionSymbolCollision(out);
    assertSpikeWgslVaryingParity(out);
    assertNoUndefinedWgslLocations(out);
    const gaussianVaryingLocation = computeSpikeGaussianVaryingLocation(out);
    console.log(`[SCA SPIKE] gaussian varying location: ${gaussianVaryingLocation}`);
    out = replaceIndexPickRuntime(out);
    out = injectSpikeRuntimeBanner(out, gaussianVaryingLocation);
    out = markSpikeBundle(out);
    if (!out.includes('SCA_GAUSSIAN_INDEX_PICK')) {
        throw new Error('[SCA] gaussian-index-spike patch did not apply shader branches');
    }
    if (!out.includes('vScaSpikeGaussianIndex')) {
        throw new Error('[SCA] gaussian-index-spike patch missing vScaSpikeGaussianIndex symbol');
    }
    if (!out.includes('SCA_SPIKE_PICK_CONSTANT_ID')) {
        throw new Error('[SCA] gaussian-index-spike patch did not apply constant-id isolation branch');
    }
    if (!out.includes('scaWaitForIndexPickMI')) {
        throw new Error('[SCA] gaussian-index-spike patch missing runtime hook');
    }
    if (!out.includes('[SCA SPIKE] Gaussian index picker active')) {
        throw new Error('[SCA] gaussian-index-spike patch missing runtime banner');
    }
    if (!out.includes('[SCA SPIKE] gaussian varying location:')) {
        throw new Error('[SCA] gaussian-index-spike patch missing varying location diagnostic');
    }
    assertSpikeNoRegionSymbolCollision(out);
    assertNoUndefinedWgslLocations(out);
    return out;
};

export {
    applySpikeSplatIndexPickPatch,
    assertNoUndefinedWgslLocations,
    assertSpikeNoRegionSymbolCollision,
    assertSpikeWgslVaryingParity,
    computeSpikeGaussianVaryingLocation,
    extractWgslVaryingNames,
    injectSplatIndexShaderBranches,
    stripVPickIdGlobalOverrides
};
