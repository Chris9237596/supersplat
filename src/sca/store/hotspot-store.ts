import { ScaHotspot, ScaNavigationMode, ScaProject, ScaRigNode, ScaViewerBackground, ScaViewerConfig } from '../types/project';
import { createEmptyProject } from '../types/project';
import { ScaRegion, ScaRegionPatch } from '../types/region';
import { ScaRigBindMode, ScaRigVec3 } from '../types/rig';
import { mergeVisualStateContent } from '../region-state-content';
import { DEFAULT_RIG_BIND_MODE, ensureProjectRig, normalizeRig } from '../rig/rig-defaults';
import {
    createKeepWorldBindOffset,
    promoteDirectChildrenOnDelete,
    ScaRigReparentMode,
    computeReparentLocalKeepWorld,
    wouldCreateRigCycle
} from '../rig/rig-hierarchy';
import { computeSnapBindOffset, poseFromVec3 } from '../rig/rig-transform';
import {
    createDefaultViewerConfig,
    ensureNavigationValid,
    normalizeProject,
    normalizeViewerConfig
} from '../viewer/viewer-config';

class HotspotStore {
    private project: ScaProject;
    private selectedHotspotId: string | null = null;
    private selectedRegionId: string | null = null;
    private selectedRigNodeId: string | null = null;

    constructor(project: ScaProject = createEmptyProject()) {
        this.project = structuredClone(project);
    }

    getProject(): ScaProject {
        return structuredClone(this.project);
    }

    getViewerConfig(fallbackInitial?: Parameters<typeof createDefaultViewerConfig>[0]): ScaViewerConfig {
        return normalizeViewerConfig(this.project.viewer, fallbackInitial);
    }

    ensureViewerConfig(fallbackInitial?: Parameters<typeof createDefaultViewerConfig>[0]): ScaViewerConfig {
        const viewer = this.project.viewer ?
            normalizeViewerConfig(this.project.viewer, fallbackInitial) :
            createDefaultViewerConfig(fallbackInitial);
        this.project.viewer = viewer;
        return structuredClone(viewer);
    }

    updateViewerConfig(viewer: ScaViewerConfig): void {
        this.project.viewer = normalizeViewerConfig(viewer);
    }

    updateViewerCameraInitial(patch: Partial<ScaViewerConfig['camera']['initial']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = {
            ...current,
            camera: {
                ...current.camera,
                initial: {
                    position: patch.position ?
                        [...patch.position] as ScaViewerConfig['camera']['initial']['position'] :
                        [...current.camera.initial.position] as ScaViewerConfig['camera']['initial']['position'],
                    target: patch.target ?
                        [...patch.target] as ScaViewerConfig['camera']['initial']['target'] :
                        [...current.camera.initial.target] as ScaViewerConfig['camera']['initial']['target'],
                    fov: patch.fov ?? current.camera.initial.fov
                }
            }
        };
    }

    updateViewerNavigation(patch: Partial<ScaViewerConfig['navigation']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = {
            ...current,
            navigation: ensureNavigationValid({
                defaultMode: patch.defaultMode ?? current.navigation.defaultMode,
                allowedModes: patch.allowedModes ?? current.navigation.allowedModes
            })
        };
    }

    setViewerAllowedMode(mode: ScaNavigationMode, enabled: boolean): void {
        const current = this.getViewerConfig();
        let allowedModes = [...current.navigation.allowedModes];

        if (enabled) {
            if (!allowedModes.includes(mode)) {
                allowedModes.push(mode);
            }
        } else if (allowedModes.length > 1) {
            allowedModes = allowedModes.filter((entry) => entry !== mode);
        } else {
            return;
        }

        const defaultMode = allowedModes.includes(current.navigation.defaultMode) ?
            current.navigation.defaultMode :
            allowedModes[0];

        this.project.viewer = {
            ...current,
            navigation: ensureNavigationValid({ defaultMode, allowedModes })
        };
    }

