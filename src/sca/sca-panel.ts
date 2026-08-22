import { Button, BooleanInput, Container, Label, SelectInput } from '@playcanvas/pcui';

import { ElementType } from '../element';
import { Events } from '../events';
import { Tooltips } from '../ui/tooltips';

import { ScaHotspot } from './types/project';
import { ScaFocusPanel } from './ui/sca-focus-panel';
import { ScaHotspotForm } from './ui/sca-hotspot-form';
import { ScaRegionsPanel } from './ui/sca-regions-panel';
import { ScaViewerPanel } from './ui/sca-viewer-panel';

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

        const projectBar = new Container({ class: 'sca-project-bar' });
        const projectTitle = new Label({
            class: 'sca-project-bar-label',
            text: 'Project'
        });
        const projectName = new Label({
            class: 'sca-project-bar-name',
            text: 'Unsaved project'
        });
        const projectSaveHint = new Label({
            class: 'sca-project-bar-hint',
            text: ''
        });
        projectBar.append(projectTitle);
        projectBar.append(projectName);
        projectBar.append(projectSaveHint);

        const reopenBanner = new Container({
            class: 'sca-reopen-banner',
            hidden: true
        });
        const reopenBannerText = new Label({
            class: 'sca-reopen-banner-text',
            text: ''
        });
        const reopenBannerButton = new Button({
            class: 'sca-reopen-banner-button',
            text: 'Reopen last project'
        });
        reopenBanner.append(reopenBannerText);
        reopenBanner.append(reopenBannerButton);

        const body = new Container({
            class: 'sca-panel-body'
        });

        const subtitle = new Label({
            class: 'sca-panel-subtitle',
            text: 'SCA Authoring'
        });

        const focusPanel = new ScaFocusPanel(events);
        const viewerPanel = new ScaViewerPanel(events);
        const regionsPanel = new ScaRegionsPanel(events);

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
        body.append(viewerPanel);
        body.append(regionsPanel);
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

        const useGaussianPickSpikeRow = new Container({ class: 'sca-export-preview-row' });
        const useGaussianPickSpikeInput = new BooleanInput({
            class: 'sca-export-gaussian-pick-spike-checkbox',
            type: 'checkbox',
            value: false
        });
        const useGaussianPickSpikeLabel = new Label({
            class: 'sca-export-preview-label',
            text: 'Use Gaussian Pick Spike (debug)'
        });

        useGaussianPickSpikeRow.append(useGaussianPickSpikeInput);
        useGaussianPickSpikeRow.append(useGaussianPickSpikeLabel);

        const sogCompressionRow = new Container({ class: 'sca-export-compression-row' });
        const sogCompressionLabel = new Label({
            class: 'sca-export-preview-label',
            text: 'SOG compression'
        });
        const sogCompressionSelect = new SelectInput({
            class: 'sca-export-compression-select',
            defaultValue: 'automatic',
            options: [
                { v: 'automatic', t: 'Automatic' },
                { v: 'prefer-webgpu', t: 'Prefer WebGPU' },
                { v: 'force-cpu', t: 'Force CPU' }
            ]
        });

        sogCompressionRow.append(sogCompressionLabel);
        sogCompressionRow.append(sogCompressionSelect);

        exportSection.append(exportTitle);
        exportSection.append(includePreviewRow);
        exportSection.append(sogCompressionRow);

        const exportStatusLabel = new Label({
            class: 'sca-export-status-label',
            text: '',
            hidden: true
        });

        exportSection.append(exportStatusLabel);
        exportSection.append(exportRuntimePackageButton);

        const debugSection = new Container({ class: 'sca-debug-section' });
        const debugTitle = new Label({
            class: 'sca-panel-section-label',
            text: 'Debug / Advanced'
        });
        const debugNote = new Label({
            class: 'sca-export-preview-label',
            text: 'Experimental tools — not used in normal export workflow.'
        });
        debugSection.append(debugTitle);
        debugSection.append(debugNote);
        debugSection.append(useGaussianPickSpikeRow);
        body.append(exportSection);
        body.append(debugSection);

        exportRuntimePackageButton.on('click', () => {
            if (events.invoke('sca.export.runtimePackage.inProgress') as boolean) {
                return;
            }
            events.fire('sca.export.runtimePackage', {
                includePreview: includePreviewInput.value,
                useGaussianPickSpike: useGaussianPickSpikeInput.value,
                sogCompressionMode: sogCompressionSelect.value as 'automatic' | 'prefer-webgpu' | 'force-cpu'
            });
        });

        const setExportControlsEnabled = (enabled: boolean) => {
            exportRuntimePackageButton.enabled = enabled;
            includePreviewInput.enabled = enabled;
            sogCompressionSelect.enabled = enabled;
        };

        events.on('sca.export.packageStatus', (status: {
            inProgress: boolean;
            message?: string;
            cpuFallback?: boolean;
        }) => {
            setExportControlsEnabled(!status.inProgress);
            if (status.inProgress && status.message) {
                exportStatusLabel.text = status.message;
                exportStatusLabel.hidden = false;
            } else {
                exportStatusLabel.hidden = true;
                exportStatusLabel.text = '';
            }
        });

        this.append(header);
        this.append(projectBar);
        this.append(reopenBanner);
        this.append(body);

        const hideReopenBanner = () => {
            reopenBanner.hidden = true;
        };

        const showReopenBanner = (name: string) => {
            reopenBannerText.text = `Last project: ${name}`;
            reopenBanner.hidden = false;
        };

        const refreshProjectBar = () => {
            const name = events.invoke('doc.name') as string | null;
            const isRecovery = events.functions.has('doc.isRecoverySession') &&
                (events.invoke('doc.isRecoverySession') as boolean);

            if (name) {
                projectName.text = name;
                if (isRecovery) {
                    projectSaveHint.text = 'Browser recovery';
                    projectSaveHint.hidden = false;
                } else {
                    const dirty = events.invoke('scene.dirty') as boolean;
                    projectSaveHint.text = dirty ? 'Unsaved changes' : 'Saved';
                    projectSaveHint.hidden = false;
                }
            } else {
                projectName.text = 'Unsaved project';
                projectSaveHint.hidden = true;
            }
        };

        reopenBannerButton.on('click', async () => {
            if (await events.invoke('doc.reopenLast')) {
                hideReopenBanner();
            }
        });

        events.on('doc.lastProjectAvailable', (payload: { name: string, permission: string }) => {
            if (!payload?.name || payload.permission === 'granted') {
                return;
            }
            if (events.invoke('scene.empty')) {
                showReopenBanner(payload.name);
            }
        });

        events.on('doc.loaded', () => {
            hideReopenBanner();
            refreshProjectBar();
        });

        events.on('doc.name', () => {
            refreshProjectBar();
        });

        events.on('doc.saveStateChanged', () => {
            refreshProjectBar();
        });

        events.on('scene.elementAdded', (element) => {
            if (element.type === ElementType.splat && !events.invoke('scene.empty')) {
                hideReopenBanner();
            }
        });

        refreshProjectBar();

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
