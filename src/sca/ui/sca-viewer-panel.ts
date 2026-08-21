import {
    BooleanInput,
    Button,
    Container,
    Label,
    SelectInput,
    SliderInput,
    VectorInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import {
    ScaNavigationMode,
    ScaStartAnimationType,
    ScaViewerConfig
} from '../types/project';
import { computeCameraDistance } from '../viewer/viewer-config';

class ScaViewerPanel extends Container {
    private syncing = false;

    private positionInput: VectorInput;
    private targetInput: VectorInput;
    private fovSlider: SliderInput;
    private distanceLabel: Label;

    private defaultModeSelect: SelectInput;
    private orbitAllowedInput: BooleanInput;
    private flyAllowedInput: BooleanInput;

    private animationTypeSelect: SelectInput;
    private animationDurationSlider: SliderInput;

    private focusTransitionSlider: SliderInput;
    private homeTransitionSlider: SliderInput;

    private previewButton: Button;
    private exitPreviewButton: Button;

    constructor(private events: Events, args = {}) {
        args = {
            ...args,
            class: 'sca-viewer-panel'
        };

        super(args);

        const title = new Label({
            class: 'sca-panel-section-label',
            text: 'Viewer'
        });

        const initialTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Initial View'
        });

        const captureButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Capture Current View'
        });

        this.positionInput = new VectorInput({
            class: 'sca-hotspot-form-vector',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z']
        });
        this.targetInput = new VectorInput({
            class: 'sca-hotspot-form-vector',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z']
        });

        this.fovSlider = new SliderInput({
            class: 'sca-viewer-fov-slider',
            min: 10,
            max: 120,
            precision: 0,
            step: 1
        });

        this.distanceLabel = new Label({
            class: 'sca-viewer-distance-label',
            text: 'Distance: —'
        });

        const resetButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Reset Initial View'
        });

        const navigationTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Navigation Mode'
        });

        this.defaultModeSelect = new SelectInput({
            class: 'sca-viewer-select',
            options: [
                { v: 'orbit', t: 'Orbit' },
                { v: 'fly', t: 'Fly' }
            ]
        });

        const orbitAllowedRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.orbitAllowedInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        orbitAllowedRow.append(this.orbitAllowedInput);
        orbitAllowedRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Orbit'
        }));

        const flyAllowedRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.flyAllowedInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: false
        });
        flyAllowedRow.append(this.flyAllowedInput);
        flyAllowedRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Fly'
        }));

        const animationTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Start Animation'
        });

        this.animationTypeSelect = new SelectInput({
            class: 'sca-viewer-select',
            options: [
                { v: 'none', t: 'None' },
                { v: 'flyTo', t: 'Fly To' }
            ]
        });

        this.animationDurationSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 0.25,
            max: 10,
            precision: 2,
            step: 0.25
        });

        const interactionTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Hotspot Focus Transition'
        });

        this.focusTransitionSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 0,
            max: 3,
            precision: 2,
            step: 0.05
        });

        this.homeTransitionSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 0,
            max: 5,
            precision: 2,
            step: 0.05
        });

        this.previewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Preview Viewer Camera'
        });

        this.exitPreviewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button', 'sca-viewer-exit-preview-button'],
            text: 'Exit Viewer Preview',
            hidden: true
        });

        this.append(title);
        this.append(initialTitle);
        this.append(captureButton);
        this.append(this.makeRow('Camera Position', this.positionInput));
        this.append(this.makeRow('Target / Focus', this.targetInput));
        this.append(this.makeRow('FOV', this.fovSlider));
        this.append(this.distanceLabel);
        this.append(resetButton);
        this.append(navigationTitle);
        this.append(this.makeRow('Default Mode', this.defaultModeSelect));
        this.append(orbitAllowedRow);
        this.append(flyAllowedRow);
        this.append(animationTitle);
        this.append(this.makeRow('Type', this.animationTypeSelect));
        this.append(this.makeRow('Duration (s)', this.animationDurationSlider));
        this.append(interactionTitle);
        this.append(this.makeRow('Duration (s)', this.focusTransitionSlider));

        const homeTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Home / Reset Transition'
        });
        this.append(homeTitle);
        this.append(this.makeRow('Duration (s)', this.homeTransitionSlider));
        this.append(this.previewButton);
        this.append(this.exitPreviewButton);

        captureButton.on('click', () => {
            this.events.fire('sca.viewer.captureCurrentView');
        });

        resetButton.on('click', () => {
            this.events.fire('sca.viewer.resetInitialView');
        });

        this.previewButton.on('click', () => {
            this.events.fire('sca.viewer.preview.enter');
        });

        this.exitPreviewButton.on('click', () => {
            this.events.fire('sca.viewer.preview.exit');
        });

        this.positionInput.on('change', (value: number[]) => {
            this.emitInitialPatch({
                position: [value[0], value[1], value[2]]
            });
        });

        this.targetInput.on('change', (value: number[]) => {
            this.emitInitialPatch({
                target: [value[0], value[1], value[2]]
            });
        });

        this.fovSlider.on('change', (value: number) => {
            this.emitInitialPatch({ fov: value });
        });

        this.defaultModeSelect.on('change', (value: string) => {
            this.emitNavigationPatch({ defaultMode: value as ScaNavigationMode });
        });

        this.orbitAllowedInput.on('change', (value: boolean) => {
            this.emitAllowedModesPatch('orbit', value);
        });

        this.flyAllowedInput.on('change', (value: boolean) => {
            this.emitAllowedModesPatch('fly', value);
        });

        this.animationTypeSelect.on('change', (value: string) => {
            this.emitAnimationPatch({ type: value as ScaStartAnimationType });
        });

        this.animationDurationSlider.on('change', (value: number) => {
            this.emitAnimationPatch({ duration: value });
        });

        this.focusTransitionSlider.on('change', (value: number) => {
            this.emitInteractionPatch({ focusTransition: { duration: value } });
        });

        this.homeTransitionSlider.on('change', (value: number) => {
            this.emitInteractionPatch({ homeTransition: { duration: value } });
        });

        events.on('sca.project.changed', () => {
            this.refresh();
        });

        events.on('sca.viewer.preview.changed', () => {
            this.refreshPreviewState();
        });

        this.refresh();
    }

    private makeRow(
        labelText: string,
        control: VectorInput | SliderInput | SelectInput
    ): Container {
        const row = new Container({ class: 'sca-hotspot-form-row' });
        const label = new Label({
            class: 'sca-hotspot-form-label',
            text: labelText
        });
        row.append(label);
        row.append(control);
        return row;
    }

    private emitInitialPatch(patch: Partial<ScaViewerConfig['camera']['initial']>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.camera.initial.update', patch);
    }

    private emitNavigationPatch(patch: Partial<ScaViewerConfig['navigation']>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.navigation.update', patch);
    }

    private emitAllowedModesPatch(mode: ScaNavigationMode, enabled: boolean): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.navigation.allowedMode.set', { mode, enabled });
    }

    private emitAnimationPatch(patch: Partial<ScaViewerConfig['camera']['animation']>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.camera.animation.update', patch);
    }

    private emitInteractionPatch(patch: Partial<ScaViewerConfig['interaction']>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.interaction.update', patch);
    }

    private refreshPreviewState(): void {
        const active = this.events.invoke('sca.viewer.preview.active') as boolean;
        this.previewButton.hidden = active;
        this.exitPreviewButton.hidden = !active;
    }

    private refresh(): void {
        const viewer = this.events.invoke('sca.viewer.get') as ScaViewerConfig | null;
        if (!viewer) {
            return;
        }

        const { initial, animation } = viewer.camera;
        const { navigation, interaction } = viewer;

        this.syncing = true;
        this.positionInput.value = [...initial.position];
        this.targetInput.value = [...initial.target];
        this.fovSlider.value = initial.fov;
        this.defaultModeSelect.options = navigation.allowedModes.map((mode) => ({
            v: mode,
            t: mode === 'fly' ? 'Fly' : 'Orbit'
        }));
        this.defaultModeSelect.value = navigation.defaultMode;
        this.defaultModeSelect.enabled = navigation.allowedModes.length > 1;
        this.orbitAllowedInput.value = navigation.allowedModes.includes('orbit');
        this.flyAllowedInput.value = navigation.allowedModes.includes('fly');
        this.animationTypeSelect.value = animation.type;
        this.animationDurationSlider.value = animation.duration;
        this.animationDurationSlider.enabled = animation.type === 'flyTo';
        this.focusTransitionSlider.value = interaction.focusTransition.duration;
        this.homeTransitionSlider.value = interaction.homeTransition.duration;
        this.syncing = false;

        this.distanceLabel.text = `Distance: ${computeCameraDistance(initial).toFixed(2)}`;
        this.refreshPreviewState();
    }
}

export { ScaViewerPanel };
