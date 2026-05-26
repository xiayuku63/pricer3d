// ── Preview: 3D thumbnails, preview modal ──
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    selectedFilesMap, thumbnailMap, currentResults,
    currentPreviewFilename, setCurrentPreviewFilename, quoteOptions,
    colorToObj, getRenderColorHex, formatColorLabel,
} from './state.js';
import {
    initViewer, renderSTL, buildPlaceholderThumbnail, updateViewerSize,
    camera, renderer, controls, clearCurrentMesh, currentMesh,
    lookAtView, applyOrientationRotation, resetOrientation,
    setupFaceClickHandler, highlightFaces, resetHighlight, fitCameraToMesh,
} from './viewer.js';
import { clearClusters } from './layface.js';

let dom = {};

export function initPreview(d) { dom = d; }

// Re-export buildPlaceholderThumbnail from viewer
export { buildPlaceholderThumbnail } from './viewer.js';

function applyAxonometricRotation(meshObject) {
    meshObject.rotation.x = -Math.PI / 4;
    meshObject.rotation.z = Math.PI / 4;
}

const stlLoader = new STLLoader();

export async function buildStlThumbnail(file, colorKey = "Blue") {
    const arrayBuffer = await file.arrayBuffer();
    const geometry = stlLoader.parse(arrayBuffer);
    geometry.computeVertexNormals();
    geometry.center();

    const width = 220, height = 140;
    const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(width, height);
    thumbRenderer.setPixelRatio(1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);

    const hexInfo = getRenderColorHex(colorKey);
    let colorHex;
    if (hexInfo && typeof hexInfo === 'object' && hexInfo.fallback) {
        const c = new THREE.Color();
        c.setHSL(hexInfo.hue / 360, 0.58, 0.56);
        colorHex = c.getHex();
    } else {
        colorHex = hexInfo || 0x3b82f6;
    }

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.15, roughness: 0.65 }));
    applyAxonometricRotation(mesh);
    scene.add(mesh);
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 0.85);
    light.position.set(40, 60, 90);
    scene.add(light);

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = cam.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.7;
    cam.position.set(center.x, center.y, center.z + cameraZ);
    cam.lookAt(center);

    thumbRenderer.render(scene, cam);
    const dataUrl = thumbRenderer.domElement.toDataURL('image/png');

    mesh.geometry.dispose();
    mesh.material.dispose();
    thumbRenderer.dispose();
    return dataUrl;
}

export async function buildNonStlThumbnail(file, colorKey) {
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch('/api/preview/glb', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error('GLB failed');
    const glbBlob = await resp.blob();
    const url = URL.createObjectURL(glbBlob);

    const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(220, 140);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const cam = new THREE.PerspectiveCamera(45, 220 / 140, 0.1, 10000);

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    const hexInfo = getRenderColorHex(colorKey);
    let colorHex;
    if (hexInfo && typeof hexInfo === 'object' && hexInfo.fallback) {
        const c = new THREE.Color();
        c.setHSL(hexInfo.hue / 360, 0.58, 0.56);
        colorHex = c.getHex();
    } else {
        colorHex = hexInfo || 0x3b82f6;
    }

    const model = gltf.scene;
    model.traverse(c => {
        if (c.isMesh) c.material = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.15, roughness: 0.65 });
    });
    model.rotation.x = THREE.MathUtils.degToRad(-30);
    model.rotation.y = THREE.MathUtils.degToRad(-45);
    scene.add(model);
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 0.85);
    light.position.set(40, 60, 90);
    scene.add(light);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = cam.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.7;
    cam.position.set(center.x, center.y, center.z + cameraZ);
    cam.lookAt(center);

    thumbRenderer.render(scene, cam);
    const dataUrl = thumbRenderer.domElement.toDataURL('image/png');

    model.traverse(c => {
        if (c.isMesh) { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
    });
    thumbRenderer.dispose();
    return dataUrl;
}

export async function ensureThumbnailForFile(file, colorKey) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    try {
        const thumb = ext === 'stl' ? await buildStlThumbnail(file, colorKey) : await buildNonStlThumbnail(file, colorKey);
        thumbnailMap.set(file.name, thumb);
    } catch (e) {
        console.warn('Thumbnail failed:', e.message);
        thumbnailMap.set(file.name, buildPlaceholderThumbnail(ext));
    }
}

export async function buildThumbnails(selectedFiles, colorByFilename = {}) {
    for (const file of selectedFiles) {
        const selectedColor = colorByFilename[file.name] || quoteOptions.color;
        await ensureThumbnailForFile(file, selectedColor);
    }
}

// ── Preview modal ──
export function openPreviewModal(onFaceClickCb) {
    const { previewModal, previewContainer, viewCube } = dom;
    if (previewModal) previewModal.classList.remove('hidden');
    const width = previewContainer?.clientWidth || 1000;
    const height = previewContainer?.clientHeight || 700;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    applyOrientationRotation(quoteOptions.orientation || { x: 0, y: 0, z: 0 });
    setupFaceClickHandler(onFaceClickCb);
    if (viewCube) viewCube.classList.remove('hidden');
}

export function closePreviewModal() {
    const { previewModal, viewCube, layFaceBtn } = dom;
    setupFaceClickHandler(null);
    clearClusters();
    window.__onLayFaceClick = null;
    if (layFaceBtn) layFaceBtn.textContent = '🎯 智能摆放 (Lay on Face)';
    if (previewModal) previewModal.classList.add('hidden');
    if (viewCube) viewCube.classList.add('hidden');
}

export function previewByFilename(filename, ext) {
    const { previewPlaceholder } = dom;
    setCurrentPreviewFilename(filename);
    const onFaceClickCb = window._onFaceClicked || null;
    openPreviewModal(onFaceClickCb);
    const file = selectedFilesMap.get(filename);
    if (!file) {
        clearCurrentMesh();
        if (previewPlaceholder) { previewPlaceholder.textContent = '文件未找到'; previewPlaceholder.classList.remove('hidden'); }
        return;
    }
    if (previewPlaceholder) { previewPlaceholder.textContent = `加载中 ${filename} (${(file.size/1024).toFixed(0)}KB)...`; previewPlaceholder.classList.remove('hidden'); }
    const rowData = currentResults.find((i) => i && i.filename === filename);
    const colorForPreview = (rowData && rowData.color) ? rowData.color : quoteOptions.color;
    renderSTL(file, colorForPreview);
}

// ── View cube ──
export function setupViewCube() {
    const viewCube = document.getElementById('view-cube');
    if (!viewCube) return;
    viewCube.querySelectorAll('.view-cube-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!currentMesh) return;
            lookAtView(btn.dataset.view, currentMesh);
        });
    });
}
