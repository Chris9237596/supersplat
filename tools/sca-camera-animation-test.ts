import assert from 'node:assert/strict';

import {
    computeFlyToPose,
    computeTurntablePose,
    isTurntableComplete
} from '../src/sca/viewer/camera-animation';
import { computeCameraDistance } from '../src/sca/viewer/viewer-config';

const basePose = {
    position: [2, 1, 0] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 60
};

const turntable = {
    duration: 10,
    direction: 'clockwise' as const,
    degrees: 360,
    loop: true
};

const distanceAt = (pose: { position: number[]; target: number[] }) => computeCameraDistance({
    position: pose.position as [number, number, number],
    target: pose.target as [number, number, number],
    fov: 60
});

const baseDistance = distanceAt(basePose);
const atZero = computeTurntablePose(basePose, 0, turntable);
const atQuarter = computeTurntablePose(basePose, 2.5, turntable);
const atHalf = computeTurntablePose(basePose, 5, turntable);

assert.ok(Math.abs(distanceAt(atZero) - baseDistance) < 1e-6, 'distance preserved at t=0');
assert.ok(Math.abs(distanceAt(atQuarter) - baseDistance) < 1e-6, 'distance preserved at t=0.25');
assert.ok(Math.abs(distanceAt(atHalf) - baseDistance) < 1e-6, 'distance preserved at t=0.5');
assert.deepEqual(atZero.target, basePose.target, 'target fixed at t=0');
assert.deepEqual(atHalf.target, basePose.target, 'target fixed at t=0.5');

const flyFrom = {
    position: [0, 2, -4] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 60
};
const flyTo = {
    position: [0, 1, -2] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 45
};

assert.deepEqual(
    computeFlyToPose(flyFrom, flyTo, 0, 1.5).position.map((v) => Math.round(v * 1000) / 1000),
    flyFrom.position.map((v) => Math.round(v * 1000) / 1000),
    'flyTo starts at from pose'
);

assert.deepEqual(
    computeFlyToPose(flyFrom, flyTo, 1.5, 1.5).position.map((v) => Math.round(v * 1000) / 1000),
    flyTo.position.map((v) => Math.round(v * 1000) / 1000),
    'flyTo ends at to pose'
);

assert.equal(isTurntableComplete(9, { ...turntable, loop: false }), false);
assert.equal(isTurntableComplete(10, { ...turntable, loop: false }), true);
assert.equal(isTurntableComplete(20, turntable), false);

console.log('sca-camera-animation-test: PASS');
