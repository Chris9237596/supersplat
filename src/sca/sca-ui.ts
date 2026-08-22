import { Button, Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaPanel } from './sca-panel';
import { ScaAnimationTimelinePanel } from './ui/sca-animation-timeline-panel';
import { ScaLayoutController } from './ui/layout/sca-layout-controller';
import { ScaLayoutManager, clampTimelineHeight } from './ui/layout/sca-layout-state';
import { ScaNavigatorPanel } from './ui/navigator/sca-navigator-panel';
import { registerScaBackgroundPreview } from './ui/register-sca-background-preview';
import { registerScaRuntimeViewerPreviewUi } from './ui/sca-runtime-viewer-preview-ui';
import { ScaAssetStore } from './store/sca-asset-store';

const registerScaUi = (
    events: Events,
    tooltips: Tooltips,
    canvasContainer: Container,
    rightToolbar: Container,
    assetStore: ScaAssetStore
) => {
    console.log('[SCA UI] registerScaUi called');

    const layout = new ScaLayoutManager();
    const scaNavigator = new ScaNavigatorPanel(events);
    const scaPanel = new ScaPanel(events, tooltips);
    const scaTimeline = new ScaAnimationTimelinePanel(events);
    canvasContainer.append(scaNavigator);
    canvasContainer.append(scaPanel);
    document.body.appendChild(scaTimeline.dom);
    registerScaBackgroundPreview(events, canvasContainer, assetStore);
    registerScaRuntimeViewerPreviewUi(events, canvasContainer);
    console.log('[SCA UI] panel appended');

    const scaButton = new Button({
        id: 'right-toolbar-sca-panel',
        class: ['right-toolbar-toggle', 'sca-toolbar-button'],
        text: 'SCA'
    });

    const navigatorToggleButton = new Button({
        id: 'right-toolbar-sca-navigator',
        class: ['right-toolbar-toggle', 'sca-toolbar-button', 'sca-toolbar-button-nav'],
        text: 'Nav'
    });

    const inspectorToggleButton = new Button({
        id: 'right-toolbar-sca-inspector',
        class: ['right-toolbar-toggle', 'sca-toolbar-button', 'sca-toolbar-button-insp'],
        text: 'Insp'
    });

    const timelineToggleButton = new Button({
        id: 'right-toolbar-sca-timeline',
        class: ['right-toolbar-toggle', 'sca-toolbar-button', 'sca-toolbar-button-timeline'],
        text: 'Time'
    });

    rightToolbar.append(new Element({ class: 'right-toolbar-separator' }));
    rightToolbar.append(scaButton);
    rightToolbar.append(navigatorToggleButton);
    rightToolbar.append(inspectorToggleButton);
    rightToolbar.append(timelineToggleButton);
    console.log('[SCA UI] button appended');

    new ScaLayoutController({
        events,
        tooltips,
        layout,
        navigator: scaNavigator,
        inspector: scaPanel,
        timeline: scaTimeline,
        workspaceButton: scaButton,
        navigatorToggleButton,
        inspectorToggleButton,
        timelineToggleButton
    });
};

export { registerScaUi };
