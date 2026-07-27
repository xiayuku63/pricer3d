// ── Three.js 3D Viewer — Mesh Module ──
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getRenderColorHex } from '../state.js';
import { scene, camera, stlLoader, previewContainer, previewPlaceholder, requestRender } from './scene.js';
import { fitCameraToMesh } from './camera.js';
import { createPreviewMaterial } from './render-style.js';
import { getPreview3mf, getPreviewStl } from '../preview-cache.js';

// ── Shared mutable state (owned here, imported by scene.js and camera.js) ──
export let currentMesh, currentMeshCenterOffset = null;
export let currentMeshEntities = [];

// Face-click / highlight state
export let faceClickCallback = null;
export let highlightGroup = null;
export let highlightMode = false;

// ── Private mesh state ──
let _initialMeshPos = null;

// Recolor fast-path cache: skip re-parsing normalized STL when only the color changes
let _lastRenderedFileKey = null;
let _lastRenderedColorKey = null;
let _lastRenderedOrientation = null;
let _renderRequestId = 0;
let _meshReadyPromise = Promise.resolve(false);
let _currentEntityFileKey = null;
const _entityColorOverridesByFile = new Map();

const FACES_COLORS = [0x22c55e, 0x3b82f6, 0xa855f7, 0xeab308, 0xf97316, 0xec4899];

function _addPreviewOutline(parent, geometry) {
    if (!geometry) return;
    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({
            color: 0x64748b,
            transparent: true,
            opacity: 0.5,
            depthTest: true,
        }),
    );
    outline.name = 'preview-outline';
    outline.renderOrder = 2;
    parent.add(outline);
}

// ── Color helpers ──

/**
 * Resolve a colorKey (hex string, bare name, or object) to a Three.js hex number.
 * Handles the fallback object returned by getRenderColorHex for bare names.
 * @param {*} colorKey - hex string like "#ff0000", bare name like "Blue", or null
 * @returns {number} hex color number usable by THREE.MeshBasicMaterial
 */
function _colorNumFromKey(colorKey) {
    var r = getRenderColorHex(colorKey);
    if (typeof r === 'number') return r;
    if (r && typeof r === 'object' && r.fallback) {
        var c = new THREE.Color();
        c.setHSL(r.hue / 360, 0.58, 0.56);
        return c.getHex();
    }
    return 0x3b82f6;  // default blue
}

function _orientationEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return ((a.x || 0) === (b.x || 0) && (a.y || 0) === (b.y || 0) && (a.z || 0) === (b.z || 0));
}

// ── Mesh color / recolor ──

/**
 * Recolor the currently-loaded mesh without re-parsing the source file.
 * Fast path used when only the color changed (same file + orientation).
 * @param {*} colorKey - hex string / bare name / null
 * @returns {boolean} true if a mesh was recolored, false if no mesh is loaded
 */
function _colorHexFromKey(colorKey) {
    return '#' + new THREE.Color(_colorNumFromKey(colorKey)).getHexString().toUpperCase();
}

function _replaceMeshMaterial(mesh, colorKey) {
    if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material.dispose();
    }
    mesh.material = createPreviewMaterial(_colorNumFromKey(colorKey));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
}

export function getCurrentMeshEntities() {
    return currentMeshEntities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        color: entity.color,
        sourceColor: entity.sourceColor,
    }));
}

export function setCurrentMeshEntityColor(entityId, colorKey) {
    const entity = currentMeshEntities.find((item) => item.id === entityId);
    if (!entity || !entity.mesh) return false;
    const color = _colorHexFromKey(colorKey);
    _replaceMeshMaterial(entity.mesh, color);
    entity.color = color;
    entity.hasOverride = true;
    if (_currentEntityFileKey) {
        const overrides = _entityColorOverridesByFile.get(_currentEntityFileKey) || new Map();
        overrides.set(entityId, color);
        _entityColorOverridesByFile.set(_currentEntityFileKey, overrides);
    }
    requestRender();
    return true;
}

export function recolorCurrentMesh(colorKey) {
    if (!currentMesh) return false;
    if (currentMeshEntities.length > 0) {
        for (const entity of currentMeshEntities) {
            if (entity.hasOverride || entity.sourceColor) continue;
            const color = _colorHexFromKey(colorKey);
            _replaceMeshMaterial(entity.mesh, color);
            entity.color = color;
        }
    } else {
        const colorNum = _colorNumFromKey(colorKey);
        currentMesh.traverse(function(c) {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                c.material = createPreviewMaterial(colorNum);
            }
        });
    }
    _lastRenderedColorKey = colorKey;
    requestRender();
    return true;
}

