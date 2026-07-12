// ── Three.js 3D Viewer — Backward-compatible re-exports ──
// All symbols that were originally exported from viewer.js are re-exported here.
// Importers can use: import { scene, renderSTL, ... } from './viewer/index.js'
// (or from the original './viewer.js' path if the project entry still references it).

// Scene module — scene init, bed, render loop, lights
export {
    scene,
    camera,
    renderer,
    controls,
    stlLoader,
    previewContainer,
    previewPlaceholder,
    initialised,
    initViewer,
    requestRender,
    updateBedSize,
    setBedLabel,
    updateViewerSize,
} from './scene.js';

// Mesh module — loading, recolor, orientation, highlight
export {
    currentMesh,
    currentMeshCenterOffset,
    faceClickCallback,
    highlightGroup,
    highlightMode,
    recolorCurrentMesh,
    clearCurrentMesh,
    renderSTL,
    applyOrientationRotation,
    resetOrientation,
    setupFaceClickHandler,
    highlightFaces,
    resetHighlight,
} from './mesh.js';

// Camera module — fitCamera, view transitions
export {
    fitCameraToMesh,
    lookAtView,
} from './camera.js';

// Thumbnail module — placeholder SVG thumbnails
export {
    buildPlaceholderThumbnail,
} from './thumbnail.js';
