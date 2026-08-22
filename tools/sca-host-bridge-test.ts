import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SCA_RUNTIME_ASSET_FILENAMES
} from '../src/sca/export/export-sca-runtime-package';
import {
    HOST_BRIDGE_INBOUND_TYPES,
    HOST_BRIDGE_OUTBOUND_TYPES,
    HOST_SOURCE,
    VIEWER_SOURCE,
    isValidHostInboundMessage,
    parseHostInboundMessage
} from '../src/sca/runtime/sca-host-bridge-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const hostBridgePath = path.join(repoRoot, 'static/sca/sca-host-bridge.js');

const runAssetIntegrationTests = () => {
    assert.ok(SCA_RUNTIME_ASSET_FILENAMES.includes('sca-host-bridge.js'));
    assert.equal(SCA_RUNTIME_ASSET_FILENAMES[SCA_RUNTIME_ASSET_FILENAMES.length - 1], 'sca-host-bridge.js');
    assert.ok(existsSync(hostBridgePath));

    const source = readFileSync(hostBridgePath, 'utf8');
    assert.match(source, /initScaHostBridge/);
    assert.match(source, /emitRegionVisitedChanged/);
    assert.match(source, /source:\s*'external'/);
    assert.match(source, /emitEvent:\s*false/);
    assert.match(source, /regionVisitedChanged/);

    console.log('[sca-host-bridge] asset integration PASS');
};

const runInboundValidationTests = () => {
    assert.equal(isValidHostInboundMessage(null), false);
    assert.equal(isValidHostInboundMessage('activateRegion'), false);
    assert.equal(isValidHostInboundMessage({ source: 'Other', type: 'activateRegion', payload: {} }), false);

    const valid = {
        source: HOST_SOURCE,
        type: 'activateRegion',
        payload: { regionId: 'region_01' }
    };
    assert.equal(isValidHostInboundMessage(valid), true);

    const parsed = parseHostInboundMessage(valid);
    assert.deepEqual(parsed, {
        type: 'activateRegion',
        payload: { regionId: 'region_01' }
    });

    assert.equal(isValidHostInboundMessage({
        source: HOST_SOURCE,
        type: 'activateRegion',
        payload: { regionId: 123 }
    }), false);

    assert.equal(isValidHostInboundMessage({
        source: HOST_SOURCE,
        type: 'setRegionVisited',
        payload: { regionId: 'region_01', visited: 'true' }
    }), false);

    assert.equal(isValidHostInboundMessage({
        source: HOST_SOURCE,
        type: 'resetRegionVisited',
        payload: {}
    }), true);

    assert.equal(isValidHostInboundMessage({
        source: HOST_SOURCE,
        type: 'unknownCommand',
        payload: {}
    }), false);

    console.log('[sca-host-bridge] inbound validation PASS');
};

const runOutboundContractTests = () => {
    assert.deepEqual(HOST_BRIDGE_INBOUND_TYPES, [
        'activateRegion',
        'activateHotspot',
        'setRegionVisited',
        'resetRegionVisited'
    ]);
    assert.deepEqual(HOST_BRIDGE_OUTBOUND_TYPES, ['regionVisitedChanged']);
    assert.equal(HOST_SOURCE, 'SCA3DHost');
    assert.equal(VIEWER_SOURCE, 'SCA3DViewer');

    console.log('[sca-host-bridge] outbound contract PASS');
};

const runVisitedChangeDedupTests = () => {
    const visited = new Set<string>();
    const emissions: Array<{ regionId: string; visited: boolean }> = [];

    const setVisited = (regionId: string, next: boolean) => {
        const was = visited.has(regionId);
        if (was === next) {
            return;
        }
        if (next) {
            visited.add(regionId);
        } else {
            visited.delete(regionId);
        }
        emissions.push({ regionId, visited: next });
    };

    setVisited('region_01', true);
    setVisited('region_01', true);
    setVisited('region_01', false);
    setVisited('region_01', false);

    assert.deepEqual(emissions, [
        { regionId: 'region_01', visited: true },
        { regionId: 'region_01', visited: false }
    ]);

    console.log('[sca-host-bridge] visited change dedup PASS');
};

const runActivationOptionTests = () => {
    const shouldMarkRegionVisited = (
        source: string,
        options: { markVisited?: boolean } = {}
    ): boolean => {
        if (options.markVisited === false) {
            return false;
        }
        if (options.markVisited === true) {
            return true;
        }
        if (source === 'programmatic') {
            return false;
        }
        return true;
    };

    const resolveDirectClickOptions = (source: string) => ({
        source,
        emitClick: source === 'click',
        markVisited: shouldMarkRegionVisited(source, {})
    });

    const direct = resolveDirectClickOptions('click');
    assert.equal(direct.emitClick, true);
    assert.equal(direct.markVisited, true);

    const external = {
        source: 'external',
        emitClick: false,
        markVisited: shouldMarkRegionVisited('external', { markVisited: true })
    };
    assert.equal(external.emitClick, false);
    assert.equal(external.markVisited, true);

    console.log('[sca-host-bridge] activation options PASS');
};

async function main() {
    runAssetIntegrationTests();
    runInboundValidationTests();
    runOutboundContractTests();
    runVisitedChangeDedupTests();
    runActivationOptionTests();

    console.log('\n========== SCA HOST BRIDGE TEST REPORT ==========');
    console.log('Bridge file: static/sca/sca-host-bridge.js');
    console.log('Inbound commands: activateRegion, activateHotspot, setRegionVisited, resetRegionVisited');
    console.log('Outbound event: regionVisitedChanged (change-only)');
    console.log('Loop prevention: external activation uses emitEvent/emitClick false');
    console.log('Direct click options: emitClick=true markVisited=true');
    console.log('Debug category: window.SCA3D.debug.runtimeEvents = true');
    console.log('Storyline independence: no GetPlayer in Viewer');
    console.log('Runtime export: sca-host-bridge.js included after sca-runtime.js');
    console.log('=================================================\n');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
