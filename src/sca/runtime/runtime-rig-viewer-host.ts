import {
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_NEAREST,
    GraphicsDevice,
    Mat4,
    PIXELFORMAT_R16U,
    PIXELFORMAT_RGBA32F
} from 'playcanvas';

import { buildEffectiveRigWorldMatrixFromPose } from '../rig/rig-hierarchy';
import {
    findFirstGaussianIndexForRegion,
    registerRuntimeTransformOrderProbe,
    resetRuntimeTransformOrderProbe,
    TARGET_REGION_ID
} from '../rig/rig-transform-order-check';
import { maybeLogRuntimeRigDataParity } from '../rig/rig-data-parity-check';
import { evaluateRuntimeRigPose } from './runtime-rig-pose';
import { RuntimeRigHost, RuntimeRigPaletteBinding } from './runtime-rig-applier';
import { createRuntimeRigSortCentersState, RuntimeRigSortCentersState } from './runtime-rig-sort-centers';
import { ScaProject } from '../types/project';
import { ScaRig, ScaRigBinding, ScaRigNode } from '../types/rig';

const SCA_RIG_TRANSFORM_INDEX_UNIFORM = 'uScaRigTransformIndex';
const SCA_RIG_TRANSFORM_PALETTE_UNIFORM = 'uScaRigTransformPalette';
const SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM = 'scaRigTransformIndexTexWidth';

const RIG_CENTER_UNIFORMS = `
uniform highp usampler2D ${SCA_RIG_TRANSFORM_INDEX_UNIFORM};
uniform highp sampler2D ${SCA_RIG_TRANSFORM_PALETTE_UNIFORM};
uniform float ${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM};

mat4 applyPaletteTransform(mat4 model) {
    uint transformIndex = texelFetch(${SCA_RIG_TRANSFORM_INDEX_UNIFORM}, ivec2(int(splat.index) % int(${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM}), int(splat.index) / int(${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM})), 0).r;
    if (transformIndex == 0u) {
        return model;
    }

    int u = int(transformIndex % 512u) * 3;
    int v = int(transformIndex / 512u);

    mat4 t;
    t[0] = texelFetch(${SCA_RIG_TRANSFORM_PALETTE_UNIFORM}, ivec2(u, v), 0);
    t[1] = texelFetch(${SCA_RIG_TRANSFORM_PALETTE_UNIFORM}, ivec2(u + 1, v), 0);
    t[2] = texelFetch(${SCA_RIG_TRANSFORM_PALETTE_UNIFORM}, ivec2(u + 2, v), 0);
    t[3] = vec4(0.0, 0.0, 0.0, 1.0);

    return model * transpose(t);
}
`;

// SuperSplat Viewer v1.27.1 / engine v2.20.6 default gsplatCenterVS (unified gsplat).
// Unified materials only override format/read chunks; gsplatCenterVS lives in the engine registry.
const RUNTIME_GSPLAT_CENTER_VS_FALLBACK = `
uniform mat4 matrix_model;
uniform mat4 matrix_view;
#ifndef GSPLAT_CENTER_NOPROJ
	uniform vec4 camera_params;
	uniform mat4 matrix_projection;
	#ifdef GSPLAT_FISHEYE
		uniform float fisheye_k;
		uniform float fisheye_inv_k;
		uniform float fisheye_projMat00;
		uniform float fisheye_projMat11;
	#endif
#endif
bool initCenter(vec3 modelCenter, inout SplatCenter center) {
	mat4 modelView = matrix_view * matrix_model;
	vec4 centerView = modelView * vec4(modelCenter, 1.0);
	#ifndef GSPLAT_CENTER_NOPROJ
		#ifdef GSPLAT_FISHEYE
			vec3 v = centerView.xyz;
			float r_xy = length(v.xy);
			float neg_z = -v.z;
			float theta = atan(r_xy, neg_z);
			float maxTheta = min(fisheye_k * 1.5707963, 3.13);
			if (theta > maxTheta - 0.01 || dot(v, v) < 0.0001) {
				return false;
			}
			float tk = theta * fisheye_inv_k;
			float sin_tk = sin(tk);
			float cos_tk = cos(tk);
			float g_theta = fisheye_k * sin_tk / cos_tk;
			float fisheye_s = (r_xy > 1e-4) ? g_theta / r_xy : (neg_z > 0.0 ? 1.0 / neg_z : 0.0);
			vec2 ndc = vec2(fisheye_projMat00 * fisheye_s * v.x, fisheye_projMat11 * fisheye_s * v.y);
			float near = camera_params.z;
			float far = camera_params.y;
			float linearDepth = neg_z;
			#if WEBGPU
				float depthNdc = clamp((linearDepth - near) / (far - near), 0.0, 1.0);
			#else
				float depthNdc = clamp(2.0 * (linearDepth - near) / (far - near) - 1.0, -1.0, 1.0);
			#endif
			center.proj = vec4(ndc, depthNdc, 1.0);
			center.projMat00 = fisheye_projMat00;
			center.fisheyeSinTK = sin_tk;
			center.fisheyeCosTK = cos_tk;
			center.fisheyeRxy = r_xy;
		#else
			if (camera_params.w != 1.0 && centerView.z > 0.0) {
				return false;
			}
			vec4 centerProj = matrix_projection * centerView;
			#if WEBGPU
				centerProj.z = clamp(centerProj.z, 0, abs(centerProj.w));
			#else
				centerProj.z = clamp(centerProj.z, -abs(centerProj.w), abs(centerProj.w));
			#endif
			center.proj = centerProj;
			center.projMat00 = matrix_projection[0][0];
		#endif
	#endif
	center.view = centerView.xyz / centerView.w;
	center.modelView = modelView;
	return true;
}
`;

