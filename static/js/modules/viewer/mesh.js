// ── Three.js 3D Viewer — Mesh Module ──
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getRenderColorHex } from '../state.js';
import { scene, camera, stlLoader, previewContainer, previewPlaceholder, requestRender } from './scene.js';
import { fitCameraToMesh } from './camera.js';

// ── Shared mutable state (owned here, imported by scene.js and camera.js) ──
export let currentMesh, currentMeshCenterOffset = null;

// Face-click / highlight state
export let faceClickCallback = null;
export let highlightGroup = null;
export let highlightMode = false;

// ── Private mesh state ──
let _initialMeshPos = null;

// Recolor fast-path cache: skip re-parsing STL/GLB when only the color changes
let _lastRenderedFileKey = null;
let _lastRenderedColorKey = null;
let _lastRenderedOrientation = null;

const FACES_COLORS = [0x22c55e, 0x3b82f6, 0xa855f7, 0xeab308, 0xf97316, 0xec4899];

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
export function recolorCurrentMesh(colorKey) {
    if (!currentMesh) return false;
    const colorNum = _colorNumFromKey(colorKey);
    currentMesh.traverse(function(c) {
        if (c.isMesh) {
            c.material = new THREE.MeshStandardMaterial({
                color: colorNum,
                metalness: 0.0,
                roughness: 0.6,
            });
        }
    });
    _lastRenderedColorKey = colorKey;
    requestRender();
    return true;
}

// ── Mesh lifecycle ──

export function clearCurrentMesh() {
    // 清理可放置平面视觉（如果有）
    if (typeof window.__cleanupPlaceablePlane === 'function') {
        window.__cleanupPlaceablePlane();
    }
    if (!currentMesh) return;
    scene.remove(currentMesh);
    if (currentMesh.type === 'Group') {
        currentMesh.traverse(c => {
            if (c.isMesh) {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            }
        });
    } else {
        if (currentMesh.geometry) currentMesh.geometry.dispose();
        if (currentMesh.material) currentMesh.material.dispose();
    }
    currentMesh = null;
}

// ── GLB rendering (non-STL files via backend conversion) ──

async function renderViaGLB(file, orientation = null, colorKey = null) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const resp = await fetch('/api/preview/glb', { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('GLB conversion failed');
        const glbBlob = await resp.blob();
        const url = URL.createObjectURL(glbBlob);
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        URL.revokeObjectURL(url);

        const model = gltf.scene;
        var _glbColorNum = _colorNumFromKey(colorKey || 'Blue');
        model.traverse(function(c) {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
                c.material = new THREE.MeshStandardMaterial({
                    color: _glbColorNum,
                    metalness: 0.0,
                    roughness: 0.6,
                });
            }
        });
        // 自适应缩放 + 居中
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        let scale = 1;
        if (maxDim > 0) {
            scale = 100 / maxDim;
            const center = box.getCenter(new THREE.Vector3());
            model.scale.setScalar(scale);
            model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        }
        // 居中到网格 (BED_HALF, BED_HALF, 0) + 下沉到 Z=0
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        const boxCenter = box.getCenter(new THREE.Vector3());
        const bc = window._BED_CENTER || 128;
        const sink = new THREE.Vector3(bc - boxCenter.x, bc - boxCenter.y, -box.min.z);
        model.position.add(sink);

        currentMeshCenterOffset = new THREE.Vector3(0, 0, 0);
        _initialMeshPos = model.position.clone();

        clearCurrentMesh();
        currentMesh = model;
        scene.add(currentMesh);
        if (orientation) {
            currentMesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
            currentMesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
            currentMesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
            currentMesh.updateMatrixWorld(true);
            box = new THREE.Box3().setFromObject(currentMesh);
            currentMesh.position.z -= box.min.z;
            // 旋转后重新 X/Y 居中到热床中心（旋转会使包围盒中心偏移，否则模型偏离底板中心）
            currentMesh.updateMatrixWorld(true);
            box.setFromObject(currentMesh);
            const _glbReCenter = box.getCenter(new THREE.Vector3());
            currentMesh.position.x += (bc - _glbReCenter.x);
            currentMesh.position.y += (bc - _glbReCenter.y);
        }
        fitCameraToMesh(currentMesh);
        previewPlaceholder.classList.add('hidden');
        _lastRenderedFileKey = (file.name || '') + ':' + (file.size || 0);
        _lastRenderedColorKey = colorKey;
        _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
        return true;
    } catch (e) {
        console.warn('GLB render failed:', e);
        return false;
    }
}

// ── Exported: render ──

