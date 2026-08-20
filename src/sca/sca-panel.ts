import { Button, BooleanInput, Container, Label } from '@playcanvas/pcui';

import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaHotspot } from './types/project';
import { ScaFocusPanel } from './ui/sca-focus-panel';
import { ScaHotspotForm } from './ui/sca-hotspot-form';

class ScaPanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'sca-panel',
            class: 'panel',
            hidden: true
        };

        super(args);

        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const header = new Container({
            class: 'panel-header'
        });

        const title = new Label({
            class: 'panel-header-label',
            text: 'SCA'
        });

        const closeButton = new Container({
            class: 'panel-header-button'
        });

        const closeLabel = new Label({
            text: '\u00D7'
        });

        closeButton.append(closeLabel);

        header.append(title);
        header.append(new Label({ class: 'panel-header-spacer' }));
        header.append(closeButton);

        const body = new Container({
            class: 'sca-panel-body'
        });

        const subtitle = new Label({
            class: 'sca-panel-subtitle',
            text: 'SCA Authoring'
        });

        const focusPanel = new ScaFocusPanel(events);

        const listHeader = new Container({
            class: 'sca-hotspot-list-header'
        });

        const listTitle = new Label({
            class: 'sca-panel-section-label',
            text: 'Hotspots'
        });

        const addButton = new Button({
            class: 'sca-hotspot-add-button',
            text: '+ Hotspot'
        });

        listHeader.append(listTitle);
        listHeader.append(addButton);

        const listContainer = new Container({
            class: 'sca-hotspot-list'
        });

        const hotspotForm = new ScaHotspotForm(events);

        body.append(subtitle);
        body.append(focusPanel);
        body.append(listHeader);
        body.append(listContainer);
        body.append(hotspotForm);

        const exportSection = new Container({ class: 'sca-export-section' });
        const exportTitle = new Label({
            class: 'sca-panel-section-label',
            text: 'Export'
        });
        const exportRuntimePackageButton = new Button({
            class: ['sca-hotspot-form-button', 'sca-export-runtime-package-button'],
            text: 'Export SCA Runtime Package'
        });
        const includePreviewRow = new Container({ class: 'sca-export-preview-row' });
        const includePreviewInput = new BooleanInput({
            class: 'sca-export-preview-checkbox',
            type: 'checkbox',
            value: true
        });
        const includePreviewLabel = new Label({
            class: 'sca-export-preview-label',
            text: 'Include standalone preview.html'
        });

        includePreviewRow.append(includePreviewInput);
        includePreviewRow.append(includePreviewLabel);

        exportSection.append(exportTitle);
        exportSection.append(includePreviewRow);
        exportSection.append(exportRuntimePackageButton);
        body.append(exportSection);

        exportRuntimePackageButton.on('click', () => {
            events.fire('sca.export.runtimePackage', includePreviewInput.value);
        });

        this.append(header);
        this.append(body);

        closeButton.on('click', () => {
            events.fire('scaPanel.setVisible', false);
        });

        tooltips.register(closeButton, () => 'Close', 'left');

        const setVisible = (visible: boolean) => {
            if (visible === this.hidden) {
                this.hidden = !visible;
                events.fire('scaPanel.visible', visible);
            }
        };

        events.function('scaPanel.visible', () => {
            return !this.hidden;
        });

        events.on('scaPanel.setVisible', (visible: boolean) => {
            setVisible(visible);
        });

        events.on('scaPanel.toggleVisible', () => {
            setVisible(this.hidden);
        });

        addButton.on('click', () => {
            events.fire('sca.hotspot.create');
        });

        const rowElements = new Map<string, Container>();

        const renderHotspotList = (hotspots: ScaHotspot[], selectedId: string | null) => {
            listContainer.clear();
            rowElements.clear();

            if (hotspots.length === 0) {
                listContainer.append(new Label({
                    class: 'sca-hotspot-list-empty',
                    text: 'No hotspots yet'
                }));
                return;
            }

            hotspots.forEach((hotspot) => {
                const row = new Container({
                    class: ['sca-hotspot-list-item']
                });

                const nameLabel = new Label({
                    class: 'sca-hotspot-list-name',
                    text: hotspot.name
                });

                const idLabel = new Label({
                    class: 'sca-hotspot-list-id',
                    text: hotspot.id
                });

                row.append(nameLabel);
                row.append(idLabel);

                if (hotspot.id === selectedId) {
                    row.class.add('selected');
                }

                row.on('click', () => {
                    events.fire('sca.hotspot.select', hotspot.id);
                });

                rowElements.set(hotspot.id, row);
                listContainer.append(row);
            });
        };

        const refreshHotspotList = () => {
            const hotspots = events.invoke('sca.hotspot.list') as ScaHotspot[] | undefined;
            const selectedId = events.invoke('sca.hotspot.getSelected') as string | null | undefined;

            renderHotspotList(hotspots ?? [], selectedId ?? null);
        };

        const refreshSelectedHotspot = () => {
            const selectedId = events.invoke('sca.hotspot.getSelected') as string | null | undefined;
            const hotspot = selectedId ?
                events.invoke('sca.hotspot.get', selectedId) as ScaHotspot | null :
                null;

            hotspotForm.loadHotspot(hotspot);
        };

        events.on('sca.project.changed', () => {
            refreshHotspotList();
        });

        events.on('sca.hotspot.selected', (selectedId: string | null) => {
            rowElements.forEach((row) => {
                row.class.remove('selected');
            });

            if (selectedId && rowElements.has(selectedId)) {
                rowElements.get(selectedId).class.add('selected');
            }

            refreshSelectedHotspot();
        });

        refreshHotspotList();
        refreshSelectedHotspot();
    }
}

export { ScaPanel };
