import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('batch preset changes sync effective slicing controls and trigger a re-quote', async () => {
    const source = await readFile(new URL('../static/js/main.js', import.meta.url), 'utf8');
    const handlerStart = source.indexOf("batchSlicerPreset.addEventListener('change'");
    const handlerEnd = source.indexOf("// Open options modal", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    assert.match(handler, /const layerEl = document\.getElementById\('gen-layer-height'\)/);
    assert.match(handler, /layerEl\.value = Number\(p\.layer_height\)\.toFixed\(2\)/);
    assert.match(handler, /wallEl\.value = String\(p\.perimeters\)/);
    assert.match(handler, /infillEl\.value = String\(p\.fill_density\)/);
    assert.equal((handler.match(/await reQuoteAllSelectedFiles\(t\('quote\.recalculate'\)\)/g) || []).length, 2);
});

test('initial batch preset rendering syncs controls without relying on a change event', async () => {
    const source = await readFile(new URL('../static/js/modules/presets/ui.js', import.meta.url), 'utf8');
    assert.match(source, /async function _syncBatchPresetControls\(\)/);
    assert.match(source, /data\.preset\?\.params/);
    assert.match(source, /layer\.value = Number\(params\.layer_height\)\.toFixed\(2\)/);
    assert.match(source, /walls\.value = String\(params\.perimeters\)/);
    assert.match(source, /infill\.value = String\(params\.fill_density\)/);
    assert.match(source, /void _syncBatchPresetControls\(\)/);
});
