import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const quoteApiUrl = new URL('../static/js/modules/quote-api.js', import.meta.url);
const quoteUrl = new URL('../static/js/modules/quote.js', import.meta.url);
const profileUrl = new URL('../static/js/modules/settings/profile.js', import.meta.url);
const mainUrl = new URL('../static/js/main.js', import.meta.url);
const appEventsUrl = new URL('../static/js/modules/app-events.js', import.meta.url);
const quoteConfigUrl = new URL('../static/js/modules/quote-config.js', import.meta.url);
const orientationStateUrl = new URL('../static/js/modules/orientation-state.js', import.meta.url);

const { getAffectedFilenamesForGlobalSlicerChange, slicerParamsEqual } = await import(quoteConfigUrl);
const { normalizeOrientation, getResultOrientation, withResultOrientation } = await import(orientationStateUrl);

test('user-center save syncs the active slicer preset before re-quoting', async () => {
    const source = await readFile(profileUrl, 'utf8');
    const saveIndex = source.indexOf("if (source === 'user-center') {");
    const requoteIndex = source.indexOf('await reQuoteAllSelectedFiles', saveIndex);

    assert.notEqual(saveIndex, -1);
    assert.notEqual(requoteIndex, -1);
    assert.ok(source.indexOf('quoteOptions.slicer_preset_id = effectivePresetId || null;', saveIndex) < requoteIndex);
    assert.ok(source.indexOf('saveSlicerPresetSelection();', saveIndex) < requoteIndex);
});

