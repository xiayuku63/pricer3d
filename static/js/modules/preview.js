// ── Preview: 3D thumbnails, preview modal ──
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    selectedFilesMap, thumbnailMap, currentResults,
    currentPreviewFilename, setCurrentPreviewFilename, quoteOptions,
    colorToObj, getRenderColorHex, formatColorLabel, getCachedPrinterModels,
} from './state.js';
import {
    initViewer, renderSTL, buildPlaceholderThumbnail, updateViewerSize,
    camera, renderer, controls, clearCurrentMesh, currentMesh,
    lookAtView, applyOrientationRotation, resetOrientation,
    setupFaceClickHandler, highlightFaces, resetHighlight, fitCameraToMesh,
    setBedLabel, updateBedSize, getCurrentMeshEntities, setCurrentMeshEntityColor,
} from './viewer.js';
import { clearClusters } from './layface.js';
import { t } from './i18n.js';
import { getResultOrientation, hasNonZeroOrientation } from './orientation-state.js';
import { addPreviewLighting, configurePreviewRenderer, createPreviewMaterial } from './viewer/render-style.js';
import { getPreview3mf, getPreviewGlb } from './preview-cache.js';

let dom = {};
let entityColorEventsBound = false;
let previewRenderToken = 0;

function hideEntityColorControls() {
    const section = document.getElementById('entity-colors-section');
    const list = document.getElementById('entity-colors-list');
    if (section) section.classList.add('hidden');
    if (list) list.replaceChildren();
}

export function renderEntityColorControls() {
    const section = document.getElementById('entity-colors-section');
    const list = document.getElementById('entity-colors-list');
    if (!section || !list) return;
    const entities = getCurrentMeshEntities();
    list.replaceChildren();
    if (entities.length === 0) {
        section.classList.add('hidden');
        return;
    }
    for (const entity of entities) {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs';
        row.style.borderColor = 'var(--color-border)';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = entity.color || '#9CA3AF';
        colorInput.setAttribute('data-entity-color', entity.id);
        colorInput.className = 'h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0';
        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate tw-text';
        name.title = entity.name;
        name.textContent = entity.name;
        const hex = document.createElement('span');
        hex.className = 'font-mono text-[10px] tw-text-muted';
        hex.setAttribute('data-entity-color-value', entity.id);
        hex.textContent = colorInput.value.toUpperCase();
        row.append(colorInput, name, hex);
        list.appendChild(row);
    }
    section.classList.remove('hidden');
}

function bindEntityColorControls() {
    if (entityColorEventsBound) return;
    const list = document.getElementById('entity-colors-list');
    if (!list) return;
    list.addEventListener('input', (event) => {
        const input = event.target.closest('[data-entity-color]');
        if (!input) return;
        const entityId = input.getAttribute('data-entity-color');
        if (!setCurrentMeshEntityColor(entityId, input.value)) return;
        const value = list.querySelector('[data-entity-color-value="' + CSS.escape(entityId) + '"]');
        if (value) value.textContent = input.value.toUpperCase();
    });
    entityColorEventsBound = true;
}

export function initPreview(d) {
    dom = d;
    bindEntityColorControls();
}

// Re-export buildPlaceholderThumbnail from viewer
export { buildPlaceholderThumbnail } from './viewer.js';

function applyAxonometricRotation(meshObject) {
    meshObject.rotation.x = -Math.PI / 4;
    meshObject.rotation.z = Math.PI / 4;
}

const stlLoader = new STLLoader();

// Parsed-geometry cache for STL thumbnails: skip re-parsing when only the color changes
const _thumbGeometryCache = new Map();

export async function buildStlThumbnail(file, colorKey = "Blue", orientation = null) {
    const _fileKey = (file.name || '') + ':' + (file.size || 0);
    let _baseGeo = _thumbGeometryCache.get(_fileKey);
    if (!_baseGeo) {
        const arrayBuffer = await file.arrayBuffer();
        _baseGeo = stlLoader.parse(arrayBuffer);
        _baseGeo.computeVertexNormals();
        _thumbGeometryCache.set(_fileKey, _baseGeo);
    }
    // Clone so the per-render center() does not mutate the cached geometry
    const geometry = _baseGeo.clone();
    geometry.center();

    const width = 220, height = 140;
    const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    configurePreviewRenderer(thumbRenderer);
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
        colorHex = (hexInfo !== null && hexInfo !== undefined) ? hexInfo : 0x3b82f6;
    }

    const mesh = new THREE.Mesh(geometry, createPreviewMaterial(colorHex));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 若指定朝向，先旋转几何体再渲染缩略图
    if (orientation) {
        mesh.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
        mesh.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
        mesh.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
        mesh.updateMatrix();
        mesh.geometry.applyMatrix4(mesh.matrix);
        mesh.rotation.set(0, 0, 0);
        mesh.updateMatrix();
    }
    applyAxonometricRotation(mesh);
    scene.add(mesh);
    addPreviewLighting(scene);

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

