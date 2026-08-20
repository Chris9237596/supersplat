import {
    Button,
    Container,
    Label,
    VectorInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import { ScaFocusPosition } from '../focus/sca-focus-state';

class ScaFocusPanel extends Container {
    private syncing = false;

    private modeButton: Button;
    private positionInput: VectorInput;

    constructor(private events: Events, args = {}) {
        args = {
            ...args,
            class: 'sca-focus-panel'
        };

        super(args);

        const header = new Container({ class: 'sca-focus-panel-header' });
        const title = new Label({
            class: 'sca-panel-section-label',
            text: 'Focus'
        });

        this.modeButton = new Button({
            class: ['sca-focus-mode-button'],
            text: 'Focus Mode: OFF'
        });

        header.append(title);
        header.append(this.modeButton);

        const positionRow = new Container({ class: 'sca-hotspot-form-row' });
        const positionLabel = new Label({
            class: 'sca-hotspot-form-label',
            text: 'Focus Position'
        });
        this.positionInput = new VectorInput({
            class: 'sca-hotspot-form-vector',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0]
        });
        positionRow.append(positionLabel);
        positionRow.append(this.positionInput);

        const copyButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-focus-action-button'],
            text: 'Copy'
        });

        const useForHotspotButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-focus-action-button'],
            text: 'Use for selected hotspot'
        });

        const resetOriginButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-focus-action-button'],
            text: 'Reset Focus to Origin'
        });

        const clearButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-focus-action-button'],
            text: 'Clear Focus'
        });

        this.append(header);
        this.append(positionRow);
        this.append(copyButton);
        this.append(useForHotspotButton);
        this.append(resetOriginButton);
        this.append(clearButton);

        this.modeButton.on('click', () => {
            this.events.fire('sca.focus.mode.toggle');
        });

        this.positionInput.on('change', (value: number[]) => {
            if (this.syncing) {
                return;
            }
            const position = [value[0], value[1], value[2]] as ScaFocusPosition;
            this.events.fire('sca.focus.position.set', position);
        });

        copyButton.on('click', async () => {
            const position = this.events.invoke('sca.focus.position') as ScaFocusPosition | null;
            if (!position) {
                return;
            }

            const text = `${position[0]}, ${position[1]}, ${position[2]}`;
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                // clipboard may be unavailable
            }
        });

        useForHotspotButton.on('click', () => {
            this.events.fire('sca.focus.useForSelectedHotspot');
        });

        resetOriginButton.on('click', () => {
            this.events.fire('sca.focus.position.set', [0, 0, 0] as ScaFocusPosition);
        });

        clearButton.on('click', () => {
            this.events.fire('sca.focus.clear');
        });

        events.on('sca.focus.changed', () => {
            this.refresh();
        });

        this.refresh();
    }

    private refresh(): void {
        const modeActive = this.events.invoke('sca.focus.mode') as boolean;
        const position = this.events.invoke('sca.focus.position') as ScaFocusPosition | null;

        this.modeButton.text = modeActive ? 'Focus Mode: ON' : 'Focus Mode: OFF';
        this.modeButton.class.toggle('active', modeActive);

        this.syncing = true;
        this.positionInput.value = position ? [...position] : [0, 0, 0];
        this.positionInput.enabled = !!position;
        this.syncing = false;
    }
}

export { ScaFocusPanel };