test('front default save does not overwrite the active batch quote options', async () => {
    const [profileSource, eventsSource] = await Promise.all([
        readFile(profileUrl, 'utf8'),
        readFile(appEventsUrl, 'utf8'),
    ]);

    assert.match(eventsSource, /bind\(dom\.frontDefaultSaveBtn, 'click', \(\) => saveUserSettings\(\{ source: 'front' \}\)\);/);
    assert.match(profileSource, /if \(source === 'user-center'\) \{/);
    assert.doesNotMatch(profileSource, /quoteOptions\.printer_model = printerId \|\| '';[\s\S]*?source = 'front'/);
});

test('user-center save has one event owner to avoid concurrent re-quotes', async () => {
    const [main, appEvents] = await Promise.all([
        readFile(mainUrl, 'utf8'),
        readFile(appEventsUrl, 'utf8'),
    ]);

    assert.doesNotMatch(main, /_bind\(dom\.userCenterSaveBtn, 'click', saveUserSettings\)/);
    assert.equal((appEvents.match(/bind\(dom\.userCenterSaveBtn, 'click', \(\) => saveUserSettings\(\{/g) || []).length, 1);
});

test('re-quote treats a superseded fetch as cancellation, not a failed quote', async () => {
    const source = await readFile(quoteApiUrl, 'utf8');
    assert.match(source, /err\.name === 'AbortError' \|\| signal\.aborted/);
    assert.match(source, /const sp = existing\?\._slicer_preset_explicit/);
    assert.match(source, /_slicer_preset_id: sp/);
    assert.match(source, /null is meaningful/);
});

test('card edit captures currentColor before the result is updated', async () => {
    const source = await readFile(quoteUrl, 'utf8');
    const handlerStart = source.indexOf('async function _handleCardEdit');
    const handlerEnd = source.indexOf('// ── 导出功能', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const declaration = handler.indexOf('const currentColor =');
    const stateUpdate = handler.indexOf('currentResults[idx] = { ...currentResults[idx], color: currentColor');

    assert.notEqual(declaration, -1);
    assert.notEqual(stateUpdate, -1);
    assert.ok(declaration < stateUpdate);
});

test('unchanged effective slicing parameters do not require a re-quote', () => {
    const result = {
        filename: 'same.stl',
        _printer_model: 'bambu_a1_04',
        _slicer_preset_id: null,
        cost_breakdown: { gcode_summary: { core_params: {
            layer_height: '0.20', perimeters: '3', fill_density: '20', nozzle_diameter: '0.4',
        } } },
    };
    const affected = getAffectedFilenamesForGlobalSlicerChange(
        [result],
        { printerModel: 'bambu_a1_04', presetId: null },
        { printerModel: 'bambu_a1_04', presetId: null, params: { layer_height: 0.2, perimeters: 3, fill_density: 20 } },
    );
    assert.deepEqual(affected, []);
});

test('a changed effective slicing parameter requires a re-quote', () => {
    const result = {
        filename: 'changed.stl',
        _printer_model: 'bambu_a1_04',
        _slicer_preset_id: null,
        cost_breakdown: { gcode_summary: { core_params: {
            layer_height: 0.2, perimeters: 3, fill_density: 20,
        } } },
    };
    const affected = getAffectedFilenamesForGlobalSlicerChange(
        [result],
        { printerModel: 'bambu_a1_04', presetId: null },
        { printerModel: 'bambu_a1_04', presetId: null, params: { layer_height: 0.16, perimeters: 3, fill_density: 20 } },
    );
    assert.deepEqual(affected, ['changed.stl']);
});

test('per-file slicing overrides are not invalidated by a global setting change', () => {
    const result = {
        filename: 'override.stl',
        _printer_model: 'other_printer_04',
        _slicer_preset_id: 12,
        _printer_model_explicit: true,
        _slicer_preset_explicit: true,
        cost_breakdown: { gcode_summary: { core_params: { layer_height: 0.2, perimeters: 3, fill_density: 20 } } },
    };
    const affected = getAffectedFilenamesForGlobalSlicerChange(
        [result],
        { printerModel: 'bambu_a1_04', presetId: null },
        { printerModel: 'new_default_04', presetId: 13, params: { layer_height: 0.16, perimeters: 4, fill_density: 30 } },
    );
    assert.deepEqual(affected, []);
});

test('slicer parameter comparison ignores unconfigured fields', () => {
    assert.equal(slicerParamsEqual(
        { layer_height: 0.2, perimeters: 3, fill_density: 20, nozzle_diameter: 0.4 },
        { layer_height: 0.2, perimeters: 3, fill_density: 20 },
    ), true);
});

test('deleting an unrelated preset keeps the active preset unchanged', async () => {
    const source = await readFile(new URL('../static/js/modules/presets/slicer.js', import.meta.url), 'utf8');
    assert.match(source, /Deleting an unrelated preset must not invalidate current quotes/);
    assert.match(source, /presetId: quoteOptions\.slicer_preset_id \?\? null/);
    assert.match(source, /const savedPresetId = _selectedPresetId/);
    assert.match(source, /getAffectedFilenamesForSlicerPresetChange\(savedPresetId, nextParams\)/);
});

test('updating the active preset can re-quote by preset usage even when its id is unchanged', async () => {
    const [slicerSource, configSource] = await Promise.all([
        readFile(new URL('../static/js/modules/presets/slicer.js', import.meta.url), 'utf8'),
        readFile(quoteConfigUrl, 'utf8'),
    ]);
    assert.match(slicerSource, /previousSlicerConfig\.presetId === Number\(preset\.id\)/);
    assert.match(slicerSource, /getAffectedFilenamesForSlicerPresetChange\(preset\.id, presetParams\)/);
    assert.match(configSource, /!nextParams \|\| !slicerParamsEqual/);
});

test('model orientation survives result updates and supports an explicit zero-degree reset', () => {
    const original = withResultOrientation({ filename: 'part.stl', cost_cny: 10 }, { x: 18, y: -4, z: 90 });
    const updated = withResultOrientation({ filename: 'part.stl', cost_cny: 12 }, getResultOrientation(original));
    assert.deepEqual(updated._orientation, { x: 18, y: -4, z: 90 });
    assert.deepEqual(updated.euler_angles_deg, { x: 18, y: -4, z: 90 });

    const reset = withResultOrientation({ filename: 'part.stl', cost_cny: 8 }, { x: 0, y: 0, z: 0 });
    assert.deepEqual(getResultOrientation(reset), { x: 0, y: 0, z: 0 });
    assert.deepEqual(normalizeOrientation({ x: 'bad', y: null, z: 30 }), { x: 0, y: 0, z: 30 });
});

test('re-quote sends the saved orientation instead of triggering auto orientation', async () => {
    const source = await readFile(quoteApiUrl, 'utf8');
    assert.match(source, /const orientation = getResultOrientation\(existing\);/);
    assert.match(source, /const opts = \{ material, color, quantity, _printer_model: pm, _slicer_preset_id: sp, orientation \};/);
    assert.match(source, /const orientX = options\.orient_x != null \? options\.orient_x : orientation\?\.x;/);
    assert.match(source, /!orientation/);
});

test('preview reads model orientation from the result row', async () => {
    const source = await readFile(new URL('../static/js/modules/preview.js', import.meta.url), 'utf8');
    const orientationSource = await readFile(orientationStateUrl, 'utf8');
    assert.match(source, /var perFileOrient = getResultOrientation\(rowData\);/);
    assert.match(orientationSource, /euler_angles_deg: normalized/);
});
