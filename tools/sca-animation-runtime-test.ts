import { strict as assert } from 'node:assert';

import { normalizeAnimationClip } from '../src/sca/animation/animation-defaults';
import { applyRegionAnimationOverrides, getRegionAnimationOpacityOverride } from '../src/sca/animation/region-animation-presentation';
import { createDefaultRigNode } from '../src/sca/rig/rig-defaults';
import { sampleNumberTrack } from '../src/sca/rig/rig-animation';
import { evaluateRuntimeRigPose } from '../src/sca/runtime/runtime-rig-pose';
import { RuntimeRigApplier } from '../src/sca/runtime/runtime-rig-applier';
import {
    createRuntimeAnimationController,
    findTriggeredClips
} from '../src/sca/runtime/sca-animation-runtime';
import { patchGsplatCenterForRig, isRuntimeRigHostReady, projectNeedsRuntimeRigHost, resolveRuntimeGsplatMaterial, resolveViewerTextureSeam } from '../src/sca/runtime/runtime-rig-viewer-host';
import { transformPoint } from '../src/sca/runtime/runtime-rig-sort-centers';
import { Mat4 } from 'playcanvas';
import { ScaAnimationClip } from '../src/sca/types/animation';
import { createEmptyProject, ScaProject, SCA_PROJECT_VERSION } from '../src/sca/types/project';
import { normalizeProject } from '../src/sca/viewer/viewer-config';

const sampleClip = (overrides: Partial<ScaAnimationClip> = {}): ScaAnimationClip => ({
    id: 'animation_01',
    name: 'Test',
    duration: 2,
    tracks: [],
    ...overrides
});

const runNormalizationTests = () => {
    const clip = normalizeAnimationClip({
        id: 'animation_01',
        name: 'Intro',
        duration: 2,
        tracks: [],
        autoplay: true,
        loop: true,
        trigger: { type: 'hotspot', targetId: 'hotspot_01' }
    }, 0);

    assert.ok(clip);
    assert.equal(clip!.autoplay, true);
    assert.equal(clip!.loop, true);
    assert.deepEqual(clip!.trigger, { type: 'hotspot', targetId: 'hotspot_01' });

    const normalized = normalizeProject({
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [],
        animations: [clip!]
    });
    assert.equal(normalized.animations?.[0].autoplay, true);

    console.log('[sca-animation-runtime] normalization PASS');
};

const runPlaybackTests = () => {
    const node = createDefaultRigNode('rig_01');
    node.rotation = [0, 0, 0];
    const project: ScaProject = {
        ...createEmptyProject(),
        rig: { version: 1, nodes: [node], bindings: [] },
        animations: [
            sampleClip({
                tracks: [{
                    id: 'track_01',
                    targetType: 'rig-node',
                    nodeId: node.id,
                    property: 'rotation',
                    keyframes: [
                        { id: 'keyframe_01', time: 0, value: [0, 0, 0] },
                        { id: 'keyframe_02', time: 2, value: [0, 90, 0] }
                    ]
                }]
            }),
            sampleClip({
                id: 'animation_02',
                trigger: { type: 'region', targetId: 'region_01' }
            })
        ]
    };

    let refreshCount = 0;
    const rigApplier = new RuntimeRigApplier();
    const controller = createRuntimeAnimationController({
        getProject: () => project,
        requestRender: () => {},
        refreshRegionPresentation: () => {
            refreshCount++;
        },
        rigApplier
    });

    assert.ok(controller.playAnimation('animation_01'));
    assert.equal(controller.getActiveClipId(), 'animation_01');
    controller.stopAnimation('animation_01');
    assert.equal(controller.getActiveClipId(), null);

    const midPose = evaluateRuntimeRigPose(project.rig!, project.animations![0], 1);
    assert.ok(Math.abs(midPose.nodes.get(node.id)!.rotation[1] - 45) < 1, 'runtime rig pose interpolates');

    const triggered = findTriggeredClips(project, 'region', 'region_01');
    assert.equal(triggered.length, 1);
    assert.equal(triggered[0].id, 'animation_02');

    controller.triggerAnimationForTarget('region', 'region_01');
    assert.equal(controller.getActiveClipId(), 'animation_02');

    controller.resetAnimation('animation_02');
    assert.equal(controller.getCurrentTime(), 0);

    assert.ok(refreshCount > 0);

    console.log('[sca-animation-runtime] playback PASS');
};

