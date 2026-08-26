/**
 * Rig binding coverage analysis for rig_02 / region_04 / region_05 overlap.
 * Inputs: current.ssproj + runtime/latest/
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodeRegionMask } from '../src/sca/regions/region-mask-format';
import { resolveRigBindingOwners } from '../src/sca/rig/rig-binding-ownership';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_DIR = path.join(ROOT, 'runtime/latest');
const RIG_NODE = 'rig_02';
const REGIONS = ['region_04', 'region_05'] as const;

type IndexSpace = 'editor_storage' | 'runtime_export';

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

const decodeMaskIndices = (maskPath: string): number[] => {
    const bytes = new Uint8Array(fs.readFileSync(maskPath));
    const { ranges } = decodeRegionMask(bytes);
    const indices: number[] = [];
    ranges.forEach((index) => indices.push(index));
    indices.sort((a, b) => a - b);
    return indices;
};

const toSet = (indices: number[]): Set<number> => new Set(indices);

type BindingSimResult = {
    ownerByGaussian: Map<number, string>;
    paletteByGaussian: Map<number, number>;
    conflictSkippedByRegion: Map<string, number>;
    assignedByRegion: Map<string, number>;
    identityCount: number;
    rigPaletteCount: number;
    rigPaletteIndex: number;
    otherPaletteCounts: Map<number, number>;
};

/** Mirrors region-rig-applier.ts + runtime-rig-viewer-host.ts first-binding-wins policy. */
const simulateBindingAssignment = (
    space: IndexSpace,
    regionMasks: Map<string, Set<number>>,
    bindings: Array<{ regionId: string; nodeId: string }>,
    totalGaussians: number
): BindingSimResult => {
    const sortedBindings = [...bindings].sort((a, b) => a.regionId.localeCompare(b.regionId));

    const paletteByNodeId = new Map<string, number>();
    let nextPalette = 1;

    const ownerByGaussian = new Map<number, string>();
    const paletteByGaussian = new Map<number, number>();
    const conflictSkippedByRegion = new Map<string, number>();
    const assignedByRegion = new Map<string, number>();

    for (const regionId of REGIONS) {
        conflictSkippedByRegion.set(regionId, 0);
        assignedByRegion.set(regionId, 0);
    }

    for (const binding of sortedBindings) {
        const mask = regionMasks.get(binding.regionId);
        if (!mask) {
            continue;
        }

        let paletteIndex = paletteByNodeId.get(binding.nodeId);
        if (paletteIndex === undefined) {
            paletteIndex = nextPalette++;
            paletteByNodeId.set(binding.nodeId, paletteIndex);
        }

        for (const gaussianIndex of mask) {
            if (gaussianIndex < 0 || gaussianIndex >= totalGaussians) {
                continue;
            }

            const existingOwner = ownerByGaussian.get(gaussianIndex);
            if (existingOwner && existingOwner !== binding.regionId) {
                conflictSkippedByRegion.set(
                    binding.regionId,
                    (conflictSkippedByRegion.get(binding.regionId) ?? 0) + 1
                );
                continue;
            }
            if (existingOwner === binding.regionId) {
                continue;
            }

            ownerByGaussian.set(gaussianIndex, binding.regionId);
            paletteByGaussian.set(gaussianIndex, paletteIndex);
            assignedByRegion.set(
                binding.regionId,
                (assignedByRegion.get(binding.regionId) ?? 0) + 1
            );
        }
    }

    const rigPaletteIndex = paletteByNodeId.get(RIG_NODE) ?? -1;
    let identityCount = 0;
    let rigPaletteCount = 0;
    const otherPaletteCounts = new Map<number, number>();

    const union = new Set<number>();
    for (const mask of regionMasks.values()) {
        for (const index of mask) {
            union.add(index);
        }
    }

    for (const index of union) {
        const palette = paletteByGaussian.get(index);
        if (palette === undefined || palette === 0) {
            identityCount++;
        } else if (palette === rigPaletteIndex) {
            rigPaletteCount++;
        } else {
            otherPaletteCounts.set(palette, (otherPaletteCounts.get(palette) ?? 0) + 1);
        }
    }

    return {
        ownerByGaussian,
        paletteByGaussian,
        conflictSkippedByRegion,
        assignedByRegion,
        identityCount,
        rigPaletteCount,
        rigPaletteIndex,
        otherPaletteCounts
    };
};

