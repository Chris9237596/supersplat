import { IndexRanges } from '../../index-ranges';
import { State } from '../../splat-state';
import { Splat } from '../../splat';

const captureSelectionRanges = (splat: Splat): IndexRanges => {
    const state = splat.splatData.getProp('state') as Uint8Array;
    const total = splat.splatData.numSplats;

    return IndexRanges.fromPredicate(total, (i) => state[i] === State.selected);
};

export {
    captureSelectionRanges
};
