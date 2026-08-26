/**
 * Verify rig binding ownership fix: before/after counts for region_03/region_05 overlap.
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
const RIG_02 = 'rig_02';
const MISMATCH76_STORAGE = [
    51355, 75046, 75047, 75053, 75054, 75056, 75057, 75058, 75078, 75086, 75087, 75088, 75089, 75090,
    75091, 75092, 75093, 75094, 75095, 75096, 75097, 75098, 75100, 75101, 75110, 75113, 75467, 75468,
    75472, 75473, 75626, 75628, 75630, 75643, 75644, 75645, 75666, 75674, 75681, 75682, 75686, 75702,
    75896, 75898, 75902, 75905, 75907, 75909, 75910, 75911, 75912, 75915, 75916, 75950, 75951, 75952,
    75953, 75954, 75959, 75961, 75962, 75965, 75968, 75969, 75970, 75973, 75974, 75975, 75977, 75978,
    75980, 75981, 76852, 76854, 76856, 76902
];

const extractSsproj = (ssprojPath: string): string => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ssproj-'));
    const zipCopy = path.join(tempRoot, 'project.zip');
    fs.copyFileSync(ssprojPath, zipCopy);
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${tempRoot.replace(/'/g, "''")}' -Force"`, {
        stdio: 'pipe'
    });
    return tempRoot;
};

const decodeMask = (maskPath: string): Set<number> => {
    const bytes = new Uint8Array(fs.readFileSync(maskPath));
    const { ranges } = decodeRegionMask(bytes);
    const set = new Set<number>();
    ranges.forEach((index) => set.add(index));
    return set;
};

const simulateLegacy = (
    masks: Map<string, Set<number>>,
    bindings: Array<{ regionId: string; nodeId: string }>
) => {
    const paletteByNode = new Map<string, number>();
    let next = 1;
    const ownerByGaussian = new Map<number, { regionId: string; nodeId: string }>();
    const paletteByGaussian = new Map<number, number>();

    for (const binding of [...bindings].sort((a, b) => a.regionId.localeCompare(b.regionId))) {
        const mask = masks.get(binding.regionId);
        if (!mask) {
            continue;
        }
        let palette = paletteByNode.get(binding.nodeId);
        if (palette === undefined) {
            palette = next++;
            paletteByNode.set(binding.nodeId, palette);
        }
        for (const index of mask) {
            if (ownerByGaussian.has(index)) {
                continue;
            }
            ownerByGaussian.set(index, { regionId: binding.regionId, nodeId: binding.nodeId });
            paletteByGaussian.set(index, palette);
        }
    }

    return { ownerByGaussian, paletteByGaussian, paletteByNode };
};

const simulateHierarchy = (
    rig: { version: 1; nodes: Array<{ id: string; parentId?: string | null }>; bindings: Array<{ regionId: string; nodeId: string }> },
    masks: Map<string, Set<number>>
) => {
    const claims = rig.bindings.map((binding) => ({
        regionId: binding.regionId,
        nodeId: binding.nodeId,
        memberCount: masks.get(binding.regionId)?.size ?? 0,
        gaussianIndices: masks.get(binding.regionId) ?? []
    })).filter((claim) => claim.memberCount > 0);

    const { ownerByGaussian, skippedRegions, unrelatedConflictRegions } = resolveRigBindingOwners(rig, claims);
    const paletteByNode = new Map<string, number>();
    let next = 1;
    const paletteByGaussian = new Map<number, number>();

    for (const [index, owner] of ownerByGaussian) {
        let palette = paletteByNode.get(owner.nodeId);
        if (palette === undefined) {
            palette = next++;
            paletteByNode.set(owner.nodeId, palette);
        }
        paletteByGaussian.set(index, palette);
    }

    return { ownerByGaussian, paletteByGaussian, paletteByNode, skippedRegions, unrelatedConflictRegions };
};

const countPalette = (
    indices: number[],
    paletteByGaussian: Map<number, number>,
    rig02Palette: number
) => {
    let rig02 = 0;
    let other = 0;
    let identity = 0;
    for (const index of indices) {
        const palette = paletteByGaussian.get(index);
        if (!palette) {
            identity++;
        } else if (palette === rig02Palette) {
            rig02++;
        } else {
            other++;
        }
    }
    return { rig02, other, identity, total: indices.length };
};

function main() {
    const extracted = extractSsproj(SSPROJ_PATH);
    const project = JSON.parse(fs.readFileSync(path.join(extracted, 'document.json'), 'utf8')).sca.project;
    const runtimeProject = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, 'project.json'), 'utf8'));

    const loadMasks = (base: string, regions: string[]) => {
        const masks = new Map<string, Set<number>>();
        for (const regionId of regions) {
            const maskPath = path.join(base, 'regions', `${regionId}.mask`);
            if (fs.existsSync(maskPath)) {
                masks.set(regionId, decodeMask(maskPath));
            }
        }
        return masks;
    };

    const editorMasks = loadMasks(path.join(extracted, 'sca'), ['region_03', 'region_04', 'region_05']);
    const runtimeMasks = loadMasks(RUNTIME_DIR, ['region_03', 'region_04', 'region_05']);

    const rig = project.rig;
    const bindings = rig.bindings as Array<{ regionId: string; nodeId: string }>;

    const legacy = simulateLegacy(editorMasks, bindings);
    const hierarchy = simulateHierarchy(rig, editorMasks);

    const rig02Legacy = legacy.paletteByNode.get(RIG_02) ?? -1;
    const rig02New = hierarchy.paletteByNode.get(RIG_02) ?? -1;

    const set05 = editorMasks.get('region_05') ?? new Set<number>();
    const unionFootprint = [...set05];

    const legacy76 = countPalette(MISMATCH76_STORAGE, legacy.paletteByGaussian, rig02Legacy);
    const new76 = countPalette(MISMATCH76_STORAGE, hierarchy.paletteByGaussian, rig02New);

    const legacyUnion = countPalette(unionFootprint, legacy.paletteByGaussian, rig02Legacy);
    const newUnion = countPalette(unionFootprint, hierarchy.paletteByGaussian, rig02New);

    const legacy03 = countPalette([...(editorMasks.get('region_03') ?? [])], legacy.paletteByGaussian, rig02Legacy);
    const new03 = countPalette([...(editorMasks.get('region_03') ?? [])], hierarchy.paletteByGaussian, rig02New);

    console.log('========== RIG BINDING OWNERSHIP VERIFY ==========\n');

    console.log('Palette indices:');
    console.log(`  rig_02 legacy=${rig02Legacy} new=${rig02New}`);

    console.log('\n--- 76 shared region_03∩region_05 Gaussians ---');
    console.log(`BEFORE: rig_02 palette=${legacy76.rig02}/76, other=${legacy76.other}, identity=${legacy76.identity}`);
    console.log(`AFTER:  rig_02 palette=${new76.rig02}/76, other=${new76.other}, identity=${new76.identity}`);
    console.log(`PASS (all 76 → rig_02 palette #${rig02New}): ${new76.rig02 === 76 ? 'YES' : 'NO'}`);

    console.log('\n--- region_05 union footprint (animated object) ---');
    console.log(`BEFORE: rig_02=${legacyUnion.rig02}/${legacyUnion.total}, other=${legacyUnion.other}, identity=${legacyUnion.identity}`);
    console.log(`AFTER:  rig_02=${newUnion.rig02}/${newUnion.total}, other=${newUnion.other}, identity=${newUnion.identity}`);

    console.log('\n--- Full region_03 ownership ---');
    console.log(`BEFORE: rig_02=${legacy03.rig02}, other rig=${legacy03.other}, identity=${legacy03.identity} (total ${legacy03.total})`);
    console.log(`AFTER:  rig_02=${new03.rig02}, other rig=${new03.other}, identity=${new03.identity} (total ${new03.total})`);
    console.log(`region_03 lost to rig_02: ${legacy03.other - new03.other} Gaussians`);

    console.log('\n--- Skipped / conflict regions (new policy) ---');
    console.log(`  skippedRegions: ${[...hierarchy.skippedRegions].sort().join(', ') || '(none)'}`);
    console.log(`  unrelatedConflictRegions: ${[...hierarchy.unrelatedConflictRegions].sort().join(', ') || '(none)'}`);

    const runtimeHierarchy = simulateHierarchy(runtimeProject.rig, runtimeMasks);
    const runtimeSet03 = runtimeMasks.get('region_03') ?? new Set<number>();
    const runtimeSet04 = runtimeMasks.get('region_04') ?? new Set<number>();
    const runtimeSet05 = runtimeMasks.get('region_05') ?? new Set<number>();
    const runtimeMismatch76 = [...runtimeSet05].filter((index) =>
        runtimeSet03.has(index) && !runtimeSet04.has(index)
    );
    const runtime76 = countPalette(
        runtimeMismatch76,
        runtimeHierarchy.paletteByGaussian,
        runtimeHierarchy.paletteByNode.get(RIG_02) ?? -1
    );
    const runtimeUnion = countPalette(
        [...runtimeSet05],
        runtimeHierarchy.paletteByGaussian,
        runtimeHierarchy.paletteByNode.get(RIG_02) ?? -1
    );
    console.log('\n--- Runtime export index space ---');
    console.log(`  mismatch Gaussians (region_05∩region_03\\region_04): ${runtimeMismatch76.length}`);
    console.log(`  mismatch → rig_02 palette: ${runtime76.rig02}/${runtimeMismatch76.length}`);
    console.log(`  region_05 union → rig_02 palette: ${runtimeUnion.rig02}/${runtimeUnion.total}, other=${runtimeUnion.other}`);
    console.log(`  rig_02 palette index: ${runtimeHierarchy.paletteByNode.get(RIG_02)}`);

    const pass =
        new76.rig02 === 76 &&
        newUnion.other === 0 &&
        newUnion.rig02 === newUnion.total &&
        runtimeMismatch76.length === 76 &&
        runtime76.rig02 === 76 &&
        runtimeUnion.other === 0;

    console.log(`\nOVERALL: ${pass ? 'PASS' : 'FAIL'}`);
    console.log('==================================================\n');

    if (!pass) {
        process.exit(1);
    }
}

main();