const pct = (part: number, whole: number): string =>
    whole === 0 ? '0.00%' : `${(100 * part / whole).toFixed(2)}%`;

function analyzeSpace(
    label: IndexSpace,
    targetMasks: Map<string, Set<number>>,
    simMasks: Map<string, Set<number>>,
    bindings: Array<{ regionId: string; nodeId: string }>,
    totalGaussians: number
) {
    const set04 = targetMasks.get('region_04') ?? new Set<number>();
    const set05 = targetMasks.get('region_05') ?? new Set<number>();

    const set03 = simMasks.get('region_03') ?? new Set<number>();

    const only04: number[] = [];
    const only05: number[] = [];
    const both: number[] = [];
    const only05also03: number[] = [];
    const bothAlso03: number[] = [];

    for (const index of set04) {
        if (set05.has(index)) {
            both.push(index);
            if (set03.has(index)) {
                bothAlso03.push(index);
            }
        } else {
            only04.push(index);
        }
    }
    for (const index of set05) {
        if (!set04.has(index)) {
            only05.push(index);
            if (set03.has(index)) {
                only05also03.push(index);
            }
        }
    }

    only04.sort((a, b) => a - b);
    only05.sort((a, b) => a - b);
    both.sort((a, b) => a - b);

    const unionSize = only04.length + only05.length + both.length;
    const sim = simulateBindingAssignment(label, simMasks, bindings, totalGaussians);

    const rigPalette = sim.rigPaletteIndex;

    const paletteFor = (indices: number[]) => {
        let identity = 0;
        let rig = 0;
        let other = 0;
        let owner04 = 0;
        let owner05 = 0;
        for (const index of indices) {
            const palette = sim.paletteByGaussian.get(index);
            const owner = sim.ownerByGaussian.get(index);
            if (palette === undefined || palette === 0) {
                identity++;
            } else if (palette === rigPalette) {
                rig++;
            } else {
                other++;
            }
            if (owner === 'region_04') {
                owner04++;
            } else if (owner === 'region_05') {
                owner05++;
            }
        }
        return { identity, rig, other, owner04, owner05, total: indices.length };
    };

    console.log(`\n========== ${label.toUpperCase()} INDEX SPACE ==========`);
    console.log(`Total splat Gaussians (context): ${totalGaussians}`);
    console.log(`region_04 members: ${set04.size}`);
    console.log(`region_05 members: ${set05.size}`);
    console.log(`Union (animated footprint): ${unionSize}`);
    console.log('');
    console.log('Membership overlap:');
    console.log(`  only region_04: ${only04.length} (${pct(only04.length, unionSize)} of union)`);
    console.log(`  only region_05: ${only05.length} (${pct(only05.length, unionSize)} of union)`);
    console.log(`  in both:        ${both.length} (${pct(both.length, unionSize)} of union)`);
    console.log(`  overlap of region_05: ${pct(both.length, set05.size)} of region_05`);
    console.log(`  overlap of region_04: ${pct(both.length, set04.size)} of region_04`);
    if (set03.size > 0) {
        console.log(`\nregion_03 (rig_01) interaction:`);
        console.log(`  region_03 members: ${set03.size}`);
        console.log(`  region_05-only also in region_03: ${only05also03.length} (${pct(only05also03.length, only05.length)} of region_05-only)`);
        console.log(`  overlap region_04∩05 also in region_03: ${bothAlso03.length}`);
        console.log(`  → these get rig_01 palette (first-binding), not rig_02`);
    }

    console.log('\nBinding simulation (sorted by regionId, first-binding-wins):');
    console.log(`  rig_02 palette index: ${rigPalette}`);
    for (const regionId of REGIONS) {
        console.log(`  assigned by ${regionId}: ${sim.assignedByRegion.get(regionId)}`);
        console.log(`  conflict-skipped for ${regionId}: ${sim.conflictSkippedByRegion.get(regionId)}`);
    }

    const cats = [
        ['only region_04', only04],
        ['only region_05', only05],
        ['both (overlap)', both],
        ['union', [...only04, ...only05, ...both]]
    ] as const;

    console.log('\nTransform assignment by category:');
    for (const [name, indices] of cats) {
        const p = paletteFor(indices);
        console.log(`  ${name} (n=${p.total}):`);
        console.log(`    owner region_04: ${p.owner04}, owner region_05: ${p.owner05}`);
        console.log(`    palette identity(0/none): ${p.identity} (${pct(p.identity, p.total)})`);
        console.log(`    palette rig_02 (#${rigPalette}): ${p.rig} (${pct(p.rig, p.total)})`);
        console.log(`    palette other rig: ${p.other} (${pct(p.other, p.total)})`);
    }

    if (both.length > 0) {
        const overlapPalette = paletteFor(both);
        console.log('\nOverlapping Gaussians (first-binding-wins):');
        console.log(`  All owned by region_04: ${overlapPalette.owner04 === both.length ? 'YES' : 'NO'} (${overlapPalette.owner04}/${both.length})`);
        console.log(`  Any owned by region_05: ${overlapPalette.owner05}`);
        console.log(`  All get rig_02 palette: ${overlapPalette.rig === both.length ? 'YES' : 'NO'}`);
        console.log(`  Any keep identity: ${overlapPalette.identity}`);
    }

    const only05Palette = paletteFor(only05);
    console.log('\nregion_05-only Gaussians (would be skipped if region_04 claimed them — N/A here):');
    console.log(`  assigned via region_05 pass: ${sim.assignedByRegion.get('region_05')}`);
    console.log(`  get rig_02 palette: ${only05Palette.rig}/${only05Palette.total}`);
    console.log(`  keep identity: ${only05Palette.identity}`);

    const unionIdentity = paletteFor([...only04, ...only05, ...both]).identity;
    const unionOtherRig = paletteFor([...only04, ...only05, ...both]).other;
    const unionRig02 = paletteFor([...only04, ...only05, ...both]).rig;

    return {
        only04: only04.length,
        only05: only05.length,
        both: both.length,
        only05also03: only05also03.length,
        unionSize,
        sim,
        conflictSkipped05: sim.conflictSkippedByRegion.get('region_05') ?? 0,
        unionIdentity,
        unionOtherRig,
        unionRig02
    };
}

