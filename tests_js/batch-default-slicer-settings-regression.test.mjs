import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('batch printer initialization prioritizes saved defaults over stale local snapshots', async () => {
    const source = await readFile(new URL('../static/js/modules/presets/printers.js', import.meta.url), 'utf8');

    assert.match(source, /function _pickVisibleModelId\(candidates, fallbackId\)/);
    assert.match(source, /Batch controls drive import-time slicing\. Prefer authenticated/);
    assert.match(source, /\[defaultPrinterId, batchSel\.value, batchSnapshot\?\.printer_model\]/);
    assert.match(source, /defaultNozzle \|\| currentBatchNozzle \|\| batchSnapshot\?\.nozzle_diameter/);
});

test('upload-time quote requests inherit the front default settings bar', async () => {
    const source = await readFile(new URL('../static/js/modules/quote-api.js', import.meta.url), 'utf8');

    assert.match(source, /resolveUploadDefaults/);
    assert.match(source, /const uploadDefaults = _getUploadDefaults\(\);/);
    assert.match(source, /const presetId = uploadDefaults\.slicer_preset_id;/);
    assert.match(source, /loadFrontSettingsSnapshot/);
});

test('visible front defaults win over stale batch and local upload state', async () => {
    const { resolveUploadDefaults } = await import('../static/js/modules/upload-defaults.js');
    const values = {
        'front-default-printer-model': { value: 'Bambu Lab A1' },
        'front-default-nozzle-diameter': { value: '0.8' },
        'front-default-slicer-preset': { value: '40' },
        'front-default-brand': { value: 'Generic' },
        'front-default-material': { value: 'PLA' },
        'front-default-color-dropdown': { getAttribute: () => '#00c853' },
    };
    const root = { getElementById: (id) => values[id] || null };

    assert.deepEqual(resolveUploadDefaults({
        root,
        snapshot: { printer_model: 'stale-printer', nozzle_diameter: '0.4', slicer_preset_id: '20' },
        fallback: { printer_model: 'batch-printer_04', slicer_preset_id: 20, material: 'PETG' },
    }), {
        printer_model: 'Bambu Lab A1_08',
        slicer_preset_id: 40,
        brand: 'Generic',
        material: 'PLA',
        color: '#00c853',
    });
});

test('ZIP uploads use the same front default resolver as normal model uploads', async () => {
    const source = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

    assert.match(source, /resolveUploadDefaults/);
    assert.match(source, /uploadDefaults\.slicer_preset_id/);
    assert.doesNotMatch(source, /zipPresetEl/);
});

test('a visible no-preset selection does not revive a stale stored preset', async () => {
    const { resolveUploadDefaults } = await import('../static/js/modules/upload-defaults.js');
    const root = {
        getElementById: (id) => id === 'front-default-slicer-preset' ? { value: '' } : null,
    };

    const defaults = resolveUploadDefaults({
        root,
        snapshot: { slicer_preset_id: '40' },
        fallback: { slicer_preset_id: 20 },
    });

    assert.equal(defaults.slicer_preset_id, null);
});

test('the visible styled preset wins while the hidden select is being rebuilt', async () => {
    const { resolveUploadDefaults, getEffectiveSelectValue } = await import('../static/js/modules/upload-defaults.js');
    const wrapper = {
        querySelector: (selector) => selector === '.styled-select-label'
            ? { textContent: '0.40-2-15%' }
            : null,
    };
    const presetSelect = {
        value: '',
        options: [
            { value: '', textContent: '不使用预设' },
            { value: '8', textContent: '0.40-2-15%' },
        ],
        closest: () => wrapper,
    };
    const root = {
        getElementById: (id) => id === 'front-default-slicer-preset' ? presetSelect : null,
    };

    assert.deepEqual(getEffectiveSelectValue(root, 'front-default-slicer-preset'), {
        present: true,
        value: '8',
    });
    assert.equal(resolveUploadDefaults({ root }).slicer_preset_id, 8);
});

test('saving defaults reads the same effective styled preset as uploading', async () => {
    const source = await readFile(new URL('../static/js/modules/settings/profile.js', import.meta.url), 'utf8');

    assert.match(source, /getEffectiveSelectValue\(document, 'front-default-slicer-preset'\)\.value/);
    assert.match(source, /savedSettings\.default_slicer_preset_id/);
    assert.match(source, /savedPresetId !== effectivePresetId/);
});

test('front default preset changes stay isolated from the batch preset state', async () => {
    const source = await readFile(new URL('../static/js/main.js', import.meta.url), 'utf8');

    assert.match(source, /function _syncSlicerPresetSelectors\(value, options = \{\}\)/);
    assert.match(source, /syncBatch = false/);
    assert.match(source, /syncFront = false/);
    assert.match(source, /updateQuotePreset: false/);
    assert.match(source, /frontDefaultSlicerPreset\.addEventListener\('change', async \(\) => \{/);
    assert.match(source, /syncFront: true/);
    assert.match(source, /syncBatch: false/);
});

test('refreshing preset lists preserves the front default preset selection', async () => {
    const source = await readFile(new URL('../static/js/modules/presets/ui.js', import.meta.url), 'utf8');

    assert.match(source, /loadFrontSettingsSnapshot/);
    assert.match(source, /const frontSnapshot = loadFrontSettingsSnapshot\(\) \|\| \{\};/);
    assert.match(source, /frontCandidates = \[/);
    assert.match(source, /frontSnapshot\.slicer_preset_id/);
    assert.match(source, /frontPreset\.value/);
});
