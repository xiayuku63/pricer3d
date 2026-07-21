import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('batch printer initialization prioritizes saved defaults over stale local snapshots', async () => {
    const source = await readFile(new URL('../static/js/modules/presets/printers.js', import.meta.url), 'utf8');

    assert.match(source, /function _pickVisibleModelId\(candidates, fallbackId\)/);
    assert.match(source, /Batch controls drive import-time slicing, so authenticated defaults/);
    assert.match(source, /\[batchSel\.value, defaultPrinterId, batchSnapshot\?\.printer_model\]/);
    assert.match(source, /currentBatchNozzle \|\| defaultNozzle \|\| batchSnapshot\?\.nozzle_diameter/);
});