export async function buildNonStlThumbnail(file, colorKey, orientation = null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    const is3mf = ext === '3mf';
    const glbBlob = await (is3mf ? getPreview3mf(file) : getPreviewGlb(file));
    const url = URL.createObjectURL(glbBlob);

    const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    configurePreviewRenderer(thumbRenderer);
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
        colorHex = (hexInfo !== null && hexInfo !== undefined) ? hexInfo : 0x3b82f6;
    }

    const model = gltf.scene;
    model.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            if (!is3mf) {
                c.material = createPreviewMaterial(colorHex);
            } else {
                const sourceColor = c.userData.source_color || c.material?.color?.getHexString?.();
                c.material = createPreviewMaterial(sourceColor ? (String(sourceColor).startsWith('#') ? sourceColor : '#' + sourceColor) : colorHex);
            }
        }
    });
    if (orientation) {
        model.rotation.x = THREE.MathUtils.degToRad(orientation.x || 0);
        model.rotation.y = THREE.MathUtils.degToRad(orientation.y || 0);
        model.rotation.z = THREE.MathUtils.degToRad(orientation.z || 0);
    }
    model.rotateX(THREE.MathUtils.degToRad(-30));
    model.rotateY(THREE.MathUtils.degToRad(-45));
    scene.add(model);
    addPreviewLighting(scene);

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

export async function ensureThumbnailForFile(file, colorKey, orientation = null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    try {
        const orient = orientation || { x: 0, y: 0, z: 0 };
        const thumb = ext === 'stl' ? await buildStlThumbnail(file, colorKey, orientation) : await buildNonStlThumbnail(file, colorKey, orientation);
        // 同时存两份：带朝向的key + 文件名key（兼容现有读取逻辑）
        thumbnailMap.set(file.name, thumb);
        if (orientation) {
            const orientKey = file.name + '|' + orient.x + '_' + orient.y + '_' + orient.z;
            thumbnailMap.set(orientKey, thumb);
        }
    } catch (e) {
        console.warn('Thumbnail failed for', file.name, 'color=' + colorKey + ':', e.message);
        thumbnailMap.set(file.name, buildPlaceholderThumbnail(ext));
    }
}

export async function buildThumbnails(selectedFiles, colorByFilename = {}) {
    for (const file of selectedFiles) {
        var selectedColor = colorByFilename[file.name] || quoteOptions.color;
        // Ensure we never pass an empty color (would trigger hash-based fallback)
        if (!selectedColor || String(selectedColor).trim() === '') {
            selectedColor = '#ffffff';
        }
        // Normalize to hex if possible so thumbnails use the real material color
        var _thumbColorObj = colorToObj(selectedColor);
        if (_thumbColorObj && _thumbColorObj.hex) selectedColor = _thumbColorObj.hex;
        await ensureThumbnailForFile(file, selectedColor);
    }
}

// ── Preview modal ──
export function openPreviewModal(onFaceClickCb) {
    const { previewModal, previewContainer, viewCube, layFaceBtn, orientSaveBtn, orientLearnedBtn } = dom;
    const setButtonLabel = (button, label) => {
        if (!button) return;
        const labelEl = button.querySelector('[data-button-label], [data-orientation-label]');
        if (labelEl) labelEl.textContent = label;
        else button.textContent = label;
    };
    if (previewModal) previewModal.classList.remove('hidden');
    const width = previewContainer?.clientWidth || 1000;
    const height = previewContainer?.clientHeight || 700;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    applyOrientationRotation(quoteOptions.orientation || { x: 0, y: 0, z: 0 });
    setupFaceClickHandler(onFaceClickCb);
    if (viewCube) viewCube.classList.remove('hidden');
    if (dom.layFaceHint) {
        dom.layFaceHint.textContent = t('orientation.pickFaceHint');
        dom.layFaceHint.classList.add('hidden');
    }
    // Reset labels without removing the button icons.
    if (layFaceBtn) {
        const label = layFaceBtn.querySelector('[data-orientation-label]');
        if (label) label.textContent = t('orientation.autoOrient');
        else layFaceBtn.textContent = t('orientation.autoOrient');
        layFaceBtn.disabled = false;
        layFaceBtn.setAttribute('aria-pressed', 'false');
    }
    if (orientSaveBtn) { setButtonLabel(orientSaveBtn, t('orientation.saveQuote')); orientSaveBtn.disabled = false; }
    if (orientLearnedBtn) { setButtonLabel(orientLearnedBtn, t('orientation.autoLearn')); orientLearnedBtn.disabled = false; }
}

