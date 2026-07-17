# Lay-Face 3D Candidate Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lay-on-face candidates read as labels and overlays on true 3D model faces, and remove the separate post-placement plane visual.

**Architecture:** `layface.js` continues to own every candidate scene object. The existing PCA ellipse mesh and edge remain children of the current model; a canvas-texture sprite label is added to the same overlay result. `orientation-ui.js` only initiates placement and cleanup, so it no longer knows about a persistent plane visual.

**Tech Stack:** ES modules, Three.js r160, Node.js built-in test runner, Playwright CLI for browser verification.

---

## File Structure

- Modify: `static/js/modules/layface.js` - render, hover, and dispose labeled 3D candidate overlays; delete obsolete placement-plane lifecycle.
- Modify: `static/js/modules/orientation-ui.js` - remove imports and calls for the deleted placement-plane visual.
- Modify: `static/js/modules/viewer/mesh.js` - rely on `clearClusters()` instead of a global placement-plane cleanup hook.
- Modify: `static/js/modules/preview.js` - remove the obsolete placement-plane import and close cleanup call.
- Create: `tests_js/layface-visual-contract.test.mjs` - protect the no-placement-plane contract and labeled candidate behavior.

### Task 1: Lock The UI Contract

**Files:**
- Create: `tests_js/layface-visual-contract.test.mjs`
- Test: `tests_js/layface-visual-contract.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests_js/layface-visual-contract.test.mjs`

Expected: FAIL because `layface.js` exports the placement-plane API and does not create a sprite label.

### Task 2: Render And Dispose Candidate Labels

**Files:**
- Modify: `static/js/modules/layface.js:10-205`
- Test: `tests_js/layface-visual-contract.test.mjs`

- [ ] **Step 1: Add the minimal label helper and attach it to existing ellipse overlays**

```js
function _createClusterLabel(index, normal, centroid, radius) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const label = String.fromCharCode(65 + (index % 26));
  context.fillStyle = '#12313a';
  context.beginPath();
  context.arc(48, 48, 32, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = '#dffeff';
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = 'bold 48px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 48, 51);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false }));
  sprite.position.copy(centroid).add(normal.clone().multiplyScalar(1.2));
  const size = Math.max(5, Math.min(radius * 0.55, 14));
  sprite.scale.set(size, size, 1);
  sprite.userData.clusterLabel = true;
  return sprite;
}
```

Attach the label returned by this helper to `clusterHighlightGroup`, store it in `mesh.userData.label`, and dispose its material map in both `clearClusters()` and the overlay cleanup traversal. Keep the mesh and line as the only raycast targets.

- [ ] **Step 2: Delete the placement-plane implementation and exports**

Remove `_placeablePlaneGroup`, `_createPlaceablePlane`, `_createPlaneFromBox`, `_buildPlaceablePlaneVisual`, `_removePlaceablePlane`, all related constants, `showPlacementPlane`, `hidePlacementPlane`, `hasPlacementPlane`, and `window.__cleanupPlaceablePlane`.

- [ ] **Step 3: Improve default and hover candidate appearance**

Use a cyan translucent default fill, a white-cyan outline, and an opaque brighter cyan hover fill. Preserve `depthTest: true` and `depthWrite: false` so candidate overlays rotate and occlude with their model.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `node --test tests_js/layface-visual-contract.test.mjs`

Expected: PASS.

### Task 3: Remove Post-Placement Visual Calls

**Files:**
- Modify: `static/js/modules/orientation-ui.js:4-12, 88-218`
- Modify: `static/js/modules/viewer/mesh.js:75-83`
- Modify: `static/js/modules/preview.js:1-18, 228-237`
- Test: `tests_js/layface-visual-contract.test.mjs`

- [ ] **Step 1: Remove the placement-plane symbols from UI and mesh lifecycle**

Replace the layface import with:

```js
import {
  renderClusters, clearClusters, setClusterHover, intersectClusters,
  placeFaceOnBed, isClusterMode,
} from './layface.js';
```

Delete all `hidePlacementPlane()` calls and all `showPlacementPlane(currentMesh, cluster.face_vertices)` calls. In `mesh.js`, remove the `window.__cleanupPlaceablePlane` block. In `preview.js`, import only `clearClusters` and call only it during preview cleanup.

- [ ] **Step 2: Run the contract test and all JavaScript tests**

Run: `node --test tests_js/*.test.mjs`

Expected: PASS with no failed tests.

### Task 4: Verify The Existing Preview In A Browser

**Files:**
- Verify only: `static/test_placeface.html`

- [ ] **Step 1: Load a model and enter candidate mode**

Run the app locally, open the existing preview with `static/test_cube.stl`, and activate lay-on-face. Confirm cyan labeled overlays are visibly attached to model faces while OrbitControls rotates the mesh.

- [ ] **Step 2: Confirm placement cleanup**

Click one labeled candidate. Confirm the mesh is settled on the print bed, the selected candidate and every other candidate disappear, and no rectangle, arrow, or double-sided plane remains in the scene.

- [ ] **Step 3: Capture evidence**

Use Playwright to capture a screenshot before placement and another after placement. Check that both canvas images contain non-background pixels and that the after image contains no cyan candidate labels.

### Self-Review

- Spec coverage: Task 2 covers scene-owned labels and occlusion; Task 3 covers no persistent plane and lifecycle cleanup; Task 4 covers rotation, placement, and browser evidence.
- Placeholder scan: no deferred implementation steps, undefined APIs, or generic test instructions remain.
- Type consistency: labels are `THREE.Sprite` objects stored on overlay mesh `userData.label`; only overlay meshes remain in `clusterOverlays` raycast targets.
