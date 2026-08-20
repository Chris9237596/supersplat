import { Events } from '../../events';
import { defaultCameraForHotspot } from '../hotspot-defaults';

import { ScaFocusState } from './sca-focus-state';

let focusState: ScaFocusState | null = null;

const registerScaFocusEvents = (events: Events): void => {
    focusState = new ScaFocusState();

    events.function('sca.focus.mode', () => {
        return focusState!.isModeActive();
    });

    events.function('sca.focus.position', () => {
        return focusState!.getPosition();
    });

    events.on('sca.focus.mode.set', (active: boolean) => {
        focusState!.setMode(active);
        events.fire('sca.focus.changed');
    });

    events.on('sca.focus.mode.toggle', () => {
        events.fire('sca.focus.mode.set', !focusState!.isModeActive());
    });

    events.on('sca.focus.useForSelectedHotspot', () => {
        const position = focusState!.getPosition();
        const selectedId = events.invoke('sca.hotspot.getSelected') as string | null;
        if (!position || !selectedId) {
            return;
        }

        events.fire('sca.hotspot.update', selectedId, {
            position,
            camera: defaultCameraForHotspot(position)
        });
    });
};

const getScaFocusState = (): ScaFocusState => {
    if (!focusState) {
        throw new Error('[SCA] focus events not registered');
    }
    return focusState;
};

export { getScaFocusState, registerScaFocusEvents };