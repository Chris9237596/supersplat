import { Container, Label } from '@playcanvas/pcui';

import { Events } from '../../../events';

import { ScaHotspot } from '../../types/project';
import { ScaRegion } from '../../types/region';

import { navigatorLabelForName, ScaNavigatorItem } from './sca-navigator-types';

class ScaNavigatorPanel extends Container {
    private sceneRow: Container;

    private hotspotsList: Container;

    private regionsList: Container;

    private hotspotRows = new Map<string, Container>();

    private regionRows = new Map<string, Container>();

    constructor(private events: Events, args = {}) {
        args = {
            ...args,
            id: 'sca-navigator',
            class: 'panel',
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = new Container({ class: 'panel-header' });
        const title = new Label({
            class: 'panel-header-label',
            text: 'Navigator'
        });
        header.append(title);

        const body = new Container({ class: 'sca-navigator-body' });

        const sceneSection = this.createSection('SCENE');
        this.sceneRow = this.createItemRow({
            type: 'scene',
            id: 'scene',
            label: 'Scene / Viewer'
        }, () => {
            this.events.fire('sca.hotspot.select', null);
            this.events.fire('sca.region.select', null);
        });
        sceneSection.append(this.sceneRow);

        const hotspotsSection = this.createSection('HOTSPOTS');
        this.hotspotsList = new Container({ class: 'sca-navigator-items' });
        hotspotsSection.append(this.hotspotsList);

        const regionsSection = this.createSection('REGIONS');
        this.regionsList = new Container({ class: 'sca-navigator-items' });
        regionsSection.append(this.regionsList);

        body.append(sceneSection);
        body.append(hotspotsSection);
        body.append(regionsSection);

        this.append(header);
        this.append(body);

        this.events.on('sca.project.changed', () => {
            this.renderLists();
            this.refreshSelection();
        });

        this.events.on('sca.hotspot.selected', () => {
            this.refreshSelection();
        });

        this.events.on('sca.region.selected', () => {
            this.refreshSelection();
        });

        this.renderLists();
        this.refreshSelection();
    }

    private createSection(title: string): Container {
        const section = new Container({ class: 'sca-navigator-section' });
        section.append(new Label({
            class: 'sca-navigator-section-label',
            text: title
        }));
        return section;
    }

    private createItemRow(item: ScaNavigatorItem, onClick: () => void): Container {
        const row = new Container({
            class: ['sca-navigator-item', `sca-navigator-item-${item.type}`]
        });
        const label = new Label({
            class: 'sca-navigator-item-label',
            text: item.label
        });
        row.append(label);
        row.dom.dataset.navigatorType = item.type;
        row.dom.dataset.navigatorId = item.id;
        row.on('click', onClick);
        return row;
    }

    private renderLists(): void {
        const hotspots = this.events.invoke('sca.hotspot.list') as ScaHotspot[] | undefined;
        const regions = this.events.invoke('sca.region.list') as ScaRegion[] | undefined;

        this.renderHotspotList(hotspots ?? []);
        this.renderRegionList(regions ?? []);
    }

    private renderHotspotList(hotspots: ScaHotspot[]): void {
        this.hotspotsList.clear();
        this.hotspotRows.clear();

        if (hotspots.length === 0) {
            this.hotspotsList.append(new Label({
                class: 'sca-navigator-empty',
                text: 'No hotspots'
            }));
            return;
        }

        hotspots.forEach((hotspot) => {
            const row = this.createItemRow({
                type: 'hotspot',
                id: hotspot.id,
                label: navigatorLabelForName(hotspot.name, hotspot.id)
            }, () => {
                this.events.fire('sca.hotspot.select', hotspot.id);
            });
            this.hotspotRows.set(hotspot.id, row);
            this.hotspotsList.append(row);
        });
    }

    private renderRegionList(regions: ScaRegion[]): void {
        this.regionsList.clear();
        this.regionRows.clear();

        if (regions.length === 0) {
            this.regionsList.append(new Label({
                class: 'sca-navigator-empty',
                text: 'No regions'
            }));
            return;
        }

        regions.forEach((region) => {
            const row = this.createItemRow({
                type: 'region',
                id: region.id,
                label: navigatorLabelForName(region.name, region.id)
            }, () => {
                this.events.fire('sca.region.select', region.id);
            });
            this.regionRows.set(region.id, row);
            this.regionsList.append(row);
        });
    }

    private refreshSelection(): void {
        const selectedHotspotId = this.events.invoke('sca.hotspot.getSelected') as string | null | undefined;
        const selectedRegionId = this.events.invoke('sca.region.getSelected') as string | null | undefined;
        const sceneSelected = !selectedHotspotId && !selectedRegionId;

        this.sceneRow.class.toggle('selected', sceneSelected);

        this.hotspotRows.forEach((row, id) => {
            row.class.toggle('selected', id === selectedHotspotId);
        });

        this.regionRows.forEach((row, id) => {
            row.class.toggle('selected', id === selectedRegionId);
        });
    }
}

export { ScaNavigatorPanel };
