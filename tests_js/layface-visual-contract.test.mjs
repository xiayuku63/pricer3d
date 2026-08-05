import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layfaceUrl = new URL('../static/js/modules/layface.js', import.meta.url);
const orientationUrl = new URL('../static/js/modules/orientation-ui.js', import.meta.url);

test('lay-on-face renders exact merged surface patches without labels or ellipse markers', async () => {
    const [layface, orientation] = await Promise.all([
        readFile(layfaceUrl, 'utf8'),
        readFile(orientationUrl, 'utf8'),
    ]);

    assert.match(layface, /buildCandidatePatchData/);
    assert.match(layface, /new THREE\.LineSegments\(/);
    assert.match(layface, /clusterTriangleIds\[hit\.faceIndex\]/);
    assert.match(layface, /vertexColors: true/);
    assert.match(layface, /const FACE_FILL_COLOR = 0x06b6d4/);
    assert.match(layface, /const FACE_OUTLINE_COLOR = 0x155e75/);
    assert.match(layface, /const FACE_FILL_OPACITY = 0\.38/);
    assert.doesNotMatch(layface, /new THREE\.Sprite\(/);
    assert.doesNotMatch(layface, /clusterLabel|CanvasTexture|_buildEllipseOverlay|FACE_OVAL_/);
    assert.doesNotMatch(layface, /showPlacementPlane|hidePlacementPlane|_buildPlaceablePlaneVisual/);
    assert.doesNotMatch(orientation, /showPlacementPlane|hidePlacementPlane/);
    const faceMinZFn = layface.slice(layface.indexOf('function _getFaceWorldMinZ'), layface.indexOf('export function placeFaceOnBed'));
    assert.match(faceMinZFn, /geometry\.boundingBox\.getCenter\(localBedOffset\)/);
    assert.match(faceMinZFn, /vertex\[2\] - co\.z \+ localBedOffset\.z/);
    assert.match(faceMinZFn, /normalized STL source coordinates/);
    assert.match(orientation, /waitForMeshReady\(\)/);
    assert.match(orientation, /if \(!currentMesh\)/);
});

test('manual placement settles the rendered model bounding box even when face coordinates use a different origin', async () => {
    const layface = await readFile(layfaceUrl, 'utf8');
    const placementFn = layface.slice(layface.indexOf('export function placeFaceOnBed'));

    assert.doesNotMatch(placementFn, /mesh\.position\.z -= faceMinZ === null \? box\.min\.z : faceMinZ/);
    assert.match(placementFn, /const box = new THREE\.Box3\(\)\.setFromObject\(mesh, true\);\s*mesh\.position\.z -= box\.min\.z/);
    assert.ok((placementFn.match(/setFromObject\(mesh, true\)/g) || []).length >= 3);
    assert.doesNotMatch(placementFn, /setFromObject\(mesh\)(?!,)/);
    assert.doesNotMatch(placementFn, /if \(settledBox\.min\.z < -0\.001\)/);
});

test('re-entering manual placement preserves the current mesh orientation', async () => {
    const orientation = await readFile(orientationUrl, 'utf8');
    const toggleStart = orientation.indexOf('export async function toggleLayFace');
    const toggleEnd = orientation.indexOf('// ?? Training ??', toggleStart);
    const toggleBody = orientation.slice(toggleStart, toggleEnd);

    assert.doesNotMatch(toggleBody, /resetMeshPlacementForLayFace\(\)/);
    assert.match(toggleBody, /clearClusters\(\)/);
});

test('candidate overlays respect model depth so the solid model never becomes a see-through wireframe', async () => {
    const layface = await readFile(layfaceUrl, 'utf8');
    const fillStart = layface.indexOf('const fillMaterial = new THREE.MeshBasicMaterial');
    const fillEnd = layface.indexOf('clusterFillMesh =', fillStart);
    const fillMaterial = layface.slice(fillStart, fillEnd);
    const outlineStart = layface.indexOf('const outlineMaterial = new THREE.LineBasicMaterial');
    const outlineEnd = layface.indexOf('clusterOutlineSegments =', outlineStart);
    const outlineMaterial = layface.slice(outlineStart, outlineEnd);

    assert.match(fillMaterial, /depthTest: true/);
    assert.match(fillMaterial, /polygonOffset: true/);
    assert.doesNotMatch(fillMaterial, /depthTest: false/);
    assert.match(outlineMaterial, /depthTest: true/);
    assert.doesNotMatch(outlineMaterial, /depthTest: false/);
});
