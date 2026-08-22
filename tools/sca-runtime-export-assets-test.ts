import { strict as assert } from 'node:assert';

import {
    formatRuntimeAssetLoadError,
    isNetworkFetchFailure,
    SCA_RUNTIME_ASSET_FILENAMES,
    ScaRuntimeAssetLoadError
} from '../src/sca/export/export-sca-runtime-package';

const runAssetInventoryTests = () => {
    assert.equal(SCA_RUNTIME_ASSET_FILENAMES.length, 15);
    assert.ok(SCA_RUNTIME_ASSET_FILENAMES.includes('sca-runtime.js'));
    assert.ok(SCA_RUNTIME_ASSET_FILENAMES.includes('sca-host-bridge.js'));
    assert.ok(SCA_RUNTIME_ASSET_FILENAMES.includes('sca-debug.js'));
    assert.ok(SCA_RUNTIME_ASSET_FILENAMES.includes('sca-hotspot-markers.css'));

    const unique = new Set(SCA_RUNTIME_ASSET_FILENAMES);
    assert.equal(unique.size, SCA_RUNTIME_ASSET_FILENAMES.length);

    console.log('[sca-runtime-export-assets] asset inventory PASS');
};

const runNetworkFailureClassificationTests = () => {
    assert.equal(isNetworkFetchFailure(new TypeError('Failed to fetch')), true);
    assert.equal(isNetworkFetchFailure(new TypeError('NetworkError when attempting to fetch resource.')), true);
    assert.equal(isNetworkFetchFailure(new Error('HTTP 404')), false);

    const error = formatRuntimeAssetLoadError(
        'sca-debug.js',
        new TypeError('Failed to fetch')
    );

    assert.ok(error instanceof ScaRuntimeAssetLoadError);
    assert.equal(error.assetPath, 'static/sca/sca-debug.js');
    assert.match(error.message, /SCA Runtime export failed/);
    assert.match(error.message, /static\/sca\/sca-debug\.js/);
    assert.match(error.message, /editor server may no longer be available/i);

    console.log('[sca-runtime-export-assets] network failure classification PASS');
};

const runHttpFailureClassificationTests = () => {
    const httpError = new ScaRuntimeAssetLoadError(
        'SCA Runtime export failed\n\nCould not load:\nstatic/sca/sca-runtime.js\n\nThe server responded with HTTP 404.\n\nReload the editor and try again.',
        'static/sca/sca-runtime.js',
        new Error('HTTP 404')
    );

    const wrapped = formatRuntimeAssetLoadError('sca-runtime.js', httpError);
    assert.equal(wrapped, httpError);

    console.log('[sca-runtime-export-assets] http failure classification PASS');
};

async function main() {
    runAssetInventoryTests();
    runNetworkFailureClassificationTests();
    runHttpFailureClassificationTests();

    console.log('\n========== SCA RUNTIME EXPORT ASSETS TEST REPORT ==========');
    console.log('Asset inventory: PASS');
    console.log('Network failure classification: PASS');
    console.log('HTTP failure classification: PASS');
    console.log('Fail-fast point: ensureScaRuntimeAssetsAvailable() before writeViewerExportWithCachedSog()');
    console.log('Fetch cache: module-level Promise cache reused within one export session');
    console.log('============================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
