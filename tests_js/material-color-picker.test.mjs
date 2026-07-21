import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const appEventsUrl = new URL('../static/js/modules/app-events.js', import.meta.url);
const appEventsSource = await readFile(fileURLToPath(appEventsUrl), 'utf8');

test('material color picker stores one color on the material record', () => {
    assert.match(
        appEventsSource,
        /MATERIAL_OPTIONS\[idx\]\.color = \{ name: hex, hex \}/,
        'the picker must write the canonical single-color field',
    );
});

test('material color wheel still supports direct canvas editing', () => {
    assert.match(
        appEventsSource,
        /const canvas = e\.target\.closest\('\.color-picker-panel \.cw-canvas'\)/,
        'the canvas mousedown handler must remain available',
    );
    assert.match(
        appEventsSource,
        /document\.addEventListener\('wheel', \(e\) => \{[\s\S]*?const canvas = e\.target\.closest\('\.color-picker-panel \.cw-canvas'\)/,
        'the canvas wheel handler must remain available',
    );
});

test('switching material color pickers closes the current panel', () => {
    assert.match(
        appEventsSource,
        /const closeColorPanels = \(\) => \{[\s\S]*?document\.querySelectorAll\('\.color-picker-panel'\)/,
        'closing pickers must include all open material panels',
    );
    assert.match(
        appEventsSource,
        /const wasOpen = !panel\.classList\.contains\('hidden'\);[\s\S]*?closeColorPanels\(\);[\s\S]*?if \(wasOpen\) return;/,
        'clicking an open picker should close it while clicking another picker opens only that one',
    );
});

test('material color changes commit only through the picker save button', async () => {
    const materialsSource = await readFile(
        fileURLToPath(new URL('../static/js/modules/settings/materials.js', import.meta.url)),
        'utf8',
    );
    assert.match(
        materialsSource,
        /class="color-picker-save-btn[\s\S]*?common\.save/,
        'the material picker must render a save button',
    );
    assert.match(
        appEventsSource,
        /const saveButton = e\.target\.closest\('\.color-picker-save-btn'\)[\s\S]*?savePanelColor\(panel\)/,
        'the save button must be the commit path for a pending color',
    );
    assert.doesNotMatch(
        appEventsSource,
        /mono\.closest\('\.color-picker-mono'\)[\s\S]*?MATERIAL_OPTIONS\[idx\]\.color/,
        'choosing a monochrome swatch must not commit before save',
    );
});
