import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const uiUrl = new URL('../static/js/modules/orientation-ui.js', import.meta.url);
const viewerUrl = new URL('../static/js/modules/viewer/mesh.js', import.meta.url);

test('smart orientation applies the backend rotation matrix before Euler fallback', async () => {
    const [ui, viewer] = await Promise.all([
        readFile(uiUrl, 'utf8'),
        readFile(viewerUrl, 'utf8'),
    ]);

    assert.match(ui, /applyOrientationMatrix\(data\.rotation_matrix\)/);
    assert.match(ui, /if \(!matrixApplied\) applyOrientationRotation/);
    assert.match(viewer, /export function applyOrientationMatrix/);
    assert.match(viewer, /setFromRotationMatrix\(matrix\)/);
    assert.match(ui, /Number\(value\.toFixed\(4\)\)/);
    assert.doesNotMatch(ui, /Math\.round\(rx\)/);
});


test('calculation controls are isolated beside the default settings row', async () => {
    const [shell, css] = await Promise.all([
        readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8'),
        readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8'),
    ]);

    assert.match(shell, /id="quote-default-controls-row" class="settings-controls-row/);
    assert.match(shell, /id="batch-edit-bar" class="[^"]*mt-3/);
    assert.match(shell, /id="batch-recalculate-actions" class="apple-toolbar/);
    assert.match(shell, /data-i18n-aria-label="quote.calculationOptions"/);
    assert.doesNotMatch(shell, /<span[^>]*data-i18n="quote.calculationOptions"/);
    assert.match(shell, /data-i18n="quote.smartPlacement"/);
    assert.match(css, /\.batch-recalculate-actions\s*\{/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) 286px/);
    assert.match(css, /border-color:\s*rgba\(16, 185, 129/);
});
