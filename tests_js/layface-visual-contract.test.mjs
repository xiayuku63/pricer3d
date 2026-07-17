import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layfaceUrl = new URL('../static/js/modules/layface.js', import.meta.url);
const orientationUrl = new URL('../static/js/modules/orientation-ui.js', import.meta.url);

test('lay-on-face renders labeled 3D candidate overlays without a placement-plane API', async () => {
    const [layface, orientation] = await Promise.all([
        readFile(layfaceUrl, 'utf8'),
        readFile(orientationUrl, 'utf8'),
    ]);

    assert.match(layface, /new THREE\.Sprite\(/);
    assert.match(layface, /clusterLabel/);
    assert.doesNotMatch(layface, /showPlacementPlane|hidePlacementPlane|_buildPlaceablePlaneVisual/);
    assert.doesNotMatch(orientation, /showPlacementPlane|hidePlacementPlane/);
});
