/**
 * Spatial analysis of 76 Gaussians in region_05 ∩ region_03 (rig_01, not rig_02).
 * Uses rig-binding coverage membership + PLY/SOG centers.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    MemoryReadFileSystem,
    ZipReadFileSystem,
    createChunkDataPool,
    getInputFormat,
    materializeToDataTable,
    readFile,
    readSog
} from '@playcanvas/splat-transform';

import { decodeRegionMask } from '../src/sca/regions/region-mask-format';

const ROOT = path.resolve('sca-workspace');
const SSPROJ_PATH = path.join(ROOT, 'project/current.ssproj');
const RUNTIME_DIR = path.join(ROOT, 'runtime/latest');
const REPORT_PATH = path.join(ROOT, 'compare/reports/rig-mismatch-76-spatial.json');

type Vec3 = [number, number, number];
type CenterColumns = { x: Float32Array; y: Float32Array; z: Float32Array; count: number };

const RIG_02_HANDLE: Vec3 = [0.043530, -0.176535, 0.625845];
const SOG_CENTER_EPSILON = 0.04;
const CLUSTER_LINK_DIST = 0.025; // metres — connected-component threshold

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

const centerAt = (columns: CenterColumns, index: number): Vec3 =>
    [columns.x[index], columns.y[index], columns.z[index]];

const distance3 = (a: Vec3, b: Vec3): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

const bboxOf = (points: Vec3[]) => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) {
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
        }
    }
    const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const diagonal = Math.hypot(size[0], size[1], size[2]);
    return { min, max, size, diagonal };
};

const centroidOf = (points: Vec3[]): Vec3 => {
    if (points.length === 0) {
        return [0, 0, 0];
    }
    let sum: Vec3 = [0, 0, 0];
    for (const p of points) {
        sum = add3(sum, p);
    }
    return scale3(sum, 1 / points.length);
};

async function loadPlyCenters(plyPath: string): Promise<CenterColumns> {
    const plyBytes = new Uint8Array(fs.readFileSync(plyPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('splat.ply', plyBytes);
    const sources = await readFile({
        filename: 'splat.ply',
        inputFormat: getInputFormat('splat.ply'),
        fileSystem: fsMem
    });
    const pool = createChunkDataPool({ chunkSize: sources[0].meta.chunkSize });
    const table = await materializeToDataTable(sources[0], pool, new Set(['position']));
    await sources[0].close();
    return {
        count: table.numRows,
        x: table.getColumnByName('x').data as Float32Array,
        y: table.getColumnByName('y').data as Float32Array,
        z: table.getColumnByName('z').data as Float32Array
    };
}

async function loadSogCenters(sogPath: string): Promise<CenterColumns> {
    const sogBytes = new Uint8Array(fs.readFileSync(sogPath));
    const fsMem = new MemoryReadFileSystem();
    fsMem.set('index.sog', sogBytes);
    const zipFs = new ZipReadFileSystem(await fsMem.createSource('index.sog'));
    const table = await readSog(zipFs, 'meta.json');
    return {
        count: table.numRows,
        x: table.getColumnByName('x').data as Float32Array,
        y: table.getColumnByName('y').data as Float32Array,
        z: table.getColumnByName('z').data as Float32Array
    };
};

const buildStorageToRuntimeMap = (
    storageIndices: number[],
    sog: CenterColumns,
    ply: CenterColumns
): Map<number, { runtimeIndex: number; delta: number }> => {
    const forward = new Map<number, { runtimeIndex: number; delta: number }>();
    for (const storageIndex of storageIndices) {
        const editorCenter = centerAt(ply, storageIndex);
        let bestRuntime = -1;
        let bestDelta = Infinity;
        for (let runtimeIndex = 0; runtimeIndex < sog.count; runtimeIndex++) {
            const delta = distance3(editorCenter, centerAt(sog, runtimeIndex));
            if (delta < bestDelta) {
                bestDelta = delta;
                bestRuntime = runtimeIndex;
            }
        }
        forward.set(storageIndex, { runtimeIndex: bestRuntime, delta: bestDelta });
    }
    return forward;
};

/** Union-find connected components by distance threshold. */
const spatialClusters = (points: Vec3[], linkDist: number) => {
    const n = points.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const unite = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) {
            parent[rb] = ra;
        }
    };

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (distance3(points[i], points[j]) <= linkDist) {
                unite(i, j);
            }
        }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) {
            groups.set(root, []);
        }
        groups.get(root)!.push(i);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length);
};