function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const project = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8')).sca.project;
    const runtimeProject = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'project.json'), 'utf8'));

    const rig = project.rig;
    const allBindings = rig.bindings as Array<{ regionId: string; nodeId: string }>;

    const rig02Bindings = allBindings.filter((b) => b.nodeId === RIG_NODE && REGIONS.includes(b.regionId as typeof REGIONS[number]));
    console.log('========== RIG BINDING COVERAGE: rig_02 / region_04 / region_05 ==========');
    console.log('Bindings involved:');
    for (const b of rig02Bindings) {
        console.log(`  ${b.regionId} -> ${b.nodeId}`);
    }
    console.log('\nAll rig bindings (palette alloc order context):');
    for (const b of [...allBindings].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
        console.log(`  ${b.regionId} -> ${b.nodeId}`);
    }

    const editorMasksAll = new Map<string, Set<number>>();
    for (const region of project.regions ?? []) {
        if (!region.enabled) {
            continue;
        }
        const maskPath = path.join(extracted, 'sca/regions', `${region.id}.mask`);
        if (fs.existsSync(maskPath)) {
            editorMasksAll.set(region.id, toSet(decodeMaskIndices(maskPath)));
        }
    }

    const runtimeMasksAll = new Map<string, Set<number>>();
    for (const region of runtimeProject.regions ?? []) {
        const maskPath = path.join(RUNTIME_DIR, 'regions', `${region.id}.mask`);
        if (fs.existsSync(maskPath)) {
            runtimeMasksAll.set(region.id, toSet(decodeMaskIndices(maskPath)));
        }
    }

    const editorMasks = new Map<string, Set<number>>();
    for (const regionId of REGIONS) {
        editorMasks.set(regionId, editorMasksAll.get(regionId) ?? new Set());
    }

    const runtimeMasks = new Map<string, Set<number>>();
    for (const regionId of REGIONS) {
        runtimeMasks.set(regionId, runtimeMasksAll.get(regionId) ?? new Set());
    }

    const editorTotal = Math.max(...[...editorMasks.values()].flatMap((s) => [...s]), 0) + 1;
    const runtimeTotal = runtimeProject.regions?.find((r: { id: string }) => r.id === 'region_04')?.capture?.gaussianCount ??
        Math.max(...[...runtimeMasks.values()].flatMap((s) => [...s]), 0) + 1;

    const editorResult = analyzeSpace('editor_storage', editorMasks, editorMasksAll, allBindings, editorTotal);
    const runtimeResult = analyzeSpace('runtime_export', runtimeMasks, runtimeMasksAll, runtimeProject.rig?.bindings ?? allBindings, runtimeTotal);

    console.log('\nPalette indices (full binding simulation incl. region_03/rig_01):');
    console.log(`  Editor rig_02 palette index: ${editorResult.sim.rigPaletteIndex}`);
    console.log(`  Runtime rig_02 palette index: ${runtimeResult.sim.rigPaletteIndex}`);

    console.log('\n========== CONCLUSIONS ==========');
    console.log(`Editor: region_05 conflict-skipped (overlap with earlier binding): ${editorResult.conflictSkipped05}`);
    console.log(`  Matches log "skipped overlapping rig bindings for regions: region_05" when count > 0: ${editorResult.conflictSkipped05 > 0 ? 'YES' : 'NO'}`);
    console.log(`Runtime: region_05 conflict-skipped: ${runtimeResult.conflictSkipped05}`);

    const editorUnionIdentity = editorResult.unionIdentity;
    const runtimeUnionIdentity = runtimeResult.unionIdentity;
    console.log(`\nUnion (region_04 ∪ region_05) transform assignment:`);
    console.log(`  rig_02 palette: ${editorResult.unionRig02}/${editorResult.unionSize} (${pct(editorResult.unionRig02, editorResult.unionSize)}) editor`);
    console.log(`  other rig (rig_01): ${editorResult.unionOtherRig} (${pct(editorResult.unionOtherRig, editorResult.unionSize)}) editor`);
    console.log(`  identity: ${editorUnionIdentity} (${pct(editorUnionIdentity, editorResult.unionSize)}) editor`);

    console.log('\nFirst-binding-wins impact:');
    if (editorResult.both > 0) {
        console.log(`  ${editorResult.both} overlap Gaussians are claimed by region_04 (processed first alphabetically).`);
        console.log(`  region_05 binding pass skips assigning those indices but they ALREADY have rig_02 palette from region_04.`);
        console.log(`  Overlap does NOT leave those Gaussians at identity when both regions bind to rig_02.`);
    } else {
        console.log('  No overlap between region_04 and region_05 masks.');
    }

    if (editorResult.only05 > 0 && editorResult.sim.assignedByRegion.get('region_05') === editorResult.only05) {
        console.log(`  All ${editorResult.only05} region_05-only Gaussians are assigned by region_05 pass.`);
    }

    const animatedLooksWrongDueToOverlap =
        editorResult.unionOtherRig > 0 || editorUnionIdentity > 0;

    console.log(`\nCould overlap cause inconsistent rig_02 transform on animated footprint?`);
    if (editorResult.unionOtherRig > 0) {
        console.log(`  YES — ${editorResult.unionOtherRig} Gaussians (${pct(editorResult.unionOtherRig, editorResult.unionSize)}) in region_05 footprint get rig_01 (region_03 wins first-binding), not rig_02.`);
        console.log(`  region_04∩region_05 overlap (${editorResult.both}) is fine — all get rig_02 via region_04.`);
        console.log(`  region_05 skipped count ${editorResult.conflictSkipped05} = ${editorResult.both} (region_04) + ${editorResult.only05also03} (region_03).`);
    } else {
        console.log(`  NO — entire union gets rig_02 palette consistently`);
    }
    console.log('================================================================\n');
}

main();
