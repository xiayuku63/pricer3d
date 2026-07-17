import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('user center slicer settings no longer render the layer height range hint', async () => {
    const html = await readFile(new URL('../static/partials/user-center-modal.html', import.meta.url), 'utf8');
    const slicerSource = await readFile(new URL('../static/js/modules/presets/slicer.js', import.meta.url), 'utf8');

    assert.doesNotMatch(html, /layer-height-range-hint/);
    assert.doesNotMatch(slicerSource, /if \(!hintEl\) return/);
    assert.match(slicerSource, /updateLayerHeightDropdown\(\);/);
    assert.match(slicerSource, /if \(hintEl\) hintEl\.textContent = '';/);
});
