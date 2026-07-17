# Lay-Face 3D Candidate Overlay Design

## Goal

Make the manual lay-on-face workflow read as a real 3D selection interaction.
Candidate markers must visibly belong to their model faces while the user rotates
the existing Three.js preview. Selecting a candidate keeps the current placement
math, then removes every candidate marker without adding a separate placement
plane.

## Confirmed Interaction

1. Activating lay-on-face fetches the existing coplanar candidate clusters.
2. Each candidate is rendered as a translucent cyan overlay directly on its
   face plane, with a white-cyan outline and an `A`, `B`, or `C` style ordinal
   label.
3. Existing OrbitControls remain responsible for rotation, pan, and zoom. The
   overlays are child objects of the model, so they inherit the model transform
   and are naturally occluded by opaque model geometry.
4. Hovering a visible candidate makes it brighter and keeps the current pointer
   cursor behavior.
5. Clicking a candidate calls the existing `placeFaceOnBed` logic using the
   cluster normal and face vertices. It then clears all candidate overlays and
   exits lay-on-face mode.
6. No rectangular placeable plane, side-color plane, arrow, or persistent
   contact-area marker is shown after placement.

## Rendering Design

`static/js/modules/layface.js` remains the owner of candidate overlay lifecycle.
The existing PCA-fitted ellipse is retained as the candidate footprint because
it is concise and avoids covering irregular model faces. It gains:

- a brighter cyan fill and edge treatment that retains visibility on light
  model colors;
- a small canvas-texture sprite label centered just outside the face plane;
- consistent normal offsets for the ellipse, outline, and label to avoid
  z-fighting while retaining depth testing against the model.

Labels are scene objects, not DOM annotations, so they rotate and occlude with
the model. The candidate ordinal uses the rendered candidate order, matching
the existing cluster click mapping.

## Lifecycle

The obsolete placement-plane export functions are removed. `clearClusters()`
continues to dispose all geometry, materials, and label textures. Existing
preview close, mesh replacement, reset, and orientation controls retain their
calls to `clearClusters()`, ensuring candidate resources cannot outlive the
model that owns them.

`orientation-ui.js` calls `cleanupLayFaceMode()` before placement. It no longer
calls a separate placement-plane visualizer afterwards.

## Error Handling

The existing API and authentication error behavior is unchanged. Invalid or
too-small candidate vertex arrays still skip rendering. A candidate that lacks
valid geometry is not clickable.

## Verification

- Extend static module tests to assert the placement-plane API is absent and
  lay-on-face placement clears candidate overlays.
- Run the existing JavaScript test suite.
- Load the preview in a browser with a test STL, activate lay-on-face, rotate
  the model, and verify the candidate overlay stays on the selected face.
- Click a candidate and verify the mesh settles on the bed with no remaining
  overlay or placement-plane artifact.