const runOpacityTests = () => {
    const clip = sampleClip({
        tracks: [{
            id: 'track_01',
            targetType: 'region',
            regionId: 'region_01',
            property: 'opacity',
            keyframes: [
                { id: 'keyframe_01', time: 0, value: 1 },
                { id: 'keyframe_02', time: 2, value: 0.25 }
            ]
        }]
    });

    applyRegionAnimationOverrides(clip, 1, true);
    assert.ok(Math.abs(getRegionAnimationOpacityOverride('region_01')! - 0.625) < 1e-3);

    applyRegionAnimationOverrides(null, 0, false);
    assert.equal(getRegionAnimationOpacityOverride('region_01'), null);

    const sampled = sampleNumberTrack(
        clip.tracks[0].keyframes as { time: number; value: number }[],
        1
    );
    assert.ok(Math.abs(sampled - 0.625) < 1e-3);

    console.log('[sca-animation-runtime] opacity PASS');
};

const runSharedOpacityStoreTests = () => {
    const globalObj = globalThis as typeof globalThis & {
        SCA3D?: { state?: Record<string, unknown> };
    };
    const previousSca = globalObj.SCA3D;

    globalObj.SCA3D = { state: {} };

    const clip = sampleClip({
        tracks: [{
            id: 'track_01',
            targetType: 'region',
            regionId: 'region_01',
            property: 'opacity',
            keyframes: [
                { id: 'keyframe_01', time: 0, value: 1 },
                { id: 'keyframe_02', time: 2, value: 0.2 }
            ]
        }]
    });

    applyRegionAnimationOverrides(clip, 1, true);
    const sharedStore = globalObj.SCA3D?.state?.regionOpacityOverrides as Map<string, number>;
    assert.ok(sharedStore instanceof Map, 'runtime opacity overrides live on SCA3D.state');
    assert.ok(Math.abs(sharedStore.get('region_01')! - 0.6) < 1e-3);
    assert.equal(getRegionAnimationOpacityOverride('region_01'), sharedStore.get('region_01'));

    applyRegionAnimationOverrides(null, 0, false);
    assert.equal(sharedStore.size, 0);

    globalObj.SCA3D = previousSca;

    console.log('[sca-animation-runtime] shared opacity store PASS');
};

const runRigHostTests = () => {
    const patched = patchGsplatCenterForRig(
        'bool initCenter(vec3 modelCenter, inout SplatCenter center) {\n\tmat4 modelView = matrix_view * matrix_model;\n\treturn true;\n}'
    );
    assert.ok(patched.patchApplied);
    assert.ok(patched.chunk.includes('applyPaletteTransform'));
    assert.ok(patched.chunk.includes('uniform highp usampler2D uScaRigTransformIndex'));
    assert.ok(patched.chunk.includes('int(splat.index) % int(scaRegionHighlightTexWidth)'));
    assert.ok(!patched.chunk.includes('texelFetch(uScaRigTransformIndex, splat.uv'));

    const emptyMaterialChunks = new Map<string, string>();
    const fallbackPatch = patchGsplatCenterForRig(emptyMaterialChunks.get('gsplatCenterVS') ?? `
bool initCenter(vec3 modelCenter, inout SplatCenter center) {
\tmat4 modelView = matrix_view * matrix_model;
\treturn true;
}
`);
    assert.ok(fallbackPatch.patchApplied, 'runtime center patch applies to viewer-style initCenter signature');

    class MockViewerTexture {
        device: unknown;
        format = 35;
        constructor(device: unknown) {
            this.device = device;
        }
        lock() { return new Uint16Array(1); }
        unlock() {}
        upload() {}
        destroy() {}
    }
    const viewerDevice = { id: 'viewer-device' };
    const seam = resolveViewerTextureSeam({
        getParameter: (name: string) => name === 'scaRegionHighlight'
            ? { data: new MockViewerTexture(viewerDevice) }
            : undefined,
        getParameters: () => ({ scaRegionHighlight: { data: new MockViewerTexture(viewerDevice) } })
    });
    assert.ok(seam);
    assert.equal(seam?.sampleParameterName, 'scaRegionHighlight');
    const native = new seam!.ViewerTexture(viewerDevice, { format: 35, width: 1, height: 1 });
    assert.ok(native instanceof MockViewerTexture);

    const identity = new Mat4();
    const [tx, ty, tz] = transformPoint(identity, 1, 2, 3);
    assert.ok(Math.abs(tx - 1) < 1e-5 && Math.abs(ty - 2) < 1e-5 && Math.abs(tz - 3) < 1e-5);

    const rigApplier = new RuntimeRigApplier();
    assert.equal(rigApplier.getBindingCount(), 0);
    rigApplier.setHost({
        bindings: [{
            regionId: 'region_01',
            nodeId: 'rig_01',
            paletteIndex: 1,
            setPaletteMatrix: () => {}
        }],
        requestRender: () => {}
    });
    assert.equal(rigApplier.getBindingCount(), 1);
    assert.equal(rigApplier.hasHost(), true);

    const emptyProject = createEmptyProject();
    assert.equal(isRuntimeRigHostReady({}, emptyProject, null), true);
    assert.equal(projectNeedsRuntimeRigHost(emptyProject), false);

    const rigProject = {
        ...createEmptyProject(),
        rig: { version: 1 as const, nodes: [{ id: 'rig_01', name: 'Rig', position: [0, 0, 0], rotation: [0, 0, 0], pivot: [0, 0, 0], rest: { position: [0, 0, 0], rotation: [0, 0, 0] } }], bindings: [{ regionId: 'region_01', nodeId: 'rig_01', mode: 'rigid' as const }] },
        regions: [{ id: 'region_01', name: 'Region', enabled: true, source: { type: 'gaussian-mask' as const, scaSplatId: 'splat_01', maskAsset: 'sca/regions/region_01.mask' }, capture: { gaussianCount: 1 }, interaction: { clickable: true }, visual: {} }]
    };
    const lookup = { gaussianCount: 10, entries: [{ regionId: 'region_01', bitset: new Uint8Array(10) }] };
    const sceneMaterial = {
        shaderChunks: { glsl: new Map<string, string>() },
        setParameter: () => {}
    };
    const resolved = resolveRuntimeGsplatMaterial({
        scene: { gsplat: { material: sceneMaterial } },
        root: { findComponents: () => [{ unified: true, instance: null }] }
    });
    assert.equal(resolved.location, 'app.scene.gsplat.material');
    assert.equal(
        isRuntimeRigHostReady({
            global: {
                app: {
                    scene: { gsplat: { material: sceneMaterial } },
                    root: { findComponents: () => [{ unified: true }] },
                    graphicsDevice: {}
                }
            }
        }, rigProject, lookup),
        true
    );

    console.log('[sca-animation-runtime] rig host PASS');
};

