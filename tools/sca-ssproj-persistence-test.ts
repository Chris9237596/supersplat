import { strict as assert } from 'node:assert';
import {
    deserializeSsprojScaBlock,
    serializeSsprojScaBlock
} from '../src/sca/persistence/sca-project-persistence';
import { stringifyProjectJson } from '../src/sca/serialize/project-json';
import {
    createEmptyProject,
    ScaHotspot,
    ScaProject,
    SCA_PROJECT_VERSION
} from '../src/sca/types/project';
import { createDefaultRigNode } from '../src/sca/rig/rig-defaults';
import { createDefaultViewerConfig } from '../src/sca/viewer/viewer-config';

const sampleHotspot = (id: string, name: string, position: [number, number, number]): ScaHotspot => ({
    id,
    name,
    text: `${name} text`,
    position,
    enabled: true,
    visual: { type: 'annotation', visible: true },
    hover: { enabled: true },
    click: {
        enabled: true,
        action: { type: 'event', eventName: 'hotspotClicked' }
    },
    camera: {
        initial: {
            position: [position[0], position[1] + 1, position[2] - 1],
            target: position,
            fov: 55
        }
    }
});

const createSampleProject = (): ScaProject => {
    const viewer = createDefaultViewerConfig({
        position: [1.2, 2.3, -3.4],
        target: [0.1, 0.2, 0.3],
        fov: 48
    });

    viewer.navigation = {
        defaultMode: 'orbit',
        allowedModes: ['orbit']
    };

    viewer.interaction = {
        focusTransition: { duration: 2.0 },
        homeTransition: { duration: 3.0 }
    };

    return {
        version: SCA_PROJECT_VERSION,
        hotspots: [
            sampleHotspot('hotspot_a', 'Alpha', [0.4, 0.2, 0.1]),
            sampleHotspot('hotspot_b', 'Beta', [-0.5, 0.15, -0.2])
        ],
        regions: [],
        viewer
    };
};

const runPersistenceTests = () => {
    const source = createSampleProject();
    const block = serializeSsprojScaBlock(source);
    const restored = deserializeSsprojScaBlock(block);

    assert.equal(block.version, 1);
    assert.deepEqual(restored.hotspots.map((hotspot) => hotspot.id), ['hotspot_a', 'hotspot_b']);
    assert.deepEqual(restored.hotspots.map((hotspot) => hotspot.name), ['Alpha', 'Beta']);
    assert.deepEqual(restored.hotspots[0].position, [0.4, 0.2, 0.1]);
    assert.deepEqual(restored.hotspots[1].position, [-0.5, 0.15, -0.2]);
    assert.deepEqual(restored.viewer?.camera.initial.position, [1.2, 2.3, -3.4]);
    assert.deepEqual(restored.viewer?.camera.initial.target, [0.1, 0.2, 0.3]);
    assert.equal(restored.viewer?.camera.initial.fov, 48);
    assert.equal(restored.viewer?.interaction.focusTransition.duration, 2.0);
    assert.equal(restored.viewer?.interaction.homeTransition.duration, 3.0);

    const empty = deserializeSsprojScaBlock(undefined);
    assert.deepEqual(empty, createEmptyProject());

    const legacy = deserializeSsprojScaBlock({ version: 99, project: source });
    assert.deepEqual(legacy, createEmptyProject());

    const exportBefore = stringifyProjectJson(source, false);
    const exportAfter = stringifyProjectJson(restored, false);
    assert.equal(exportBefore, exportAfter);

    console.log('[sca-ssproj-persistence] module round-trip PASS');
};

const runAnimationPersistenceTest = () => {
    const upper = createDefaultRigNode('rig_01', 'Upper');
    upper.rotation = [-15, 0, 0];

    const source: ScaProject = {
        version: SCA_PROJECT_VERSION,
        hotspots: [],
        regions: [],
        rig: { version: 1, nodes: [upper], bindings: [] },
        animations: [{
            id: 'animation_01',
            name: 'Claw Test',
            duration: 2,
            tracks: [{
                id: 'track_01',
                targetType: 'rig-node',
                nodeId: upper.id,
                property: 'rotation',
                keyframes: [
                    { id: 'keyframe_01', time: 0, value: [-15, 0, 0] },
                    { id: 'keyframe_02', time: 1, value: [10, 0, 0] }
                ]
            }]
        }]
    };

    const restored = deserializeSsprojScaBlock(serializeSsprojScaBlock(source));
    assert.equal(restored.animations?.length, 1);
    assert.equal(restored.animations![0].name, 'Claw Test');
    assert.equal(restored.animations![0].tracks[0].keyframes.length, 2);
    assert.deepEqual(restored.animations![0].tracks[0].keyframes[1].value, [10, 0, 0]);

    console.log('[sca-ssproj-persistence] animation round-trip PASS');
};

const runDocumentJsonShapeTest = () => {
    const source = createSampleProject();
    const document = {
        version: 0,
        camera: {},
        view: {},
        poseSets: [],
        timeline: {},
        splats: [],
        sca: serializeSsprojScaBlock(source)
    };

    assert.ok(document.sca);
    assert.equal(document.sca.version, 1);
    assert.ok(document.sca.project);

    const roundTrip = JSON.parse(JSON.stringify(document));
    const restored = deserializeSsprojScaBlock(roundTrip.sca);

    assert.equal(restored.hotspots.length, 2);
    assert.equal(stringifyProjectJson(restored, false), stringifyProjectJson(source, false));
    console.log('[sca-ssproj-persistence] document.json shape PASS');
};

async function main() {
    runPersistenceTests();
    runAnimationPersistenceTest();
    runDocumentJsonShapeTest();
    console.log('\n========== SCA SSPROJ PERSISTENCE TEST REPORT ==========');
    console.log('Module round-trip: PASS');
    console.log('Animation round-trip: PASS');
    console.log('Missing SCA block: PASS');
    console.log('Unsupported version: PASS');
    console.log('Runtime project.json equivalence: PASS');
    console.log('document.json sca namespace: PASS');
    console.log('=======================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
