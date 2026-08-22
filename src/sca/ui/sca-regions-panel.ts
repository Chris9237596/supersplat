import {

    BooleanInput,

    Button,

    Container,

    Label,

    SliderInput,

    TextAreaInput,

    TextInput

} from '@playcanvas/pcui';



import { Events } from '../../events';



import { ScaRegion, ScaRegionPatch } from '../types/region';

import { DEFAULT_ACTIVE_TINT, DEFAULT_HOVER_TINT } from '../region-defaults';
import { createRegionTintControls } from './region-tint-controls';



class ScaRegionsPanel extends Container {

    private rowElements = new Map<string, Container>();

    private selectedId: string | null = null;

    private syncing = false;



    private listContainer: Container;

    private formContainer: Container;

    private idValue: Label;

    private nameInput: TextInput;

    private textInput: TextAreaInput;

    private enabledInput: BooleanInput;

    private clickableInput: BooleanInput;

    private showCardInput: BooleanInput;

    private showInNavigationInput: BooleanInput;

    private hoverTintControls: ReturnType<typeof createRegionTintControls>;

    private hoverStrengthInput: SliderInput;

    private activeTintControls: ReturnType<typeof createRegionTintControls>;

    private activeStrengthInput: SliderInput;

    private deleteButton: Button;

    private addSelectionButton: Button;

    private selectRegionGaussiansButton: Button;

    private replaceWithSelectionButton: Button;

    private removeSelectionButton: Button;