    updateViewerAnimation(patch: Partial<ScaViewerConfig['camera']['animation']>): void {
        const current = this.getViewerConfig();
        const currentAnimation = current.camera.animation;
        this.project.viewer = normalizeViewerConfig({
            ...current,
            camera: {
                ...current.camera,
                animation: {
                    type: patch.type ?? currentAnimation.type,
                    duration: patch.duration ?? currentAnimation.duration,
                    turntable: patch.turntable ?
                        { ...currentAnimation.turntable, ...patch.turntable } :
                        currentAnimation.turntable
                }
            }
        });
    }

    updateViewerInteraction(patch: Partial<ScaViewerConfig['interaction']>): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            interaction: {
                focusTransition: {
                    duration: patch.focusTransition?.duration ??
                        current.interaction.focusTransition.duration
                },
                homeTransition: {
                    duration: patch.homeTransition?.duration ??
                        current.interaction.homeTransition.duration
                }
            }
        });
    }

    updateViewerBackground(background: ScaViewerBackground): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            background
        });
    }

    updateViewerHotspots(patch: Partial<NonNullable<ScaViewerConfig['hotspots']>>): void {
        const current = this.getViewerConfig();
        this.project.viewer = normalizeViewerConfig({
            ...current,
            hotspots: {
                showCards: patch.showCards ?? current.hotspots?.showCards ?? true
            }
        });
    }

    updateViewerNavigationTargets(patch: Partial<NonNullable<ScaViewerConfig['navigationTargets']>>): void {
        const current = this.getViewerConfig();
        const currentTargets = current.navigationTargets ?? {
            enabled: true,
            hotspots: true,
            regions: true
        };

        this.project.viewer = normalizeViewerConfig({
            ...current,
            navigationTargets: {
                enabled: patch.enabled ?? currentTargets.enabled,
                hotspots: patch.hotspots ?? currentTargets.hotspots,
                regions: patch.regions ?? currentTargets.regions
            }
        });
    }

    getViewerBackground(): ScaViewerBackground {
        return this.getViewerConfig().background!;
    }

    getHotspots(): ScaHotspot[] {
        return this.project.hotspots.map((hotspot) => structuredClone(hotspot));
    }

    getSelectedHotspotId(): string | null {
        return this.selectedHotspotId;
    }

    getSelectedHotspot(): ScaHotspot | null {
        if (!this.selectedHotspotId) {
            return null;
        }

        const hotspot = this.project.hotspots.find((entry) => entry.id === this.selectedHotspotId);
        return hotspot ? structuredClone(hotspot) : null;
    }

    selectHotspot(id: string | null): void {
        if (id !== null && !this.project.hotspots.some((hotspot) => hotspot.id === id)) {
            return;
        }

        this.selectedHotspotId = id;
    }

    addHotspot(hotspot: ScaHotspot): void {
        if (this.project.hotspots.some((entry) => entry.id === hotspot.id)) {
            throw new Error(`[SCA] duplicate hotspot id: ${hotspot.id}`);
        }

        this.project.hotspots.push(structuredClone(hotspot));
    }

    updateHotspot(id: string, patch: Partial<ScaHotspot>): void {
        const index = this.project.hotspots.findIndex((hotspot) => hotspot.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown hotspot id: ${id}`);
        }

        const current = this.project.hotspots[index];
        const nextId = patch.id ?? current.id;

        if (nextId !== id && this.project.hotspots.some((hotspot) => hotspot.id === nextId)) {
            throw new Error(`[SCA] duplicate hotspot id: ${nextId}`);
        }

        const { interaction: interactionPatch, ...restPatch } = patch;

        this.project.hotspots[index] = {
            ...structuredClone(current),
            ...structuredClone(restPatch),
            id: nextId,
            interaction: interactionPatch ? {
                ...structuredClone(current.interaction ?? {}),
                ...structuredClone(interactionPatch)
            } : current.interaction
        };

        if (this.selectedHotspotId === id && nextId !== id) {
            this.selectedHotspotId = nextId;
        }
    }

    deleteHotspot(id: string): void {
        const index = this.project.hotspots.findIndex((hotspot) => hotspot.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown hotspot id: ${id}`);
        }

        this.project.hotspots.splice(index, 1);

        if (this.selectedHotspotId === id) {
            this.selectedHotspotId = null;
        }
    }

    getRegions(): ScaRegion[] {
        return this.project.regions.map((region) => structuredClone(region));
    }

    getSelectedRegionId(): string | null {
        return this.selectedRegionId;
    }

    getSelectedRegion(): ScaRegion | null {
        if (!this.selectedRegionId) {
            return null;
        }

        const region = this.project.regions.find((entry) => entry.id === this.selectedRegionId);
        return region ? structuredClone(region) : null;
    }

    selectRegion(id: string | null): void {
        if (id !== null && !this.project.regions.some((region) => region.id === id)) {
            return;
        }

        this.selectedRegionId = id;
    }

    getSelectedRigNodeId(): string | null {
        return this.selectedRigNodeId;
    }

    selectRigNode(id: string | null): void {
        if (id !== null && !this.project.rig?.nodes.some((node) => node.id === id)) {
            return;
        }

        this.selectedRigNodeId = id;
    }

    pruneInvalidRigSelection(): boolean {
        const previous = this.selectedRigNodeId;
        if (!previous) {
            return false;
        }

        if (!this.project.rig?.nodes.some((node) => node.id === previous)) {
            this.selectedRigNodeId = null;
            return true;
        }

        return false;
    }

    addRegion(region: ScaRegion): void {
        if (this.project.regions.some((entry) => entry.id === region.id)) {
            throw new Error(`[SCA] duplicate region id: ${region.id}`);
        }

        this.project.regions.push(structuredClone(region));
    }

    updateRegion(id: string, patch: ScaRegionPatch): void {
        const index = this.project.regions.findIndex((region) => region.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown region id: ${id}`);
        }

        const current = this.project.regions[index];
        const nextId = patch.id ?? current.id;

        if (nextId !== id && this.project.regions.some((region) => region.id === nextId)) {
            throw new Error(`[SCA] duplicate region id: ${nextId}`);
        }

        this.project.regions[index] = {
            ...structuredClone(current),
            ...structuredClone(patch),
            id: nextId,
            source: {
                ...structuredClone(current.source),
                ...(patch.source ? structuredClone(patch.source) : {})
            },
            capture: {
                ...structuredClone(current.capture),
                ...(patch.capture ? structuredClone(patch.capture) : {})
            },
            interaction: {
                ...structuredClone(current.interaction),
                ...(patch.interaction ? structuredClone(patch.interaction) : {})
            },
            visual: (() => {
                const nextVisual = {
                    ...structuredClone(current.visual),
                    ...(patch.visual ? structuredClone(patch.visual) : {})
                };

                if (patch.visual?.pulse) {
                    nextVisual.pulse = {
                        ...(current.visual.pulse ?? {
                            enabled: false,
                            color: current.visual.activeTint,
                            strength: 0.5,
                            speed: 1,
                            mode: 'loop' as const,
                            stopOnInteraction: false
                        }),
                        ...patch.visual.pulse
                    };
                }

                if (patch.visual?.visited) {
                    nextVisual.visited = {
                        ...(current.visual.visited ?? {
                            enabled: false,
                            color: current.visual.activeTint,
                            opacity: 0.35
                        }),
                        ...patch.visual.visited
                    };
                }

                if (patch.visual?.stateContent !== undefined) {
                    nextVisual.stateContent = mergeVisualStateContent(
                        current.visual.stateContent,
                        patch.visual.stateContent
                    );
                }

                return nextVisual;
            })()
        };

        if (this.selectedRegionId === id && nextId !== id) {
            this.selectedRegionId = nextId;
        }
    }

    deleteRegion(id: string): void {
        const index = this.project.regions.findIndex((region) => region.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown region id: ${id}`);
        }

        this.project.regions.splice(index, 1);
        this.removeRigBindingsForRegion(id);

        if (this.selectedRegionId === id) {
            this.selectedRegionId = null;
        }
    }

    getRig() {
        return this.project.rig ? structuredClone(this.project.rig) : undefined;
    }

    addRigNode(node: ScaRigNode): void {
        const rig = ensureProjectRig(this.project);
        if (rig.nodes.some((entry) => entry.id === node.id)) {
            throw new Error(`[SCA] duplicate rig node id: ${node.id}`);
        }
        rig.nodes.push(structuredClone(node));
        this.project.rig = rig;
    }

    updateRigNode(id: string, patch: Partial<ScaRigNode>): void {
        const rig = ensureProjectRig(this.project);
        const index = rig.nodes.findIndex((node) => node.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown rig node id: ${id}`);
        }

        const current = rig.nodes[index];
        rig.nodes[index] = {
            ...structuredClone(current),
            name: typeof patch.name === 'string' ? patch.name : current.name,
            id: current.id,
            position: patch.position ? [...patch.position] as ScaRigVec3 : current.position,
            rotation: patch.rotation ? [...patch.rotation] as ScaRigVec3 : current.rotation,
            pivot: patch.pivot ? [...patch.pivot] as ScaRigVec3 : current.pivot,
            rest: patch.rest ? {
                position: patch.rest.position ?
                    [...patch.rest.position] as ScaRigVec3 :
                    current.rest.position,
                rotation: patch.rest.rotation ?
                    [...patch.rest.rotation] as ScaRigVec3 :
                    current.rest.rotation
            } : current.rest,
            parentId: patch.parentId !== undefined ?
                (patch.parentId ?? undefined) :
                current.parentId
        };
        if (rig.nodes[index].parentId === undefined) {
            delete rig.nodes[index].parentId;
        }
        this.project.rig = rig;
    }

    setRigNodeParent(
        id: string,
        parentId: string | null,
        mode: ScaRigReparentMode = 'keep-world'
    ): void {
        const rig = ensureProjectRig(this.project);
        const index = rig.nodes.findIndex((node) => node.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown rig node id: ${id}`);
        }

        if (wouldCreateRigCycle(rig, id, parentId)) {
            throw new Error(`[SCA] rig parent assignment would create a cycle: ${id} -> ${parentId}`);
        }

        const current = rig.nodes[index];
        const nextParentId = parentId ?? undefined;
        let nextNode: ScaRigNode = {
            ...structuredClone(current),
            parentId: nextParentId
        };
        if (!nextParentId) {
            delete nextNode.parentId;
        }

        if (mode === 'keep-world') {
            const local = computeReparentLocalKeepWorld(rig, current, parentId);
            nextNode = {
                ...nextNode,
                position: local.position,
                rotation: local.rotation
            };
        }

        rig.nodes[index] = nextNode;
        this.project.rig = rig;
    }

    resetRigNodeToRest(id: string): void {
        const rig = ensureProjectRig(this.project);
        const index = rig.nodes.findIndex((node) => node.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown rig node id: ${id}`);
        }

        const current = rig.nodes[index];
        rig.nodes[index] = {
            ...structuredClone(current),
            position: [...current.rest.position] as ScaRigVec3,
            rotation: [...current.rest.rotation] as ScaRigVec3
        };
        this.project.rig = rig;
    }

    setRigNodeRestFromCurrent(id: string): void {
        const rig = ensureProjectRig(this.project);
        const index = rig.nodes.findIndex((node) => node.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown rig node id: ${id}`);
        }

        const current = rig.nodes[index];
        rig.nodes[index] = {
            ...structuredClone(current),
            rest: poseFromVec3(current.position, current.rotation)
        };
        this.project.rig = rig;
    }

    deleteRigNode(id: string): void {
        const rig = ensureProjectRig(this.project);
        const index = rig.nodes.findIndex((node) => node.id === id);
        if (index === -1) {
            throw new Error(`[SCA] unknown rig node id: ${id}`);
        }

        promoteDirectChildrenOnDelete(rig, id);
        rig.nodes.splice(index, 1);
        rig.bindings = rig.bindings.filter((binding) => binding.nodeId !== id);
        this.project.rig = rig.nodes.length > 0 || rig.bindings.length > 0 ? rig : undefined;

        if (this.selectedRigNodeId === id) {
            this.selectedRigNodeId = null;
        }
    }

    getRigBindingForRegion(regionId: string) {
        const binding = this.project.rig?.bindings.find((entry) => entry.regionId === regionId);
        return binding ? structuredClone(binding) : null;
    }

    setRigBinding(
        regionId: string,
        nodeId: string | null,
        options?: {
            bindMode?: ScaRigBindMode;
        }
    ): void {
        const rig = ensureProjectRig(this.project);
        rig.bindings = rig.bindings.filter((binding) => binding.regionId !== regionId);

        if (nodeId) {
            const node = rig.nodes.find((entry) => entry.id === nodeId);
            if (!node) {
                throw new Error(`[SCA] unknown rig node id: ${nodeId}`);
            }

            const bindMode = options?.bindMode ?? DEFAULT_RIG_BIND_MODE;
            const keepWorldOffset = bindMode === 'keep-world' ?
                createKeepWorldBindOffset(rig, node) :
                null;
            const bindOffset = bindMode === 'keep-world' ?
                keepWorldOffset!.bindOffset :
                computeSnapBindOffset();

            rig.bindings.push({
                regionId,
                nodeId,
                mode: 'rigid',
                bindMode,
                bindOffset,
                bindOffsetMatrix: keepWorldOffset?.bindOffsetMatrix
            });
        }

        this.project.rig = rig.nodes.length > 0 || rig.bindings.length > 0 ? rig : undefined;
    }

    rebindRegion(regionId: string, bindMode: ScaRigBindMode): void {
        const rig = ensureProjectRig(this.project);
        const binding = rig.bindings.find((entry) => entry.regionId === regionId);
        if (!binding) {
            throw new Error(`[SCA] region is not rig-bound: ${regionId}`);
        }

        const node = rig.nodes.find((entry) => entry.id === binding.nodeId);
        if (!node) {
            throw new Error(`[SCA] unknown rig node id: ${binding.nodeId}`);
        }

        binding.bindMode = bindMode;
        if (bindMode === 'keep-world') {
            const keepWorldOffset = createKeepWorldBindOffset(rig, node);
            binding.bindOffset = keepWorldOffset.bindOffset;
            binding.bindOffsetMatrix = keepWorldOffset.bindOffsetMatrix;
        } else {
            binding.bindOffset = computeSnapBindOffset();
            delete binding.bindOffsetMatrix;
        }
        this.project.rig = rig;
    }

    private removeRigBindingsForRegion(regionId: string): void {
        if (!this.project.rig) {
            return;
        }

        this.project.rig.bindings = this.project.rig.bindings.filter(
            (binding) => binding.regionId !== regionId
        );
        if (this.project.rig.nodes.length === 0 && this.project.rig.bindings.length === 0) {
            delete this.project.rig;
        }
    }

    loadProject(project: ScaProject): void {
        this.project = normalizeProject(project);

        if (this.selectedHotspotId &&
            !this.project.hotspots.some((hotspot) => hotspot.id === this.selectedHotspotId)) {
            this.selectedHotspotId = null;
        }

        if (this.selectedRegionId &&
            !this.project.regions.some((region) => region.id === this.selectedRegionId)) {
            this.selectedRegionId = null;
        }

        if (this.selectedRigNodeId &&
            !this.project.rig?.nodes.some((node) => node.id === this.selectedRigNodeId)) {
            this.selectedRigNodeId = null;
        }
    }

    toJSON(): ScaProject {
        return this.getProject();
    }
}

export { HotspotStore };
