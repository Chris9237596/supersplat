import { Button, Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaPanel } from './sca-panel';
import { ScaLayoutController } from './ui/layout/sca-layout-controller';
import { ScaLayoutManager } from './ui/layout/sca-layout-state';
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
    canvasContainer.append(scaNavigator);
    canvasContainer.append(scaPanel);
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

    rightToolbar.append(new Element({ class: 'right-toolbar-separator' }));
    rightToolbar.append(scaButton);
    rightToolbar.append(navigatorToggleButton);
    rightToolbar.append(inspectorToggleButton);
    console.log('[SCA UI] button appended');

    new ScaLayoutController({
        events,
        tooltips,
        layout,
        navigator: scaNavigator,
        inspector: scaPanel,
        workspaceButton: scaButton,
        navigatorToggleButton,
        inspectorToggleButton
    });
};

export { registerScaUi };
