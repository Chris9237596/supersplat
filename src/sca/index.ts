/**
 * SCA extension entry point.
 *
 * Isolated namespace for future Storyline / hotspot integration.
 */
import { registerScaUi } from './sca-ui';

const registerSca = (): void => {
    console.log('[SCA] initialized');
};

export { registerSca, registerScaUi };
