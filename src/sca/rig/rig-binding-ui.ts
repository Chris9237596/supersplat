import { ScaRigBindMode, ScaRigNode } from '../types/rig';

import { DEFAULT_RIG_BIND_MODE } from './rig-defaults';

/** PCUI SelectInput aborts option registration when it hits v === ''. */
const RIG_BINDING_NONE_VALUE = '__sca_rig_none__';
const RIG_BIND_MODE_KEEP_WORLD_VALUE = 'keep-world';
const RIG_BIND_MODE_SNAP_VALUE = 'snap';

type RigBindingSelectOption = {
    v: string;
    t: string;
};

type RigBindModeSelectOption = {
    v: ScaRigBindMode;
    t: string;
};

const buildRigBindModeSelectOptions = (): RigBindModeSelectOption[] => ([
    { v: 'keep-world', t: 'Keep World Position' },
    { v: 'snap', t: 'Snap to Node' }
]);

const resolveRigBindModeSelectValue = (
    bindMode: ScaRigBindMode | null | undefined
): ScaRigBindMode => {
    if (bindMode === 'snap') {
        return 'snap';
    }

    return DEFAULT_RIG_BIND_MODE;
};

const buildRigBindingSelectOptions = (nodes: ScaRigNode[]): RigBindingSelectOption[] => {
    const options: RigBindingSelectOption[] = [
        { v: RIG_BINDING_NONE_VALUE, t: 'None' }
    ];

    for (const node of nodes) {
        options.push({ v: node.id, t: node.name });
    }

    return options;
};

const resolveRigBindingSelectValue = (
    boundNodeId: string | null | undefined,
    nodes: ScaRigNode[]
): string => {
    if (!boundNodeId) {
        return RIG_BINDING_NONE_VALUE;
    }

    return nodes.some((node) => node.id === boundNodeId) ?
        boundNodeId :
        RIG_BINDING_NONE_VALUE;
};

const rigBindingNodeIdFromSelectValue = (value: string | null | undefined): string | null => {
    if (!value || value === RIG_BINDING_NONE_VALUE) {
        return null;
    }

    return value;
};

/**
 * Mirrors PCUI 6.1.4 SelectInput.options setter behavior for the empty-value early return.
 * Used by tests to verify dropdown options would actually render.
 */
const collectPcuiSelectInputOptionLabels = (options: RigBindingSelectOption[]): string[] => {
    const labels: string[] = [];

    for (const option of options) {
        if (option.v === '') {
            return labels;
        }

        labels.push(option.t);
    }

    return labels;
};

const isScaRigBindingUiDebugEnabled = (): boolean => {
    const debug = (globalThis as typeof globalThis & {
        SCA3D?: { debug?: Record<string, boolean> };
    }).SCA3D?.debug;

    return !!debug?.rigBindingUi;
};

const logScaRigBindingUi = (payload: Record<string, unknown>): void => {
    if (!isScaRigBindingUiDebugEnabled()) {
        return;
    }

    console.log('[SCA RIG BINDING UI]', JSON.stringify(payload, null, 2));
};

export {
    DEFAULT_RIG_BIND_MODE,
    RIG_BIND_MODE_KEEP_WORLD_VALUE,
    RIG_BIND_MODE_SNAP_VALUE,
    RIG_BINDING_NONE_VALUE,
    buildRigBindModeSelectOptions,
    buildRigBindingSelectOptions,
    collectPcuiSelectInputOptionLabels,
    isScaRigBindingUiDebugEnabled,
    logScaRigBindingUi,
    resolveRigBindModeSelectValue,
    resolveRigBindingSelectValue,
    rigBindingNodeIdFromSelectValue,
    RigBindModeSelectOption,
    RigBindingSelectOption
};
