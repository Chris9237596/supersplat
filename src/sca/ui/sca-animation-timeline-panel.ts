import { BooleanInput, Button, Container, Label, SelectInput, TextInput } from '@playcanvas/pcui';

import { Events } from '../../events';

import {
    ScaAnimationClip,
    ScaAnimationPlaybackState,
    ScaAnimationTrack,
    ScaAnimationTriggerType
} from '../types/animation';
import { ScaProject } from '../types/project';

import { sampleNumberTrack } from '../rig/rig-animation';
import { evaluateFinalRigPose } from '../rig/rig-pose';

const TRACKS_COLUMN_WIDTH = 220;
const RULER_LEFT_PADDING = 8;

const formatTime = (time: number): string => time.toFixed(2);

const trackLabelForProperty = (property: string): string => {
    if (property === 'position') {
        return 'Position';
    }
    if (property === 'rotation') {
        return 'Rotation';
    }
    if (property === 'opacity') {
        return 'Opacity';
    }

    return property;
};

class ScaAnimationTimelinePanel extends Container {
    private clipSelect: SelectInput;

    private durationInput: TextInput;

    private timeLabel: Label;

    private trackList: Container;

    private rulerCanvas: HTMLCanvasElement;

    private keyframeArea: HTMLDivElement;

    private playhead: HTMLDivElement;

    private addPositionButton: Button;

    private addRotationButton: Button;

    private addOpacityButton: Button;

    private editModeButton: Button;

    private autoplayInput: BooleanInput;

    private loopInput: BooleanInput;

    private triggerTypeSelect: SelectInput;

    private triggerTargetSelect: SelectInput;

    private triggerTargetRow: Container;

    private testTriggerButton: Button;

    private triggerPreviewInput: BooleanInput;

    private scrubbing = false;

    private collapsedGroups = new Set<string>();

    private hasFocus = false;

    private suppressClipSelectChange = false;

    private suppressPlaybackSettingsChange = false;

    private pendingTriggerType: ScaAnimationTriggerType | null = null;

    private pendingTriggerClipId: string | null = null;

    private refreshDepth = 0;

    constructor(private events: Events) {
        super({
            id: 'sca-animation-timeline',
            class: 'sca-animation-timeline',
            hidden: true
        });

        this.clipSelect = new SelectInput({
            class: 'sca-animation-clip-select',
            options: [{ v: '', t: 'No animation' }]
        });
        this.durationInput = new TextInput({ class: 'sca-animation-duration-input', value: '2.00' });
        this.timeLabel = new Label({ class: 'sca-animation-time-label', text: '0.00 / 0.00' });
        this.trackList = new Container({ class: 'sca-animation-track-list' });

        this.buildHeader();
        this.buildPlaybackSettingsRow();
        this.buildBody();

        this.dom.tabIndex = 0;
        this.dom.addEventListener('focusin', () => {
            this.hasFocus = true;
        });
        this.dom.addEventListener('focusout', () => {
            this.hasFocus = false;
        });
        this.dom.addEventListener('keydown', (event) => {
            if (!this.hasFocus) {
                return;
            }

            if (event.code === 'Space') {
                event.preventDefault();
                const state = this.getPlaybackState();
                if (state.playing) {
                    this.events.fire('sca.animation.stop');
                } else {
                    this.events.fire('sca.animation.play');
                }
            }

            if (event.code === 'ArrowLeft') {
                event.preventDefault();
                this.events.fire('sca.animation.navigateKeyframe', 'previous');
            }

            if (event.code === 'ArrowRight') {
                event.preventDefault();
                this.events.fire('sca.animation.navigateKeyframe', 'next');
            }

            if (event.code === 'Delete' || event.code === 'Backspace') {
                this.deleteSelectedKeyframe();
            }
        });

        window.addEventListener('keydown', this.onGlobalKeyDown);

        this.bindEvents();
        this.refresh();
    }

    private onGlobalKeyDown = (event: KeyboardEvent): void => {
        if (!this.events.invoke('scaTimeline.visible')) {
            return;
        }

        if (this.isTypingTarget(event.target)) {
            return;
        }

        if (event.code === 'KeyJ') {
            event.preventDefault();
            this.events.fire('sca.animation.navigateKeyframe', 'previous');
        }

        if (event.code === 'KeyK') {
            event.preventDefault();
            this.events.fire('sca.animation.navigateKeyframe', 'next');
        }
    };

