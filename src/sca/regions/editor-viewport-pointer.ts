const getViewportCanvas = (container: HTMLElement): HTMLCanvasElement | null => {
    const canvas = container.querySelector('canvas#canvas');
    return canvas instanceof HTMLCanvasElement ? canvas : null;
};

/**
 * True when the topmost element under the pointer is the WebGL viewport canvas.
 * Overlays (SCA panel, toolbars, PCUI controls) are excluded.
 */
const isPointerOnViewportCanvas = (
    event: PointerEvent,
    canvas: HTMLCanvasElement | null
): boolean => {
    if (!canvas) {
        return false;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    return target === canvas;
};

export {
    getViewportCanvas,
    isPointerOnViewportCanvas
};
