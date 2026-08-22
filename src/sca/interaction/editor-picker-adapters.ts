import { Mat4, Vec3, Vec4 } from 'playcanvas';

import { ElementType } from '../../element';
import { Events } from '../../events';
import { Scene } from '../../scene';
import { Splat } from '../../splat';

import { ensureScaSplatId } from '../regions/splat-identity';

const INVALID_PICK_ID = 0xffffffff;

type EditorPickResult = {
    gaussianIndex: number;
    scaSplatId: string;
};

type EditorPickerBackend = 'gpu' | 'centers';

interface EditorPickerAdapter {
    readonly backendId: EditorPickerBackend;
    isAvailable(): boolean;
    pick(nx: number, ny: number): Promise<EditorPickResult | null>;
}

const vec4 = new Vec4();
const mat = new Mat4();
const localPos = new Vec3();
const worldPos = new Vec3();

class EditorGpuPickerAdapter implements EditorPickerAdapter {
    readonly backendId = 'gpu' as const;

    constructor(
        private readonly events: Events,
        private readonly scene: Scene
    ) {}

    isAvailable(): boolean {
        return this.events.invoke('camera.mode') === 'rings';
    }

    async pick(nx: number, ny: number): Promise<EditorPickResult | null> {
        const targetSize = this.scene.targetSize;
        if (!targetSize?.width || !targetSize?.height) {
            return null;
        }

        const { width, height } = targetSize;
        const splats = this.scene.getElementsByType(ElementType.splat) as Splat[];

        for (let i = 0; i < splats.length; i++) {
            const splat = splats[i];
            if (!splat.visible || !splat.entity.enabled) {
                continue;
            }

            this.scene.camera.pickPrep(splat, 'set');
            const pickResult = await this.scene.camera.pickRect(nx, ny, 1 / width, 1 / height);
            const gaussianIndex = pickResult[0];

            if (gaussianIndex === undefined || gaussianIndex === INVALID_PICK_ID) {
                continue;
            }

            return {
                gaussianIndex,
                scaSplatId: ensureScaSplatId(splat, this.scene)
            };
        }

        return null;
    }
}

class EditorCentersPickerAdapter implements EditorPickerAdapter {
    readonly backendId = 'centers' as const;

    constructor(
        private readonly events: Events,
        private readonly scene: Scene
    ) {}

    isAvailable(): boolean {
        const mode = this.events.invoke('camera.mode');
        return mode !== 'rings';
    }

    async pick(nx: number, ny: number): Promise<EditorPickResult | null> {
        const targetSize = this.scene.targetSize;
        if (!targetSize?.width || !targetSize?.height) {
            return null;
        }

        const { width, height } = targetSize;
        const splatSize = this.events.invoke('camera.splatSize') as number;
        if (!Number.isFinite(splatSize) || splatSize <= 0) {
            return null;
        }

        const sx = nx * width;
        const sy = ny * height;
        const camera = this.scene.camera.camera;
        const cameraPos = this.scene.camera.position;

        let bestHit: EditorPickResult | null = null;
        let bestDistanceSq = Infinity;

        const splats = this.scene.getElementsByType(ElementType.splat) as Splat[];
        for (let s = 0; s < splats.length; s++) {
            const splat = splats[s];
            if (!splat.visible || !splat.entity.enabled) {
                continue;
            }

            const splatData = splat.splatData;
            const x = splatData.getProp('x');
            const y = splatData.getProp('y');
            const z = splatData.getProp('z');
            const numSplats = splatData.numSplats;

            mat.mul2(camera.camera._viewProjMat, splat.worldTransform);

            for (let i = 0; i < numSplats; i++) {
                vec4.set(x[i], y[i], z[i], 1.0);
                mat.transformVec4(vec4, vec4);
                if (Math.abs(vec4.w) < 1e-8) {
                    continue;
                }

                const px = (vec4.x / vec4.w * 0.5 + 0.5) * width;
                const py = (-vec4.y / vec4.w * 0.5 + 0.5) * height;
                if (Math.abs(px - sx) >= splatSize || Math.abs(py - sy) >= splatSize) {
                    continue;
                }

                localPos.set(x[i], y[i], z[i]);
                splat.worldTransform.transformPoint(localPos, worldPos);
                const distanceSq = worldPos.distance(cameraPos);

                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    bestHit = {
                        gaussianIndex: i,
                        scaSplatId: ensureScaSplatId(splat, this.scene)
                    };
                }
            }
        }

        return bestHit;
    }
}

const createEditorPickerAdapter = (events: Events, scene: Scene): EditorPickerAdapter => {
    if (events.invoke('camera.mode') === 'rings') {
        return new EditorGpuPickerAdapter(events, scene);
    }
    return new EditorCentersPickerAdapter(events, scene);
};

export {
    EditorCentersPickerAdapter,
    EditorGpuPickerAdapter,
    EditorPickResult,
    EditorPickerAdapter,
    EditorPickerBackend,
    createEditorPickerAdapter
};