export function renderSTL(file, colorKey = 'Blue', orientation = null) {
    if (!file || !(file instanceof Blob) || file.size === 0) {
        previewPlaceholder.textContent = '文件无效或为空，请重新上传';
        previewPlaceholder.classList.remove('hidden');
        return;
    }
    // Fast path: same file + orientation already loaded → just recolor, skip re-parse
    var _fileKey = (file.name || '') + ':' + (file.size || 0);
    if (currentMesh && _fileKey === _lastRenderedFileKey
        && _orientationEqual(orientation, _lastRenderedOrientation)) {
        recolorCurrentMesh(colorKey);
        previewPlaceholder.classList.add('hidden');
        return;
    }
    const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    if (ext !== 'stl') {
        // 为 3MF/OBJ/STP 通过后端转为 GLB 预览
        clearCurrentMesh();
        renderViaGLB(file, orientation, colorKey).then(ok => {
            if (!ok) {
                previewPlaceholder.innerHTML = '<div style="text-align:center;padding-top:20%"><div style="font-size:1.5rem;font-weight:600;color:var(--color-text-muted);margin-bottom:1rem">' + ext.toUpperCase() + '</div><p style="color:var(--color-text-muted)">' + ext.toUpperCase() + ' 预览失败</p><p style="color:var(--color-disabled-text);font-size:0.8rem">上传后将自动切片报价</p></div>';
                previewPlaceholder.classList.remove('hidden');
            }
        });
        return;
    }
    const reader = new FileReader();
    reader.onloadstart = () => {
        previewPlaceholder.textContent = '读取中...';
    };
    reader.onerror = () => {
        previewPlaceholder.textContent = '文件读取失败，请重新上传';
        previewPlaceholder.classList.remove('hidden');
    };
    reader.onload = (event) => {
        try {
            const geometry = stlLoader.parse(event.target.result);
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            const centerOffset = new THREE.Vector3();
            geometry.boundingBox.getCenter(centerOffset);
            currentMeshCenterOffset = centerOffset;
            geometry.center();
            // Move model above print bed: lowest point at Z=0
            geometry.computeBoundingBox();
            geometry.translate(0, 0, -geometry.boundingBox.min.z);
            clearCurrentMesh();
            const material = new THREE.MeshStandardMaterial({
                color: _colorNumFromKey(colorKey),
                metalness: 0.0,
                roughness: 0.6,
            });
            currentMesh = new THREE.Mesh(geometry, material);
            currentMesh.rotation.set(0, 0, 0);
            // 模型在打印平面居中
            const bc = window._BED_CENTER || 128;
            currentMesh.position.set(bc, bc, 0);
            _initialMeshPos = currentMesh.position.clone();
            if (orientation) {
                currentMesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
                currentMesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
                currentMesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
                currentMesh.updateMatrixWorld(true);
                var box = new THREE.Box3().setFromObject(currentMesh);
                currentMesh.position.z -= box.min.z;
                // 旋转后重新 X/Y 居中到热床中心（旋转会使包围盒中心偏移，否则模型偏离底板中心）
                currentMesh.updateMatrixWorld(true);
                box.setFromObject(currentMesh);
                var _reCenter = box.getCenter(new THREE.Vector3());
                currentMesh.position.x += (bc - _reCenter.x);
                currentMesh.position.y += (bc - _reCenter.y);
            }
            scene.add(currentMesh);
            fitCameraToMesh(currentMesh);
            previewPlaceholder.classList.add('hidden');
            _lastRenderedFileKey = _fileKey;
            _lastRenderedColorKey = colorKey;
            _lastRenderedOrientation = orientation ? { x: orientation.x || 0, y: orientation.y || 0, z: orientation.z || 0 } : null;
        } catch (e) {
            previewPlaceholder.textContent = '预览失败，请确认 STL 文件有效';
            previewPlaceholder.classList.remove('hidden');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ── Orientation ──

export function applyOrientationRotation(data) {
    if (!currentMesh) return;
    var euler = data.euler || data;
    currentMesh.rotation.x = THREE.MathUtils.degToRad(euler.x || 0);
    currentMesh.rotation.y = THREE.MathUtils.degToRad(euler.y || 0);
    currentMesh.rotation.z = THREE.MathUtils.degToRad(euler.z || 0);
    // Compute world-space bounding box, lift bottom to Z=0, and re-centre X/Y
    currentMesh.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.position.z -= box.min.z;
    // Rotation shifts the bounding-box centre, so re-centre X/Y on the bed
    currentMesh.updateMatrixWorld(true);
    box.setFromObject(currentMesh);
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
    const box = new THREE.Box3().setFromObject(currentMesh);
    currentMesh.position.z -= box.min.z;
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
