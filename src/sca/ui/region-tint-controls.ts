import { Container, Label, TextInput } from '@playcanvas/pcui';

import { Events } from '../../events';

import { DEFAULT_ACTIVE_TINT, DEFAULT_HOVER_TINT } from '../region-defaults';
import { normalizeHexColor } from '../presentation/region-color';

type RegionTintPreviewHandlers = {
    onPreviewStart?: () => void;
    onPreviewEnd?: () => void;
};

type RegionTintControls = {
    row: Container;
    colorInput: HTMLInputElement;
    hexInput: TextInput;
    setValue: (hex: string) => void;
    getValue: () => string;
    bind: (
        events: Events,
        onCommit: (hex: string) => void,
        preview?: RegionTintPreviewHandlers
    ) => void;
};

const isValidHexColor = (value: string): boolean => {
    return /^#[0-9a-f]{6}$/.test(value.trim().toLowerCase());
};

const createRegionTintControls = (
    labelText: string,
    fallbackHex: string
): RegionTintControls => {
    const row = new Container({ class: 'sca-hotspot-form-row' });
    const label = new Label({ class: ['sca-hotspot-form-label', 'sca-region-tint-label'], text: labelText });

    const controls = new Container({ class: 'sca-region-color-controls' });

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'sca-region-color-swatch';
    controls.dom.appendChild(colorInput);

    const hexInput = new TextInput({
        class: ['sca-hotspot-form-input', 'sca-region-color-hex']
    });

    controls.append(hexInput);
    row.append(label);
    row.append(controls);

    let syncing = false;
    let lastValidHex = fallbackHex;

    const setValue = (hex: string) => {
        const normalized = normalizeHexColor(hex, fallbackHex);
        syncing = true;
        lastValidHex = normalized;
        colorInput.value = normalized;
        hexInput.value = normalized;
        syncing = false;
    };

    const getValue = () => lastValidHex;

    const bind = (
        events: Events,
        onCommit: (hex: string) => void,
        preview?: RegionTintPreviewHandlers
    ) => {
        const commitHex = (hex: string) => {
            const normalized = normalizeHexColor(hex, fallbackHex);
            lastValidHex = normalized;
            onCommit(normalized);
        };

        colorInput.addEventListener('input', () => {
            if (syncing) {
                return;
            }
            const hex = colorInput.value.toLowerCase();
            syncing = true;
            hexInput.value = hex;
            syncing = false;
            commitHex(hex);
        });

        colorInput.addEventListener('pointerdown', () => {
            preview?.onPreviewStart?.();
            events.invoke('sca.history.beginTransaction');
        });
        colorInput.addEventListener('change', () => {
            events.invoke('sca.history.commitTransaction');
            preview?.onPreviewEnd?.();
        });
        colorInput.addEventListener('blur', () => {
            preview?.onPreviewEnd?.();
        });

        hexInput.on('change', () => {
            if (syncing) {
                return;
            }
            const trimmed = hexInput.value.trim().toLowerCase();
            if (!isValidHexColor(trimmed)) {
                syncing = true;
                hexInput.value = lastValidHex;
                colorInput.value = lastValidHex;
                syncing = false;
                return;
            }
            syncing = true;
            colorInput.value = trimmed;
            syncing = false;
            commitHex(trimmed);
        });

        hexInput.dom.addEventListener('focusin', () => {
            preview?.onPreviewStart?.();
            events.invoke('sca.history.beginTransaction');
        });
        hexInput.dom.addEventListener('focusout', () => {
            events.invoke('sca.history.commitTransaction');
            preview?.onPreviewEnd?.();
        });
    };

    setValue(fallbackHex);

    return {
        row,
        colorInput,
        hexInput,
        setValue,
        getValue,
        bind
    };
};

export { createRegionTintControls, RegionTintPreviewHandlers };
