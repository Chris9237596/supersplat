import { ScaAnimationClip } from '../types/animation';
import { ScaRig } from '../types/rig';

import { applyRigAnimationToPose } from '../rig/rig-animation';
import { evaluateRigPose, ScaRigEvaluatedPose } from '../rig/rig-pose';

const evaluateRuntimeRigPose = (
    rig: ScaRig,
    clip: ScaAnimationClip | null,
    currentTime: number
): ScaRigEvaluatedPose => {
    const basePose = evaluateRigPose(rig);
    if (!clip) {
        return basePose;
    }

    return applyRigAnimationToPose(basePose, rig, clip, currentTime);
};

export { evaluateRuntimeRigPose };
