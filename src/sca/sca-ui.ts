import { Button, Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaPanel } from './sca-panel';
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

    rightToolbar.append(new Element({ class: 'right-toolbar-separator' }));
    rightToolbar.append(scaButton);
    console.log('[SCA UI] button appended');

    tooltips.register(scaButton, () => 'SCA', 'left');

    scaButton.on('click', () => {
        events.fire('scaPanel.toggleVisible');
    });

    events.on('scaPanel.visible', (visible: boolean) => {
        scaButton.class[visible ? 'add' : 'remove']('active');
        scaNavigator.hidden = !visible;
    });
};

export { registerScaUi };