    private isTypingTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) {
            return false;
        }

        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return true;
        }

        return target.isContentEditable;
    }

    private buildHeader(): void {
        const header = new Container({ class: 'sca-animation-timeline-header' });

        const newButton = new Button({ class: 'sca-hotspot-form-button', text: '+ New Animation' });
        newButton.on('click', () => {
            const clips = this.events.invoke('sca.animation.list') as ScaAnimationClip[];
            this.events.fire('sca.animation.create', `Animation ${clips.length + 1}`, 2);
        });

        this.clipSelect.on('change', () => {
            if (this.suppressClipSelectChange) {
                return;
            }

            const clipId = this.clipSelect.value || null;
            this.events.fire('sca.animation.setActiveClip', clipId);
        });

        this.durationInput.on('change', () => {
            const state = this.getPlaybackState();
            if (!state.activeClipId) {
                return;
            }

            const duration = Number.parseFloat(this.durationInput.value);
            if (!Number.isFinite(duration) || duration <= 0) {
                return;
            }

            this.events.fire('sca.animation.update', state.activeClipId, { duration });
        });

        header.append(newButton);
        header.append(new Label({ class: 'sca-animation-header-label', text: 'Animation' }));
        header.append(this.clipSelect);
        header.append(new Label({ class: 'sca-animation-header-label', text: 'Duration' }));
        header.append(this.durationInput);
        header.append(new Label({ class: 'sca-animation-header-label', text: 's' }));

        const transport = new Container({ class: 'sca-animation-transport' });
        const prevButton = new Button({ class: 'sca-rig-transform-mode-button', text: '← keyframe' });
        const playButton = new Button({ class: 'sca-rig-transform-mode-button', text: '▶' });
        const stopButton = new Button({ class: 'sca-rig-transform-mode-button', text: '■' });
        const resetButton = new Button({ class: 'sca-rig-transform-mode-button', text: '↺' });
        const nextButton = new Button({ class: 'sca-rig-transform-mode-button', text: 'keyframe →' });

        prevButton.on('click', () => this.events.fire('sca.animation.navigateKeyframe', 'previous'));
        playButton.on('click', () => this.events.fire('sca.animation.play'));
        stopButton.on('click', () => this.events.fire('sca.animation.stop'));
        resetButton.on('click', () => this.events.fire('sca.animation.reset'));
        nextButton.on('click', () => this.events.fire('sca.animation.navigateKeyframe', 'next'));

        transport.append(prevButton);
        transport.append(playButton);
        transport.append(stopButton);
        transport.append(resetButton);
        transport.append(nextButton);
        transport.append(this.timeLabel);

        header.append(transport);
        this.append(header);
    }

    private buildPlaybackSettingsRow(): void {
        const row = new Container({ class: 'sca-animation-playback-row' });

        const autoplayRow = new Container({ class: 'sca-animation-playback-control' });
        autoplayRow.append(new Label({ class: 'sca-animation-header-label', text: 'Autoplay' }));
        this.autoplayInput = new BooleanInput({
            class: 'sca-animation-playback-toggle',
            type: 'toggle',
            value: false
        });
        autoplayRow.append(this.autoplayInput);

        const loopRow = new Container({ class: 'sca-animation-playback-control' });
        loopRow.append(new Label({ class: 'sca-animation-header-label', text: 'Loop' }));
        this.loopInput = new BooleanInput({
            class: 'sca-animation-playback-toggle',
            type: 'toggle',
            value: false
        });
        loopRow.append(this.loopInput);

        const triggerRow = new Container({ class: 'sca-animation-playback-control' });
        triggerRow.append(new Label({ class: 'sca-animation-header-label', text: 'Trigger' }));
        this.triggerTypeSelect = new SelectInput({
            class: 'sca-animation-trigger-type-select',
            options: [
                { v: 'none', t: 'None' },
                { v: 'hotspot', t: 'Hotspot' },
                { v: 'region', t: 'Region' }
            ]
        });
        triggerRow.append(this.triggerTypeSelect);

        this.triggerTargetRow = new Container({ class: 'sca-animation-playback-control' });
        this.triggerTargetRow.append(new Label({ class: 'sca-animation-header-label', text: 'Target' }));
        this.triggerTargetSelect = new SelectInput({
            class: 'sca-animation-trigger-target-select',
            placeholder: 'Select target…',
            allowNull: true,
            options: []
        });
        this.triggerTargetRow.append(this.triggerTargetSelect);
        this.triggerTargetRow.hidden = true;
        this.triggerTargetRow.dom.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        this.autoplayInput.on('change', (value: boolean) => {
            this.updateActiveClipPlayback({ autoplay: value });
        });
        this.loopInput.on('change', (value: boolean) => {
            this.updateActiveClipPlayback({ loop: value });
        });
        this.triggerTypeSelect.on('change', (value: string) => {
            if (this.suppressPlaybackSettingsChange) {
                return;
            }

            const triggerType = value as ScaAnimationTriggerType;
            const state = this.getPlaybackState();
            if (!state.activeClipId) {
                return;
            }

            if (triggerType === 'none') {
                this.pendingTriggerType = null;
                this.pendingTriggerClipId = null;
                this.updateActiveClipPlayback({ trigger: { type: 'none' } });
                this.triggerTargetRow.hidden = true;
                console.log('[SCA ANIM TRIGGER UI] type selected', { triggerType, optionCount: 0 });
                return;
            }

            const clip = this.getActiveClipFromProject(state.activeClipId);
            const existingTargetId = clip?.trigger?.type === triggerType ?
                clip.trigger.targetId ?? '' :
                '';

            this.pendingTriggerType = triggerType;
            this.pendingTriggerClipId = state.activeClipId;
            this.triggerTargetRow.hidden = false;
            this.refreshTriggerTargetOptions(triggerType, existingTargetId);

            const project = this.getProject();
            const optionCount = triggerType === 'hotspot' ?
                project.hotspots.length :
                project.regions.length;
            console.log('[SCA ANIM TRIGGER UI] type selected', {
                triggerType,
                optionCount
            });
        });
        this.triggerTargetSelect.on('change', (value: string) => {
            if (this.suppressPlaybackSettingsChange) {
                return;
            }

            console.log('[SCA ANIM TRIGGER UI] target change', { value });

            const triggerType = (
                this.pendingTriggerType ??
                this.triggerTypeSelect.value
            ) as ScaAnimationTriggerType;
            const targetId = value;
            if (triggerType === 'none' || !targetId) {
                return;
            }

            this.pendingTriggerType = null;
            this.pendingTriggerClipId = null;
            this.updateActiveClipPlayback({
                trigger: { type: triggerType, targetId }
            });

            const clip = this.getActiveClipFromProject(this.getPlaybackState().activeClipId);
            console.log('[SCA ANIM TRIGGER UI] target selected', {
                type: triggerType,
                targetId,
                clipTrigger: clip?.trigger ?? null
            });
        });

        row.dom.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        const testTriggerRow = new Container({ class: 'sca-animation-playback-control' });
        this.testTriggerButton = new Button({
            class: 'sca-hotspot-form-button',
            text: 'Test Trigger'
        });
        this.testTriggerButton.on('click', () => {
            this.events.fire('sca.animation.testTrigger');
        });
        testTriggerRow.append(this.testTriggerButton);

        const triggerPreviewRow = new Container({ class: 'sca-animation-playback-control' });
        triggerPreviewRow.append(new Label({ class: 'sca-animation-header-label', text: 'Trigger Preview' }));
        this.triggerPreviewInput = new BooleanInput({
            class: 'sca-animation-playback-toggle',
            type: 'toggle',
            value: false
        });
        this.triggerPreviewInput.on('change', (value: boolean) => {
            if (this.suppressPlaybackSettingsChange) {
                return;
            }
            this.events.fire('sca.animation.triggerPreview.setEnabled', value);
        });
        triggerPreviewRow.append(this.triggerPreviewInput);

        row.append(autoplayRow);
        row.append(loopRow);
        row.append(triggerRow);
        row.append(this.triggerTargetRow);
        row.append(testTriggerRow);
        row.append(triggerPreviewRow);
        this.append(row);

        const authoring = new Container({ class: 'sca-animation-authoring-row' });
        this.editModeButton = new Button({ class: 'sca-rig-transform-mode-button', text: 'Animation Edit' });
        this.editModeButton.on('click', () => {
            const enabled = !this.events.invoke('sca.animation.getEditMode');
            this.events.fire('sca.animation.setEditMode', enabled);
        });

        this.addPositionButton = new Button({ class: 'sca-hotspot-form-button', text: '+ Position Keyframe' });
        this.addRotationButton = new Button({ class: 'sca-hotspot-form-button', text: '+ Rotation Keyframe' });
        this.addOpacityButton = new Button({ class: 'sca-hotspot-form-button', text: '+ Opacity Keyframe' });

        this.addPositionButton.on('click', () => this.addRigKeyframe('position'));
        this.addRotationButton.on('click', () => this.addRigKeyframe('rotation'));
        this.addOpacityButton.on('click', () => this.addRegionOpacityKeyframe());

        authoring.append(this.editModeButton);
        authoring.append(this.addPositionButton);
        authoring.append(this.addRotationButton);
        authoring.append(this.addOpacityButton);
        this.append(authoring);
    }

    private updateActiveClipPlayback(
        patch: Partial<Pick<ScaAnimationClip, 'autoplay' | 'loop' | 'trigger'>>
    ): void {
        if (this.suppressPlaybackSettingsChange) {
            return;
        }

        const state = this.getPlaybackState();
        if (!state.activeClipId) {
            return;
        }

        this.events.fire('sca.animation.update', state.activeClipId, patch);
    }

    private getActiveClipFromProject(activeClipId: string | null | undefined): ScaAnimationClip | null {
        if (!activeClipId) {
            return null;
        }

        return this.getProject().animations?.find((entry) => entry.id === activeClipId) ?? null;
    }

    private resolveEffectiveTriggerType(
        clip: ScaAnimationClip | null,
        activeClipId: string | null
    ): ScaAnimationTriggerType {
        if (
            activeClipId &&
            this.pendingTriggerClipId === activeClipId &&
            this.pendingTriggerType &&
            this.pendingTriggerType !== 'none'
        ) {
            return this.pendingTriggerType;
        }

        return this.resolveClipTrigger(clip);
    }

    private resolveClipTrigger(clip: ScaAnimationClip | null): ScaAnimationTriggerType {
        if (!clip?.trigger || clip.trigger.type === 'none') {
            return 'none';
        }

        return clip.trigger.type;
    }

    private refreshTriggerTargetOptions(
        triggerType: ScaAnimationTriggerType,
        selectedTargetId: string
    ): void {
        const project = this.getProject();
        const options = triggerType === 'hotspot' ?
            project.hotspots.map((hotspot) => ({ v: hotspot.id, t: hotspot.name || hotspot.id })) :
            project.regions.map((region) => ({ v: region.id, t: region.name || region.id }));

        // PCUI SelectInput aborts options assignment on the first `{ v: '' }` entry.
        this.triggerTargetSelect.options = options;
        this.triggerTargetSelect.value = selectedTargetId &&
            options.some((entry) => entry.v === selectedTargetId) ?
            selectedTargetId :
            null;
        this.triggerTargetSelect.enabled = options.length > 0;
        this.triggerTargetSelect.placeholder = options.length > 0 ?
            'Select target…' :
            'No targets available';
    }

    private refreshPlaybackSettings(clip: ScaAnimationClip | null, activeClipId: string | null): void {
        if (activeClipId !== this.pendingTriggerClipId) {
            this.pendingTriggerType = null;
            this.pendingTriggerClipId = null;
        }

        const triggerType = this.resolveEffectiveTriggerType(clip, activeClipId);
        const targetId = clip?.trigger?.type === triggerType ?
            clip.trigger.targetId ?? '' :
            '';

        this.suppressPlaybackSettingsChange = true;
        this.autoplayInput.value = clip?.autoplay === true;
        this.loopInput.value = clip?.loop === true;
        this.autoplayInput.enabled = !!clip;
        this.loopInput.enabled = !!clip;
        this.triggerTypeSelect.enabled = !!clip;
        this.triggerTypeSelect.value = triggerType;
        this.testTriggerButton.enabled = !!clip;
        this.triggerPreviewInput.enabled = true;
        this.triggerPreviewInput.value = this.events.invoke('sca.animation.triggerPreview.enabled') === true;

        if (!clip || triggerType === 'none') {
            this.triggerTargetRow.hidden = true;
            this.triggerTargetSelect.enabled = false;
        } else {
            this.triggerTargetRow.hidden = false;
            this.refreshTriggerTargetOptions(triggerType, targetId);
        }

        this.suppressPlaybackSettingsChange = false;
    }

    private buildBody(): void {
        const body = new Container({ class: 'sca-animation-timeline-body' });
        body.append(this.trackList);

        const timelineArea = new Container({ class: 'sca-animation-timeline-area' });
        this.rulerCanvas = document.createElement('canvas');
        this.rulerCanvas.className = 'sca-animation-ruler-canvas';

        this.keyframeArea = document.createElement('div');
        this.keyframeArea.className = 'sca-animation-keyframe-area';

        this.playhead = document.createElement('div');
        this.playhead.className = 'sca-animation-playhead';
        this.keyframeArea.appendChild(this.playhead);

        this.bindScrubHandlers(this.rulerCanvas);
        this.bindScrubHandlers(this.keyframeArea);
        this.bindScrubHandlers(this.playhead);

        timelineArea.dom.appendChild(this.rulerCanvas);
        timelineArea.dom.appendChild(this.keyframeArea);
        body.append(timelineArea);
        this.append(body);
    }

    private bindScrubHandlers(element: HTMLElement): void {
        element.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }

            this.scrubbing = true;
            element.setPointerCapture(event.pointerId);
            this.scrubFromClientX(event.clientX);
        });

        element.addEventListener('pointermove', (event) => {
            if (!this.scrubbing) {
                return;
            }

            this.scrubFromClientX(event.clientX);
        });

        const endScrub = (event: PointerEvent) => {
            if (!this.scrubbing) {
                return;
            }

            this.scrubbing = false;
            if (element.hasPointerCapture(event.pointerId)) {
                element.releasePointerCapture(event.pointerId);
            }
        };

        element.addEventListener('pointerup', endScrub);
        element.addEventListener('pointercancel', endScrub);
    }

    private scrubFromClientX(clientX: number): void {
        const clip = this.getPlaybackState().clip;
        if (!clip) {
            return;
        }

        const rect = this.keyframeArea.getBoundingClientRect();
        const usableWidth = Math.max(1, rect.width - RULER_LEFT_PADDING);
        const localX = clientX - rect.left - RULER_LEFT_PADDING;
        const alpha = Math.min(1, Math.max(0, localX / usableWidth));
        this.events.fire('sca.animation.setCurrentTime', alpha * clip.duration);
    }

    private bindEvents(): void {
        this.events.on('sca.animation.changed', () => this.refresh());
        this.events.on('sca.project.changed', () => this.refresh());
        this.events.on('sca.rig.node.selected', () => this.refresh());
        this.events.on('sca.region.selected', () => this.refresh());
    }

    private getProject(): ScaProject {
        return this.events.invoke('sca.project.get') as ScaProject;
    }

    private getPlaybackState(): ScaAnimationPlaybackState {
        return this.events.invoke('sca.animation.getState') as ScaAnimationPlaybackState;
    }

    private addRigKeyframe(property: 'position' | 'rotation'): void {
        const state = this.getPlaybackState();
        const nodeId = this.events.invoke('sca.rig.getSelected') as string | null;
        if (!state.activeClipId || !nodeId) {
            return;
        }

        const node = this.getProject().rig?.nodes.find((entry) => entry.id === nodeId);
        if (!node) {
            return;
        }

        const rig = this.getProject().rig!;
        const evaluated = state.previewActive ?
            evaluateFinalRigPose(rig, this.getProject()).nodes.get(nodeId) :
            null;
        const value = property === 'position' ?
            (evaluated?.position ?? node.position) :
            (evaluated?.rotation ?? node.rotation);
        this.events.fire(
            'sca.animation.keyframe.addRig',
            state.activeClipId,
            nodeId,
            property,
            state.currentTime,
            [...value] as [number, number, number]
        );
        this.events.fire('sca.animation.setCurrentTime', state.currentTime);
    }

    private addRegionOpacityKeyframe(): void {
        const state = this.getPlaybackState();
        const regionId = this.events.invoke('sca.region.getSelected') as string | null;
        if (!state.activeClipId || !regionId) {
            return;
        }

        const region = this.getProject().regions.find((entry) => entry.id === regionId);
        if (!region) {
            return;
        }

        const clip = state.clip;
        const opacityTrack = clip?.tracks.find((track): track is Extract<ScaAnimationTrack, { targetType: 'region'; property: 'opacity' }> =>
            track.targetType === 'region' &&
            track.regionId === regionId &&
            track.property === 'opacity'
        );
        const opacity = state.previewActive && opacityTrack ?
            sampleNumberTrack(opacityTrack.keyframes, state.currentTime) :
            (region.visual.activeOpacity ?? 1);
        this.events.fire(
            'sca.animation.keyframe.addRegionOpacity',
            state.activeClipId,
            regionId,
            state.currentTime,
            opacity
        );
        this.events.fire('sca.animation.setCurrentTime', state.currentTime);
    }

    private deleteSelectedKeyframe(): void {
        const state = this.getPlaybackState();
        if (!state.activeClipId || !state.selectedTrackId || !state.selectedKeyframeId) {
            return;
        }

        this.events.fire(
            'sca.animation.keyframe.delete',
            state.activeClipId,
            state.selectedTrackId,
            state.selectedKeyframeId
        );
    }

    setPanelHeight(height: number): void {
        this.dom.style.height = `${height}px`;
        this.refresh();
    }

    refresh(): void {
        if (++this.refreshDepth > 8) {
            this.refreshDepth--;
            return;
        }

        const project = this.getProject();
        const clips = project.animations ?? [];
        const state = this.getPlaybackState();
        const clip = state.activeClipId ?
            project.animations?.find((entry) => entry.id === state.activeClipId) ?? state.clip :
            null;

        const options = [{ v: '', t: 'No animation' }, ...clips.map((entry) => ({ v: entry.id, t: entry.name }))];
        this.suppressClipSelectChange = true;
        this.clipSelect.options = options;
        this.clipSelect.value = state.activeClipId ?? '';
        this.suppressClipSelectChange = false;

        this.durationInput.value = clip ? formatTime(clip.duration) : '2.00';
        this.durationInput.enabled = !!clip;
        this.refreshPlaybackSettings(clip, state.activeClipId);
        this.timeLabel.text = clip ?
            `${formatTime(state.currentTime)} / ${formatTime(clip.duration)}` :
            '0.00 / 0.00';

        const hasNode = !!this.events.invoke('sca.rig.getSelected');
        const hasRegion = !!this.events.invoke('sca.region.getSelected');
        this.editModeButton.enabled = !!clip;
        this.editModeButton.class[state.editMode ? 'add' : 'remove']('active');
        this.addPositionButton.enabled = !!clip && hasNode;
        this.addRotationButton.enabled = !!clip && hasNode;
        this.addOpacityButton.enabled = !!clip && hasRegion;

        this.renderTracks(project, clip, state);
        this.renderRuler(clip, state.currentTime);
        this.renderPlayhead(clip, state.currentTime);

        this.refreshDepth--;
    }

    private renderTracks(project: ScaProject, clip: ScaAnimationClip | null, state: ScaAnimationPlaybackState): void {
        this.trackList.clear();

        if (!clip) {
            this.keyframeArea.querySelectorAll('.sca-animation-keyframe-marker').forEach((node) => node.remove());
            return;
        }

        this.keyframeArea.querySelectorAll('.sca-animation-keyframe-marker').forEach((node) => node.remove());

        const groups = new Map<string, { label: string; tracks: ScaAnimationTrack[]; selectId?: string }>();

        for (const track of clip.tracks) {
            if (track.targetType === 'rig-node') {
                const node = project.rig?.nodes.find((entry) => entry.id === track.nodeId);
                const groupKey = `rig:${track.nodeId}`;
                const group = groups.get(groupKey) ?? {
                    label: node?.name ?? track.nodeId,
                    tracks: [],
                    selectId: track.nodeId
                };
                group.tracks.push(track);
                groups.set(groupKey, group);
            } else {
                const region = project.regions.find((entry) => entry.id === track.regionId);
                const groupKey = `region:${track.regionId}`;
                const group = groups.get(groupKey) ?? {
                    label: region?.name ?? track.regionId,
                    tracks: [],
                    selectId: track.regionId
                };
                group.tracks.push(track);
                groups.set(groupKey, group);
            }
        }

        for (const [groupKey, group] of groups.entries()) {
            const collapsed = this.collapsedGroups.has(groupKey);
            const groupRow = new Container({ class: 'sca-animation-track-group-row' });
            const toggle = new Label({
                class: 'sca-animation-track-group-toggle',
                text: `${collapsed ? '▶' : '▼'} ${group.label}`
            });
            toggle.dom.addEventListener('click', () => {
                if (this.collapsedGroups.has(groupKey)) {
                    this.collapsedGroups.delete(groupKey);
                } else {
                    this.collapsedGroups.add(groupKey);
                }
                this.refresh();
            });
            toggle.dom.addEventListener('dblclick', () => {
                if (group.selectId?.startsWith('rig_')) {
                    this.events.fire('sca.rig.node.select', group.selectId);
                } else if (group.selectId) {
                    this.events.fire('sca.region.select', group.selectId);
                }
            });
            groupRow.append(toggle);
            this.trackList.append(groupRow);

            if (collapsed) {
                continue;
            }

            for (const track of group.tracks) {
                const property = track.property;
                const row = new Container({ class: 'sca-animation-track-row' });
                row.append(new Label({
                    class: 'sca-animation-track-property-label',
                    text: trackLabelForProperty(property)
                }));
                this.trackList.append(row);

                for (const keyframe of track.keyframes) {
                    const marker = document.createElement('button');
                    marker.type = 'button';
                    marker.className = 'sca-animation-keyframe-marker';
                    if (
                        state.selectedTrackId === track.id &&
                        state.selectedKeyframeId === keyframe.id
                    ) {
                        marker.classList.add('is-selected');
                    }

                    marker.style.left = `${this.timeToX(keyframe.time, clip.duration)}px`;
                    marker.title = `${formatTime(keyframe.time)}s`;
                    marker.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.events.fire('sca.animation.selectTrack', track.id);
                        this.events.fire('sca.animation.selectKeyframe', keyframe.id);
                        this.events.fire('sca.animation.setCurrentTime', keyframe.time);
                    });

                    this.keyframeArea.appendChild(marker);
                }
            }
        }
    }

    private timeToX(time: number, duration: number): number {
        const rectWidth = this.keyframeArea.clientWidth || 1;
        const usableWidth = Math.max(1, rectWidth - RULER_LEFT_PADDING);
        const alpha = duration > 0 ? time / duration : 0;
        return RULER_LEFT_PADDING + alpha * usableWidth;
    }

    private renderPlayhead(clip: ScaAnimationClip | null, currentTime: number): void {
        if (!clip) {
            this.playhead.style.display = 'none';
            return;
        }

        this.playhead.style.display = 'block';
        this.playhead.style.left = `${this.timeToX(currentTime, clip.duration)}px`;
    }

    private renderRuler(clip: ScaAnimationClip | null, currentTime: number): void {
        const width = this.keyframeArea.clientWidth || this.rulerCanvas.clientWidth || 600;
        const height = 24;
        this.rulerCanvas.width = width;
        this.rulerCanvas.height = height;

        const context = this.rulerCanvas.getContext('2d');
        if (!context || !clip) {
            return;
        }

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#8a8f98';
        context.font = '10px sans-serif';

        const duration = clip.duration;
        const usableWidth = width - RULER_LEFT_PADDING;
        const tickCount = Math.max(2, Math.ceil(duration * 2));
        for (let index = 0; index <= tickCount; index++) {
            const alpha = index / tickCount;
            const x = RULER_LEFT_PADDING + alpha * usableWidth;
            context.fillRect(x, height - 8, 1, 8);
            const time = alpha * duration;
            context.fillText(formatTime(time), x + 2, 10);
        }

        void currentTime;
    }
}

export { ScaAnimationTimelinePanel };
