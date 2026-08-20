/**
 * SCA extension entry point.
 *
 * Isolated namespace for future Storyline / hotspot integration.
 */
import { registerScaEvents } from './sca-events';
import { registerScaScene } from './sca-scene';
import { registerScaUi } from './sca-ui';

const registerSca = (): void => {
    console.log('[SCA] initialized');
};

export { registerSca, registerScaEvents, registerScaScene, registerScaUi };
