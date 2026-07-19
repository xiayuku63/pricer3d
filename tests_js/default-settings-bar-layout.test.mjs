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
