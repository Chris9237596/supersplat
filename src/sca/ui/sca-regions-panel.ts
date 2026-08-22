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
import { ScaRegionStateContentLayer, isRegionOverlayLayer } from '../types/region-state-content';
import { ScaProject } from '../types/project';
import { ScaRigBindMode, ScaRigNode } from '../types/rig';
import { generateStateLayerId } from '../ids/generate-state-layer-id';
import {
    createDefaultPlaceholderLayer,
    createDefaultRegionOverlayLayer
} from '../region-state-content';
import {
    DEFAULT_ACTIVE_TINT,
    DEFAULT_HOVER_TINT,
    DEFAULT_PULSE_SPEED,
    DEFAULT_PULSE_STRENGTH,
    DEFAULT_REGION_OVERLAY_COLOR,
    DEFAULT_REGION_OVERLAY_OPACITY,
    DEFAULT_VISITED_OPACITY
} from '../region-defaults';
import { RegionAuthoringPreviewState } from '../regions/region-authoring-preview-state';
import {
    buildRigBindModeSelectOptions,
    buildRigBindingSelectOptions,
    logScaRigBindingUi,
    resolveRigBindModeSelectValue,
    resolveRigBindingSelectValue,
    rigBindingNodeIdFromSelectValue
} from '../rig/rig-binding-ui';
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

    private visitedEnabledInput: BooleanInput;

    private visitedTintControls: ReturnType<typeof createRegionTintControls>;

    private visitedStrengthInput: SliderInput;

    private visitedStateContentContainer: Container;

    private visitedStateContentList: Container;

    private addPlaceholderLayerButton: Button;

    private addRegionOverlayButton: Button;

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

    private rigBindingNodeSelect: SelectInput;

    private rigBindingBindModeSelect: SelectInput;

    private rigBindingRebindButton: Button;

    private pendingBindMode: ScaRigBindMode = 'keep-world';

    private authoringPreviewRefs = {
        hover: 0,
        selected: 0,
        visited: 0
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



        const statesTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'STATES'
        });

        const visitedEnabledRow = new Container({ class: 'sca-hotspot-form-row' });
        const visitedEnabledLabel = new Label({
            class: 'sca-hotspot-form-label',
            text: 'Enable visited style'
        });
        this.visitedEnabledInput = new BooleanInput({
            class: 'sca-hotspot-form-toggle',
            type: 'toggle',
            value: false
        });
        visitedEnabledRow.append(visitedEnabledLabel);
        visitedEnabledRow.append(this.visitedEnabledInput);

        this.visitedTintControls = createRegionTintControls('Visited color', DEFAULT_ACTIVE_TINT);

        const visitedStrengthRow = new Container({ class: 'sca-hotspot-form-row' });
        const visitedStrengthLabel = new Label({
            class: 'sca-hotspot-form-label',
            text: 'Visited strength'
        });
        this.visitedStrengthInput = new SliderInput({
            class: 'sca-hotspot-form-slider',
            min: 0,
            max: 1,
            step: 0.01,
            precision: 2,
            value: DEFAULT_VISITED_OPACITY
        });
        visitedStrengthRow.append(visitedStrengthLabel);
        visitedStrengthRow.append(this.visitedStrengthInput);

        const visitedStateContentTitle = new Label({
            class: ['sca-panel-subsection-label', 'sca-panel-subsection-label-nested'],
            text: 'STATE CONTENT (Experimental)'
        });

        this.visitedStateContentList = new Container({
            class: 'sca-region-state-content-list'
        });

        this.addPlaceholderLayerButton = new Button({
            class: 'sca-hotspot-form-button',
            text: '+ Add Placeholder Layer'
        });

        this.addRegionOverlayButton = new Button({
            class: 'sca-hotspot-form-button',
            text: '+ Add Region Overlay'
        });

        this.visitedStateContentContainer = new Container({
            class: 'sca-region-state-content-section'
        });
        this.visitedStateContentContainer.append(visitedStateContentTitle);
        this.visitedStateContentContainer.append(this.visitedStateContentList);
        this.visitedStateContentContainer.append(this.addRegionOverlayButton);
        this.visitedStateContentContainer.append(this.addPlaceholderLayerButton);



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
        visualSection.body.append(statesTitle);
        visualSection.body.append(visitedEnabledRow);
        visualSection.body.append(this.visitedTintControls.row);
        visualSection.body.append(visitedStrengthRow);
        visualSection.body.append(this.visitedStateContentContainer);

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

        const rigBindingTitle = new Label({
            class: ['sca-panel-subsection-label', 'sca-panel-subsection-label-nested'],
            text: 'RIG BINDING'
        });
        const rigBindingNodeRow = new Container({ class: 'sca-hotspot-form-row' });
        rigBindingNodeRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Node' }));
        this.rigBindingNodeSelect = new SelectInput({
            class: 'sca-hotspot-form-input',
            options: buildRigBindingSelectOptions([]),
            value: resolveRigBindingSelectValue(null, [])
        });
        rigBindingNodeRow.append(this.rigBindingNodeSelect);
        const rigBindingBindModeRow = new Container({ class: 'sca-hotspot-form-row' });
        rigBindingBindModeRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Bind Mode' }));
        this.rigBindingBindModeSelect = new SelectInput({
            class: 'sca-hotspot-form-input',
            options: buildRigBindModeSelectOptions(),
            value: 'keep-world'
        });
        rigBindingBindModeRow.append(this.rigBindingBindModeSelect);
        this.rigBindingRebindButton = new Button({
            class: 'sca-hotspot-form-button',
            text: 'Rebind'
        });
        const rigBindingModeRow = new Container({ class: 'sca-hotspot-form-row' });
        rigBindingModeRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Mode' }));
        rigBindingModeRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Rigid' }));

        const rigBindingSection = new CollapsibleSection({
            sectionId: 'regionRigBinding',
            title: 'RIG BINDING',
            layout: this.sectionLayout,
            class: 'sca-region-form-section'
        });
        rigBindingSection.body.append(rigBindingTitle);
        rigBindingSection.body.append(rigBindingNodeRow);
        rigBindingSection.body.append(rigBindingBindModeRow);
        rigBindingSection.body.append(this.rigBindingRebindButton);
        rigBindingSection.body.append(rigBindingModeRow);

        this.formContainer.append(formTitle);
        this.formContainer.append(generalSection);
        this.formContainer.append(interactionSection);
        this.formContainer.append(visualSection);
        this.formContainer.append(pulseSection);
        this.formContainer.append(rigBindingSection);
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



        this.visitedEnabledInput.on('change', () => {
            if (this.visitedEnabledInput.value) {
                this.commitPatch({
                    visual: {
                        visited: {
                            enabled: true,
                            color: this.visitedTintControls.getValue(),
                            opacity: this.visitedStrengthInput.value
                        }
                    }
                });
                return;
            }

            this.commitPatch({
                visual: {
                    visited: {
                        enabled: false,
                        color: this.visitedTintControls.getValue(),
                        opacity: this.visitedStrengthInput.value
                    }
                }
            });
        });

        this.visitedTintControls.bind(events, (color) => {
            if (!this.visitedEnabledInput.value) {
                return;
            }
            this.commitPatch({
                visual: {
                    visited: {
                        enabled: true,
                        color,
                        opacity: this.visitedStrengthInput.value
                    }
                }
            });
        }, {
            onPreviewStart: () => this.beginAuthoringPreview('visited'),
            onPreviewEnd: () => this.endAuthoringPreview('visited')
        });

        this.bindStrengthAuthoringPreview(
            this.visitedStrengthInput,
            'visited',
            () => {
                if (!this.visitedEnabledInput.value) {
                    return;
                }
                this.commitPatch({
                    visual: {
                        visited: {
                            enabled: true,
                            color: this.visitedTintControls.getValue(),
                            opacity: this.visitedStrengthInput.value
                        }
                    }
                });
            }
        );



        this.addPlaceholderLayerButton.on('click', () => {
            this.addVisitedPlaceholderLayer();
        });

        this.addRegionOverlayButton.on('click', () => {
            this.addVisitedRegionOverlayLayer();
        });

        this.rigBindingNodeSelect.on('change', () => {
            if (!this.selectedId || this.syncing) {
                return;
            }

            const nodeId = rigBindingNodeIdFromSelectValue(this.rigBindingNodeSelect.value);
            this.events.fire(
                'sca.rig.binding.set',
                this.selectedId,
                nodeId,
                this.pendingBindMode
            );
        });

        this.rigBindingBindModeSelect.on('change', () => {
            if (this.syncing) {
                return;
            }

            this.pendingBindMode = resolveRigBindModeSelectValue(
                this.rigBindingBindModeSelect.value as ScaRigBindMode
            );
        });

        this.rigBindingRebindButton.on('click', () => {
            if (!this.selectedId || this.syncing) {
                return;
            }

            const binding = this.events.invoke('sca.rig.getBinding', this.selectedId) as { nodeId: string } | null;
            if (!binding) {
                return;
            }

            this.events.fire(
                'sca.rig.binding.rebind',
                this.selectedId,
                this.pendingBindMode
            );
        });



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

            this.refreshRigBindingUi();

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

    private getVisitedStateContentLayers(region: ScaRegion): ScaRegionStateContentLayer[] {
        return region.visual.stateContent?.visited?.layers ?
            [...region.visual.stateContent.visited.layers] :
            [];
    }

    private commitVisitedStateContentLayers(layers: ScaRegionStateContentLayer[]) {
        this.commitPatch({
            visual: {
                stateContent: {
                    visited: { layers }
                }
            }
        });
    }

    private addVisitedPlaceholderLayer() {
        if (!this.selectedId) {
            return;
        }

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        if (!project) {
            return;
        }

        const region = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
        if (!region) {
            return;
        }

        const layers = this.getVisitedStateContentLayers(region);
        const layerNumber = layers.length + 1;
        layers.push(createDefaultPlaceholderLayer(
            generateStateLayerId(project),
            `Placeholder Layer ${layerNumber}`
        ));
        this.commitVisitedStateContentLayers(layers);
    }

    private addVisitedRegionOverlayLayer() {
        if (!this.selectedId) {
            return;
        }

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        if (!project) {
            return;
        }

        const region = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
        if (!region) {
            return;
        }

        const layers = this.getVisitedStateContentLayers(region);
        const overlayCount = layers.filter((entry) => entry.type === 'region-overlay').length + 1;
        layers.push(createDefaultRegionOverlayLayer(
            generateStateLayerId(project),
            `Region Overlay ${overlayCount}`
        ));
        this.commitVisitedStateContentLayers(layers);
    }

    private rebuildVisitedStateContentUi(region: ScaRegion) {
        this.visitedStateContentList.clear();

        const layers = this.getVisitedStateContentLayers(region);
        for (const layer of layers) {
            const layerBlock = new Container({
                class: ['sca-region-state-content-layer', `sca-region-state-content-layer-${layer.type}`]
            });

            const row = new Container({ class: ['sca-hotspot-form-row', 'sca-region-state-content-row'] });

            const nameInput = new TextInput({
                class: 'sca-hotspot-form-input',
                value: layer.name ?? layer.id
            });

            const enabledInput = new BooleanInput({
                class: 'sca-hotspot-form-toggle',
                type: 'toggle',
                value: layer.enabled
            });

            const deleteButton = new Button({
                class: ['sca-hotspot-form-button', 'sca-region-state-content-delete'],
                text: 'Delete'
            });

            const layerId = layer.id;

            nameInput.on('change', () => {
                const currentRegion = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
                if (!currentRegion) {
                    return;
                }

                const nextLayers = this.getVisitedStateContentLayers(currentRegion).map((entry) => (
                    entry.id === layerId ?
                        { ...entry, name: nameInput.value.trim() || entry.id } :
                        entry
                ));
                this.commitVisitedStateContentLayers(nextLayers);
            });

            enabledInput.on('change', () => {
                const currentRegion = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
                if (!currentRegion) {
                    return;
                }

                const nextLayers = this.getVisitedStateContentLayers(currentRegion).map((entry) => (
                    entry.id === layerId ?
                        { ...entry, enabled: enabledInput.value } :
                        entry
                ));
                this.commitVisitedStateContentLayers(nextLayers);
            });

            deleteButton.on('click', () => {
                const currentRegion = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
                if (!currentRegion) {
                    return;
                }

                const nextLayers = this.getVisitedStateContentLayers(currentRegion)
                    .filter((entry) => entry.id !== layerId);
                this.commitVisitedStateContentLayers(nextLayers);
            });

            row.append(nameInput);
            row.append(enabledInput);
            row.append(deleteButton);
            layerBlock.append(row);

            if (isRegionOverlayLayer(layer)) {
                const overlayTintControls = createRegionTintControls(
                    'Overlay color',
                    layer.color ?? DEFAULT_REGION_OVERLAY_COLOR
                );
                overlayTintControls.setValue(layer.color ?? DEFAULT_REGION_OVERLAY_COLOR);

                const overlayOpacityRow = new Container({ class: 'sca-hotspot-form-row' });
                const overlayOpacityLabel = new Label({
                    class: 'sca-hotspot-form-label',
                    text: 'Overlay opacity'
                });
                const overlayOpacityInput = new SliderInput({
                    class: 'sca-hotspot-form-slider',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    precision: 2,
                    value: layer.opacity ?? DEFAULT_REGION_OVERLAY_OPACITY
                });
                overlayOpacityRow.append(overlayOpacityLabel);
                overlayOpacityRow.append(overlayOpacityInput);

                const updateOverlayLayer = (patch: { color?: string; opacity?: number }) => {
                    const currentRegion = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
                    if (!currentRegion) {
                        return;
                    }

                    const nextLayers = this.getVisitedStateContentLayers(currentRegion).map((entry) => {
                        if (entry.id !== layerId || !isRegionOverlayLayer(entry)) {
                            return entry;
                        }

                        return {
                            ...entry,
                            ...(patch.color !== undefined ? { color: patch.color } : {}),
                            ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {})
                        };
                    });
                    this.commitVisitedStateContentLayers(nextLayers);
                };

                overlayTintControls.bind(this.events, (color) => {
                    updateOverlayLayer({ color });
                }, {
                    onPreviewStart: () => this.beginAuthoringPreview('visited'),
                    onPreviewEnd: () => this.endAuthoringPreview('visited')
                });

                overlayOpacityInput.on('change', () => {
                    updateOverlayLayer({ opacity: overlayOpacityInput.value });
                });
                overlayOpacityInput.dom.addEventListener('pointerdown', () => {
                    this.beginAuthoringPreview('visited');
                });
                overlayOpacityInput.dom.addEventListener('pointerup', () => {
                    this.endAuthoringPreview('visited');
                });
                overlayOpacityInput.dom.addEventListener('blur', () => {
                    this.endAuthoringPreview('visited');
                });

                layerBlock.append(overlayTintControls.row);
                layerBlock.append(overlayOpacityRow);
            }

            this.visitedStateContentList.append(layerBlock);
        }
    }

    private refreshRigBindingUi() {
        if (!this.selectedId) {
            return;
        }

        const region = this.events.invoke('sca.region.get', this.selectedId) as ScaRegion | null;
        if (!region) {
            return;
        }

        this.syncing = true;
        this.rebuildRigBindingUi(region);
        this.syncing = false;
    }

    private rebuildRigBindingUi(region: ScaRegion) {
        const nodes = this.events.invoke('sca.rig.node.list') as ScaRigNode[] | undefined;
        const binding = this.events.invoke('sca.rig.getBinding', region.id) as {
            nodeId: string;
            bindMode?: ScaRigBindMode;
        } | null;
        const options = buildRigBindingSelectOptions(nodes ?? []);
        const currentValue = resolveRigBindingSelectValue(binding?.nodeId, nodes ?? []);
        this.pendingBindMode = resolveRigBindModeSelectValue(binding?.bindMode);

        logScaRigBindingUi({
            region: region.id,
            nodes: nodes?.length ?? 0,
            options,
            currentValue,
            bindMode: this.pendingBindMode,
            selectOptionCountBefore: this.rigBindingNodeSelect.options.length
        });

        this.rigBindingNodeSelect.options = options;
        this.rigBindingNodeSelect.value = currentValue;
        this.rigBindingBindModeSelect.options = buildRigBindModeSelectOptions();
        this.rigBindingBindModeSelect.value = this.pendingBindMode;
        this.rigBindingRebindButton.enabled = !!binding?.nodeId;

        logScaRigBindingUi({
            region: region.id,
            selectOptionCountAfter: this.rigBindingNodeSelect.options.length,
            selectValue: this.rigBindingNodeSelect.value,
            bindMode: this.pendingBindMode
        });
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
        } else if (this.authoringPreviewRefs.visited > 0) {
            state = 'visited';
        }

        this.events.fire('sca.region.authoringPreview.set', state);
    }

    private beginAuthoringPreview(state: 'hover' | 'selected' | 'visited'): void {
        if (!this.selectedId) {
            return;
        }

        this.authoringPreviewRefs[state]++;
        this.syncAuthoringPreviewState();
    }

    private endAuthoringPreview(state: 'hover' | 'selected' | 'visited'): void {
        this.authoringPreviewRefs[state] = Math.max(0, this.authoringPreviewRefs[state] - 1);
        this.syncAuthoringPreviewState();
    }

    private resetAuthoringPreview(): void {
        this.authoringPreviewRefs.hover = 0;
        this.authoringPreviewRefs.selected = 0;
        this.authoringPreviewRefs.visited = 0;
        this.events.fire('sca.region.authoringPreview.set', null);
    }

    private bindStrengthAuthoringPreview(
        slider: SliderInput,
        state: 'hover' | 'selected' | 'visited',
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

        const visited = region.visual.visited;
        this.visitedEnabledInput.value = visited?.enabled === true;
        this.visitedTintControls.setValue(visited?.color ?? region.visual.activeTint ?? DEFAULT_ACTIVE_TINT);
        this.visitedStrengthInput.value = visited?.opacity ?? DEFAULT_VISITED_OPACITY;
        this.rebuildVisitedStateContentUi(region);

        const pulse = region.visual.pulse;
        this.pulseEnabledInput.value = pulse?.enabled === true;
        this.pulseTintControls.setValue(pulse?.color ?? region.visual.activeTint ?? DEFAULT_ACTIVE_TINT);
        this.pulseStrengthInput.value = pulse?.strength ?? DEFAULT_PULSE_STRENGTH;
        this.pulseSpeedInput.value = pulse?.speed ?? DEFAULT_PULSE_SPEED;
        this.pulseModeSelect.value = pulse?.mode === 'once' ? 'once' : 'loop';
        this.pulseStopOnInteractionInput.value = pulse?.stopOnInteraction === true;
        this.rebuildRigBindingUi(region);
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

