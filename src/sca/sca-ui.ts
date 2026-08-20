import { Button, Container, Element } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaPanel } from './sca-panel';

const registerScaUi = (
    events: Events,
    tooltips: Tooltips,
    canvasContainer: Container,
    rightToolbar: Container
) => {
    console.log('[SCA UI] registerScaUi called');

    const scaPanel = new ScaPanel(events, tooltips);
    canvasContainer.append(scaPanel);
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
    });
};

export { registerScaUi };
