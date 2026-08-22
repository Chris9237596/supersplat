import {

    BooleanInput,

    Button,

    Container,

    Label,

    SelectInput,

    SliderInput,

    TextAreaInput,

    TextInput

} from '@playcanvas/pcui';



import { Events } from '../../events';



import { ScaRegion, ScaRegionPatch } from '../types/region';

import { DEFAULT_ACTIVE_TINT, DEFAULT_HOVER_TINT, DEFAULT_PULSE_SPEED, DEFAULT_PULSE_STRENGTH } from '../region-defaults';
import { RegionAuthoringPreviewState } from '../regions/region-authoring-preview-state';
import { CollapsibleSection } from './components/collapsible-section';
import { createRegionTintControls } from './region-tint-controls';
import { ScaSectionLayoutManager } from './sca-section-layout-state';



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

    private pulseEnabledInput: BooleanInput;

    private pulseTintControls: ReturnType<typeof createRegionTintControls>;

    private pulseStrengthInput: SliderInput;

    private pulseSpeedInput: SliderInput;

    private pulseModeSelect: SelectInput;

    private pulseStopOnInteractionInput: BooleanInput;

    private previewPulseButton: Button;

    private deleteButton: Button;

    private addSelectionButton: Button;

    private selectRegionGaussiansButton: Button;

    private replaceWithSelectionButton: Button;

    private removeSelectionButton: Button;

    private authoringPreviewRefs = {
        hover: 0,
        selected: 0
    };

    constructor(private events: Events, private sectionLayout: ScaSectionLayoutManager, args = {}) {

        args = {

            ...args,

            class: 'sca-regions-panel'

        };



        super(args);



        const listHeader = new Container({

            class: 'sca-hotspot-list-header'

        });



        const addButton = new Button({

            class: 'sca-hotspot-add-button',

            text: '+ Region from Selection'

        });



        listHeader.append(new Label({ class: 'sca-panel-section-spacer' }));

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



        const pulseEnabledRow = new Container({ class: 'sca-hotspot-form-row' });

        const pulseEnabledLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Enable Pulse' });

        this.pulseEnabledInput = new BooleanInput({

            class: 'sca-hotspot-form-toggle',

            type: 'toggle',

            value: false

        });

        pulseEnabledRow.append(pulseEnabledLabel);

        pulseEnabledRow.append(this.pulseEnabledInput);



        this.pulseTintControls = createRegionTintControls('Pulse color', DEFAULT_ACTIVE_TINT);



        const pulseStrengthRow = new Container({ class: 'sca-hotspot-form-row' });

        const pulseStrengthLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Strength' });

        this.pulseStrengthInput = new SliderInput({

            class: 'sca-hotspot-form-slider',

            min: 0,

            max: 1,

            step: 0.01,

            precision: 2,

            value: DEFAULT_PULSE_STRENGTH

        });

        pulseStrengthRow.append(pulseStrengthLabel);

        pulseStrengthRow.append(this.pulseStrengthInput);



        const pulseSpeedRow = new Container({ class: 'sca-hotspot-form-row' });

        const pulseSpeedLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Speed' });

        this.pulseSpeedInput = new SliderInput({

            class: 'sca-hotspot-form-slider',

            min: 0.1,

            max: 4,

            step: 0.05,

            precision: 2,

            value: DEFAULT_PULSE_SPEED

        });

        pulseSpeedRow.append(pulseSpeedLabel);

        pulseSpeedRow.append(this.pulseSpeedInput);



        const pulseModeRow = new Container({ class: 'sca-hotspot-form-row' });

        const pulseModeLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Mode' });

        this.pulseModeSelect = new SelectInput({

            class: 'sca-hotspot-form-input',

            options: [

                { v: 'loop', t: 'Loop' },

                { v: 'once', t: 'Once' }

            ],

            value: 'loop'

        });

        pulseModeRow.append(pulseModeLabel);

        pulseModeRow.append(this.pulseModeSelect);



        const pulseStopOnInteractionRow = new Container({ class: 'sca-hotspot-form-row' });

        const pulseStopOnInteractionLabel = new Label({ class: 'sca-hotspot-form-label', text: 'Stop after interaction' });

        this.pulseStopOnInteractionInput = new BooleanInput({

            class: 'sca-hotspot-form-toggle',

            type: 'toggle',

            value: false

        });

        pulseStopOnInteractionRow.append(pulseStopOnInteractionLabel);

        pulseStopOnInteractionRow.append(this.pulseStopOnInteractionInput);



        this.previewPulseButton = new Button({

            class: ['sca-hotspot-form-button'],

            text: 'Preview Pulse'

        });



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



        const generalSection = new CollapsibleSection({
            sectionId: 'regionGeneral',
            title: 'GENERAL',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        generalSection.body.append(idRow);
        generalSection.body.append(nameRow);
        generalSection.body.append(textRow);
        generalSection.body.append(enabledRow);

        const interactionSection = new CollapsibleSection({
            sectionId: 'regionInteraction',
            title: 'INTERACTION',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        interactionSection.body.append(clickableRow);
        interactionSection.body.append(showCardRow);
        interactionSection.body.append(showInNavigationRow);

        const visualSection = new CollapsibleSection({
            sectionId: 'regionVisual',
            title: 'VISUAL',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        visualSection.body.append(this.hoverTintControls.row);
        visualSection.body.append(hoverStrengthRow);
        visualSection.body.append(this.activeTintControls.row);
        visualSection.body.append(activeStrengthRow);

        const pulseSection = new CollapsibleSection({
            sectionId: 'regionPulse',
            title: 'PULSE / ATTENTION',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        pulseSection.body.append(pulseEnabledRow);
        pulseSection.body.append(this.pulseTintControls.row);
        pulseSection.body.append(pulseStrengthRow);
        pulseSection.body.append(pulseSpeedRow);
        pulseSection.body.append(pulseModeRow);
        pulseSection.body.append(pulseStopOnInteractionRow);
        pulseSection.body.append(this.previewPulseButton);

        const membershipSection = new CollapsibleSection({
            sectionId: 'regionMembership',
            title: 'REGION MEMBERSHIP',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        membershipSection.body.append(this.addSelectionButton);
        membershipSection.body.append(this.selectRegionGaussiansButton);
        membershipSection.body.append(this.replaceWithSelectionButton);
        membershipSection.body.append(this.removeSelectionButton);
        membershipSection.body.append(this.deleteButton);

        this.formContainer.append(formTitle);
        this.formContainer.append(generalSection);
        this.formContainer.append(interactionSection);
        this.formContainer.append(visualSection);
        this.formContainer.append(pulseSection);
        this.formContainer.append(membershipSection);



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
        }, {
            onPreviewStart: () => this.beginAuthoringPreview('hover'),
            onPreviewEnd: () => this.endAuthoringPreview('hover')
        });

        this.bindStrengthAuthoringPreview(
            this.hoverStrengthInput,
            'hover',
            () => {
                this.commitPatch({
                    visual: {
                        hoverOpacity: this.hoverStrengthInput.value
                    }
                });
            }
        );



        this.activeTintControls.bind(events, (activeTint) => {
            this.commitPatch({
                visual: { activeTint }
            });
        }, {
            onPreviewStart: () => this.beginAuthoringPreview('selected'),
            onPreviewEnd: () => this.endAuthoringPreview('selected')
        });

        this.bindStrengthAuthoringPreview(
            this.activeStrengthInput,
            'selected',
            () => {
                this.commitPatch({
                    visual: {
                        activeOpacity: this.activeStrengthInput.value
                    }
                });
            }
        );



        this.pulseEnabledInput.on('change', () => {
            this.commitPulsePatch({ enabled: this.pulseEnabledInput.value });
        });



        this.pulseTintControls.bind(events, (color) => {
            this.commitPulsePatch({ color });
        });



        this.pulseStrengthInput.on('change', () => {
            this.commitPulsePatch({ strength: this.pulseStrengthInput.value });
        });



        this.pulseSpeedInput.on('change', () => {
            this.commitPulsePatch({ speed: this.pulseSpeedInput.value });
        });



        this.pulseModeSelect.on('change', () => {
            this.commitPulsePatch({
                mode: this.pulseModeSelect.value === 'once' ? 'once' : 'loop'
            });
        });



        this.pulseStopOnInteractionInput.on('change', () => {
            this.commitPulsePatch({ stopOnInteraction: this.pulseStopOnInteractionInput.value });
        });



        this.previewPulseButton.on('click', () => {
            if (!this.selectedId) {
                return;
            }

            events.fire('sca.region.pulse.preview', this.selectedId);
            this.updatePreviewPulseButton();
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

    private commitPulsePatch(pulsePatch: {
        enabled?: boolean;
        color?: string;
        strength?: number;
        speed?: number;
        mode?: 'loop' | 'once';
        stopOnInteraction?: boolean;
    }) {
        this.commitPatch({
            visual: {
                pulse: {
                    enabled: this.pulseEnabledInput.value,
                    color: this.pulseTintControls.getValue(),
                    strength: this.pulseStrengthInput.value,
                    speed: this.pulseSpeedInput.value,
                    mode: this.pulseModeSelect.value === 'once' ? 'once' : 'loop',
                    stopOnInteraction: this.pulseStopOnInteractionInput.value,
                    ...pulsePatch
                }
            }
        });
    }

    private updatePreviewPulseButton() {
        const previewId = this.events.invoke('sca.region.pulse.preview.get') as string | null;
        const active = !!this.selectedId && previewId === this.selectedId;
        this.previewPulseButton.text = active ? 'Stop Pulse Preview' : 'Preview Pulse';
    }

    private syncAuthoringPreviewState(): void {
        if (!this.selectedId) {
            this.events.fire('sca.region.authoringPreview.set', null);
            return;
        }

        let state: RegionAuthoringPreviewState = null;
        if (this.authoringPreviewRefs.hover > 0) {
            state = 'hover';
        } else if (this.authoringPreviewRefs.selected > 0) {
            state = 'selected';
        }

        this.events.fire('sca.region.authoringPreview.set', state);
    }

    private beginAuthoringPreview(state: 'hover' | 'selected'): void {
        if (!this.selectedId) {
            return;
        }

        this.authoringPreviewRefs[state]++;
        this.syncAuthoringPreviewState();
    }

    private endAuthoringPreview(state: 'hover' | 'selected'): void {
        this.authoringPreviewRefs[state] = Math.max(0, this.authoringPreviewRefs[state] - 1);
        this.syncAuthoringPreviewState();
    }

    private resetAuthoringPreview(): void {
        this.authoringPreviewRefs.hover = 0;
        this.authoringPreviewRefs.selected = 0;
        this.events.fire('sca.region.authoringPreview.set', null);
    }

    private bindStrengthAuthoringPreview(
        slider: SliderInput,
        state: 'hover' | 'selected',
        onCommit: () => void
    ): void {
        let pointerActive = false;

        slider.on('change', onCommit);

        slider.dom.addEventListener('pointerdown', () => {
            pointerActive = true;
            this.beginAuthoringPreview(state);
            this.events.invoke('sca.history.beginTransaction');
        });
        slider.dom.addEventListener('pointerup', () => {
            if (!pointerActive) {
                return;
            }
            pointerActive = false;
            this.events.invoke('sca.history.commitTransaction');
            this.endAuthoringPreview(state);
        });
        slider.dom.addEventListener('focusin', () => {
            if (pointerActive) {
                return;
            }
            this.beginAuthoringPreview(state);
            this.events.invoke('sca.history.beginTransaction');
        });
        slider.dom.addEventListener('focusout', () => {
            if (pointerActive) {
                return;
            }
            this.events.invoke('sca.history.commitTransaction');
            this.endAuthoringPreview(state);
        });
    }



    private loadRegion(selectedId: string | null) {

        this.resetAuthoringPreview();

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

        const pulse = region.visual.pulse;
        this.pulseEnabledInput.value = pulse?.enabled === true;
        this.pulseTintControls.setValue(pulse?.color ?? region.visual.activeTint ?? DEFAULT_ACTIVE_TINT);
        this.pulseStrengthInput.value = pulse?.strength ?? DEFAULT_PULSE_STRENGTH;
        this.pulseSpeedInput.value = pulse?.speed ?? DEFAULT_PULSE_SPEED;
        this.pulseModeSelect.value = pulse?.mode === 'once' ? 'once' : 'loop';
        this.pulseStopOnInteractionInput.value = pulse?.stopOnInteraction === true;
        this.updatePreviewPulseButton();

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