// ── Mesh lifecycle ──

export function clearCurrentMesh() {
    if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.traverse(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) c.material.dispose();
        });
    }
    currentMesh = null;
    currentMeshEntities = [];
    _currentEntityFileKey = null;
}

// ── GLB rendering (non-STL files via backend conversion) ──

/**
 * Wait until the asynchronous preview loader has installed the current mesh.
 * Non-STL files first pass through backend normalization to STL.
 */
export function waitForMeshReady(timeoutMs = 10000) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return Promise.race([_meshReadyPromise, timeout]).then((ready) => Boolean(ready && currentMesh));
}

function _installStlBuffer(arrayBuffer, file, orientation, colorKey, requestId) {
    if (requestId !== _renderRequestId) return false;

    const geometry = stlLoader.parse(arrayBuffer);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const centerOffset = new THREE.Vector3();
    geometry.boundingBox.getCenter(centerOffset);
    currentMeshCenterOffset = centerOffset;
    geometry.center();

    // Match the native STL path exactly: local geometry bottom is Z=0.
    geometry.computeBoundingBox();
    geometry.translate(0, 0, -geometry.boundingBox.min.z);

    clearCurrentMesh();
    const material = createPreviewMaterial(_colorNumFromKey(colorKey));
    currentMesh = new THREE.Mesh(geometry, material);
    currentMesh.castShadow = true;
    currentMesh.receiveShadow = true;
    _addPreviewOutline(currentMesh, geometry);
    currentMesh.rotation.set(0, 0, 0);

    const bc = window._BED_CENTER || 128;
    currentMesh.position.set(bc, bc, 0);
    _initialMeshPos = currentMesh.position.clone();
    if (orientation) {
        currentMesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
        currentMesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
        currentMesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
        currentMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(currentMesh, true);
        currentMesh.position.z -= box.min.z;
        currentMesh.updateMatrixWorld(true);
        box.setFromObject(currentMesh, true);
        const reCenter = box.getCenter(new THREE.Vector3());
        currentMesh.position.x += (bc - reCenter.x);
        currentMesh.position.y += (bc - reCenter.y);
    }

    scene.add(currentMesh);
    fitCameraToMesh(currentMesh);
    previewPlaceholder.classList.add('hidden');
    _lastRenderedFileKey = (file.name || '') + ':' + (file.size || 0);
    _lastRenderedColorKey = colorKey;
    _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
    return true;
}

async function renderVia3mfScene(file, orientation = null, colorKey = null, requestId) {
    let objectUrl = null;
    try {
        const sceneBlob = await getPreview3mf(file);
        objectUrl = URL.createObjectURL(sceneBlob);
        const gltf = await new GLTFLoader().loadAsync(objectUrl);
        if (requestId !== _renderRequestId) return false;

        const model = gltf.scene;
        const entityMeshes = [];
        model.traverse((child) => {
            if (child.isMesh) entityMeshes.push(child);
        });
        if (entityMeshes.length === 0) return false;

        const fileKey = (file.name || '') + ':' + (file.size || 0);
        const overrides = _entityColorOverridesByFile.get(fileKey) || new Map();
        const entities = [];
        entityMeshes.forEach((mesh, index) => {
            const entityId = String(mesh.userData.entity_id || mesh.name || ('entity-' + (index + 1)));
            const entityName = String(mesh.userData.entity_name || mesh.name || ('Entity ' + (index + 1)));
            const sourceColor = String(mesh.userData.source_color || '').trim();
            const chosenColor = overrides.get(entityId) || sourceColor || _colorHexFromKey(colorKey);
            _replaceMeshMaterial(mesh, chosenColor);
            mesh.userData.entity_id = entityId;
            mesh.userData.entity_name = entityName;
            mesh.userData.source_color = sourceColor;
            _addPreviewOutline(mesh, mesh.geometry);
            entities.push({
                id: entityId,
                name: entityName,
                color: _colorHexFromKey(chosenColor),
                sourceColor: sourceColor || null,
                hasOverride: overrides.has(entityId),
                mesh,
            });
        });

        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model, true);
        const center = box.getCenter(new THREE.Vector3());
        const bc = window._BED_CENTER || 128;
        model.position.set(bc - center.x, bc - center.y, -box.min.z);
        model.rotation.set(0, 0, 0);
        if (orientation) {
            model.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
            model.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
            model.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
            model.updateMatrixWorld(true);
            box = new THREE.Box3().setFromObject(model, true);
            model.position.z -= box.min.z;
            model.updateMatrixWorld(true);
            box.setFromObject(model, true);
            const rotatedCenter = box.getCenter(new THREE.Vector3());
            model.position.x += (bc - rotatedCenter.x);
            model.position.y += (bc - rotatedCenter.y);
        }

        clearCurrentMesh();
        currentMesh = model;
        currentMeshCenterOffset = new THREE.Vector3(0, 0, 0);
        currentMeshEntities = entities;
        _currentEntityFileKey = fileKey;
        _initialMeshPos = model.position.clone();
        scene.add(currentMesh);
        fitCameraToMesh(currentMesh);
        previewPlaceholder.classList.add('hidden');
        _lastRenderedFileKey = fileKey;
        _lastRenderedColorKey = colorKey;
        _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
        return true;
    } catch (error) {
        console.warn('3MF entity preview failed:', error);
        return false;
    } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}