const GSPLAT_CENTER_MODEL_VIEW_PATTERN = /\bmat4 modelView = matrix_view \* matrix_model;/;

type GsplatCenterPatchResult = {
    chunk: string;
    patchApplied: boolean;
    chunkSource?: 'material' | 'engine-fallback';
};

let runtimeRigShaderDiagLogged = false;
let runtimeRigUniformDiagLogged = false;
let runtimeRigTextureIdentityLogged = false;

type ViewerTextureLike = {
    device?: GraphicsDevice;
    format?: number;
    width?: number;
    height?: number;
    lock: () => unknown;
    unlock: () => void;
    upload: () => void;
    destroy: () => void;
};

type ViewerTextureConstructor = new (
    device: GraphicsDevice,
    options: Record<string, unknown>
) => ViewerTextureLike;

type ViewerTextureSeam = {
    ViewerTexture: ViewerTextureConstructor;
    sample: ViewerTextureLike;
    sampleParameterName: string;
};

const PALETTE_MATRIX_IDX = [
    0, 4, 8, 12,
    1, 5, 9, 13,
    2, 6, 10, 14
];

const PALETTE_TEXTURE_WIDTH = 512 * 3;

const isViewerTextureLike = (value: unknown): value is ViewerTextureLike => {
    return !!value
        && typeof value === 'object'
        && typeof (value as ViewerTextureLike).lock === 'function'
        && typeof (value as ViewerTextureLike).upload === 'function'
        && typeof (value as ViewerTextureLike).destroy === 'function';
};

const resolveViewerTextureSeam = (material: GsplatMaterial): ViewerTextureSeam | null => {
    const preferredNames = [
        'scaRegionHighlight',
        'scaRegionPulse',
        'scaRegionStateOverlay',
        'splatOrder',
        'means_l',
        'means_u',
        'quats',
        'scales',
        'sh0'
    ];

    for (const name of preferredNames) {
        const value = material.getParameter?.(name)?.data;
        if (isViewerTextureLike(value)) {
            return {
                ViewerTexture: value.constructor as ViewerTextureConstructor,
                sample: value,
                sampleParameterName: name
            };
        }
    }

    const parameters = material.getParameters?.() ?? {};
    for (const [name, parameter] of Object.entries(parameters)) {
        const value = parameter?.data;
        if (isViewerTextureLike(value)) {
            return {
                ViewerTexture: value.constructor as ViewerTextureConstructor,
                sample: value,
                sampleParameterName: name
            };
        }
    }

    return null;
};

class RuntimeViewerTransformPalette {
    readonly texture: ViewerTextureLike;
    private data: Float32Array;
    private nextIdx = 1;

    constructor(device: GraphicsDevice, ViewerTexture: ViewerTextureConstructor, initialSize = 4096) {
        let texture: ViewerTextureLike;
        let data: Float32Array;

        const realloc = (width: number, height: number) => {
            const newTexture = new ViewerTexture(device, {
                name: SCA_RIG_TRANSFORM_PALETTE_UNIFORM,
                width,
                height,
                format: PIXELFORMAT_RGBA32F,
                mipmaps: false,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });

            const newData = newTexture.lock() as Float32Array;
            newTexture.unlock();

            if (texture) {
                newData.set(data);
                texture.destroy();
            }

            texture = newTexture;
            data = newData;
        };

        this.setTransform = (index: number, transform: Mat4) => {
            const src = transform.data;
            for (let i = 0; i < 12; ++i) {
                data[index * 12 + i] = src[PALETTE_MATRIX_IDX[i]];
            }
            texture.upload();
        };

        this.alloc = (num = 1) => {
            const result = this.nextIdx;
            while (this.nextIdx + num > data.length / 12) {
                realloc(PALETTE_TEXTURE_WIDTH, texture.height * 2);
            }
            this.nextIdx += num;
            return result;
        };

        this.free = (num = 1) => {
            this.nextIdx -= num;
        };

        realloc(PALETTE_TEXTURE_WIDTH, Math.ceil(initialSize / (PALETTE_TEXTURE_WIDTH / 3)));
        this.texture = texture;
        this.data = data;
        this.setTransform(0, Mat4.IDENTITY);
    }

    setTransform: (index: number, transform: Mat4) => void;
    alloc: (num?: number) => number;
    free: (num?: number) => void;

    destroy(): void {
        this.texture.destroy();
    }
}

