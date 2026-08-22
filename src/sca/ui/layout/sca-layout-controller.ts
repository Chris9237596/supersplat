import { Button, Container } from '@playcanvas/pcui';

import { Events } from '../../../events';
import { Tooltips } from '../../../ui/tooltips';

import { ScaPanel } from '../../sca-panel';
import { ScaAnimationTimelinePanel } from '../sca-animation-timeline-panel';
import { ScaNavigatorPanel } from '../navigator/sca-navigator-panel';

import { attachHorizontalResizeHandle } from './sca-panel-resize';
import {
    ScaLayoutManager,
    clampNavigatorWidth,
    clampInspectorWidth,
    clampTimelineHeight
} from './sca-layout-state';

type ScaLayoutControllerOptions = {
    events: Events;
    tooltips: Tooltips;
    layout: ScaLayoutManager;
    navigator: ScaNavigatorPanel;
    inspector: ScaPanel;
    timeline: ScaAnimationTimelinePanel;
    workspaceButton: Button;
    navigatorToggleButton: Button;
    inspectorToggleButton: Button;
    timelineToggleButton: Button;
};

class ScaLayoutController {
    private navigatorWidth = 0;

    private inspectorWidth = 0;

    private timelineHeight = 0;

    private timelineResizeHandle: HTMLDivElement;

    constructor(private options: ScaLayoutControllerOptions) {
        this.timelineResizeHandle = document.createElement('div');
        this.timelineResizeHandle.id = 'sca-animation-timeline-resize-handle';
        document.body.appendChild(this.timelineResizeHandle);

        this.bindVisibilityEvents();
        this.bindResizeHandles();
        this.bindToolbarButtons();
        this.bindWindowResize();

        this.applyLayoutFromState();
        this.syncToolbarState();
    }

    private getViewportWidth(): number {
        return window.innerWidth;
    }

    private getViewportHeight(): number {
        return window.innerHeight;
    }

    private applyLayoutFromState(): void {
        const clamped = this.options.layout.getClamped(this.getViewportWidth(), this.getViewportHeight());
        this.navigatorWidth = clamped.navigatorWidth;
        this.inspectorWidth = clamped.inspectorWidth;
        this.timelineHeight = clamped.timelineHeight;

        this.setNavigatorVisible(clamped.navigatorVisible, false);
        this.setInspectorVisible(clamped.inspectorVisible, false);
        this.setTimelineVisible(clamped.timelineVisible, false);
        this.applyPanelWidths();
        this.applyTimelineLayout();
    }

    private applyPanelWidths(): void {
        this.options.navigator.dom.style.width = `${this.navigatorWidth}px`;
        this.options.inspector.dom.style.width = `${this.inspectorWidth}px`;
    }

    private applyTimelineLayout(): void {
        const visible = !this.options.timeline.hidden;
        this.options.timeline.setPanelHeight(this.timelineHeight);
        this.options.timeline.dom.style.height = `${this.timelineHeight}px`;
        this.timelineResizeHandle.style.display = visible ? 'block' : 'none';
        this.timelineResizeHandle.style.bottom = `${this.timelineHeight}px`;
        document.body.style.paddingBottom = visible ? `${this.timelineHeight}px` : '0px';
    }

    private clampNavigatorWidth(width: number): number {
        return clampNavigatorWidth(width, this.getViewportWidth());
    }

    private clampInspectorWidth(width: number): number {
        return clampInspectorWidth(width, this.getViewportWidth());
    }

    private clampBothForViewport(): void {
        const clamped = this.options.layout.getClamped(this.getViewportWidth(), this.getViewportHeight());
        this.navigatorWidth = clamped.navigatorWidth;
        this.inspectorWidth = clamped.inspectorWidth;
        this.timelineHeight = clamped.timelineHeight;
        this.applyPanelWidths();
        this.applyTimelineLayout();
    }

    private setNavigatorVisible(visible: boolean, persist: boolean): void {
        if (this.options.navigator.hidden === !visible) {
            if (persist) {
                this.options.layout.setNavigatorVisible(visible);
            }
            this.syncToolbarState();
            return;
        }

        this.options.navigator.hidden = !visible;
        this.options.events.fire('scaNavigator.visible', visible);

        if (persist) {
            this.options.layout.setNavigatorVisible(visible);
        }

        this.syncToolbarState();
    }

    private setInspectorVisible(visible: boolean, persist: boolean): void {
        if (this.options.inspector.hidden === !visible) {
            if (persist) {
                this.options.layout.setInspectorVisible(visible);
            }
            this.syncToolbarState();
            return;
        }

        this.options.inspector.hidden = !visible;
        this.options.events.fire('scaPanel.visible', visible);
        this.options.events.fire('scaInspector.visible', visible);

        if (persist) {
            this.options.layout.setInspectorVisible(visible);
        }

        this.syncToolbarState();
    }

    private setTimelineVisible(visible: boolean, persist: boolean): void {
        if (this.options.timeline.hidden === !visible) {
            if (persist) {
                this.options.layout.setTimelineVisible(visible);
            }
            this.applyTimelineLayout();
            this.syncToolbarState();
            return;
        }

        this.options.timeline.hidden = !visible;
        this.options.events.fire('scaTimeline.visible', visible);

        if (persist) {
            this.options.layout.setTimelineVisible(visible);
        }

        this.applyTimelineLayout();
        this.syncToolbarState();
        this.options.timeline.refresh();
    }

    private isWorkspaceVisible(): boolean {
        return !this.options.navigator.hidden || !this.options.inspector.hidden;
    }

