import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../static/partials/user-center-modal.html', import.meta.url);
const printerModuleUrl = new URL('../static/js/modules/presets/printer.js', import.meta.url);

test('custom printer form exposes lifecycle editors without duplicating backend defaults', async () => {
    const html = await readFile(htmlUrl, 'utf8');

    assert.match(html, /id="custom-pp-gcode-flavor"/);
    assert.match(html, /id="custom-pp-start-gcode"[^>]*><\/textarea>/);
    assert.match(html, /id="custom-pp-before-layer-gcode"[^>]*><\/textarea>/);
    assert.match(html, /id="custom-pp-layer-gcode"[^>]*><\/textarea>/);
    assert.match(html, /id="custom-pp-end-gcode"[^>]*><\/textarea>/);
    assert.doesNotMatch(html, /M140 S\[first_layer_bed_temperature\]/);
});

test('active custom printer flow loads defaults and sends lifecycle fields', async () => {
    const source = await readFile(printerModuleUrl, 'utf8');
    const activeFlow = source.slice(source.indexOf('export async function saveCustomPrinter()'));

    assert.match(source, /fetch\('\/api\/printer\/gcode-defaults'\)/);
    assert.match(activeFlow, /\.\.\.readPrinterLifecyclePayload\(\)/);
    for (const field of [
        'gcode_flavor',
        'start_gcode',
        'before_layer_gcode',
        'layer_gcode',
        'end_gcode',
    ]) {
        assert.match(source, new RegExp(`${field}:`));
    }
});
