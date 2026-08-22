import {
    Button,
    Container,
    Label,
    SliderInput,
    TextInput
} from '@playcanvas/pcui';

import { Events } from '../../events';

import { generateRigId } from '../ids/generate-rig-id';
import { createDefaultRigNode } from '../rig/rig-defaults';
import { ScaProject } from '../types/project';
import { ScaRigNode } from '../types/rig';
import { ScaSectionLayoutManager } from './sca-section-layout-state';

class ScaRigPanel extends Container {
    private listContainer: Container;
    private formContainer: Container;
    private selectedNodeId: string | null = null;
    private mountedNodeId: string | null = null;
    private syncing = false;

    private nameInput: TextInput | null = null;
    private positionInputs: SliderInput[] = [];
    private rotationInputs: SliderInput[] = [];

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
            this.setSelectedNodeId(id);
        });

        events.on('sca.project.changed', () => {
            this.rebuildList();
            this.refreshSelectedNodeForm();
        });

        this.rebuildList();
    }

    private setSelectedNodeId(nodeId: string | null) {
        if (this.selectedNodeId === nodeId) {
            return;
        }

        this.selectedNodeId = nodeId;
        this.events.fire('sca.rig.node.selected', nodeId);
        this.rebuildList();
        this.refreshSelectedNodeForm(true);
    }

    private rebuildList() {
        this.listContainer.clear();

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        const nodes = project?.rig?.nodes ?? [];

        if (nodes.length === 0) {
            this.listContainer.append(new Label({
                class: 'sca-hotspot-list-empty',
                text: 'No rig nodes yet.'
            }));
            return;
        }

        for (const node of nodes) {
            const row = new Container({
                class: ['sca-hotspot-list-item', ...(this.selectedNodeId === node.id ? ['selected'] : [])]
            });
            row.append(new Label({
                class: 'sca-hotspot-list-item-name',
                text: node.name
            }));
            row.on('click', () => {
                this.setSelectedNodeId(node.id);
            });
            this.listContainer.append(row);
        }
    }

    private clearForm() {
        this.formContainer.clear();
        this.mountedNodeId = null;
        this.nameInput = null;
        this.positionInputs = [];
        this.rotationInputs = [];
    }

    private refreshSelectedNodeForm(forceRemount = false) {
        if (!this.selectedNodeId) {
            this.clearForm();
            return;
        }

        const project = this.events.invoke('sca.project.get') as ScaProject | null;
        const node = project?.rig?.nodes.find((entry) => entry.id === this.selectedNodeId);
        if (!node) {
            this.setSelectedNodeId(null);
            this.clearForm();
            return;
        }

        if (forceRemount || this.mountedNodeId !== this.selectedNodeId) {
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

        const deleteButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-region-delete-button'],
            text: 'Delete Rig Node'
        });
        deleteButton.on('click', () => {
            if (!this.selectedNodeId) {
                return;
            }
            const nodeId = this.selectedNodeId;
            this.setSelectedNodeId(null);
            this.events.fire('sca.rig.node.delete', nodeId);
        });
        this.formContainer.append(deleteButton);

        this.nameInput.on('change', () => {
            if (!this.nameInput) {
                return;
            }
            this.commitNodePatch({ name: this.nameInput.value.trim() || node.name });
        });
    }

    private syncFormValues(node: ScaRigNode) {
        if (this.mountedNodeId !== node.id) {
            return;
        }

        this.syncing = true;

        if (this.nameInput) {
            this.nameInput.value = node.name;
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
        if (!this.selectedNodeId || this.syncing) {
            return;
        }

        this.events.fire('sca.rig.node.update', this.selectedNodeId, patch);
    }
}

export { ScaRigPanel };