    constructor(private events: Events, args = {}) {

        args = {

            ...args,

            class: 'sca-regions-panel'

        };



        super(args);



        const listHeader = new Container({

            class: 'sca-hotspot-list-header'

        });



        const listTitle = new Label({

            class: 'sca-panel-section-label',

            text: 'Regions'

        });



        const addButton = new Button({

            class: 'sca-hotspot-add-button',

            text: '+ Region from Selection'

        });



        listHeader.append(listTitle);

        listHeader.append(addButton);



        this.listContainer = new Container({

            class: 'sca-hotspot-list'

        });



        this.formContainer = new Container({

            class: 'sca-hotspot-form',

            hidden: true

        });



        const formTitle = new Label({

            class: 'sca-panel-section-label',

            text: 'Selected Region'

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



        const clickableRow = new Container({ class: 'sca-hotspot-form-row' });

        const clickableLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Clickable' });

        this.clickableInput = new BooleanInput({

            class: 'sca-hotspot-form-toggle',

            type: 'toggle',

            value: true

        });

        clickableRow.append(clickableLabel);

        clickableRow.append(this.clickableInput);



        const showCardRow = new Container({ class: 'sca-hotspot-form-row' });

        const showCardLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Show Info Card' });

        this.showCardInput = new BooleanInput({

            class: 'sca-hotspot-form-toggle',

            type: 'toggle',

            value: true

        });

        showCardRow.append(showCardLabel);

        showCardRow.append(this.showCardInput);



        const showInNavigationRow = new Container({ class: 'sca-hotspot-form-row' });

        const showInNavigationLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Show in top navigation' });

        this.showInNavigationInput = new BooleanInput({

            class: 'sca-hotspot-form-toggle',

            type: 'toggle',

            value: true

        });

        showInNavigationRow.append(showInNavigationLabel);

        showInNavigationRow.append(this.showInNavigationInput);



        this.hoverTintControls = createRegionTintControls('Hover color', DEFAULT_HOVER_TINT);

        const hoverStrengthRow = new Container({ class: 'sca-hotspot-form-row' });

        const hoverStrengthLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Hover Strength' });

        this.hoverStrengthInput = new SliderInput({

            class: 'sca-hotspot-form-slider',

            min: 0,

            max: 1,

            step: 0.01,

            precision: 2

        });

        hoverStrengthRow.append(hoverStrengthLabel);

        hoverStrengthRow.append(this.hoverStrengthInput);



        this.activeTintControls = createRegionTintControls('Selected color', DEFAULT_ACTIVE_TINT);

        const activeStrengthRow = new Container({ class: 'sca-hotspot-form-row' });

        const activeStrengthLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Active Strength' });

        this.activeStrengthInput = new SliderInput({

            class: 'sca-hotspot-form-slider',

            min: 0,

            max: 1,

            step: 0.01,

            precision: 2

        });

        activeStrengthRow.append(activeStrengthLabel);

        activeStrengthRow.append(this.activeStrengthInput);



        this.deleteButton = new Button({

            class: ['sca-hotspot-form-button', 'sca-region-delete-button'],

            text: 'Delete Region'

        });

        this.addSelectionButton = new Button({

            class: ['sca-hotspot-form-button'],

            text: 'Add Selection to Region'

        });

        this.selectRegionGaussiansButton = new Button({

            class: ['sca-hotspot-form-button'],

            text: 'Select Region Gaussians'

        });

        this.replaceWithSelectionButton = new Button({

            class: ['sca-hotspot-form-button'],

            text: 'Replace Region with Selection'

        });

        this.removeSelectionButton = new Button({

            class: ['sca-hotspot-form-button'],

            text: 'Remove Selection from Region'

        });



        this.formContainer.append(formTitle);

        this.formContainer.append(idRow);

        this.formContainer.append(nameRow);

        this.formContainer.append(textRow);

        this.formContainer.append(enabledRow);

        this.formContainer.append(clickableRow);

        this.formContainer.append(showCardRow);

        this.formContainer.append(showInNavigationRow);

        this.formContainer.append(this.hoverTintControls.row);

        this.formContainer.append(hoverStrengthRow);

        this.formContainer.append(this.activeTintControls.row);

        this.formContainer.append(activeStrengthRow);

        this.formContainer.append(this.addSelectionButton);

        this.formContainer.append(this.selectRegionGaussiansButton);

        this.formContainer.append(this.replaceWithSelectionButton);

        this.formContainer.append(this.removeSelectionButton);

        this.formContainer.append(this.deleteButton);



        this.append(listHeader);

        this.append(this.listContainer);

        this.append(this.formContainer);



        addButton.on('click', () => {

            events.fire('sca.region.createFromSelection');

        });



        this.nameInput.on('change', () => {

            this.commitPatch({ name: this.nameInput.value });

        });



        this.textInput.on('change', () => {

            const text = this.textInput.value.trim();

            this.commitPatch({ text: text.length > 0 ? text : undefined });

        });



        this.enabledInput.on('change', () => {

            this.commitPatch({ enabled: this.enabledInput.value });

        });



        this.clickableInput.on('change', () => {

            this.commitPatch({

                interaction: {

                    clickable: this.clickableInput.value

                }

            });

        });



        this.showCardInput.on('change', () => {

            this.commitPatch({

                interaction: {

                    showCard: this.showCardInput.value

                }

            });

        });



        this.showInNavigationInput.on('change', () => {

            this.commitPatch({

                interaction: {

                    showInNavigation: this.showInNavigationInput.value

                }

            });

        });



        this.hoverTintControls.bind(events, (hoverTint) => {
            this.commitPatch({
                visual: { hoverTint }
            });
        });

        this.hoverStrengthInput.on('change', () => {

            this.commitPatch({

                visual: {

                    hoverOpacity: this.hoverStrengthInput.value

                }

            });

        });



        this.activeTintControls.bind(events, (activeTint) => {
            this.commitPatch({
                visual: { activeTint }
            });
        });

        this.activeStrengthInput.on('change', () => {

            this.commitPatch({

                visual: {

                    activeOpacity: this.activeStrengthInput.value

                }

            });

        });



        this.addSelectionButton.on('click', () => {

            if (this.selectedId) {

                events.fire('sca.region.addSelection', this.selectedId);

            }

        });



        this.selectRegionGaussiansButton.on('click', () => {

            if (this.selectedId) {

                events.fire('sca.region.selectGaussians', this.selectedId);

            }

        });



        this.replaceWithSelectionButton.on('click', () => {

            if (this.selectedId) {

                events.fire('sca.region.replaceWithSelection', this.selectedId);

            }

        });



        this.removeSelectionButton.on('click', () => {

            if (this.selectedId) {

                events.fire('sca.region.removeSelection', this.selectedId);

            }

        });



        this.deleteButton.on('click', () => {

            if (this.selectedId) {

                events.fire('sca.region.delete', this.selectedId);

            }

        });



        events.on('sca.project.changed', () => {

            this.refreshList();

            this.updateSelectGaussiansButton(this.selectedId);

            this.updateReplaceWithSelectionButton(this.selectedId);

        });



        events.on('sca.region.selected', (selectedId: string | null) => {

            this.rowElements.forEach((row) => {

                row.class.remove('selected');

            });



            if (selectedId && this.rowElements.has(selectedId)) {

                this.rowElements.get(selectedId).class.add('selected');

            }



            this.loadRegion(selectedId);

        });



        this.refreshList();

        this.loadRegion(events.invoke('sca.region.getSelected') as string | null);

    }



    private commitPatch(patch: ScaRegionPatch) {

        if (this.syncing || !this.selectedId) {

            return;

        }



        this.events.fire('sca.region.update', this.selectedId, patch);

    }



    private loadRegion(selectedId: string | null) {

        this.selectedId = selectedId;

        this.syncing = true;



        if (!selectedId) {

            this.formContainer.hidden = true;

            this.syncing = false;

            return;

        }



        const region = this.events.invoke('sca.region.get', selectedId) as ScaRegion | null;

        if (!region) {

            this.formContainer.hidden = true;

            this.syncing = false;

            return;

        }



        this.formContainer.hidden = false;

        this.idValue.text = region.id;

        this.nameInput.value = region.name;

        this.textInput.value = region.text ?? '';

        this.enabledInput.value = region.enabled;

        this.clickableInput.value = region.interaction.clickable;

        this.showCardInput.value = region.interaction.showCard !== false;

        this.showInNavigationInput.value = region.interaction.showInNavigation !== false;

        this.hoverTintControls.setValue(region.visual.hoverTint);

        this.hoverStrengthInput.value = region.visual.hoverOpacity;

        this.activeTintControls.setValue(region.visual.activeTint);

        this.activeStrengthInput.value = region.visual.activeOpacity;

        this.updateSelectGaussiansButton(selectedId);

        this.updateReplaceWithSelectionButton(selectedId);

        this.syncing = false;

    }



    private updateSelectGaussiansButton(selectedId: string | null) {

        const canSelect = selectedId ?
            this.events.invoke('sca.region.canSelectGaussians', selectedId) === true :
            false;

        this.selectRegionGaussiansButton.enabled = canSelect;

    }



    private updateReplaceWithSelectionButton(selectedId: string | null) {

        const canReplace = selectedId ?
            this.events.invoke('sca.region.canReplaceWithSelection', selectedId) === true :
            false;

        this.replaceWithSelectionButton.enabled = canReplace;

    }



    private refreshList() {

        const regions = this.events.invoke('sca.region.list') as ScaRegion[] | undefined;

        const selectedId = this.events.invoke('sca.region.getSelected') as string | null | undefined;



        this.listContainer.clear();

        this.rowElements.clear();



        const entries = regions ?? [];

        if (entries.length === 0) {

            this.listContainer.append(new Label({

                class: 'sca-hotspot-list-empty',

                text: 'No regions yet'

            }));

            return;

        }



        entries.forEach((region) => {

            const row = new Container({

                class: ['sca-hotspot-list-item']

            });



            const nameLabel = new Label({

                class: 'sca-hotspot-list-name',

                text: region.name

            });



            const idLabel = new Label({

                class: 'sca-hotspot-list-id',

                text: region.id

            });



            row.append(nameLabel);

            row.append(idLabel);



            if (region.id === selectedId) {

                row.class.add('selected');

            }



            row.on('click', () => {

                this.events.fire('sca.region.select', region.id);

            });



            this.rowElements.set(region.id, row);

            this.listContainer.append(row);

        });

    }

}



export { ScaRegionsPanel };

