import { Vec3 } from 'playcanvas';

import { Events } from '../../events';
import { ScaCameraPose, ScaViewerCamera, Vec3 as ScaVec3 } from '../types/project';

type EditorCameraPose = {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
};

const toScaVec3 = (value: { x: number; y: number; z: number }): ScaVec3 => {
    return [value.x, value.y, value.z];
};

const toScaCameraPose = (pose: EditorCameraPose): ScaCameraPose => ({
    position: toScaVec3(pose.position),
    target: toScaVec3(pose.target),
    fov: pose.fov
});

const captureCurrentView = (events: Events): ScaCameraPose => {
    const pose = events.invoke('camera.getPose') as EditorCameraPose | null;
    if (!pose?.position || !pose?.target) {
        throw new Error('[SCA] unable to capture current editor camera pose');
    }

    return toScaCameraPose(pose);
};

const applyCameraPose = (events: Events, pose: ScaCameraPose, speed = 0): void => {
    events.fire('camera.setPose', {
        position: new Vec3(pose.position[0], pose.position[1], pose.position[2]),
        target: new Vec3(pose.target[0], pose.target[1], pose.target[2]),
        fov: pose.fov
    }, speed);
};

const applyViewerInitialCamera = (events: Events, camera: ScaViewerCamera, speed = 0): void => {
    applyCameraPose(events, camera.initial, speed);
};

export {
    applyCameraPose,
    applyViewerInitialCamera,
    captureCurrentView,
    toScaCameraPose
};
