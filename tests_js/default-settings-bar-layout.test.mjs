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

test('calculation actions reserve room for translated controls', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /#quote-default-controls-row\s*\{\s*container-name:\s*quote-default-controls;\s*container-type:\s*inline-size;/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+286px;/);
    assert.match(css, /@container quote-default-controls \(max-width:\s*1640px\)\s*\{[\s\S]*?column-gap:\s*6px;/);
    assert.doesNotMatch(css, /@container quote-default-controls \(max-width:\s*1640px\)\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;/);
});


test('matching fields share columns and label/control gap', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /#quote-default-settings-bar\s*\{\s*grid-template-columns:\s*96px\s+190px\s+120px\s+188px\s+145px\s+155px\s+92px\s+minmax\(0,\s*1fr\)\s+auto;/);
    assert.match(css, /#batch-edit-bar\s*\{\s*grid-template-columns:\s*96px\s+190px\s+120px\s+188px\s+145px\s+155px\s+92px\s+122px\s+minmax\(0,\s*1fr\)\s+auto;/);
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*max-content\)\s+minmax\(0,\s*1fr\);[\s\S]*?gap:\s*6px;/);
});


test('quantity uses the same control height and a readable fixed width', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /#batch-edit-bar > \.flex\.items-center:nth-of-type\(7\)\s*\{[\s\S]*?grid-template-columns:\s*max-content\s+72px;/);
    assert.match(css, /#batch-quantity\s*\{[\s\S]*?width:\s*72px\s*!important;[\s\S]*?height:\s*26px;/);
});


test('translated field groups use shared grid columns and label/control spacing', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /#quote-default-settings-bar,[\s\S]*?#batch-edit-bar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?column-gap:\s*6px;[\s\S]*?row-gap:\s*8px;/);
    assert.match(css, /#quote-default-settings-bar > \.flex\.items-center,[\s\S]*?#batch-edit-bar > \.flex\.items-center\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*max-content\)\s+minmax\(0,\s*1fr\);[\s\S]*?gap:\s*6px;/);
    assert.doesNotMatch(css, /#quote-default-settings-bar,[\s\S]*?#batch-edit-bar\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
});


test('all action buttons use the same right inset', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /#front-default-save-btn,[\s\S]*?#batch-apply-btn\s*\{[\s\S]*?margin-right:\s*0;/);
    assert.match(css, /\.batch-recalculate-actions\s*\{[\s\S]*?padding:\s*12px\s+16px;/);
    assert.doesNotMatch(css, /#batch-apply-btn\s*\{\s*margin-right:\s*-12px;/);
});


test('calculation actions distribute controls across the panel while preserving edge padding', async () => {
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(css, /\.batch-recalculate-actions\s*\{[\s\S]*?justify-content:\s*space-between;[\s\S]*?padding:\s*12px\s+16px;/);
});
