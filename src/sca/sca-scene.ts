import { Container } from '@playcanvas/pcui';



import { Events } from '../events';

import { Scene } from '../scene';

import { ToolManager } from '../tools/tool-manager';



import { getScaFocusState } from './focus/sca-focus-events';

import { ScaFocusController } from './focus/sca-focus-tool';

import { HotspotMarkerManager } from './markers/hotspot-marker-manager';

import { HotspotPlaceTool } from './tools/hotspot-place-tool';

import { ScaAssetStore } from './store/sca-asset-store';
import { registerScaPanoramaBackground } from './viewer/sca-panorama-background';
import { registerScaRegionEvents } from './regions/register-sca-region-events';
import { registerScaRegionCardPreview } from './regions/sca-region-card-preview';
import { registerScaRegionHighlight } from './regions/sca-region-highlight';



const registerScaScene = (

    events: Events,

    scene: Scene,

    toolsContainer: HTMLElement,

    canvasContainer: Container,

    toolManager: ToolManager,

    assetStore: ScaAssetStore

): void => {

    new HotspotMarkerManager(events, scene, canvasContainer);

    registerScaPanoramaBackground(events, scene, assetStore);
    registerScaRegionEvents(events, scene);
    registerScaRegionHighlight(events, scene);
    registerScaRegionCardPreview(events, scene, canvasContainer);



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