const nearestNeighborDist = (target: Vec3, others: Vec3[]): number => {
    let best = Infinity;
    for (const o of others) {
        best = Math.min(best, distance3(target, o));
    }
    return best;
};

const median = (values: number[]): number => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ?
        (sorted[mid - 1] + sorted[mid]) / 2 :
        sorted[mid];
};

const identifyMismatch76 = (
    set03: Set<number>,
    set04: Set<number>,
    set05: Set<number>
): number[] => {
    const indices: number[] = [];
    for (const index of set05) {
        if (!set04.has(index) && set03.has(index)) {
            indices.push(index);
        }
    }
    indices.sort((a, b) => a - b);
    return indices;
};

async function main() {
    const extracted = extractSsproj(SSPROJ_PATH);

    const editorMaskPath = (id: string) => path.join(extracted, 'sca/regions', `${id}.mask`);
    const runtimeMaskPath = (id: string) => path.join(RUNTIME_DIR, 'regions', `${id}.mask`);

    const editor03 = new Set(decodeMaskIndices(editorMaskPath('region_03')));
    const editor04 = new Set(decodeMaskIndices(editorMaskPath('region_04')));
    const editor05 = new Set(decodeMaskIndices(editorMaskPath('region_05')));

    const runtime03 = new Set(decodeMaskIndices(runtimeMaskPath('region_03')));
    const runtime04 = new Set(decodeMaskIndices(runtimeMaskPath('region_04')));
    const runtime05 = new Set(decodeMaskIndices(runtimeMaskPath('region_05')));

    const storageIndices = identifyMismatch76(editor03, editor04, editor05);
    const runtimeIndicesFromMask = identifyMismatch76(runtime03, runtime04, runtime05);

    const plyPath = fs.existsSync(path.join(extracted, 'splat_0.ply')) ?
        path.join(extracted, 'splat_0.ply') :
        path.join(extracted, 'splats/splat_0.ply');
    const ply = await loadPlyCenters(plyPath);
    const sog = await loadSogCenters(path.join(RUNTIME_DIR, 'index.sog'));

    const indexMap = buildStorageToRuntimeMap(storageIndices, sog, ply);

    // rig_02-bound footprint in region_05 (editor storage space)
    const rig02Footprint: number[] = [];
    for (const index of editor05) {
        if (!editor03.has(index) || editor04.has(index)) {
            // region_05-only OR overlap region_04∩05 — both get rig_02
            // Exclude region_05-only ∩ region_03 (the 76)
            if (!editor04.has(index) && editor03.has(index)) {
                continue;
            }
            rig02Footprint.push(index);
        } else if (editor04.has(index)) {
            rig02Footprint.push(index);
        }
    }
    // Simpler: all in editor05 except the 76 mismatch
    const mismatchSet = new Set(storageIndices);
    const rig02Centers: Vec3[] = [];
    const rig02StorageIndices: number[] = [];
    for (const index of editor05) {
        if (!mismatchSet.has(index)) {
            rig02StorageIndices.push(index);
            rig02Centers.push(centerAt(ply, index));
        }
    }

    const animatedFootprintCenters: Vec3[] = [];
    for (const index of editor05) {
        animatedFootprintCenters.push(centerAt(ply, index));
    }

    const entries = storageIndices.map((storageIndex) => {
        const center = centerAt(ply, storageIndex);
        const { runtimeIndex, delta: mapDelta } = indexMap.get(storageIndex)!;
        const distToRig02 = distance3(center, RIG_02_HANDLE);
        const distToNearestRig02 = nearestNeighborDist(center, rig02Centers);
        return {
            storageIndex,
            runtimeIndex,
            center,
            storageToRuntimeMapDelta: mapDelta,
            distanceToRig02Handle: distToRig02
        };
    });

    const centers = entries.map((e) => e.center);
    const group76Centroid = centroidOf(centers);
    const group76Bbox = bboxOf(centers);
    const animatedBbox = bboxOf(animatedFootprintCenters);
    const animatedCentroid = centroidOf(animatedFootprintCenters);

    const distToRig02List = entries.map((e) => e.distanceToRig02Handle);
    const seamDistances = entries.map((e) =>
        nearestNeighborDist(e.center, rig02Centers)
    );

    const clusters = spatialClusters(centers, CLUSTER_LINK_DIST);
    const clusterReports = clusters.map((memberIndices, clusterIdx) => {
        const clusterCenters = memberIndices.map((i) => centers[i]);
        const clusterStorage = memberIndices.map((i) => storageIndices[i]);
        const bb = bboxOf(clusterCenters);
        return {
            clusterId: clusterIdx + 1,
            count: memberIndices.length,
            storageIndices: clusterStorage,
            runtimeIndices: memberIndices.map((i) => entries[i].runtimeIndex),
            centroid: centroidOf(clusterCenters),
            bbox: bb,
            medianDistToRig02Handle: median(memberIndices.map((i) => distToRig02List[i])),
            medianSeamGapToRig02: median(memberIndices.map((i) => seamDistances[i]))
        };
    });

    const runtimeMatchOk = runtimeIndicesFromMask.length === storageIndices.length &&
        runtimeIndicesFromMask.every((rt, i) => {
            const mapped = indexMap.get(storageIndices[i])!.runtimeIndex;
            return rt === mapped;
        });

    const report = {
        summary: {
            count: storageIndices.length,
            assignment: 'rig_01 via region_03 (first-binding-wins)',
            expectedAssignment: 'rig_02 via region_05',
            fractionOfAnimatedFootprint: storageIndices.length / editor05.size,
            editorRuntimeMaskCountMatch: runtimeIndicesFromMask.length === storageIndices.length,
            editorRuntimeIndexMapConsistent: runtimeMatchOk
        },
        indices: {
            storage: storageIndices,
            runtimeFromMask: runtimeIndicesFromMask,
            runtimeFromPositionMap: storageIndices.map((s) => indexMap.get(s)!.runtimeIndex)
        },
        gaussians: entries.map((e) => ({
            ...e,
            nearestRig02NeighborDist: nearestNeighborDist(e.center, rig02Centers)
        })),
        spatial: {
            centroid: group76Centroid,
            bbox: group76Bbox,
            animatedFootprintCentroid: animatedCentroid,
            animatedFootprintBbox: animatedBbox,
            centroidOffsetFromAnimated: distance3(group76Centroid, animatedCentroid),
            bboxFractionOfAnimated: {
                x: group76Bbox.size[0] / animatedBbox.size[0],
                y: group76Bbox.size[1] / animatedBbox.size[1],
                z: group76Bbox.size[2] / animatedBbox.size[2]
            },
            rig02Handle: RIG_02_HANDLE,
            distanceToRig02Handle: {
                min: Math.min(...distToRig02List),
                max: Math.max(...distToRig02List),
                median: median(distToRig02List),
                mean: distToRig02List.reduce((a, b) => a + b, 0) / distToRig02List.length
            },
            seamGapToNearestRig02Gaussian: {
                min: Math.min(...seamDistances),
                max: Math.max(...seamDistances),
                median: median(seamDistances),
                mean: seamDistances.reduce((a, b) => a + b, 0) / seamDistances.length
            },
            clusterLinkDistance: CLUSTER_LINK_DIST,
            clusterCount: clusters.length,
            clusters: clusterReports,
            layout: clusters.length === 1 ? 'single_cluster' :
                clusters.length <= 3 && clusters[0].length >= storageIndices.length * 0.5 ? 'one_dominant_cluster_plus_fragments' :
                'scattered_multi_cluster'
        },
        visualImpactAssessment: {
            countPercentOfFootprint: `${(100 * storageIndices.length / editor05.size).toFixed(2)}%`,
            likelyVisible: null as boolean | null,
            reasoning: [] as string[]
        }
    };

    // Heuristic visual impact
    const medianSeam = report.spatial.seamGapToNearestRig02Gaussian.median;
    const medianLever = report.spatial.distanceToRig02Handle.median;
    const reasons: string[] = [];

    reasons.push(`${storageIndices.length} Gaussians (0.60% of region_05 footprint) bound to rig_01 instead of rig_02.`);
    reasons.push(`Spatial layout: ${report.spatial.layout} (${clusters.length} cluster(s) at ${CLUSTER_LINK_DIST}m link distance).`);

    if (medianSeam < 0.01) {
        reasons.push(`Median seam gap to nearest rig_02 neighbor is ${medianSeam.toFixed(4)}m — sits directly on the rig_02/rig_01 boundary.`);
    } else if (medianSeam < 0.05) {
        reasons.push(`Median seam gap ${medianSeam.toFixed(4)}m — adjacent to rig_02 surface (edge/shell band).`);
    } else {
        reasons.push(`Median seam gap ${medianSeam.toFixed(4)}m — not tightly glued to rig_02 surface; may be interior overlap with region_03.`);
    }

    reasons.push(`Median lever arm from rig_02 rotation center: ${medianLever.toFixed(4)}m (range ${report.spatial.distanceToRig02Handle.min.toFixed(4)}–${report.spatial.distanceToRig02Handle.max.toFixed(4)}m).`);
    reasons.push(`Group bbox diagonal ${group76Bbox.diagonal.toFixed(4)}m vs animated footprint ${animatedBbox.diagonal.toFixed(4)}m.`);

    const likelyVisible = medianSeam < 0.03 && medianLever > 0.05 && storageIndices.length >= 20;
    reasons.push(likelyVisible ?
        'VERDICT: plausibly visible — boundary-adjacent splats with non-trivial lever arm will slide against rig_02 neighbors during rotation.' :
        'VERDICT: unlikely dominant cause — very small count and/or weak seam/lever signature; mismatch may be subtle or elsewhere.');

    report.visualImpactAssessment.likelyVisible = likelyVisible;
    report.visualImpactAssessment.reasoning = reasons;

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    // Console summary
    console.log('========== 76 MIS-BOUND GAUSSIAN SPATIAL REPORT ==========\n');
    console.log(`Count: ${storageIndices.length}`);
    console.log(`Storage indices: ${storageIndices.join(', ')}`);
    console.log(`Runtime indices (mask): ${runtimeIndicesFromMask.join(', ')}`);
    console.log(`Runtime indices (position map): ${report.indices.runtimeFromPositionMap.join(', ')}`);
    console.log(`Editor/runtime mask counts match: ${report.summary.editorRuntimeMaskCountMatch}`);
    console.log(`Position map consistent with runtime masks: ${report.summary.editorRuntimeIndexMapConsistent}`);

    console.log('\n--- Centroid & bbox (splat-local) ---');
    console.log(`Centroid: [${group76Centroid.map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`BBox min: [${group76Bbox.min.map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`BBox max: [${group76Bbox.max.map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`BBox size: [${group76Bbox.size.map((v) => v.toFixed(6)).join(', ')}] diagonal=${group76Bbox.diagonal.toFixed(6)}m`);
    console.log(`Animated footprint centroid: [${animatedCentroid.map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`Offset from animated centroid: ${report.spatial.centroidOffsetFromAnimated.toFixed(6)}m`);

    console.log('\n--- Distance from rig_02 rotation center ---');
    console.log(`Handle: [${RIG_02_HANDLE.map((v) => v.toFixed(6)).join(', ')}]`);
    console.log(`min=${report.spatial.distanceToRig02Handle.min.toFixed(6)} median=${report.spatial.distanceToRig02Handle.median.toFixed(6)} max=${report.spatial.distanceToRig02Handle.max.toFixed(6)} mean=${report.spatial.distanceToRig02Handle.mean.toFixed(6)}`);

    console.log('\n--- Seam analysis (dist to nearest rig_02-bound neighbor) ---');
    console.log(`min=${report.spatial.seamGapToNearestRig02Gaussian.min.toFixed(6)} median=${report.spatial.seamGapToNearestRig02Gaussian.median.toFixed(6)} max=${report.spatial.seamGapToNearestRig02Gaussian.max.toFixed(6)}`);

    console.log('\n--- Spatial clusters ---');
    for (const c of clusterReports) {
        console.log(`Cluster ${c.clusterId}: n=${c.count} centroid=[${c.centroid.map((v) => v.toFixed(4)).join(', ')}] seam_med=${c.medianSeamGapToRig02.toFixed(4)}m lever_med=${c.medianDistToRig02Handle.toFixed(4)}m`);
        console.log(`  storage: ${c.storageIndices.join(', ')}`);
    }
    console.log(`Layout classification: ${report.spatial.layout}`);

    console.log('\n--- Per-Gaussian table ---');
    console.log('storage\truntime\tcenter_x\tcenter_y\tcenter_z\tdist_rig02\tseam_gap');
    for (const g of report.gaussians) {
        console.log(`${g.storageIndex}\t${g.runtimeIndex}\t${g.center[0].toFixed(6)}\t${g.center[1].toFixed(6)}\t${g.center[2].toFixed(6)}\t${g.distanceToRig02Handle.toFixed(6)}\t${g.nearestRig02NeighborDist.toFixed(6)}`);
    }

    console.log('\n--- Visual impact ---');
    for (const r of reasons) {
        console.log(`  ${r}`);
    }
    console.log(`\nFull JSON: ${REPORT_PATH}`);
    console.log('================================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
