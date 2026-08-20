import {
    BooleanInput,
    Button,
    Container,
    Label,
    TextAreaInput,
    TextInput,
    VectorInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import { defaultCameraForHotspot } from '../hotspot-defaults';
import { ScaHotspot } from '../types/project';

class ScaHotspotForm extends Container {
    private selectedId: string | null = null;
    private syncing = false;

    private idValue: Label;
    private nameInput: TextInput;
    private textInput: TextAreaInput;
    private enabledInput: BooleanInput;
    private positionInput: VectorInput;

    constructor(private events: Events, args = {}) {
        args = {
            ...args,
            class: 'sca-hotspot-form',
            hidden: true
        };

        super(args);

        const title = new Label({
            class: 'sca-panel-section-label',
            text: 'Selected Hotspot'
        });

        const idRow = new Container({ class: 'sca-hotspot-form-row' });
        const idLabelTitle = new Label({ class: 'sca-hotspot-form-label', text: 'ID' });
        this.idValue = new Label({ class: 'sca-hotspot-form-id' });
        idRow.append(idLabelTitle);
        idRow.append(this.idValue);

        const nameRow = new Container({ class: 'sca-hotspot-form-row' });
        const nameLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Name' });
        this.nameInput = new TextInput({ class: 'sca-hotspot-form-input' });
        nameRow.append(nameLabel);
        nameRow.append(this.nameInput);

        const textRow = new Container({
            class: ['sca-hotspot-form-row', 'sca-hotspot-form-row-multiline']
        });
        const textLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Text' });
        this.textInput = new TextAreaInput({ class: 'sca-hotspot-form-textarea' });
        textRow.append(textLabel);
        textRow.append(this.textInput);

        const enabledRow = new Container({ class: 'sca-hotspot-form-row' });
        const enabledLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Enabled' });
        this.enabledInput = new BooleanInput({
            class: 'sca-hotspot-form-toggle',
            type: 'toggle',
            value: true
        });
        enabledRow.append(enabledLabel);
        enabledRow.append(this.enabledInput);

        const positionRow = new Container({ class: 'sca-hotspot-form-row' });
        const positionLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Position' });
        this.positionInput = new VectorInput({
            class: 'sca-hotspot-form-vector',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0]
        });
        positionRow.append(positionLabel);
        positionRow.append(this.positionInput);

        const placeButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-hotspot-form-place'],
            text: 'Place Hotspot'
        });

        const deleteButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-hotspot-form-delete'],
            text: 'Delete Hotspot'
        });

        this.append(title);
        this.append(idRow);
        this.append(nameRow);
        this.append(textRow);
        this.append(enabledRow);
        this.append(positionRow);
        this.append(placeButton);
        this.append(deleteButton);

        this.nameInput.on('change', (value: string) => {
            this.updateSelected({ name: value });
        });

        this.textInput.on('change', (value: string) => {
            this.updateSelected({ text: value });
        });

        this.enabledInput.on('change', (value: boolean) => {
            this.updateSelected({ enabled: value });
        });

        this.positionInput.on('change', (value: number[]) => {
            const position = [value[0], value[1], value[2]] as ScaHotspot['position'];
            this.updateSelected({
                position,
                camera: defaultCameraForHotspot(position)
            });
        });

        placeButton.on('click', () => {
            if (!this.selectedId) {
                return;
            }
            this.events.fire('sca.hotspot.place.start');
        });

        events.on('tool.activated', (toolName: string) => {
            if (toolName === 'scaHotspotPlace') {
                placeButton.class.add('active');
            }
        });

        events.on('tool.deactivated', (toolName: string) => {
            if (toolName === 'scaHotspotPlace') {
                placeButton.class.remove('active');
            }
        });

        events.on('sca.project.changed', () => {
            if (!this.selectedId || this.syncing) {
                return;
            }

            const hotspot = this.events.invoke('sca.hotspot.get', this.selectedId) as ScaHotspot | null;
            if (!hotspot) {
                return;
            }

            this.syncing = true;
            this.positionInput.value = [...hotspot.position];
            this.syncing = false;
        });

        deleteButton.on('click', async () => {
            if (!this.selectedId) {
                return;
            }

            const hotspot = this.events.invoke('sca.hotspot.get', this.selectedId) as ScaHotspot | null;
            const hotspotName = hotspot?.name ?? this.selectedId;

            const result = await this.events.invoke('showPopup', {
                type: 'yesno',
                header: 'Delete Hotspot',
                message: `Delete hotspot "${hotspotName}"? This cannot be undone.`
            });

            if (result?.action === 'yes') {
                this.events.fire('sca.hotspot.delete', this.selectedId);
            }
        });
    }

    loadHotspot(hotspot: ScaHotspot | null): void {
        this.selectedId = hotspot?.id ?? null;
        this.hidden = !hotspot;

        if (!hotspot) {
            return;
        }

        this.syncing = true;
        this.idValue.text = hotspot.id;
        this.nameInput.value = hotspot.name;
        this.textInput.value = hotspot.text;
        this.enabledInput.value = hotspot.enabled;
        this.positionInput.value = [...hotspot.position];
        this.syncing = false;
    }

    private updateSelected(patch: Partial<ScaHotspot>): void {
        if (this.syncing || !this.selectedId) {
            return;
        }

        this.events.fire('sca.hotspot.update', this.selectedId, patch);
    }
}

export { ScaHotspotForm };
