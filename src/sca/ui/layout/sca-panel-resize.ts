import { Container } from '@playcanvas/pcui';

type HorizontalResizeSide = 'left' | 'right';

type AttachHorizontalResizeOptions = {
    panel: Container;
    side: HorizontalResizeSide;
    getWidth: () => number;
    setWidth: (width: number) => void;
    onResizeEnd: (width: number) => void;
    clampWidth: (width: number) => number;
};

const RESIZE_BODY_CLASS = 'sca-ui-panel-resizing';

const attachHorizontalResizeHandle = (options: AttachHorizontalResizeOptions): Container => {
    const handle = new Container({
        class: [
            'sca-panel-resize-handle',
            options.side === 'left' ?
                'sca-panel-resize-handle-left' :
                'sca-panel-resize-handle-right'
        ]
    });

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let activePointerId: number | null = null;

    const finishDrag = (event: PointerEvent) => {
        if (!dragging || activePointerId !== event.pointerId) {
            return;
        }

        dragging = false;
        activePointerId = null;
        handle.class.remove('is-dragging');
        document.body.classList.remove(RESIZE_BODY_CLASS);
        document.body.style.removeProperty('cursor');

        if (handle.dom.hasPointerCapture(event.pointerId)) {
            handle.dom.releasePointerCapture(event.pointerId);
        }

        options.onResizeEnd(options.getWidth());
    };

    handle.dom.addEventListener('pointerdown', (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();

        dragging = true;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startWidth = options.getWidth();
        handle.class.add('is-dragging');
        document.body.classList.add(RESIZE_BODY_CLASS);
        document.body.style.cursor = 'ew-resize';
        handle.dom.setPointerCapture(event.pointerId);
    });

    handle.dom.addEventListener('pointermove', (event: PointerEvent) => {
        if (!dragging || activePointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const delta = event.clientX - startX;
        const rawWidth = options.side === 'right' ?
            startWidth + delta :
            startWidth - delta;

        options.setWidth(options.clampWidth(rawWidth));
    });

    handle.dom.addEventListener('pointerup', finishDrag);
    handle.dom.addEventListener('pointercancel', finishDrag);

    options.panel.append(handle);
    return handle;
};

export {
    RESIZE_BODY_CLASS,
    attachHorizontalResizeHandle
};
