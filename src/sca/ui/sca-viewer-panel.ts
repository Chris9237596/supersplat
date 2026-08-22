import {
    BooleanInput,
    Button,
    ColorPicker,
    Container,
    Label,
    SelectInput,
    SliderInput,
    TextInput,
    VectorInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import {
    ScaNavigationMode,
    ScaProject,
    ScaStartAnimationType,
    ScaTurntableDirection,
    ScaViewerConfig
} from '../types/project';
import { computeCameraDistance, buildNavigationPreview } from '../viewer/viewer-config';
import { parseHexColor, rgbToHex } from '../viewer/viewer-background';

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
    private turntableControls: Container;
    private turntableDegreesSlider: SliderInput;
    private turntableDurationSlider: SliderInput;
    private turntableDirectionSelect: SelectInput;
    private turntableLoopInput: BooleanInput;
    private previewAnimationButton: Button;
    private stopAnimationPreviewButton: Button;

    private focusTransitionSlider: SliderInput;
    private homeTransitionSlider: SliderInput;
    private showHotspotCardsInput: BooleanInput;

    private showTopNavigationInput: BooleanInput;
    private includeHotspotsNavInput: BooleanInput;
    private includeRegionsNavInput: BooleanInput;
    private navigationPreviewContainer: Container;

    private backgroundTypeSelect: SelectInput;
    private backgroundColorPicker: ColorPicker;
    private backgroundHexInput: TextInput;
    private backgroundImageButton: Button;
    private backgroundRemoveImageButton: Button;
    private backgroundFilenameLabel: Label;
    private backgroundColorRow: Container;
    private backgroundImageRow: Container;

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
                { v: 'flyTo', t: 'Fly To' },
                { v: 'turntable', t: 'Turntable' }
            ]
        });

        this.animationDurationSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 0.25,
            max: 10,
            precision: 2,
            step: 0.25
        });

        this.turntableControls = new Container({ class: 'sca-viewer-turntable-controls' });

        this.turntableDegreesSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 45,
            max: 720,
            precision: 0,
            step: 15
        });

        this.turntableDurationSlider = new SliderInput({
            class: 'sca-viewer-duration-slider',
            min: 1,
            max: 120,
            precision: 1,
            step: 0.5
        });

        this.turntableDirectionSelect = new SelectInput({
            class: 'sca-viewer-select',
            options: [
                { v: 'clockwise', t: 'Clockwise' },
                { v: 'counterclockwise', t: 'Counter-clockwise' }
            ]
        });

        const turntableLoopRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.turntableLoopInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        turntableLoopRow.append(this.turntableLoopInput);
        turntableLoopRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Loop'
        }));

        this.turntableControls.append(this.makeRow('Degrees', this.turntableDegreesSlider));
        this.turntableControls.append(this.makeRow('Duration (s)', this.turntableDurationSlider));
        this.turntableControls.append(this.makeRow('Direction', this.turntableDirectionSelect));
        this.turntableControls.append(turntableLoopRow);

        this.previewAnimationButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Preview Animation'
        });

        this.stopAnimationPreviewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button', 'sca-viewer-exit-preview-button'],
            text: 'Stop Preview',
            hidden: true
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

        const hotspotsTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Hotspots'
        });

        const showHotspotCardsRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.showHotspotCardsInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        showHotspotCardsRow.append(this.showHotspotCardsInput);
        showHotspotCardsRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Show hotspot cards'
        }));

        const topNavigationTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Top Navigation'
        });

        const showTopNavigationRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.showTopNavigationInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        showTopNavigationRow.append(this.showTopNavigationInput);
        showTopNavigationRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Show top navigation'
        }));

        const includeHotspotsNavRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.includeHotspotsNavInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        includeHotspotsNavRow.append(this.includeHotspotsNavInput);
        includeHotspotsNavRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Include Hotspots'
        }));

        const includeRegionsNavRow = new Container({ class: 'sca-viewer-checkbox-row' });
        this.includeRegionsNavInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        includeRegionsNavRow.append(this.includeRegionsNavInput);
        includeRegionsNavRow.append(new Label({
            class: 'sca-export-preview-label',
            text: 'Include Regions'
        }));

        const navigationPreviewTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Navigation Order'
        });

        this.navigationPreviewContainer = new Container({
            class: 'sca-viewer-nav-preview'
        });

        const backgroundTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Background'
        });

        this.backgroundTypeSelect = new SelectInput({
            class: 'sca-viewer-select',
            options: [
                { v: 'color', t: 'Color' },
                { v: 'transparent', t: 'Transparent' },
                { v: 'image', t: 'Image' },
                { v: 'panorama', t: 'Panorama / HDRI' }
            ]
        });

        this.backgroundColorPicker = new ColorPicker({
            class: 'sca-viewer-background-color-picker',
            channels: 3,
            value: [0, 0, 0]
        });

        this.backgroundHexInput = new TextInput({
            class: ['sca-hotspot-form-input', 'sca-viewer-background-hex-input'],
            value: '#000000'
        });

        this.backgroundImageButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Choose Image…'
        });

        this.backgroundRemoveImageButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Remove Image'
        });

        this.backgroundFilenameLabel = new Label({
            class: 'sca-viewer-background-filename',
            text: 'No image selected'
        });

        this.backgroundColorRow = new Container({ class: 'sca-viewer-background-controls' });
        this.backgroundColorRow.append(this.makeRow('Color', this.backgroundColorPicker));
        this.backgroundColorRow.append(this.makeRow('Hex', this.backgroundHexInput));

        this.backgroundImageRow = new Container({ class: 'sca-viewer-background-controls' });
        this.backgroundImageRow.append(this.backgroundImageButton);
        this.backgroundImageRow.append(this.backgroundFilenameLabel);
        this.backgroundImageRow.append(this.backgroundRemoveImageButton);

        this.previewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Preview Viewer Camera'
        });

        this.exitPreviewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button', 'sca-viewer-exit-preview-button'],
            text: 'Exit Viewer Preview',
            hidden: true
        });

        const viewerInteractionPreviewRow = new Container({ class: 'sca-export-preview-row' });
        const viewerInteractionPreviewInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: false
        });
        const viewerInteractionPreviewLabel = new Label({
            class: 'sca-export-preview-label',
            text: 'Authoring Interaction Preview'
        });
        viewerInteractionPreviewRow.append(viewerInteractionPreviewInput);
        viewerInteractionPreviewRow.append(viewerInteractionPreviewLabel);

        const authoringPreviewNote = new Label({
            class: 'sca-viewer-preview-note',
            text: 'Authoring preview uses storage-index region pick (Centers or Rings). Runtime preview runs the exported viewer.'
        });

        const runtimePreviewSpikeRow = new Container({ class: 'sca-export-preview-row' });
        const runtimePreviewSpikeInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: false
        });
        const runtimePreviewSpikeLabel = new Label({
            class: 'sca-export-preview-label',
            text: 'Runtime preview: Gaussian Pick Spike'
        });
        runtimePreviewSpikeRow.append(runtimePreviewSpikeInput);
        runtimePreviewSpikeRow.append(runtimePreviewSpikeLabel);

        const runtimePreviewButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-viewer-action-button'],
            text: 'Open Runtime Viewer Preview'
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
        this.append(this.turntableControls);
        this.append(this.previewAnimationButton);
        this.append(this.stopAnimationPreviewButton);
        this.append(interactionTitle);
        this.append(this.makeRow('Duration (s)', this.focusTransitionSlider));

        const homeTitle = new Label({
            class: 'sca-panel-subsection-label',
            text: 'Home / Reset Transition'
        });
        this.append(homeTitle);
        this.append(this.makeRow('Duration (s)', this.homeTransitionSlider));
        this.append(hotspotsTitle);
        this.append(showHotspotCardsRow);
        this.append(topNavigationTitle);
        this.append(showTopNavigationRow);
        this.append(includeHotspotsNavRow);
        this.append(includeRegionsNavRow);
        this.append(navigationPreviewTitle);
        this.append(this.navigationPreviewContainer);
        this.append(backgroundTitle);
        this.append(this.makeRow('Type', this.backgroundTypeSelect));
        this.append(this.backgroundColorRow);
        this.append(this.backgroundImageRow);
        this.append(this.previewButton);
        this.append(this.exitPreviewButton);
        this.append(viewerInteractionPreviewRow);
        this.append(authoringPreviewNote);
        this.append(runtimePreviewSpikeRow);
        this.append(runtimePreviewButton);

        runtimePreviewButton.on('click', () => {
            this.events.fire('sca.runtimeViewerPreview.open', {
                useGaussianPickSpike: runtimePreviewSpikeInput.value
            });
        });

        viewerInteractionPreviewInput.on('change', (value: boolean) => {
            this.events.fire('sca.viewerInteractionPreview.setEnabled', value);
        });

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

        this.turntableDegreesSlider.on('change', (value: number) => {
            this.emitTurntablePatch({ degrees: value });
        });

        this.turntableDurationSlider.on('change', (value: number) => {
            this.emitTurntablePatch({ duration: value });
        });

        this.turntableDirectionSelect.on('change', (value: string) => {
            this.emitTurntablePatch({ direction: value as ScaTurntableDirection });
        });

        this.turntableLoopInput.on('change', (value: boolean) => {
            this.emitTurntablePatch({ loop: value });
        });

        this.previewAnimationButton.on('click', () => {
            this.events.fire('sca.viewer.animation.preview.start');
        });

        this.stopAnimationPreviewButton.on('click', () => {
            this.events.fire('sca.viewer.animation.preview.stop');
        });

        this.bindSliderHistory(this.animationDurationSlider);
        this.bindSliderHistory(this.turntableDegreesSlider);
        this.bindSliderHistory(this.turntableDurationSlider);

        this.focusTransitionSlider.on('change', (value: number) => {
            this.emitInteractionPatch({ focusTransition: { duration: value } });
        });

        this.homeTransitionSlider.on('change', (value: number) => {
            this.emitInteractionPatch({ homeTransition: { duration: value } });
        });

        this.showHotspotCardsInput.on('change', (value: boolean) => {
            this.emitHotspotsPatch({ showCards: value });
        });

        this.showTopNavigationInput.on('change', (value: boolean) => {
            this.emitNavigationTargetsPatch({ enabled: value });
        });

        this.includeHotspotsNavInput.on('change', (value: boolean) => {
            this.emitNavigationTargetsPatch({ hotspots: value });
        });

        this.includeRegionsNavInput.on('change', (value: boolean) => {
            this.emitNavigationTargetsPatch({ regions: value });
        });

        this.backgroundTypeSelect.on('change', (value: string) => {
            if (this.syncing) {
                return;
            }
            this.events.fire('sca.viewer.background.type.set', value);
        });

        this.backgroundColorPicker.on('change', (value: number[]) => {
            if (this.syncing) {
                return;
            }
            const hex = rgbToHex(value[0], value[1], value[2]);
            this.syncing = true;
            this.backgroundHexInput.value = hex;
            this.syncing = false;
            this.events.fire('sca.viewer.background.color.set', hex);
        });

        this.backgroundHexInput.on('change', (value: string) => {
            if (this.syncing) {
                return;
            }
            const trimmed = value.trim();
            if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
                return;
            }
            const hex = trimmed.toLowerCase();
            const { r, g, b } = parseHexColor(hex);
            this.syncing = true;
            this.backgroundColorPicker.value = [r, g, b];
            this.syncing = false;
            this.events.fire('sca.viewer.background.color.set', hex);
        });

        this.backgroundImageButton.on('click', () => {
            this.events.fire('sca.viewer.background.image.import');
        });

        this.backgroundRemoveImageButton.on('click', () => {
            this.events.fire('sca.viewer.background.image.remove');
        });

        this.bindVectorHistory(this.positionInput);
        this.bindVectorHistory(this.targetInput);
        this.bindSliderHistory(this.fovSlider);
        this.bindSliderHistory(this.animationDurationSlider);
        this.bindSliderHistory(this.focusTransitionSlider);
        this.bindSliderHistory(this.homeTransitionSlider);
        this.bindTextHistory(this.backgroundHexInput);
        this.bindColorPickerHistory(this.backgroundColorPicker);

        events.on('sca.project.changed', () => {
            this.refresh();
        });

        events.on('sca.viewer.preview.changed', () => {
            this.refreshPreviewState();
        });

        events.on('sca.viewer.animation.preview.changed', () => {
            this.refreshAnimationPreviewState();
        });

        this.refresh();
    }

    private makeRow(
        labelText: string,
        control: VectorInput | SliderInput | SelectInput | ColorPicker | TextInput
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

    private emitTurntablePatch(patch: Partial<NonNullable<ScaViewerConfig['camera']['animation']['turntable']>>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.camera.animation.turntable.update', patch);
    }

    private emitInteractionPatch(patch: Partial<ScaViewerConfig['interaction']>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.interaction.update', patch);
    }

    private emitHotspotsPatch(patch: Partial<NonNullable<ScaViewerConfig['hotspots']>>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.hotspots.update', patch);
    }

    private emitNavigationTargetsPatch(patch: Partial<NonNullable<ScaViewerConfig['navigationTargets']>>): void {
        if (this.syncing) {
            return;
        }
        this.events.fire('sca.viewer.navigationTargets.update', patch);
    }

    private bindVectorHistory(input: VectorInput): void {
        input.dom.addEventListener('focusin', () => {
            this.events.invoke('sca.history.beginTransaction');
        });
        input.dom.addEventListener('focusout', () => {
            this.events.invoke('sca.history.commitTransaction');
        });
    }

    private bindSliderHistory(slider: SliderInput): void {
        slider.on('slide:start', () => {
            this.events.invoke('sca.history.beginTransaction');
        });
        slider.on('slide:end', () => {
            this.events.invoke('sca.history.commitTransaction');
        });
    }

    private bindTextHistory(input: TextInput): void {
        input.dom.addEventListener('focusin', () => {
            this.events.invoke('sca.history.beginTransaction');
        });
        input.dom.addEventListener('focusout', () => {
            this.events.invoke('sca.history.commitTransaction');
        });
    }

    private bindColorPickerHistory(picker: ColorPicker): void {
        picker.dom.addEventListener('pointerdown', () => {
            this.events.invoke('sca.history.beginTransaction');
        });
        picker.dom.addEventListener('pointerup', () => {
            this.events.invoke('sca.history.commitTransaction');
        });
        picker.dom.addEventListener('pointerleave', () => {
            this.events.invoke('sca.history.commitTransaction');
        });
    }

    private refreshPreviewState(): void {
        const active = this.events.invoke('sca.viewer.preview.active') as boolean;
        this.previewButton.hidden = active;
        this.exitPreviewButton.hidden = !active;
    }

    private refreshAnimationPreviewState(): void {
        const active = this.events.invoke('sca.viewer.animation.preview.active') as boolean;
        this.previewAnimationButton.hidden = active;
        this.stopAnimationPreviewButton.hidden = !active;
        this.refreshAnimationControlsEnabled(active);
    }

    private refreshAnimationControlsEnabled(previewActive = false): void {
        const viewer = this.events.invoke('sca.viewer.get') as ScaViewerConfig | null;
        const animationType = viewer?.camera.animation.type ?? 'none';
        const disableEditing = previewActive;

        this.animationTypeSelect.enabled = !disableEditing;
        this.animationDurationSlider.enabled = !disableEditing && animationType === 'flyTo';
        this.turntableDegreesSlider.enabled = !disableEditing && animationType === 'turntable';
        this.turntableDurationSlider.enabled = !disableEditing && animationType === 'turntable';
        this.turntableDirectionSelect.enabled = !disableEditing && animationType === 'turntable';
        this.turntableLoopInput.enabled = !disableEditing && animationType === 'turntable';
        this.previewAnimationButton.enabled = !disableEditing && animationType !== 'none';
    }

    private refresh(): void {
        const viewer = this.events.invoke('sca.viewer.get') as ScaViewerConfig | null;
        if (!viewer) {
            return;
        }

        const { initial, animation } = viewer.camera;
        const { navigation, interaction, background, hotspots, navigationTargets } = viewer;

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

        const turntable = animation.turntable!;
        this.turntableControls.hidden = animation.type !== 'turntable';
        this.turntableDegreesSlider.value = turntable.degrees;
        this.turntableDurationSlider.value = turntable.duration;
        this.turntableDirectionSelect.value = turntable.direction;
        this.turntableLoopInput.value = turntable.loop;

        this.focusTransitionSlider.value = interaction.focusTransition.duration;
        this.homeTransitionSlider.value = interaction.homeTransition.duration;
        this.showHotspotCardsInput.value = hotspots?.showCards !== false;

        const navTargets = navigationTargets ?? { enabled: true, hotspots: true, regions: true };
        this.showTopNavigationInput.value = navTargets.enabled !== false;
        this.includeHotspotsNavInput.value = navTargets.hotspots !== false;
        this.includeRegionsNavInput.value = navTargets.regions !== false;
        this.includeHotspotsNavInput.enabled = navTargets.enabled !== false;
        this.includeRegionsNavInput.enabled = navTargets.enabled !== false;

        this.refreshNavigationPreview(viewer);

        const bg = background ?? { type: 'color' as const, color: '#000000' };
        this.backgroundTypeSelect.value = bg.type;
        this.backgroundColorRow.hidden = bg.type !== 'color';
        this.backgroundImageRow.hidden = bg.type !== 'image' && bg.type !== 'panorama';

        if (bg.type === 'color') {
            const hex = bg.color ?? '#000000';
            const { r, g, b } = parseHexColor(hex);
            this.backgroundColorPicker.value = [r, g, b];
            this.backgroundHexInput.value = hex;
        }

        if (bg.type === 'image' || bg.type === 'panorama') {
            const filename = bg.image?.filename;
            this.backgroundFilenameLabel.text = filename ?? 'No image selected';
            this.backgroundRemoveImageButton.enabled = !!filename;
        }

        this.syncing = false;

        this.distanceLabel.text = `Distance: ${computeCameraDistance(initial).toFixed(2)}`;
        this.refreshPreviewState();
        this.refreshAnimationPreviewState();
    }

    private refreshNavigationPreview(viewer: ScaViewerConfig): void {
        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        if (!project) {
            return;
        }

        const entries = buildNavigationPreview(
            project.hotspots,
            project.regions,
            viewer.navigationTargets
        );

        this.navigationPreviewContainer.clear();

        if (entries.length === 0) {
            const emptyLabel = new Label({
                class: 'sca-viewer-nav-preview-empty',
                text: 'No navigation targets'
            });
            this.navigationPreviewContainer.append(emptyLabel);
            return;
        }

        entries.forEach((entry, index) => {
            const typeLabel = entry.type === 'hotspot' ? 'Hotspot' : 'Region';
            const line = new Label({
                class: 'sca-viewer-nav-preview-item',
                text: `${index + 1}. ${typeLabel} — ${entry.name}`
            });
            this.navigationPreviewContainer.append(line);
        });
    }
}

export { ScaViewerPanel };