    private syncToolbarState(): void {
        const workspaceVisible = this.isWorkspaceVisible();
        this.options.workspaceButton.class[workspaceVisible ? 'add' : 'remove']('active');
        this.options.navigatorToggleButton.class[
            !this.options.navigator.hidden ? 'add' : 'remove'
        ]('active');
        this.options.inspectorToggleButton.class[
            !this.options.inspector.hidden ? 'add' : 'remove'
        ]('active');
        this.options.timelineToggleButton.class[
            !this.options.timeline.hidden ? 'add' : 'remove'
        ]('active');
    }

    private bindVisibilityEvents(): void {
        const { events, layout } = this.options;

        events.function('scaNavigator.visible', () => {
            return !this.options.navigator.hidden;
        });

        events.on('scaNavigator.setVisible', (visible: boolean) => {
            this.setNavigatorVisible(visible, true);
        });

        events.on('scaNavigator.toggleVisible', () => {
            this.setNavigatorVisible(this.options.navigator.hidden, true);
        });

        events.function('scaInspector.visible', () => {
            return !this.options.inspector.hidden;
        });

        events.on('scaInspector.setVisible', (visible: boolean) => {
            this.setInspectorVisible(visible, true);
        });

        events.on('scaInspector.toggleVisible', () => {
            this.setInspectorVisible(this.options.inspector.hidden, true);
        });

        events.function('scaTimeline.visible', () => {
            return !this.options.timeline.hidden;
        });

        events.on('scaTimeline.setVisible', (visible: boolean) => {
            this.setTimelineVisible(visible, true);
        });

        events.on('scaTimeline.toggleVisible', () => {
            this.setTimelineVisible(this.options.timeline.hidden, true);
        });

        events.on('scaPanel.setVisible', (visible: boolean) => {
            this.setInspectorVisible(visible, true);
        });

        events.on('scaPanel.toggleVisible', () => {
            const saved = layout.get();
            const workspaceVisible = this.isWorkspaceVisible();

            if (workspaceVisible) {
                this.setNavigatorVisible(false, false);
                this.setInspectorVisible(false, false);
                return;
            }

            this.setNavigatorVisible(saved.navigatorVisible, false);
            this.setInspectorVisible(saved.inspectorVisible, false);
        });
    }

    private bindResizeHandles(): void {
        const { navigator, inspector, layout } = this.options;

        attachHorizontalResizeHandle({
            panel: navigator,
            side: 'right',
            getWidth: () => this.navigatorWidth,
            setWidth: (width) => {
                this.navigatorWidth = width;
                navigator.dom.style.width = `${width}px`;
            },
            clampWidth: (width) => this.clampNavigatorWidth(width),
            onResizeEnd: (width) => {
                layout.setNavigatorWidth(width, this.getViewportWidth());
                this.clampBothForViewport();
            }
        });

        attachHorizontalResizeHandle({
            panel: inspector,
            side: 'left',
            getWidth: () => this.inspectorWidth,
            setWidth: (width) => {
                this.inspectorWidth = width;
                inspector.dom.style.width = `${width}px`;
            },
            clampWidth: (width) => this.clampInspectorWidth(width),
            onResizeEnd: (width) => {
                layout.setInspectorWidth(width, this.getViewportWidth());
                this.clampBothForViewport();
            }
        });

        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        const onPointerMove = (event: PointerEvent) => {
            if (!dragging) {
                return;
            }

            const delta = startY - event.clientY;
            const nextHeight = clampTimelineHeight(startHeight + delta, this.getViewportHeight());
            this.timelineHeight = nextHeight;
            this.applyTimelineLayout();
            this.options.timeline.refresh();
        };

        const onPointerUp = (event: PointerEvent) => {
            if (!dragging) {
                return;
            }

            dragging = false;
            this.timelineResizeHandle.classList.remove('is-dragging');
            document.body.classList.remove('sca-ui-timeline-resizing');
            this.timelineResizeHandle.releasePointerCapture(event.pointerId);
            layout.setTimelineHeight(this.timelineHeight, this.getViewportHeight());
        };

        this.timelineResizeHandle.addEventListener('pointerdown', (event) => {
            if (this.options.timeline.hidden) {
                return;
            }

            dragging = true;
            startY = event.clientY;
            startHeight = this.timelineHeight;
            this.timelineResizeHandle.classList.add('is-dragging');
            document.body.classList.add('sca-ui-timeline-resizing');
            this.timelineResizeHandle.setPointerCapture(event.pointerId);
        });

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    private bindToolbarButtons(): void {
        const {
            workspaceButton,
            navigatorToggleButton,
            inspectorToggleButton,
            timelineToggleButton,
            tooltips
        } = this.options;

        tooltips.register(workspaceButton, () => 'Toggle SCA workspace', 'left');
        tooltips.register(navigatorToggleButton, () => 'Toggle Navigator', 'left');
        tooltips.register(inspectorToggleButton, () => 'Toggle Inspector', 'left');
        tooltips.register(timelineToggleButton, () => 'Toggle Animation Timeline', 'left');

        workspaceButton.on('click', () => {
            this.options.events.fire('scaPanel.toggleVisible');
        });

        navigatorToggleButton.on('click', () => {
            this.options.events.fire('scaNavigator.toggleVisible');
        });

        inspectorToggleButton.on('click', () => {
            this.options.events.fire('scaInspector.toggleVisible');
        });

        timelineToggleButton.on('click', () => {
            this.options.events.fire('scaTimeline.toggleVisible');
        });
    }

    private bindWindowResize(): void {
        window.addEventListener('resize', () => {
            this.clampBothForViewport();
        });
    }
}

export { ScaLayoutController };
