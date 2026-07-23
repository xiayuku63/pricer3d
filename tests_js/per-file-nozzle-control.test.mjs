import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('per-file printer helpers preserve and compose nozzle diameters', async () => {
    const {
        buildPrinterCompoundId,
        getPrinterBaseId,
        getPrinterNozzleFromRef,
        getResultNozzleDiameter,
    } = await import('../static/js/modules/state.js');

    assert.equal(getPrinterBaseId('bambu_a1_08'), 'bambu_a1');
    assert.equal(getPrinterNozzleFromRef('bambu_a1_08'), 0.8);
    assert.equal(buildPrinterCompoundId('bambu_a1', 0.8), 'bambu_a1_08');
    assert.equal(getResultNozzleDiameter({
        _printer_model: 'bambu_a1_08',
        cost_breakdown: { gcode_summary: { core_params: { nozzle_diameter: '0.4' } } },
    }), 0.8);
});

test('desktop and mobile model configuration render a nozzle selector', async () => {
    const source = await readFile(new URL('../static/js/modules/quote-render.js', import.meta.url), 'utf8');

    assert.match(source, /function _buildRowDropdownsHtml\(item\)/);
    assert.match(source, /getResultNozzleDiameter\(item, selectedPrinter\)/);
    assert.ok((source.match(/data-field="_nozzle_diameter"/g) || []).length >= 4);
    assert.match(source, /quote-config-row quote-config-row-printer/);
});

test('per-file nozzle edits submit a compound printer id and persist the selected nozzle', async () => {
    const source = await readFile(new URL('../static/js/modules/quote.js', import.meta.url), 'utf8');

    assert.match(source, /function _syncPerFileNozzleSelect\(container, printerId, preferredNozzle\)/);
    assert.ok((source.match(/buildPrinterCompoundId\(pmBase, nozzle\)/g) || []).length >= 2);
    assert.ok((source.match(/_nozzle_diameter: nozzle/g) || []).length >= 2);
});

test('desktop model configuration reserves a stable three-column printer row', async () => {
    const css = await readFile(new URL('../static/css/table-enhancements.css', import.meta.url), 'utf8');

    assert.match(css, /\.quote-config-row-printer/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(64px, 0\.65fr\) minmax\(0, 1fr\)/);
});
