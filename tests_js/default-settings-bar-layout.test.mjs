import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('quote default settings bar appears above batch settings and exposes the shared default controls', async () => {
    const html = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');

    assert.ok(html.indexOf('id="quote-default-settings-bar"') < html.indexOf('id="batch-edit-bar"'));
    assert.match(html, /id="front-default-printer-model"/);
    assert.match(html, /id="front-default-nozzle-diameter"/);
    assert.match(html, /id="front-default-slicer-preset"/);
    assert.match(html, /id="front-default-material"/);
    assert.match(html, /id="front-default-color-dropdown"/);
    assert.match(html, /id="front-default-save-btn"[^>]*data-i18n="settings.saveDefaults"/);
    assert.match(html, /data-i18n="settings.defaultSettings"/);
});


test('default settings keeps its save button while calculation actions share the same row', async () => {
    const html = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
    const defaultRowStart = html.indexOf('id="quote-default-controls-row"');
    const defaultBarStart = html.indexOf('id="quote-default-settings-bar"', defaultRowStart);
    const saveButton = html.indexOf('id="front-default-save-btn"', defaultBarStart);
    const calculationPanel = html.indexOf('id="batch-recalculate-actions"', saveButton);
    const batchBar = html.indexOf('id="batch-edit-bar"', calculationPanel);

    assert.ok(defaultRowStart >= 0);
    assert.ok(defaultBarStart < saveButton);
    assert.ok(saveButton < calculationPanel);
    assert.ok(calculationPanel < batchBar);
});
