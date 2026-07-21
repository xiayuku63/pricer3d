import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const slicerUrl = new URL('../static/js/modules/presets/slicer.js', import.meta.url);
const printersUrl = new URL('../static/js/modules/presets/printers.js', import.meta.url);
const profileUrl = new URL('../static/js/modules/settings/profile.js', import.meta.url);
const nozzleRulesUrl = new URL('../static/js/modules/presets/nozzle-rules.js', import.meta.url);
const stateUrl = new URL('../static/js/modules/state.js', import.meta.url);

test('each nozzle has a standard 2-wall 15-percent preset and restricted layer heights', async () => {
    const slicerSource = await readFile(slicerUrl, 'utf8');
    const rulesSource = await readFile(nozzleRulesUrl, 'utf8');
    assert.match(rulesSource, /'0\.2': \{[\s\S]*defaultVal: 0\.10/);
    assert.match(rulesSource, /'0\.4': \{[\s\S]*valid: \[0\.08, 0\.16, 0\.20, 0\.24, 0\.28\],[\s\S]*defaultVal: 0\.20/);
    assert.match(rulesSource, /'0\.6': \{[\s\S]*defaultVal: 0\.30/);
    assert.match(rulesSource, /'0\.8': \{[\s\S]*defaultVal: 0\.40/);
    assert.match(slicerSource, /const STANDARD_WALL_COUNT = 2/);
    assert.match(slicerSource, /const STANDARD_INFILL = 15/);
    assert.match(slicerSource, /syncStandardPresetForNozzle/);
    assert.match(slicerSource, /updateLayerHeightDropdown\(\);/);
});

test('switching the printer nozzle drives the slicer form back to half-nozzle standard settings', async () => {
    const slicerSource = await readFile(slicerUrl, 'utf8');
    const printersSource = await readFile(printersUrl, 'utf8');
    assert.match(slicerSource, /_setStandardSlicerForm\(settings\);/);
    assert.match(slicerSource, /const standardName = getStandardPresetNameForNozzle\(key\);/);
    assert.match(printersSource, /void syncStandardPresetForNozzle\(\);/);
});

test('all nozzle sizes auto-select their own standard preset', async () => {
    const slicerSource = await readFile(slicerUrl, 'utf8');
    const printersSource = await readFile(printersUrl, 'utf8');
    assert.match(slicerSource, /export function getStandardPresetNameForNozzle\(nozzleValue\)/);
    assert.match(slicerSource, /const targetName = getStandardPresetNameForNozzle\(nozzleValue\);/);
    assert.match(printersSource, /function _selectFrontDefaultStandardPreset\(nozzleValue\)/);
    assert.match(printersSource, /_selectFrontDefaultStandardPreset\(frontDefaultNozzle\.value\);/);
});

test('changing the nozzle synchronizes its standard preset', async () => {
    const source = await readFile(printersUrl, 'utf8');
    assert.match(source, /const frontDefaultPrinter = document\.getElementById\('front-default-printer-model'\);/);
    assert.match(source, /_populateNozzleDropdown\('front-default-nozzle-diameter', frontDefaultPrinter\.value\)/);
    assert.match(source, /frontDefaultNozzle\.addEventListener\('change', \(\) => \{/);
    assert.match(source, /renderSlicerPresetsUI\(\);/);
});

test('all slicer preset selectors share one synchronization path', async () => {
    const mainSource = await readFile(new URL('../static/js/main.js', import.meta.url), 'utf8');
    assert.match(mainSource, /function _syncSlicerPresetSelectors\(value\)/);
    assert.match(mainSource, /document\.getElementById\('batch-slicer-preset'\)/);
    assert.match(mainSource, /document\.getElementById\('front-default-slicer-preset'\)/);
    assert.match(mainSource, /saveFrontSettingsSnapshot\(/);
    assert.match(mainSource, /saveBatchSettingsSnapshot\(/);
    assert.match(mainSource, /dom\.frontDefaultSlicerPreset\.addEventListener\('change', async \(\) => \{/);
    assert.match(mainSource, /await _applySlicerPresetSelection\(dom\.frontDefaultSlicerPreset\.value\);/);
});

test('front and batch toolbar snapshots persist across reloads', async () => {
    const stateSource = await readFile(stateUrl, 'utf8');
    const printersSource = await readFile(printersUrl, 'utf8');
    assert.match(stateSource, /const FRONT_SETTINGS_STORAGE_PREFIX = "demo_front_settings_v1_";/);
    assert.match(stateSource, /const BATCH_SETTINGS_STORAGE_PREFIX = "demo_batch_settings_v1_";/);
    assert.match(stateSource, /export function loadFrontSettingsSnapshot\(\)/);
    assert.match(stateSource, /export function saveFrontSettingsSnapshot\(snapshot\)/);
    assert.match(stateSource, /export function loadBatchSettingsSnapshot\(\)/);
    assert.match(stateSource, /export function saveBatchSettingsSnapshot\(snapshot\)/);
    assert.match(printersSource, /const frontSnapshot = loadFrontSettingsSnapshot\(\);/);
    assert.match(printersSource, /const batchSnapshot = loadBatchSettingsSnapshot\(\);/);
    assert.match(printersSource, /refreshStyledSelectDropdowns\(\[/);
});

test('model page preset dropdowns filter standard presets by the active nozzle', async () => {
    const uiSource = await readFile(new URL('../static/js/modules/presets/ui.js', import.meta.url), 'utf8');
    const rulesSource = await readFile(new URL('../static/js/modules/presets/nozzle-rules.js', import.meta.url), 'utf8');
    assert.match(uiSource, /filterPresetsForNozzle\(slicerPresets \|\| \[\], frontNozzle\)/);
    assert.match(uiSource, /filterPresetsForNozzle\(slicerPresets \|\| \[\], batchNozzle\)/);
    assert.match(uiSource, /getStandardPresetNameForNozzle\(frontNozzle\)/);
    assert.match(uiSource, /standardFrontPreset/);
    assert.match(rulesSource, /name\.match\(/);
    assert.match(rulesSource, /settings\.valid\.some/);
});

test('settings save snapshots and restores the selected nozzle around async refreshes', async () => {
    const source = await readFile(profileUrl, 'utf8');
    assert.match(source, /const nozzleSel = document\.getElementById\('front-default-nozzle-diameter'\);/);
    assert.match(source, /const nozzle = String\(\(nozzleSel && nozzleSel\.value\) \|\| defaultNozzle \|\| ''\)\.trim\(\);/);
    assert.match(source, /const refreshedNozzle = document\.getElementById\('front-default-nozzle-diameter'\);/);
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