async function renderViaNormalizedStl(file, orientation = null, colorKey = null, requestId) {
    try {
        const stlBlob = await getPreviewStl(file);
        const arrayBuffer = await stlBlob.arrayBuffer();
        return _installStlBuffer(arrayBuffer, file, orientation, colorKey, requestId);
    } catch (e) {
        console.warn('Normalized STL render failed:', e);
        return false;
    }
}

export function renderSTL(file, colorKey = 'Blue', orientation = null) {
    if (!file || !(file instanceof Blob) || file.size === 0) {
        previewPlaceholder.textContent = 'Invalid or empty model file';
        previewPlaceholder.classList.remove('hidden');
        return Promise.resolve(false);
    }

    const fileKey = (file.name || '') + ':' + (file.size || 0);
    if (currentMesh && fileKey === _lastRenderedFileKey
        && _orientationEqual(orientation, _lastRenderedOrientation)) {
        recolorCurrentMesh(colorKey);
        previewPlaceholder.classList.add('hidden');
        return Promise.resolve(true);
    }

    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    const requestId = ++_renderRequestId;
    if (ext === '3mf') {
        clearCurrentMesh();
        previewPlaceholder.textContent = 'Loading 3MF entities...';
        previewPlaceholder.classList.remove('hidden');
        _meshReadyPromise = renderVia3mfScene(file, orientation, colorKey, requestId).then((ok) => {
            if (!ok && requestId === _renderRequestId) {
                previewPlaceholder.textContent = '3MF entity preview failed';
                previewPlaceholder.classList.remove('hidden');
            }
            return ok;
        });
        return _meshReadyPromise;
    }
    if (ext !== 'stl') {
        // STP/STEP/OBJ are normalized by the backend, then rendered through
        // the exact same STLLoader/centering/bed-placement path as native STL.
        clearCurrentMesh();
        previewPlaceholder.textContent = 'Generating preview...';
        previewPlaceholder.classList.remove('hidden');
        _meshReadyPromise = renderViaNormalizedStl(file, orientation, colorKey, requestId).then((ok) => {
            if (!ok && requestId === _renderRequestId) {
                previewPlaceholder.innerHTML = '<div style="text-align:center;padding-top:20%"><div style="font-size:1.5rem;font-weight:600;color:var(--color-text-muted);margin-bottom:1rem">' + ext.toUpperCase() + '</div><p style="color:var(--color-text-muted)">' + ext.toUpperCase() + ' preview failed</p><p style="color:var(--color-disabled-text);font-size:0.8rem">The file can still be sliced for quoting.</p></div>';
                previewPlaceholder.classList.remove('hidden');
            }
            return ok;
        });
        return _meshReadyPromise;
    }

    _meshReadyPromise = new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadstart = () => {
            previewPlaceholder.textContent = 'Reading file...';
        };
        reader.onerror = () => {
            if (requestId === _renderRequestId) {
                previewPlaceholder.textContent = 'Failed to read the model file';
                previewPlaceholder.classList.remove('hidden');
            }
            resolve(false);
        };
        reader.onload = (event) => {
            try {
                resolve(_installStlBuffer(event.target.result, file, orientation, colorKey, requestId));
            } catch (e) {
                if (requestId === _renderRequestId) {
                    previewPlaceholder.textContent = 'Preview failed: invalid STL geometry';
                    previewPlaceholder.classList.remove('hidden');
                }
                resolve(false);
            }
        };
        reader.readAsArrayBuffer(file);
    });
    return _meshReadyPromise;
}

