import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const slicerUrl = new URL('../static/js/modules/presets/slicer.js', import.meta.url);
const printersUrl = new URL('../static/js/modules/presets/printers.js', import.meta.url);
const profileUrl = new URL('../static/js/modules/settings/profile.js', import.meta.url);

test('each nozzle has a standard 2-wall 15-percent preset and restricted layer heights', async () => {
    const source = await readFile(slicerUrl, 'utf8');
    assert.match(source, /'0\.2': \{[\s\S]*defaultVal: 0\.10/);
    assert.match(source, /'0\.4': \{[\s\S]*defaultVal: 0\.20/);
    assert.match(source, /'0\.6': \{[\s\S]*defaultVal: 0\.30/);
    assert.match(source, /'0\.8': \{[\s\S]*defaultVal: 0\.40/);
    assert.match(source, /const STANDARD_WALL_COUNT = 2/);
    assert.match(source, /const STANDARD_INFILL = 15/);
    assert.match(source, /syncStandardPresetForNozzle/);
    assert.match(source, /updateLayerHeightDropdown\(\);/);
});

test('changing the nozzle synchronizes its standard preset', async () => {
    const source = await readFile(printersUrl, 'utf8');
    assert.match(source, /syncStandardPresetForNozzle\(\);/);
});

test('settings save snapshots and restores the selected nozzle around async refreshes', async () => {
    const source = await readFile(profileUrl, 'utf8');
    assert.match(source, /const nozzle = String\(\(cfgNozzle && cfgNozzle\.value\) \|\| defaultNozzle \|\| ''\)\.trim\(\);/);
    assert.match(source, /const refreshedNozzle = document\.getElementById\('cfg-nozzle-diameter'\);/);
    assert.match(source, /refreshedNozzle\.value = savedNozzle;/);
});

test('settings save trusts and verifies the server-persisted nozzle value', async () => {
    const source = await readFile(profileUrl, 'utf8');
    assert.match(source, /const savedSettings = await res\.json\(\)\.catch/);
    assert.match(source, /const savedNozzle = String\(savedSettings\.default_nozzle/);
    assert.match(source, /喷嘴直径保存失败/);
});

test('printer refresh preserves the selected nozzle before falling back to the saved default', async () => {
    const source = await readFile(printersUrl, 'utf8');
    assert.match(source, /const currentCfgNozzle = document\.getElementById\('cfg-nozzle-diameter'\)\?\.value/);
    assert.match(source, /function _sameNozzle\(left, right\)/);
    assert.match(source, /const candidates = \[currentValue, defaultNozzle, model\?\.nozzle/);
    assert.match(source, /_sameNozzle\(n, preferred\)/);
});
