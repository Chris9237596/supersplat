import { ScaCameraPose, ScaTurntableAnimation, Vec3 } from '../types/project';

import { clonePose, computeFlyToStartPose } from './viewer-config';

/** Matches SuperSplat Viewer `easeOut` used for startup fly-to. */
const easeOut = (x: number): number => (1 - (2 ** (-10 * x))) / (1 - (2 ** -10));

const rotateOffsetY = (offset: Vec3, radians: number): Vec3 => {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
        offset[0] * cos + offset[2] * sin,
        offset[1],
        -offset[0] * sin + offset[2] * cos
    ];
};

const lerpVec3 = (from: Vec3, to: Vec3, t: number): Vec3 => {
    return [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t
    ];
};

const lerpPose = (from: ScaCameraPose, to: ScaCameraPose, t: number): ScaCameraPose => ({
    position: lerpVec3(from.position, to.position, t),
    target: lerpVec3(from.target, to.target, t),
    fov: from.fov + (to.fov - from.fov) * t
});

/**
 * Orbit camera position around a fixed target on the world Y axis.
 * Preserves distance, elevation, target, and FOV.
 */
const computeTurntablePose = (
    basePose: ScaCameraPose,
    elapsedSeconds: number,
    config: ScaTurntableAnimation
): ScaCameraPose => {
    const [tx, ty, tz] = basePose.target;
    const [px, py, pz] = basePose.position;
    const offset: Vec3 = [px - tx, py - ty, pz - tz];

    const direction = config.direction === 'counterclockwise' ? -1 : 1;
    const totalRadians = config.degrees * (Math.PI / 180) * direction;
    const duration = Math.max(config.duration, 1e-6);

    let progress = elapsedSeconds / duration;
    if (config.loop) {
        progress = progress % 1;
    } else {
        progress = Math.min(1, Math.max(0, progress));
    }

    const rotated = rotateOffsetY(offset, totalRadians * progress);

    return {
        position: [tx + rotated[0], ty + rotated[1], tz + rotated[2]],
        target: [...basePose.target] as Vec3,
        fov: basePose.fov
    };
};

const computeFlyToPose = (
    fromPose: ScaCameraPose,
    toPose: ScaCameraPose,
    elapsedSeconds: number,
    durationSeconds: number
): ScaCameraPose => {
    const duration = Math.max(durationSeconds, 1e-6);
    const t = Math.min(1, Math.max(0, elapsedSeconds / duration));
    return lerpPose(fromPose, toPose, easeOut(t));
};

const isTurntableComplete = (
    elapsedSeconds: number,
    config: ScaTurntableAnimation
): boolean => {
    return !config.loop && elapsedSeconds >= config.duration;
};

export {
    computeFlyToPose,
    computeFlyToStartPose,
    computeTurntablePose,
    easeOut,
    isTurntableComplete,
    lerpPose
};