export function closePreviewModal() {
    previewRenderToken += 1;
    const { previewModal, viewCube, layFaceBtn } = dom;
    setupFaceClickHandler(null);
    import('./orientation-ui.js').then(m => m.cleanupLayFaceMode()).catch(() => {
        clearClusters();
        window.__onLayFaceClick = null;
    });
    if (dom.layFaceHint) dom.layFaceHint.classList.add('hidden');
    if (layFaceBtn) {
        const label = layFaceBtn.querySelector('[data-orientation-label]');
        if (label) label.textContent = t('orientation.autoOrient');
        else layFaceBtn.textContent = t('orientation.autoOrient');
        layFaceBtn.disabled = false;
        layFaceBtn.setAttribute('aria-pressed', 'false');
    }
    if (previewModal) previewModal.classList.add('hidden');
    hideEntityColorControls();
    if (viewCube) viewCube.classList.add('hidden');
}

export function previewByFilename(filename, ext) {
    const { previewPlaceholder } = dom;
    setCurrentPreviewFilename(filename);
    const renderToken = ++previewRenderToken;
    const rowData = currentResults.find((i) => i && i.filename === filename);
    const printerRef = String(rowData?._printer_model || quoteOptions.printer_model || '');
    const printerId = printerRef.replace(/_\d{2}$/, '');
    const printer = getCachedPrinterModels().find(
        (item) => item && (item.id === printerId || item.name === printerId),
    );
    if (printer?.bed_width && printer?.bed_depth) {
        setBedLabel(printer.bed_width, printer.bed_depth, printer.bed_height);
        updateBedSize(printer.bed_width, printer.bed_depth);
    }
    const onFaceClickCb = window._onFaceClicked || null;
    openPreviewModal(onFaceClickCb);
    const file = selectedFilesMap.get(filename);
    if (!file) {
        clearCurrentMesh();
        if (previewPlaceholder) { previewPlaceholder.textContent = t('preview.fileNotFound'); previewPlaceholder.classList.remove('hidden'); }
        return;
    }
    if (previewPlaceholder) { previewPlaceholder.textContent = t('preview.loadingFile', { filename: filename, size: (file.size/1024).toFixed(0) }); previewPlaceholder.classList.remove('hidden'); }
    var perFileOrient = getResultOrientation(rowData);
    // 如果没有 per-file 方向（API 不返回），使用最后一次用户设置的 quoteOptions.orientation
    if (!perFileOrient && hasNonZeroOrientation(quoteOptions.orientation)) {
        perFileOrient = quoteOptions.orientation;
    }
    var colorForPreview = (rowData && rowData.color) ? rowData.color : quoteOptions.color;
    // Fallback: ensure we always have a valid hex, never empty
    if (!colorForPreview || String(colorForPreview).trim() === '') {
        colorForPreview = '#ffffff';
    }
    // Normalize to hex string if possible (handles bare-color-name / object inputs)
    var _previewColorObj = colorToObj(colorForPreview);
    if (_previewColorObj && _previewColorObj.hex) colorForPreview = _previewColorObj.hex;
    hideEntityColorControls();
    Promise.resolve(renderSTL(file, colorForPreview, perFileOrient)).then((ok) => {
        if (renderToken !== previewRenderToken || currentPreviewFilename !== filename) return;
        if (ok) renderEntityColorControls();
        else hideEntityColorControls();
    });
}

export function updatePreviewColor(filename, color) {
    if (!filename || currentPreviewFilename !== filename) return false;
    const file = selectedFilesMap.get(filename);
    if (!file) return false;
    const obj = colorToObj(color);
    const renderToken = ++previewRenderToken;
    Promise.resolve(renderSTL(file, obj?.hex || color || '#ffffff',
        getResultOrientation(currentResults.find((item) => item && item.filename === filename)),
    )).then((ok) => {
        if (renderToken !== previewRenderToken || currentPreviewFilename !== filename) return;
        if (ok) renderEntityColorControls();
    });
    return true;
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