const createViewerRigTransformIndexTexture = (
    device: GraphicsDevice,
    ViewerTexture: ViewerTextureConstructor,
    layout: { width: number; height: number }
): ViewerTextureLike => {
    return new ViewerTexture(device, {
        name: SCA_RIG_TRANSFORM_INDEX_UNIFORM,
        width: layout.width,
        height: layout.height,
        format: PIXELFORMAT_R16U,
        mipmaps: false,
        minFilter: FILTER_NEAREST,
        magFilter: FILTER_NEAREST,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
};

const logRuntimeRigTextureIdentityDiagnostic = (
    viewerDevice: GraphicsDevice | undefined,
    indexTexture: ViewerTextureLike,
    paletteTexture: ViewerTextureLike,
    seam: ViewerTextureSeam
): void => {
    if (runtimeRigTextureIdentityLogged) {
        return;
    }

    runtimeRigTextureIdentityLogged = true;

    const ViewerTexture = seam.ViewerTexture;

    console.log('[SCA RUNTIME RIG TEXTURE IDENTITY]', {
        viewerDeviceMatchesIndexTextureDevice: indexTexture.device === viewerDevice,
        viewerDeviceMatchesPaletteTextureDevice: paletteTexture.device === viewerDevice,
        indexTextureConstructor: indexTexture.constructor?.name ?? 'unknown',
        paletteTextureConstructor: paletteTexture.constructor?.name ?? 'unknown',
        viewerKnownTextureConstructor: ViewerTexture.name ?? 'unknown',
        indexTextureLooksViewerNative: indexTexture instanceof ViewerTexture,
        paletteTextureLooksViewerNative: paletteTexture instanceof ViewerTexture,
        seamSampleParameterName: seam.sampleParameterName
    });
};

const resetRuntimeRigTextureIdentityDiagnostic = (): void => {
    runtimeRigTextureIdentityLogged = false;
};

const RIG_SHADER_UNIFORM_SPECS = [
    {
        name: SCA_RIG_TRANSFORM_INDEX_UNIFORM,
        glslType: 'highp usampler2D',
        textureFormat: 'PIXELFORMAT_R16U'
    },
    {
        name: SCA_RIG_TRANSFORM_PALETTE_UNIFORM,
        glslType: 'highp sampler2D',
        textureFormat: 'PIXELFORMAT_RGBA32F'
    }
] as const;

const LEGACY_RIG_PARAMETER_NAMES = ['splatTransform', 'transformPalette'] as const;

const describeParameterValue = (value: unknown): { valueType: string; textureFormat?: string } => {
    if (isViewerTextureLike(value)) {
        const formatNames: Record<number, string> = {
            [PIXELFORMAT_R16U]: 'PIXELFORMAT_R16U',
            [PIXELFORMAT_RGBA32F]: 'PIXELFORMAT_RGBA32F'
        };
        return {
            valueType: 'Texture',
            textureFormat: formatNames[value.format ?? -1] ?? `format_${value.format ?? 'unknown'}`
        };
    }
    if (Array.isArray(value)) {
        return { valueType: `array[${value.length}]` };
    }
    if (value === null) {
        return { valueType: 'null' };
    }
    return { valueType: typeof value };
};

const clearLegacyRigMaterialParameters = (material: GsplatMaterial): void => {
    for (const name of LEGACY_RIG_PARAMETER_NAMES) {
        material.deleteParameter?.(name);
    }
};

const logRuntimeRigUniformDiagnostic = (
    material: GsplatMaterial,
    transformIndexTexture: ViewerTextureLike,
    transformPaletteTexture: ViewerTextureLike
): void => {
    if (runtimeRigUniformDiagLogged) {
        return;
    }

    runtimeRigUniformDiagLogged = true;

    const parameterEntries = material.getParameters?.() ?? {};
    const parameterNames = Object.keys(parameterEntries);
    const collisions = parameterNames.filter((name) =>
        LEGACY_RIG_PARAMETER_NAMES.includes(name as typeof LEGACY_RIG_PARAMETER_NAMES[number])
    );

    console.log('[SCA RUNTIME RIG UNIFORMS]', {
        uniforms: RIG_SHADER_UNIFORM_SPECS.map((spec) => ({
            name: spec.name,
            glslType: spec.glslType,
            ...describeParameterValue(
                spec.name === SCA_RIG_TRANSFORM_INDEX_UNIFORM
                    ? transformIndexTexture
                    : transformPaletteTexture
            )
        })),
        materialParameterNames: parameterNames.sort(),
        legacyCollisions: collisions
    });
};

const resetRuntimeRigUniformDiagnostic = (): void => {
    runtimeRigUniformDiagLogged = false;
};

type RegionLookupEntry = {
    regionId: string;
    bitset: Uint8Array;
    memberCount?: number;
};

type RegionLookup = {
    gaussianCount: number;
    entries: RegionLookupEntry[];
};

type SavedGaussianTransform = {
    gaussianIndex: number;
    transformIndex: number;
};

type RuntimeRigSlot = {
    regionId: string;
    nodeId: string;
    paletteIndex: number;
    gaussianIndices: number[];
    saved: SavedGaussianTransform[];
};

type GsplatMaterial = {
    shaderChunks?: { glsl?: Map<string, string> };
    setParameter: (name: string, value: unknown) => void;
    deleteParameter?: (name: string) => void;
    getParameter?: (name: string) => { data?: unknown } | undefined;
    getParameters?: () => Record<string, { data?: unknown }>;
    update?: () => void;
};

type GsplatComponent = {
    unified?: boolean;
    entity?: {
        getWorldTransform?: () => Mat4;
    };
    material?: GsplatMaterial | null;
    resource?: { textureDimensions?: { x: number; y: number }; streams?: { textureDimensions?: { x: number; y: number } } };
    _resource?: { textureDimensions?: { x: number; y: number } };
    _placement?: { resource?: { textureDimensions?: { x: number; y: number }; streams?: { textureDimensions?: { x: number; y: number } } } };
    instance?: {
        material?: GsplatMaterial;
        resource?: { textureDimensions?: { x: number; y: number } };
    };
};

type AppLike = {
    scene?: { gsplat?: { material?: GsplatMaterial | null } };
    root?: { findComponents?: (type: string) => GsplatComponent[] };
    graphicsDevice?: GraphicsDevice;
};

type ViewerLike = {
    global?: {
        app?: AppLike;
    };
};

type RuntimeGsplatMaterialResolution = {
    material: GsplatMaterial | null;
    location: string;
    component: GsplatComponent | null;
};

let runtimeGsplatInspectLogged = false;

const resolveRuntimeGsplatComponent = (app: AppLike | undefined): GsplatComponent | null => {
    const components = app?.root?.findComponents?.('gsplat') ?? [];
    return components[0] ?? null;
};

const resolveRuntimeGsplatMaterial = (app: AppLike | undefined): RuntimeGsplatMaterialResolution => {
    const component = resolveRuntimeGsplatComponent(app);

    const sceneMaterial = app?.scene?.gsplat?.material ?? null;
    if (sceneMaterial) {
        return {
            material: sceneMaterial,
            location: 'app.scene.gsplat.material',
            component
        };
    }

    const components = app?.root?.findComponents?.('gsplat') ?? [];
    for (const entry of components) {
        const instanceMaterial = entry?.instance?.material ?? null;
        if (instanceMaterial) {
            return {
                material: instanceMaterial,
                location: 'component.instance.material',
                component: entry
            };
        }

        const componentMaterial = entry?.material ?? null;
        if (componentMaterial) {
            return {
                material: componentMaterial,
                location: 'component.material',
                component: entry
            };
        }
    }

    return {
        material: null,
        location: 'none',
        component
    };
};

const inspectRuntimeGsplatSeam = (viewer: ViewerLike): void => {
    if (runtimeGsplatInspectLogged) {
        return;
    }

    runtimeGsplatInspectLogged = true;

    const app = viewer.global?.app;
    const components = app?.root?.findComponents?.('gsplat') ?? [];
    const component = components[0] ?? null;
    const resolved = resolveRuntimeGsplatMaterial(app);
    const material = resolved.material;
    const glsl = material?.shaderChunks?.glsl;

    console.log('[SCA RUNTIME RIG INSPECT]', {
        componentCount: components.length,
        componentKeys: component ? Object.keys(component as object) : [],
        hasInstance: !!component?.instance,
        instanceKeys: component?.instance ? Object.keys(component.instance as object) : [],
        hasMaterial: !!material,
        materialLocation: resolved.location,
        shaderChunksLocation: glsl ? `${resolved.location}.shaderChunks.glsl` : 'none'
    });
};

const resetRuntimeGsplatInspectLog = (): void => {
    runtimeGsplatInspectLogged = false;
};

type RuntimeRigViewerHostContext = {
    host: RuntimeRigHost;
    applyRestPose: (rig: ScaRig) => void;
    destroy: () => void;
};

const rigMat = new Mat4();

const resolveGsplatCenterChunk = (glsl: Map<string, string>): { chunk: string; source: 'material' | 'engine-fallback' } => {
    const fromMaterial = glsl.get('gsplatCenterVS');
    if (fromMaterial?.includes('bool initCenter')) {
        return { chunk: fromMaterial, source: 'material' };
    }

    return { chunk: RUNTIME_GSPLAT_CENTER_VS_FALLBACK, source: 'engine-fallback' };
};

const patchGsplatCenterForRig = (chunk: string): GsplatCenterPatchResult => {
    if (!chunk.includes('bool initCenter')) {
        return { chunk, patchApplied: false };
    }

    if (chunk.includes('applyPaletteTransform')) {
        return { chunk, patchApplied: false };
    }

    const modelViewReplaced = chunk.replace(
        GSPLAT_CENTER_MODEL_VIEW_PATTERN,
        'mat4 modelView = matrix_view * applyPaletteTransform(matrix_model);'
    );

    if (modelViewReplaced === chunk) {
        return { chunk, patchApplied: false };
    }

    const patched = chunk.includes(`uniform highp usampler2D ${SCA_RIG_TRANSFORM_INDEX_UNIFORM}`)
        ? modelViewReplaced
        : `${RIG_CENTER_UNIFORMS}\n${modelViewReplaced}`;

    return { chunk: patched, patchApplied: true };
};

const logRuntimeRigShaderDiagnostic = (originalChunk: string, patchResult: GsplatCenterPatchResult): void => {
    if (runtimeRigShaderDiagLogged) {
        return;
    }

    runtimeRigShaderDiagLogged = true;

    const signatureMatch = originalChunk.match(/bool initCenter[\s\S]{0,160}/);

    console.log('[SCA RUNTIME RIG SHADER]', {
        chunkName: 'gsplatCenterVS',
        originalChunkContainsInitCenter: originalChunk.includes('bool initCenter'),
        originalChunkContainsCameraParams: originalChunk.includes('camera_params'),
        patchApplied: patchResult.patchApplied,
        chunkSource: patchResult.chunkSource,
        initCenterSignature: signatureMatch?.[0]?.split('\n').slice(0, 3).join('\\n') ?? 'none'
    });
};

const resetRuntimeRigShaderDiagnostic = (): void => {
    runtimeRigShaderDiagLogged = false;
};

const resolveGsplatLayout = (
    component: GsplatComponent | null,
    gaussianCount: number,
    app: AppLike | undefined
): { width: number; height: number } | null => {
    const resource = component?.resource ??
        component?._resource ??
        component?._placement?.resource ??
        component?.instance?.resource ??
        null;
    const dims = resource?.textureDimensions ?? resource?.streams?.textureDimensions ?? null;
    if (dims?.x && dims?.y) {
        return {
            width: dims.x,
            height: Math.max(dims.y, Math.ceil(gaussianCount / dims.x))
        };
    }

    const splatTextureSize = app?.scene?.gsplat?.material?.getParameter?.('splatTextureSize')?.data;
    if (typeof splatTextureSize === 'number' && splatTextureSize > 0) {
        const width = splatTextureSize;
        return {
            width,
            height: Math.ceil(gaussianCount / width)
        };
    }

    const width = Math.ceil(Math.sqrt(gaussianCount));
    return {
        width,
        height: Math.ceil(gaussianCount / width)
    };
};

const findRegionBitset = (lookup: RegionLookup, regionId: string): Uint8Array | null => {
    return lookup.entries.find((entry) => entry.regionId === regionId)?.bitset ?? null;
};

const findRegionLookupEntry = (lookup: RegionLookup, regionId: string): RegionLookupEntry | null => {
    return lookup.entries.find((entry) => entry.regionId === regionId) ?? null;
};

const countBitsetMembers = (bitset: Uint8Array | null): number => {
    if (!bitset) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < bitset.length; i++) {
        if (bitset[i]) {
            count++;
        }
    }
    return count;
};

const collectBitsetIndices = (bitset: Uint8Array | null): number[] => {
    const indices: number[] = [];
    if (!bitset) {
        return indices;
    }

    for (let i = 0; i < bitset.length; i++) {
        if (bitset[i]) {
            indices.push(i);
        }
    }
    return indices;
};

const takeFirstLast = (values: number[], count: number): { first: number[]; last: number[] } => {
    if (values.length <= count) {
        return { first: [...values], last: [...values] };
    }

    return {
        first: values.slice(0, count),
        last: values.slice(-count)
    };
};

const gaussianIndexToTexel = (
    gaussianIndex: number,
    width: number
): { x: number; y: number; linear: number } => {
    const x = gaussianIndex % width;
    const y = Math.floor(gaussianIndex / width);
    return {
        x,
        y,
        linear: y * width + x
    };
};

let rigIndexCheckLogged = false;

const resetRigIndexCheckDiagnostic = (): void => {
    rigIndexCheckLogged = false;
};

const logRigIndexCheck = (
    regionLookup: RegionLookup,
    slot: RuntimeRigSlot,
    rigTransformIndexTexture: ViewerTextureLike,
    layout: { width: number; height: number }
): void => {
    if (rigIndexCheckLogged) {
        return;
    }

    rigIndexCheckLogged = true;

    const entry = findRegionLookupEntry(regionLookup, slot.regionId);
    const bitset = entry?.bitset ?? null;
    const regionIndices = collectBitsetIndices(bitset);
    const paletteIndices = [...slot.gaussianIndices].sort((left, right) => left - right);
    const regionEnds = takeFirstLast(regionIndices, 10);
    const paletteEnds = takeFirstLast(paletteIndices, 10);

    const regionMemberCount = countBitsetMembers(bitset);
    const exportMemberCount = entry?.memberCount ?? null;
    const paletteAssignedCount = slot.gaussianIndices.length;

    const locked = rigTransformIndexTexture.lock() as Uint16Array;
    const first10TransformIndexValues = regionEnds.first.map((gaussianIndex) => locked[gaussianIndex] ?? 0);
    const last10TransformIndexValues = regionEnds.last.map((gaussianIndex) => locked[gaussianIndex] ?? 0);

    let transformIndexMismatchCount = 0;
    const transformIndexMismatches: Array<{ gaussianIndex: number; expected: number; actual: number }> = [];
    for (const gaussianIndex of paletteIndices) {
        const actual = locked[gaussianIndex] ?? 0;
        if (actual !== slot.paletteIndex) {
            transformIndexMismatchCount++;
            if (transformIndexMismatches.length < 5) {
                transformIndexMismatches.push({
                    gaussianIndex,
                    expected: slot.paletteIndex,
                    actual
                });
            }
        }
    }
    rigTransformIndexTexture.unlock();

    const regionSet = new Set(regionIndices);
    const paletteSet = new Set(paletteIndices);
    let paletteNotInRegionCount = 0;
    for (const gaussianIndex of paletteIndices) {
        if (!regionSet.has(gaussianIndex)) {
            paletteNotInRegionCount++;
        }
    }

    let regionNotInPaletteCount = 0;
    for (const gaussianIndex of regionIndices) {
        if (!paletteSet.has(gaussianIndex)) {
            regionNotInPaletteCount++;
        }
    }

    const indicesMatch = paletteNotInRegionCount === 0 &&
        regionNotInPaletteCount === 0 &&
        regionMemberCount === paletteAssignedCount;

    console.log('[SCA RIG INDEX CHECK]', {
        regionId: slot.regionId,
        nodeId: slot.nodeId,
        runtimeGaussianCount: regionLookup.gaussianCount,
        regionMemberCount,
        paletteAssignedCount,
        first10RegionIndices: regionEnds.first,
        first10PaletteIndices: paletteEnds.first,
        last10RegionIndices: regionEnds.last,
        highlightedRegionMemberCount: regionMemberCount,
        exportMemberCount,
        exportMemberCountMatchesRegion: exportMemberCount === null ? null : exportMemberCount === regionMemberCount,
        last10PaletteIndices: paletteEnds.last,
        paletteIndex: slot.paletteIndex,
        first10TransformIndexValues,
        last10TransformIndexValues,
        transformIndexMismatchCount,
        transformIndexMismatches,
        paletteNotInRegionCount,
        regionNotInPaletteCount,
        regionPaletteIndicesMatch: indicesMatch,
        transformIndexLayout: layout,
        highlightIndexSource: 'regionLookup.entry.bitset (same as setScaRegionHighlightCombined selectedBitset)',
        cpuTransformIndexTexelKey: 'indices[gaussianIndex] (linear row-major, width = rigTransformIndexTexture.width)',
        highlightShaderTexelKey: 'scaGaussianIndex → ivec2(index % scaRegionHighlightTexWidth, index / scaRegionHighlightTexWidth)',
        rigShaderTexelKey: `splat.index → ivec2(index % ${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM}, index / ${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM})`
    });

    if (!indicesMatch || transformIndexMismatchCount > 0 || exportMemberCount !== regionMemberCount) {
        console.warn('[SCA RIG INDEX CHECK MISMATCH]', {
            regionId: slot.regionId,
            regionMemberCount,
            paletteAssignedCount,
            exportMemberCount,
            regionNotInPaletteCount,
            paletteNotInRegionCount,
            transformIndexMismatchCount,
            transformIndexMismatches
        });
    }
};

const projectNeedsRuntimeRigHost = (project: ScaProject): boolean => {
    const rig = project.rig;
    return !!(rig && rig.nodes.length > 0 && rig.bindings.length > 0);
};

const projectNeedsRegionLookupForRig = (project: ScaProject): boolean => {
    return (project.regions ?? []).some((region) => region.enabled);
};

const isRuntimeRigHostReady = (
    viewer: ViewerLike,
    project: ScaProject,
    regionLookup: RegionLookup | null
): boolean => {
    if (!projectNeedsRuntimeRigHost(project)) {
        return true;
    }

    if (projectNeedsRegionLookupForRig(project)) {
        if (!regionLookup || regionLookup.gaussianCount <= 0) {
            return false;
        }
    }

    const app = viewer.global?.app;
    const device = app?.graphicsDevice;
    const { material } = resolveRuntimeGsplatMaterial(app);

    return !!(device && material && material.shaderChunks?.glsl);
};

const createRuntimeRigViewerHost = (
    viewer: ViewerLike,
    project: ScaProject,
    regionLookup: RegionLookup | null
): RuntimeRigViewerHostContext | null => {
    const rig = project.rig;
    if (!rig || rig.nodes.length === 0 || rig.bindings.length === 0) {
        return null;
    }

    if (!regionLookup || regionLookup.gaussianCount <= 0) {
        console.warn('[SCA RUNTIME RIG] host skipped: region lookup unavailable');
        return null;
    }

    const app = viewer.global?.app;
    const device = app?.graphicsDevice;
    const { material, component } = resolveRuntimeGsplatMaterial(app);

    if (!device || !material) {
        return null;
    }

    if (device.isWebGPU) {
        console.warn('[SCA RUNTIME RIG] host skipped: rig palette not supported on WebGPU viewer yet');
        return null;
    }

    const glsl = material.shaderChunks?.glsl;
    if (!glsl) {
        console.warn('[SCA RUNTIME RIG] host skipped: gsplat shader chunks unavailable');
        return null;
    }

    const gaussianCount = regionLookup.gaussianCount;
    const layout = resolveGsplatLayout(component, gaussianCount, app);
    if (!layout) {
        console.warn('[SCA RUNTIME RIG] host skipped: gsplat layout unavailable');
        return null;
    }

    const textureSeam = resolveViewerTextureSeam(material);
    if (!textureSeam) {
        console.warn('[SCA RUNTIME RIG] host skipped: viewer-native Texture constructor unavailable');
        return null;
    }

    const { ViewerTexture } = textureSeam;
    const transformPalette = new RuntimeViewerTransformPalette(device, ViewerTexture);
    const rigTransformIndexTexture = createViewerRigTransformIndexTexture(device, ViewerTexture, layout);

    const transformIndices = rigTransformIndexTexture.lock() as Uint16Array;
    transformIndices.fill(0);
    rigTransformIndexTexture.unlock();

    const nodeById = new Map<string, ScaRigNode>(rig.nodes.map((node) => [node.id, node]));
    const bindings = [...rig.bindings].sort((left, right) => left.regionId.localeCompare(right.regionId));
    const paletteByNodeId = new Map<string, number>();
    const slotByBindingKey = new Map<string, RuntimeRigSlot>();
    const ownerByGaussian = new Map<number, string>();
    const slots: RuntimeRigSlot[] = [];

    const indices = rigTransformIndexTexture.lock() as Uint16Array;

    for (const binding of bindings) {
        if (!nodeById.has(binding.nodeId)) {
            continue;
        }

        const bitset = findRegionBitset(regionLookup, binding.regionId);
        if (!bitset) {
            continue;
        }

        const bindingKey = `${binding.nodeId}:${binding.regionId}`;
        let paletteIndex = paletteByNodeId.get(binding.nodeId);
        if (paletteIndex === undefined) {
            paletteIndex = transformPalette.alloc();
            paletteByNodeId.set(binding.nodeId, paletteIndex);
        }

        let slot = slotByBindingKey.get(bindingKey);
        if (!slot) {
            slot = {
                regionId: binding.regionId,
                nodeId: binding.nodeId,
                paletteIndex,
                gaussianIndices: [],
                saved: []
            };
            slotByBindingKey.set(bindingKey, slot);
            slots.push(slot);
        }

        for (let gaussianIndex = 0; gaussianIndex < bitset.length; gaussianIndex++) {
            if (!bitset[gaussianIndex]) {
                continue;
            }

            const existingOwner = ownerByGaussian.get(gaussianIndex);
            if (existingOwner && existingOwner !== binding.regionId) {
                continue;
            }
            if (existingOwner === binding.regionId) {
                continue;
            }

            ownerByGaussian.set(gaussianIndex, binding.regionId);
            slot.saved.push({
                gaussianIndex,
                transformIndex: indices[gaussianIndex] ?? 0
            });
            slot.gaussianIndices.push(gaussianIndex);
            indices[gaussianIndex] = slot.paletteIndex;
        }
    }

    rigTransformIndexTexture.unlock();
    rigTransformIndexTexture.upload();

    if (slots.length === 0) {
        rigTransformIndexTexture.destroy();
        transformPalette.destroy();
        console.warn('[SCA RUNTIME RIG] host skipped: no rig bindings matched runtime region masks');
        return null;
    }

    logRigIndexCheck(regionLookup, slots[0], rigTransformIndexTexture, layout);

    const sortCentersState: RuntimeRigSortCentersState | null = createRuntimeRigSortCentersState(
        app,
        component,
        slots.map((slot) => ({ gaussianIndices: slot.gaussianIndices }))
    );

    const region06Slot = slots.find((slot) => slot.regionId === TARGET_REGION_ID);
    const region06GaussianIndex = region06Slot ?
        findFirstGaussianIndexForRegion(region06Slot.gaussianIndices) :
        null;
    if (region06Slot && region06GaussianIndex !== null && sortCentersState) {
        registerRuntimeTransformOrderProbe({
            regionId: TARGET_REGION_ID,
            gaussianIndex: region06GaussianIndex,
            paletteIndex: region06Slot.paletteIndex,
            textureWidth: layout.width,
            getLocalCenter: () => sortCentersState.readSourceCenter(region06GaussianIndex) ?? [0, 0, 0],
            getEntityMatrix: () => component?.entity?.getWorldTransform?.() ?? new Mat4(),
            getResourceCenter: () => {
                const offset = region06GaussianIndex * 3;
                const centers = sortCentersState.resource.centers;
                if (offset + 2 >= centers.length) {
                    return null;
                }
                return [centers[offset], centers[offset + 1], centers[offset + 2]];
            },
            getSortCenterModelSpace: () => sortCentersState.readSortCenter(region06GaussianIndex)
        });
    } else {
        registerRuntimeTransformOrderProbe(null);
    }

    const hostBindings: RuntimeRigPaletteBinding[] = slots.map((slot) => ({
        regionId: slot.regionId,
        nodeId: slot.nodeId,
        paletteIndex: slot.paletteIndex,
        setPaletteMatrix: (paletteIndex: number, matrix: Mat4) => {
            transformPalette.setTransform(paletteIndex, matrix);
        }
    }));

    const requestRender = () => {
        if (app) {
            app.renderNextFrame = 1;
        }
    };

    const bindingByRegion = new Map<string, ScaRigBinding>(
        rig.bindings.map((binding) => [binding.regionId, binding])
    );

    const applyPose = (rigToApply: ScaRig, pose: ReturnType<typeof evaluateRuntimeRigPose>): void => {
        for (const slot of slots) {
            const node = nodeById.get(slot.nodeId);
            const binding = bindingByRegion.get(slot.regionId);
            if (!node || !binding) {
                continue;
            }

            buildEffectiveRigWorldMatrixFromPose(rigToApply, pose, node, binding, rigMat);
            transformPalette.setTransform(slot.paletteIndex, rigMat);
            sortCentersState?.updateForMatrix(rigMat, [{ gaussianIndices: slot.gaussianIndices }]);
        }

        sortCentersState?.flush();
        rigTransformIndexTexture.upload();
        requestRender();
    };

    const { chunk: originalGsplatCenterChunk, source: gsplatCenterChunkSource } = resolveGsplatCenterChunk(glsl);
    const gsplatCenterPatch = patchGsplatCenterForRig(originalGsplatCenterChunk);
    gsplatCenterPatch.chunkSource = gsplatCenterChunkSource;
    logRuntimeRigShaderDiagnostic(originalGsplatCenterChunk, gsplatCenterPatch);

    if (!gsplatCenterPatch.patchApplied) {
        rigTransformIndexTexture.destroy();
        transformPalette.destroy();
        console.warn('[SCA RUNTIME RIG] host skipped: gsplat center shader patch did not apply');
        return null;
    }

    glsl.set('gsplatCenterVS', gsplatCenterPatch.chunk);
    clearLegacyRigMaterialParameters(material);
    material.update?.();
    material.setParameter(SCA_RIG_TRANSFORM_INDEX_UNIFORM, rigTransformIndexTexture);
    material.setParameter(SCA_RIG_TRANSFORM_PALETTE_UNIFORM, transformPalette.texture);
    material.setParameter(SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM, layout.width);
    material.update?.();
    logRuntimeRigTextureIdentityDiagnostic(device, rigTransformIndexTexture, transformPalette.texture, textureSeam);
    logRuntimeRigUniformDiagnostic(material, rigTransformIndexTexture, transformPalette.texture);

    const highlightTexWidthParam = material.getParameter?.('scaRegionHighlightTexWidth')?.data;
    const highlightTexWidth = typeof highlightTexWidthParam === 'number' ? highlightTexWidthParam : null;
    const sampleGaussianIndex = slots[0]?.gaussianIndices[0] ?? 0;
    console.log('[SCA RUNTIME RIG TRANSFORM INDEX LAYOUT]', {
        rigTransformIndexTexture: {
            width: layout.width,
            height: layout.height,
            allocatedWidth: rigTransformIndexTexture.width,
            allocatedHeight: rigTransformIndexTexture.height
        },
        scaRegionHighlightTexWidth: highlightTexWidth,
        scaRigTransformIndexTexWidth: layout.width,
        highlightWidthMatchesRigIndexWidth: highlightTexWidth === null ? null : highlightTexWidth === layout.width,
        beforeShaderMapping: {
            widthUniform: 'scaRegionHighlightTexWidth',
            texel: 'ivec2(splat.index % scaRegionHighlightTexWidth, splat.index / scaRegionHighlightTexWidth)'
        },
        afterShaderMapping: {
            widthUniform: SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM,
            texel: `ivec2(splat.index % ${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM}, splat.index / ${SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM})`
        },
        cpuWriteMapping: {
            buffer: 'indices[gaussianIndex] = paletteIndex',
            texelCoordinate: 'linear gaussianIndex (row-major width = rigTransformIndexTexture.width)'
        },
        sampleGaussianIndex,
        sampleCpuTexel: gaussianIndexToTexel(sampleGaussianIndex, layout.width),
        sampleShaderTexel: gaussianIndexToTexel(sampleGaussianIndex, layout.width),
        cpuShaderLinearIndexMatch: gaussianIndexToTexel(sampleGaussianIndex, layout.width).linear === sampleGaussianIndex
    });

    const paletteSize = hostBindings.reduce(
        (max, entry) => Math.max(max, entry.paletteIndex),
        0
    ) + 1;

    console.log('[SCA RUNTIME RIG] host ready', {
        bindingCount: hostBindings.length,
        paletteSize
    });

    maybeLogRuntimeRigDataParity(rig);

    const host: RuntimeRigHost = {
        bindings: hostBindings,
        requestRender,
        applyPose: (rigToApply, pose) => {
            applyPose(rigToApply, pose);
        }
    };

    return {
        host,
        applyRestPose: (rigToApply: ScaRig) => {
            applyPose(rigToApply, evaluateRuntimeRigPose(rigToApply, null, 0));
        },
        destroy: () => {
            resetRuntimeTransformOrderProbe();
            const locked = rigTransformIndexTexture.lock() as Uint16Array;
            const freedPalette = new Set<number>();
            for (const slot of slots) {
                for (const saved of slot.saved) {
                    locked[saved.gaussianIndex] = saved.transformIndex;
                }
                if (!freedPalette.has(slot.paletteIndex)) {
                    transformPalette.setTransform(slot.paletteIndex, Mat4.IDENTITY);
                    transformPalette.free(1);
                    freedPalette.add(slot.paletteIndex);
                }
            }
            rigTransformIndexTexture.unlock();
            rigTransformIndexTexture.upload();
            rigTransformIndexTexture.destroy();
            transformPalette.destroy();
            sortCentersState?.destroy();
            material.deleteParameter?.(SCA_RIG_TRANSFORM_INDEX_UNIFORM);
            material.deleteParameter?.(SCA_RIG_TRANSFORM_PALETTE_UNIFORM);
            material.deleteParameter?.(SCA_RIG_TRANSFORM_INDEX_TEX_WIDTH_UNIFORM);
        }
    };
};

export {
    createRuntimeRigViewerHost,
    inspectRuntimeGsplatSeam,
    isRuntimeRigHostReady,
    patchGsplatCenterForRig,
    projectNeedsRegionLookupForRig,
    projectNeedsRuntimeRigHost,
    resetRuntimeGsplatInspectLog,
    resetRuntimeRigShaderDiagnostic,
    resetRuntimeRigTextureIdentityDiagnostic,
    resetRuntimeRigUniformDiagnostic,
    resetRigIndexCheckDiagnostic,
    resolveRuntimeGsplatMaterial,
    resolveViewerTextureSeam,
    RuntimeRigViewerHostContext
};
