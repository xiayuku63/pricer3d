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
