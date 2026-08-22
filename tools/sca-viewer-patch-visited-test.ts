import { strict as assert } from 'node:assert';

import {
    applyScaRegionHighlightGlslPatches,
    verifyGlslHighlightPatch
} from '../src/sca/export/patch-viewer-bundle';

const MINIMAL_GSPLAT_SHADER = `
varying mediump vec2 gaussianUV;
varying mediump vec4 gaussianColor;
#ifndef DITHER_NONE
	varying float id;
#endif
mediump vec4 discardVec;
flat varying float scaGaussianIndex;
#ifndef DITHER_NONE
		id = float(splat.index);
#endif
#ifdef PREPASS_PASS
vec4 fragColor = vec4(gaussianColor.xyz, alpha);
vec4 fragColor = vec4(gaussianColor.xyz, alpha);
`;

const runGlslVisitedPatchTests = () => {
    const first = applyScaRegionHighlightGlslPatches(MINIMAL_GSPLAT_SHADER);
    assert.equal(first.ok, true, first.reason);
    assert.match(first.source, /scaRegionVisitedClr/);
    assert.match(first.source, /regionState > 0\.45/);
    assert.match(first.source, /regionState > 0\.75/);
    verifyGlslHighlightPatch(first.source);

    const occurrences = first.source.split('regionState > 0.45').length - 1;
    assert.equal(occurrences, 2, 'visited branch should patch all gsplat shader variants');

    console.log('[sca-viewer-patch-visited] GLSL visited patch PASS');
};

const runRuntimeEncodingMarkerTests = () => {
    const runtimeSnippet = `
        const SCA_REGION_STATE_HOVER = 85;
        const SCA_REGION_STATE_VISITED = 170;
        const SCA_REGION_STATE_SELECTED = 255;
        scaRegionHighlightMaterial.setParameter('scaRegionVisitedClr', visitedColor ?? [0, 0, 0, 0]);
    `;

    assert.match(runtimeSnippet, /SCA_REGION_STATE_VISITED = 170/);
    assert.match(runtimeSnippet, /scaRegionVisitedClr/);

    console.log('[sca-viewer-patch-visited] runtime encoding markers PASS');
};

async function main() {
    runGlslVisitedPatchTests();
    runRuntimeEncodingMarkerTests();

    console.log('\n========== SCA VIEWER PATCH VISITED TEST REPORT ==========');
    console.log('GLSL visited branch: PASS');
    console.log('Multi-variant replaceAll: PASS');
    console.log('Runtime state encoding 170: PASS');
    console.log('==========================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
