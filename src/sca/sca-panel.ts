import { Container, Label } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

class ScaPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'sca-panel',
            class: 'panel',
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = new Container({
            class: 'panel-header'
        });

        const title = new Label({
            class: 'panel-header-label',
            text: 'SCA'
        });

        const closeButton = new Container({
            class: 'panel-header-button'
        });

        const closeLabel = new Label({
            text: '\u00D7'
        });

        closeButton.append(closeLabel);

        header.append(title);
        header.append(new Label({ class: 'panel-header-spacer' }));
        header.append(closeButton);

        const body = new Label({
            class: 'sca-panel-body',
            text: 'SCA Authoring'
        });

        this.append(header);
        this.append(body);

        closeButton.on('click', () => {
            events.fire('scaPanel.setVisible', false);
        });

        tooltips.register(closeButton, () => 'Close', 'left');

        const setVisible = (visible: boolean) => {
            if (visible === this.hidden) {
                this.hidden = !visible;
                events.fire('scaPanel.visible', visible);
            }
        };

        events.function('scaPanel.visible', () => {
            return !this.hidden;
        });

        events.on('scaPanel.setVisible', (visible: boolean) => {
            setVisible(visible);
        });

        events.on('scaPanel.toggleVisible', () => {
            setVisible(this.hidden);
        });
    }
}

export { ScaPanel };
