import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const batchUrl = new URL('../static/js/modules/quote-batch.js', import.meta.url);
const mainUrl = new URL('../static/js/main.js', import.meta.url);
const pageShellUrl = new URL('../static/partials/page-shell.html', import.meta.url);
const printersUrl = new URL('../static/js/modules/presets/printers.js', import.meta.url);
const tableEnhancementsUrl = new URL('../static/css/table-enhancements.css', import.meta.url);

test('batch dirty tracking keeps printer, nozzle, and preset independent', async () => {
    const source = await readFile(batchUrl, 'utf8');
    assert.match(source, /const BATCH_FIELDS = \['_printer_model', '_nozzle_diameter', '_slicer_preset_id', 'brand', 'material', 'color', 'quantity'\];/);
    assert.match(source, /case '_printer_model': \{ const el = document\.getElementById\('batch-printer-model'\); return el \? el\.value : ''; \}/);
    assert.match(source, /case '_nozzle_diameter': \{ const el = document\.getElementById\('batch-nozzle-diameter'\); return el \? el\.value : ''; \}/);
    assert.match(source, /case '_slicer_preset_id': \{ const el = document\.getElementById\('batch-slicer-preset'\); return el \? el\.value : ''; \}/);
});

test('batch controls bind dirty markers to their own field ids', async () => {
    const source = await readFile(mainUrl, 'utf8');
    assert.match(source, /batchPrinterModel\.addEventListener\('change', _onBatchChange\('_printer_model'\)\);/);
    assert.match(source, /batchNozzle\.addEventListener\('change', _onBatchChange\('_nozzle_diameter'\)\);/);
    assert.match(source, /markBatchDirty\('_slicer_preset_id'\);/);
});

test('batch page shell separates the nozzle dirty wrapper and keeps mm labels', async () => {
    const source = await readFile(pageShellUrl, 'utf8');
    assert.match(source, /data-batch-field="_nozzle_diameter"[\s\S]*?<select id="batch-nozzle-diameter"/);
    assert.match(source, /<option value="0\.4" selected>0\.4mm<\/option>/);
});

test('batch nozzle dropdown options render without a spacing mismatch before mm', async () => {
    const source = await readFile(printersUrl, 'utf8');
    assert.match(source, />' \+ n \+ 'mm<\/option>'/);
});

test('batch dirty styling highlights the whole modified control in green', async () => {
    const source = await readFile(tableEnhancementsUrl, 'utf8');
    assert.match(source, /#batch-edit-bar \.batch-dirty \.styled-select-trigger,/);
    assert.match(source, /#batch-edit-bar \.batch-dirty \.color-dd-trigger \{/);
    assert.match(source, /background-color: rgba\(34, 197, 94, 0\.12\) !important;/);
    assert.match(source, /box-shadow: 0 0 0 2px rgba\(34, 197, 94, 0\.22\), inset 0 1px 0 rgba\(255, 255, 255, 0\.88\) !important;/);
    assert.match(source, /width: 10px;/);
    assert.match(source, /height: 10px;/);
});