// Orientation

export function applyOrientationRotation(data) {
    if (!currentMesh) return;
    var euler = data.euler || data;
    currentMesh.rotation.x = THREE.MathUtils.degToRad(euler.x || 0);
    currentMesh.rotation.y = THREE.MathUtils.degToRad(euler.y || 0);
    currentMesh.rotation.z = THREE.MathUtils.degToRad(euler.z || 0);
    // Compute world-space bounding box, lift bottom to Z=0, and re-centre X/Y
    currentMesh.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(currentMesh, true);
    currentMesh.position.z -= box.min.z;
    // Rotation shifts the bounding-box centre, so re-centre X/Y on the bed
    currentMesh.updateMatrixWorld(true);
    box.setFromObject(currentMesh, true);
    var centre = box.getCenter(new THREE.Vector3());
    var bc = window._BED_CENTER || 128;
    currentMesh.position.x += (bc - centre.x);
    currentMesh.position.y += (bc - centre.y);
    requestRender();
}

export function resetOrientation() {
    if (!currentMesh) return;
    currentMesh.rotation.set(0, 0, 0);
    if (_initialMeshPos) {
        currentMesh.position.copy(_initialMeshPos);
    }
    // 下沉到 Z=0
    currentMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(currentMesh, true);
    currentMesh.position.z -= box.min.z;
    requestRender();
}

/**
 * Reset the loaded preview mesh to the neutral placement used immediately
 * after parsing/loading, without changing saved quote orientation state.
 * Manual lay-on-face must start from this neutral pose; otherwise a second
 * placement after saving an orientation compounds the previous rotation/Z lift.
 */
export function resetMeshPlacementForLayFace() {
    if (!currentMesh) return;
    currentMesh.rotation.set(0, 0, 0);
    currentMesh.quaternion.identity();
    if (_initialMeshPos) currentMesh.position.copy(_initialMeshPos);
    currentMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(currentMesh, true);
    currentMesh.position.z -= box.min.z;
    currentMesh.updateMatrixWorld(true);
    requestRender();
}

// ── Face click handler ──

export function setupFaceClickHandler(callback) {
    faceClickCallback = callback || null;
}

// ── Highlight faces ──

export function highlightFaces(faces) {
    resetHighlight();
    if (!currentMesh || !faces || faces.length === 0) return;
    if (!currentMeshCenterOffset) return;
    highlightGroup = new THREE.Group();
    currentMesh.add(highlightGroup);
    highlightMode = true;
    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const verts = face.vertices;
        const color = FACES_COLORS[i % FACES_COLORS.length];
        const n = verts ? verts.length : 0;
        if (n < 3) continue;
        const v0 = new THREE.Vector3(verts[0][0] - currentMeshCenterOffset.x, verts[0][1] - currentMeshCenterOffset.y, verts[0][2] - currentMeshCenterOffset.z);
        for (let j = 1; j < n - 1; j++) {
            const v1 = new THREE.Vector3(verts[j][0] - currentMeshCenterOffset.x, verts[j][1] - currentMeshCenterOffset.y, verts[j][2] - currentMeshCenterOffset.z);
            const v2 = new THREE.Vector3(verts[j+1][0] - currentMeshCenterOffset.x, verts[j+1][1] - currentMeshCenterOffset.y, verts[j+1][2] - currentMeshCenterOffset.z);
            const triGeom = new THREE.BufferGeometry();
            const arr = new Float32Array([v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
            triGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.75,
                depthTest: true,
                depthWrite: false,
            });
            const triMesh = new THREE.Mesh(triGeom, mat);
            triMesh.userData.normal = face.normal;
            highlightGroup.add(triMesh);
        }
    }
    requestRender();
}

export function resetHighlight() {
    if (highlightGroup) {
        highlightGroup.traverse(function(child) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        if (currentMesh) currentMesh.remove(highlightGroup);
        highlightGroup = null;
    }
    highlightMode = false;
    requestRender();
}
