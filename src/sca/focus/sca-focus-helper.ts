import { Vec3 } from 'playcanvas';

import { Scene } from '../../scene';
import { ToolOverlay, OverlayWriter } from '../../tool-overlay';

import { ScaFocusPosition, ScaFocusState } from './sca-focus-state';

const axis = new Vec3();
const p0 = new Vec3();
const p1 = new Vec3();

const CROSSHAIR_ARM = 0.08;

class ScaFocusHelper {
    private overlay: ToolOverlay;
    private visible = false;
    private modeActive = false;
    private position: ScaFocusPosition | null = null;

    constructor(private scene: Scene) {
        this.overlay = new ToolOverlay();
        this.overlay.provider = (writer: OverlayWriter) => {
            if (!this.visible || !this.position) {
                return;
            }

            const [x, y, z] = this.position;
            p0.set(x, y, z);
            writer.dot(p0);

            const arms = [
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1]
            ] as const;

            for (const [ax, ay, az] of arms) {
                axis.set(ax, ay, az).mulScalar(CROSSHAIR_ARM * 0.5);
                p0.set(x, y, z).sub(axis);
                p1.set(x, y, z).add(axis);
                writer.segment(p0, p1);
            }
        };

        scene.add(this.overlay);
    }

    sync(state: ScaFocusState): void {
        this.modeActive = state.isModeActive();
        this.position = state.getPosition();
        this.visible = state.hasPosition();
        if (this.visible) {
            console.log('[SCA Focus] helper shown', this.position);
        }
        this.scene.forceRender = true;
    }

    destroy(): void {
        this.overlay.destroy();
    }
}

export { ScaFocusHelper };
