import { ElementType } from '../../element';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { generateSplatId } from '../ids/generate-splat-id';

const collectScaSplatIds = (scene: Scene): Set<string> => {
    const ids = new Set<string>();
    const splats = scene.getElementsByType(ElementType.splat) as Splat[];

    for (const splat of splats) {
        if (splat.scaSplatId) {
            ids.add(splat.scaSplatId);
        }
    }

    return ids;
};

const ensureScaSplatId = (splat: Splat, scene: Scene): string => {
    if (splat.scaSplatId) {
        return splat.scaSplatId;
    }

    const existing = collectScaSplatIds(scene);
    const id = generateSplatId(existing);
    splat.scaSplatId = id;
    return id;
};

const findSplatByScaSplatId = (scene: Scene, scaSplatId: string): Splat | null => {
    const splats = scene.getElementsByType(ElementType.splat) as Splat[];

    for (const splat of splats) {
        if (splat.scaSplatId === scaSplatId) {
            return splat;
        }
    }

    return null;
};

const stripScaSplatId = (splat: Splat): void => {
    splat.scaSplatId = undefined;
};

export {
    collectScaSplatIds,
    ensureScaSplatId,
    findSplatByScaSplatId,
    stripScaSplatId
};
