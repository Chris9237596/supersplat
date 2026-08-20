import { Container } from '@playcanvas/pcui';



import { Events } from '../events';

import { Scene } from '../scene';

import { ToolManager } from '../tools/tool-manager';



import { getScaFocusState } from './focus/sca-focus-events';

import { ScaFocusController } from './focus/sca-focus-tool';

import { HotspotMarkerManager } from './markers/hotspot-marker-manager';

import { HotspotPlaceTool } from './tools/hotspot-place-tool';



const registerScaScene = (

    events: Events,

    scene: Scene,

    toolsContainer: HTMLElement,

    canvasContainer: Container,

    toolManager: ToolManager

): void => {

    new HotspotMarkerManager(events, scene, canvasContainer);



    toolManager.register(

        'scaHotspotPlace',

        new HotspotPlaceTool(events, scene, toolsContainer, canvasContainer)

    );



    events.on('sca.hotspot.place.start', () => {

        if (!events.invoke('sca.hotspot.getSelected')) {

            return;

        }

        events.fire('tool.scaHotspotPlace');

    });



    const focusState = getScaFocusState();

    new ScaFocusController(events, scene, focusState, canvasContainer);

};



export { registerScaScene };


