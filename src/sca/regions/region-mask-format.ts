import { IndexRanges, sortedPredicate } from '../../index-ranges';
import { State } from '../../splat-state';

const REGION_MASK_MAGIC = 'SCARM';
const REGION_MASK_VERSION = 1;
const REGION_MASK_FORMAT_INDEX_RANGES = 0;

const HEADER_BYTES = 16;

type RegionMaskHeader = {
    gaussianCount: number;
    format: number;
};

const encodeRegionMask = (ranges: IndexRanges, gaussianCount: number): Uint8Array => {
    const payload = ranges.data;
    const buffer = new Uint8Array(HEADER_BYTES + payload.byteLength);
    const view = new DataView(buffer.buffer);

    for (let i = 0; i < REGION_MASK_MAGIC.length; i++) {
        buffer[i] = REGION_MASK_MAGIC.charCodeAt(i);
    }

    view.setUint8(5, REGION_MASK_VERSION);
    view.setUint8(6, REGION_MASK_FORMAT_INDEX_RANGES);
    view.setUint8(7, 0);
    view.setUint32(8, gaussianCount, true);
    view.setUint32(12, payload.byteLength, true);
    buffer.set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), HEADER_BYTES);

    return buffer;
};

const decodeRegionMask = (bytes: Uint8Array): { ranges: IndexRanges; header: RegionMaskHeader } => {
    if (bytes.byteLength < HEADER_BYTES) {
        throw new Error('[SCA] region mask file too small');
    }

    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    if (magic !== REGION_MASK_MAGIC) {
        throw new Error(`[SCA] invalid region mask magic: ${magic}`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(5);
    if (version !== REGION_MASK_VERSION) {
        throw new Error(`[SCA] unsupported region mask version: ${version}`);
    }

    const format = view.getUint8(6);
    if (format !== REGION_MASK_FORMAT_INDEX_RANGES) {
        throw new Error(`[SCA] unsupported region mask format: ${format}`);
    }

    const gaussianCount = view.getUint32(8, true);
    const payloadBytes = view.getUint32(12, true);

    if (HEADER_BYTES + payloadBytes !== bytes.byteLength) {
        throw new Error('[SCA] region mask payload size mismatch');
    }

    if (payloadBytes % 4 !== 0) {
        throw new Error('[SCA] region mask payload must be 4-byte aligned');
    }

    const payload = new Uint32Array(
        bytes.buffer,
        bytes.byteOffset + HEADER_BYTES,
        payloadBytes / 4
    );

    return {
        ranges: IndexRanges.fromData(payload),
        header: { gaussianCount, format }
    };
};

const buildCompactionMap = (state: Uint8Array): { map: Int32Array; survivorCount: number } => {
    const map = new Int32Array(state.length);
    map.fill(-1);

    let survivorCount = 0;
    for (let i = 0; i < state.length; i++) {
        if ((state[i] & State.deleted) === 0) {
            map[i] = survivorCount++;
        }
    }

    return { map, survivorCount };
};

const remapIndexRanges = (ranges: IndexRanges, map: Int32Array, survivorCount: number): IndexRanges => {
    const remapped: number[] = [];

    ranges.forEach((oldIndex) => {
        const newIndex = map[oldIndex];
        if (newIndex >= 0) {
            remapped.push(newIndex);
        }
    });

    if (remapped.length === 0) {
        return IndexRanges.fromPredicate(0, () => false);
    }

    remapped.sort((a, b) => a - b);
    const sorted = new Uint32Array(remapped);

    return IndexRanges.fromPredicate(survivorCount, sortedPredicate(sorted));
};

export {
    buildCompactionMap,
    decodeRegionMask,
    encodeRegionMask,
    REGION_MASK_FORMAT_INDEX_RANGES,
    REGION_MASK_VERSION,
    remapIndexRanges
};
