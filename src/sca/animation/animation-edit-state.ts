import { ScaRigNodeAnimationProperty } from '../types/animation';
import { ScaRigVec3 } from '../types/rig';

type ScaAnimationEditOverride = {
    nodeId: string;
    property: ScaRigNodeAnimationProperty;
    value: ScaRigVec3;
};

let animationEditMode = false;
let animationEditOverride: ScaAnimationEditOverride | null = null;

const setAnimationEditMode = (enabled: boolean): void => {
    animationEditMode = enabled;
    if (!enabled) {
        animationEditOverride = null;
    }
};

const getAnimationEditMode = (): boolean => {
    return animationEditMode;
};

const setAnimationEditOverride = (override: ScaAnimationEditOverride | null): void => {
    animationEditOverride = override ?
        {
            nodeId: override.nodeId,
            property: override.property,
            value: [...override.value] as ScaRigVec3
        } :
        null;
};

const getAnimationEditOverride = (): ScaAnimationEditOverride | null => {
    if (!animationEditOverride) {
        return null;
    }

    return {
        nodeId: animationEditOverride.nodeId,
        property: animationEditOverride.property,
        value: [...animationEditOverride.value] as ScaRigVec3
    };
};

const clearAnimationEditOverride = (): void => {
    animationEditOverride = null;
};

export {
    ScaAnimationEditOverride,
    clearAnimationEditOverride,
    getAnimationEditMode,
    getAnimationEditOverride,
    setAnimationEditMode,
    setAnimationEditOverride
};
