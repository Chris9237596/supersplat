export type ScaFocusPosition = [number, number, number];

class ScaFocusState {
    modeActive = false;
    position: ScaFocusPosition | null = null;

    setMode(active: boolean): void {
        this.modeActive = active;
    }

    isModeActive(): boolean {
        return this.modeActive;
    }

    setPosition(position: ScaFocusPosition): void {
        this.position = [position[0], position[1], position[2]];
    }

    getPosition(): ScaFocusPosition | null {
        return this.position ? [...this.position] as ScaFocusPosition : null;
    }

    hasPosition(): boolean {
        return this.position !== null;
    }

    clear(): void {
        this.position = null;
    }
}

export { ScaFocusState };
