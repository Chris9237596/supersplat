import {
    Button,
    Container,
    Label,
    SelectInput,
    SliderInput,
    TextInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import { generateRigId } from '../ids/generate-rig-id';
import { createDefaultRigNode } from '../rig/rig-defaults';
import {
    buildRigParentSelectOptions,
    resolveRigParentSelectValue,
    rigParentIdFromSelectValue
} from '../rig/rig-hierarchy-ui';
import { ScaRigReparentMode } from '../rig/rig-hierarchy';
import { ScaRigAnimationPlaybackState } from '../rig/rig-animation-types';
import { ScaProject } from '../types/project';
import { ScaRigNode } from '../types/rig';
import { ScaSectionLayoutManager } from './sca-section-layout-state';

class ScaRigPanel extends Container {
    private listContainer: Container;
    private formContainer: Container;
    private mountedNodeId: string | null = null;
    private syncing = false;

    private nameInput: TextInput | null = null;
    private moveModeButton: Button | null = null;
    private rotateModeButton: Button | null = null;
    private scaleModeButton: Button | null = null;
    private parentSelect: SelectInput | null = null;
    private reparentModeSelect: SelectInput | null = null;
    private positionInputs: SliderInput[] = [];
    private rotationInputs: SliderInput[] = [];
    private animationSection: Container | null = null;
    private animationInfoLabel: Label | null = null;
    private animationTimeLabel: Label | null = null;
    private createAnimationButton: Button | null = null;
    private playAnimationButton: Button | null = null;
    private stopAnimationButton: Button | null = null;
    private resetAnimationButton: Button | null = null;

    constructor(private events: Events, _sectionLayout: ScaSectionLayoutManager) {
        super({ class: 'sca-rig-panel' });

        const listHeader = new Container({ class: 'sca-hotspot-list-header' });
        listHeader.append(new Label({ class: 'sca-panel-section-spacer' }));

        const addButton = new Button({
            class: 'sca-hotspot-form-button',
            text: '+ Add Rig Node'
        });
        listHeader.append(addButton);

        this.listContainer = new Container({ class: 'sca-rig-node-list' });
        this.formContainer = new Container({ class: 'sca-rig-node-form' });

        this.append(listHeader);
        this.append(this.listContainer);
        this.append(this.formContainer);

        addButton.on('click', () => {
            const project = this.events.invoke('sca.project.get') as ScaProject | null;
            if (!project) {
                return;
            }

            const id = generateRigId(project);
            this.events.fire('sca.rig.node.add', createDefaultRigNode(id));
            this.events.fire('sca.rig.node.select', id);
        });

        events.on('sca.project.changed', () => {
            this.rebuildList();
            this.refreshSelectedNodeForm();
        });

        events.on('sca.rig.node.selected', () => {
            this.rebuildList();
            this.refreshSelectedNodeForm();
        });

        events.on('tool.activated', () => {
            this.syncTransformModeButtons();
        });

        events.on('tool.deactivated', () => {
            this.syncTransformModeButtons();
        });

        events.on('sca.rig.animation.changed', () => {
            this.syncAnimationControls();
        });

        this.rebuildList();
    }

    private getSelectedNodeId(): string | null {
        return this.events.invoke('sca.rig.getSelected') as string | null;
    }

    private rebuildList() {
        this.listContainer.clear();

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        const nodes = project?.rig?.nodes ?? [];
        const selectedNodeId = this.getSelectedNodeId();

        if (nodes.length === 0) {
            this.listContainer.append(new Label({
                class: 'sca-hotspot-list-empty',
                text: 'No rig nodes yet.'
            }));
            return;
        }

        for (const node of nodes) {
            const row = new Container({
                class: ['sca-hotspot-list-item', ...(selectedNodeId === node.id ? ['selected'] : [])]
            });
            row.append(new Label({
                class: 'sca-hotspot-list-item-name',
                text: node.name
            }));
            row.on('click', () => {
                const selectedId = this.events.invoke('sca.rig.getSelected') as string | null;
                this.events.fire(
                    'sca.rig.node.select',
                    selectedId === node.id ? null : node.id
                );
            });
            this.listContainer.append(row);
        }
    }

    private clearForm() {
        this.formContainer.clear();
        this.mountedNodeId = null;
        this.nameInput = null;
        this.moveModeButton = null;
        this.rotateModeButton = null;
        this.scaleModeButton = null;
        this.parentSelect = null;
        this.reparentModeSelect = null;
        this.positionInputs = [];
        this.rotationInputs = [];
        this.animationSection = null;
        this.animationInfoLabel = null;
        this.animationTimeLabel = null;
        this.createAnimationButton = null;
        this.playAnimationButton = null;
        this.stopAnimationButton = null;
        this.resetAnimationButton = null;
    }

    private refreshSelectedNodeForm(forceRemount = false) {
        const selectedNodeId = this.getSelectedNodeId();
        if (!selectedNodeId) {
            this.clearForm();
            return;
        }

        const nodes = this.events.invoke('sca.rig.node.list') as ScaRigNode[];
        const node = nodes.find((entry) => entry.id === selectedNodeId) ?? null;
        if (!node) {
            this.events.fire('sca.rig.node.select', null);
            this.clearForm();
            return;
        }

        if (forceRemount || this.mountedNodeId !== selectedNodeId) {
            this.mountForm(node);
            return;
        }

        this.syncFormValues(node);
    }

    private mountForm(node: ScaRigNode) {
        this.clearForm();
        this.mountedNodeId = node.id;

        const nameRow = new Container({ class: 'sca-hotspot-form-row' });
        nameRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Name' }));
        this.nameInput = new TextInput({
            class: 'sca-hotspot-form-input',
            value: node.name
        });
        nameRow.append(this.nameInput);
        this.formContainer.append(nameRow);

        this.formContainer.append(this.createTransformModeRow());
        this.formContainer.append(this.createAnimationTestSection());

        const hierarchyTitle = new Label({
            class: ['sca-panel-subsection-label', 'sca-panel-subsection-label-nested'],
            text: 'HIERARCHY'
        });
        this.formContainer.append(hierarchyTitle);

        const parentRow = new Container({ class: 'sca-hotspot-form-row' });
        parentRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Parent' }));
        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        const rig = project?.rig;
        this.parentSelect = new SelectInput({
            class: 'sca-hotspot-form-input',
            options: rig ? buildRigParentSelectOptions(rig, node.id) : [],
            value: resolveRigParentSelectValue(node.parentId)
        });
        parentRow.append(this.parentSelect);
        this.formContainer.append(parentRow);

        const reparentModeRow = new Container({ class: 'sca-hotspot-form-row' });
        reparentModeRow.append(new Label({ class: 'sca-hotspot-form-label', text: 'Reparent Mode' }));
        this.reparentModeSelect = new SelectInput({
            class: 'sca-hotspot-form-input',
            options: [
                { v: 'keep-world', t: 'Keep World Position' },
                { v: 'keep-local', t: 'Keep Local Transform' }
            ],
            value: 'keep-world'
        });
        reparentModeRow.append(this.reparentModeSelect);
        this.formContainer.append(reparentModeRow);

        this.parentSelect.on('change', () => {
            if (this.syncing || !this.parentSelect) {
                return;
            }

            const selectedNodeId = this.getSelectedNodeId();
            if (!selectedNodeId) {
                return;
            }

            const nodes = this.events.invoke('sca.rig.node.list') as ScaRigNode[];
            const currentNode = nodes.find((entry) => entry.id === selectedNodeId);
            if (!currentNode) {
                return;
            }

            const nextParentId = rigParentIdFromSelectValue(this.parentSelect.value);
            const currentParentId = currentNode.parentId ?? null;
            if (nextParentId === currentParentId) {
                return;
            }

            const mode = (this.reparentModeSelect?.value ?? 'keep-world') as ScaRigReparentMode;
            this.events.fire('sca.rig.node.setParent', selectedNodeId, nextParentId, mode);
        });

        this.formContainer.append(this.createVec3Row(
            'Position',
            this.positionInputs,
            node.position,
            (values) => this.commitNodePatch({ position: values })
        ));

        this.formContainer.append(this.createVec3Row(
            'Rotation',
            this.rotationInputs,
            node.rotation,
            (values) => this.commitNodePatch({ rotation: values }),
            { step: 1, min: -180, max: 180 }
        ));

        const resetRestButton = new Button({
            class: 'sca-hotspot-form-button',
            text: 'Reset to Rest Pose'
        });
        resetRestButton.on('click', () => {
            const selectedNodeId = this.getSelectedNodeId();
            if (!selectedNodeId) {
                return;
            }
            this.events.fire('sca.rig.node.resetToRest', selectedNodeId);
        });
        this.formContainer.append(resetRestButton);

        const setRestButton = new Button({
            class: 'sca-hotspot-form-button',
            text: 'Set Current as Rest Pose'
        });
        setRestButton.on('click', () => {
            const selectedNodeId = this.getSelectedNodeId();
            if (!selectedNodeId) {
                return;
            }
            this.events.fire('sca.rig.node.setRestFromCurrent', selectedNodeId);
        });
        this.formContainer.append(setRestButton);

        const deleteButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-region-delete-button'],
            text: 'Delete Rig Node'
        });
        deleteButton.on('click', () => {
            const selectedNodeId = this.getSelectedNodeId();
            if (!selectedNodeId) {
                return;
            }
            this.events.fire('sca.rig.node.select', null);
            this.events.fire('sca.rig.node.delete', selectedNodeId);
        });
        this.formContainer.append(deleteButton);

        this.nameInput.on('change', () => {
            if (!this.nameInput) {
                return;
            }
            this.commitNodePatch({ name: this.nameInput.value.trim() || node.name });
        });

        this.syncTransformModeButtons();
        this.syncAnimationControls();
    }

    private createAnimationTestSection(): Container {
        const section = new Container({ class: 'sca-rig-animation-test' });

        const title = new Label({
            class: ['sca-panel-subsection-label', 'sca-panel-subsection-label-nested'],
            text: 'ANIMATION TEST (EXPERIMENTAL)'
        });
        section.append(title);

        this.createAnimationButton = new Button({
            class: 'sca-hotspot-form-button',
            text: 'Create Test Animation'
        });
        this.createAnimationButton.on('click', () => {
            this.events.fire('sca.rig.animation.createTest');
        });
        section.append(this.createAnimationButton);

        this.animationInfoLabel = new Label({
            class: 'sca-rig-animation-info',
            text: 'No test animation'
        });
        section.append(this.animationInfoLabel);

        this.animationTimeLabel = new Label({
            class: 'sca-rig-animation-time',
            text: '0.00 / 0.00'
        });
        section.append(this.animationTimeLabel);

        const controls = new Container({ class: 'sca-rig-animation-controls' });
        this.playAnimationButton = new Button({
            class: ['sca-rig-transform-mode-button'],
            text: 'Play'
        });
        this.stopAnimationButton = new Button({
            class: ['sca-rig-transform-mode-button'],
            text: 'Stop'
        });
        this.resetAnimationButton = new Button({
            class: ['sca-rig-transform-mode-button'],
            text: 'Reset'
        });

        this.playAnimationButton.on('click', () => {
            this.events.fire('sca.rig.animation.play');
        });
        this.stopAnimationButton.on('click', () => {
            this.events.fire('sca.rig.animation.stop');
        });
        this.resetAnimationButton.on('click', () => {
            this.events.fire('sca.rig.animation.reset');
        });

        controls.append(this.playAnimationButton);
        controls.append(this.stopAnimationButton);
        controls.append(this.resetAnimationButton);
        section.append(controls);

        this.animationSection = section;
        return section;
    }

    private getAnimationState(): ScaRigAnimationPlaybackState {
        return this.events.invoke('sca.rig.animation.getState') as ScaRigAnimationPlaybackState;
    }

    private syncAnimationControls() {
        if (!this.animationSection) {
            return;
        }

        const state = this.getAnimationState();
        const hasClip = !!state.clip;
        const duration = state.clip?.duration ?? 1;

        if (this.animationInfoLabel) {
            this.animationInfoLabel.text = hasClip ?
                `${state.clip!.name}\nDuration: ${duration.toFixed(1)}s` :
                'No test animation';
        }

        if (this.animationTimeLabel) {
            this.animationTimeLabel.text = `${state.currentTime.toFixed(2)} / ${duration.toFixed(2)}`;
        }

        if (this.createAnimationButton) {
            this.createAnimationButton.enabled = !!this.getSelectedNodeId();
        }

        if (this.playAnimationButton) {
            this.playAnimationButton.enabled = hasClip && !state.playing;
        }

        if (this.stopAnimationButton) {
            this.stopAnimationButton.enabled = hasClip && (state.playing || state.influenceActive);
        }

        if (this.resetAnimationButton) {
            this.resetAnimationButton.enabled = hasClip;
        }
    }

    private createTransformModeRow(): Container {
        const row = new Container({ class: 'sca-rig-transform-modes' });

        this.moveModeButton = new Button({
            class: ['sca-rig-transform-mode-button'],
            text: 'Move'
        });
        this.rotateModeButton = new Button({
            class: ['sca-rig-transform-mode-button'],
            text: 'Rotate'
        });
        this.scaleModeButton = new Button({
            class: ['sca-rig-transform-mode-button', 'sca-rig-transform-mode-button-disabled'],
            text: 'Scale'
        });
        this.scaleModeButton.enabled = false;
        this.scaleModeButton.dom.title = 'Scale support is not available yet';

        this.moveModeButton.on('click', () => {
            this.events.fire('tool.move');
        });
        this.rotateModeButton.on('click', () => {
            this.events.fire('tool.rotate');
        });

        row.append(this.moveModeButton);
        row.append(this.rotateModeButton);
        row.append(this.scaleModeButton);

        return row;
    }

    private syncTransformModeButtons() {
        if (!this.moveModeButton || !this.rotateModeButton) {
            return;
        }

        const activeTool = this.events.invoke('tool.active') as string | null;
        this.moveModeButton.class.toggle('active', activeTool === 'move');
        this.rotateModeButton.class.toggle('active', activeTool === 'rotate');
    }

    private syncFormValues(node: ScaRigNode) {
        if (this.mountedNodeId !== node.id) {
            return;
        }

        this.syncing = true;

        if (this.nameInput) {
            this.nameInput.value = node.name;
        }

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        if (this.parentSelect && project?.rig) {
            this.parentSelect.options = buildRigParentSelectOptions(project.rig, node.id);
            this.parentSelect.value = resolveRigParentSelectValue(node.parentId);
        }

        for (let axis = 0; axis < 3; axis++) {
            if (this.positionInputs[axis]) {
                this.positionInputs[axis].value = node.position[axis];
            }
            if (this.rotationInputs[axis]) {
                this.rotationInputs[axis].value = node.rotation[axis];
            }
        }

        this.syncing = false;
    }

    private createVec3Row(
        label: string,
        inputsOut: SliderInput[],
        values: [number, number, number],
        onCommit: (values: [number, number, number]) => void,
        options: { min?: number; max?: number; step?: number } = {}
    ) {
        const row = new Container({ class: 'sca-rig-vec3-group' });
        row.append(new Label({
            class: ['sca-panel-subsection-label', 'sca-panel-subsection-label-nested'],
            text: label
        }));

        const axisLabels = ['X', 'Y', 'Z'];
        const inputs: SliderInput[] = [];

        for (let axis = 0; axis < 3; axis++) {
            const axisRow = new Container({ class: 'sca-hotspot-form-row' });
            axisRow.append(new Label({ class: 'sca-hotspot-form-label', text: axisLabels[axis] }));
            const input = new SliderInput({
                class: 'sca-hotspot-form-slider',
                min: options.min ?? -10,
                max: options.max ?? 10,
                step: options.step ?? 0.01,
                precision: options.step && options.step >= 1 ? 0 : 2,
                value: values[axis]
            });
            inputs.push(input);
            axisRow.append(input);
            row.append(axisRow);

            const commit = () => {
                if (this.syncing) {
                    return;
                }
                onCommit([
                    inputs[0].value,
                    inputs[1].value,
                    inputs[2].value
                ]);
            };

            let pointerActive = false;

            input.on('change', commit);
            input.dom.addEventListener('pointerdown', () => {
                pointerActive = true;
                this.events.invoke('sca.history.beginTransaction');
            });
            const finishPointerEdit = () => {
                if (!pointerActive) {
                    return;
                }
                pointerActive = false;
                this.events.invoke('sca.history.commitTransaction');
            };
            input.dom.addEventListener('pointerup', finishPointerEdit);
            input.dom.addEventListener('pointercancel', finishPointerEdit);
            input.dom.addEventListener('blur', () => {
                if (pointerActive) {
                    return;
                }
                this.events.invoke('sca.history.commitTransaction');
            });
        }

        inputsOut.splice(0, inputsOut.length, ...inputs);
        return row;
    }

    private commitNodePatch(patch: Partial<ScaRigNode>) {
        const selectedNodeId = this.getSelectedNodeId();
        if (!selectedNodeId || this.syncing) {
            return;
        }

        this.events.fire('sca.rig.node.update', selectedNodeId, patch);
    }
}

export { ScaRigPanel };