const runTriggerBehaviorTests = () => {
    const project: ScaProject = {
        ...createEmptyProject(),
        animations: [
            sampleClip({
                id: 'animation_autoplay',
                autoplay: true,
                tracks: [{
                    id: 'track_autoplay',
                    targetType: 'region',
                    regionId: 'region_01',
                    property: 'opacity',
                    keyframes: [
                        { id: 'keyframe_01', time: 0, value: 1 },
                        { id: 'keyframe_02', time: 1, value: 0.2 }
                    ]
                }]
            }),
            sampleClip({
                id: 'animation_hotspot_a',
                trigger: { type: 'hotspot', targetId: 'hotspot_a' }
            }),
            sampleClip({
                id: 'animation_hotspot_a_duplicate',
                trigger: { type: 'hotspot', targetId: 'hotspot_a' }
            }),
            sampleClip({
                id: 'animation_loop',
                loop: true,
                duration: 1,
                tracks: [{
                    id: 'track_loop',
                    targetType: 'region',
                    regionId: 'region_01',
                    property: 'opacity',
                    keyframes: [
                        { id: 'keyframe_01', time: 0, value: 1 },
                        { id: 'keyframe_02', time: 1, value: 0.2 }
                    ]
                }]
            })
        ]
    };

    const rigApplier = new RuntimeRigApplier();
    const controller = createRuntimeAnimationController({
        getProject: () => project,
        requestRender: () => {},
        refreshRegionPresentation: () => {},
        rigApplier
    });
    controller.initAutoplay();
    assert.equal(controller.getActiveClipId(), 'animation_autoplay', 'autoplay starts first matching clip');

    controller.triggerAnimationForTarget('hotspot', 'hotspot_a');
    assert.equal(controller.getActiveClipId(), 'animation_hotspot_a', 'only first matching trigger clip starts');

    controller.triggerAnimationForTarget('hotspot', 'hotspot_b');
    assert.equal(controller.getActiveClipId(), 'animation_hotspot_a', 'unrelated hotspot does not start clip');

    assert.ok(controller.playAnimation('animation_loop'));
    assert.equal(controller.isPlaying(), true, 'loop clip starts playback');

    controller.destroy();

    console.log('[sca-animation-runtime] trigger behavior PASS');
};

const main = () => {
    runNormalizationTests();
    runPlaybackTests();
    runOpacityTests();
    runSharedOpacityStoreTests();
    runRigHostTests();
    runTriggerBehaviorTests();

    console.log('\n========== SCA ANIMATION RUNTIME TEST REPORT ==========');
    console.log('Normalization: PASS');
    console.log('Playback: PASS');
    console.log('Opacity: PASS');
    console.log('Shared opacity store: PASS');
    console.log('Rig host: PASS');
    console.log('Trigger behavior: PASS');
    console.log('=======================================================\n');
};

main();
