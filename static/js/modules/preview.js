// ── Preview: 3D thumbnails, preview modal ──
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    selectedFilesMap, thumbnailMap, currentResults,
    currentPreviewFilename, setCurrentPreviewFilename, quoteOptions,
    authToken, authFetch,
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
import { getCoplanarClusters, getPreview3mf, getPreviewGlb } from './preview-cache.js';
import {
    showModelProgress, updateModelProgress, completeModelProgress,
    startModelProgressItems, updateModelProgressItem,
} from './model-progress.js';

let dom = {};
let entityColorEventsBound = false;
let pendingEntityColorId = null;
let previewRenderToken = 0;
const entityColorPalettesByFile = new Map();

function normalizeEntityColor(value, fallback = '#9CA3AF') {
    const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toUpperCase()}` : fallback;
}

function currentEntityPaletteKey() {
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return String(currentPreviewFilename || '__preview__');
    return [file.name || currentPreviewFilename || '', file.size || 0, file.lastModified || 0].join(':');
}

function addEntityPaletteColor(color) {
    const normalized = normalizeEntityColor(color, '');
    if (!normalized) return '';
    const key = currentEntityPaletteKey();
    const palette = entityColorPalettesByFile.get(key) || [];
    if (!palette.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
        palette.push(normalized);
        entityColorPalettesByFile.set(key, palette);
    }
    return normalized;
}

function getEntityColorPalette(entities) {
    const key = currentEntityPaletteKey();
    const palette = [...(entityColorPalettesByFile.get(key) || [])];
    for (const entity of entities) {
        for (const color of [entity.sourceColor, entity.color]) {
            const normalized = normalizeEntityColor(color, '');
            if (normalized && !palette.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
                palette.push(normalized);
            }
        }
    }
    if (palette.length === 0) palette.push('#9CA3AF');
    entityColorPalettesByFile.set(key, palette);
    return palette;
}

function closeEntityColorMenus(exceptMenu = null) {
    const list = document.getElementById('entity-colors-list');
    if (!list) return;
    list.querySelectorAll('[data-entity-color-menu]').forEach((menu) => {
        if (menu === exceptMenu) return;
        menu.classList.add('hidden');
        const row = menu.closest('[data-entity-color-row]');
        const trigger = row?.querySelector('[data-entity-color-trigger]');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
}

function hideEntityColorControls() {
    const section = document.getElementById('entity-colors-section');
    const list = document.getElementById('entity-colors-list');
    pendingEntityColorId = null;
    if (section) section.classList.add('hidden');
    if (list) list.replaceChildren();
}

function createEntityColorChoice(color, entityId, selectedColor) {
    const choice = document.createElement('button');
    const isSelected = color.toLowerCase() === selectedColor.toLowerCase();
    choice.type = 'button';
    choice.className = `entity-color-choice${isSelected ? ' is-active' : ''}`;
    choice.setAttribute('data-entity-color-option', entityId);
    choice.setAttribute('data-color-value', color);
    choice.setAttribute('role', 'option');
    choice.setAttribute('aria-label', color);
    choice.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    choice.title = color;
    choice.style.setProperty('--entity-choice-color', color);
    if (isSelected) {
        const check = document.createElement('span');
        check.className = 'entity-color-choice-check';
        check.textContent = '?';
        choice.appendChild(check);
    }
    return choice;
}

export function getCurrentPreviewEntityColors() {
    const assignments = {};
    for (const entity of getCurrentMeshEntities()) {
        const color = normalizeEntityColor(entity.color, '');
        if (entity.id && color) assignments[entity.id] = { color };
    }
    return assignments;
}

function applySavedEntityColors(assignments) {
    if (!assignments || typeof assignments !== 'object') return;
    for (const entity of getCurrentMeshEntities()) {
        const requested = assignments[entity.id];
        const color = normalizeEntityColor(typeof requested === 'object' ? requested?.color : requested, '');
        if (color) setCurrentMeshEntityColor(entity.id, color);
    }
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
    const palette = getEntityColorPalette(entities);
    for (const entity of entities) {
        const selectedColor = normalizeEntityColor(entity.color);
        const row = document.createElement('div');
        row.className = 'entity-color-row';
        row.setAttribute('data-entity-color-row', entity.id);

        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate text-xs font-medium tw-text';
        name.title = entity.name;
        name.textContent = entity.name;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'entity-color-select-trigger';
        trigger.setAttribute('data-entity-color-trigger', entity.id);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-label', `${entity.name}: ${selectedColor}`);
        trigger.title = selectedColor;

        const swatch = document.createElement('span');
        swatch.className = 'entity-color-selected-swatch';
        swatch.style.backgroundColor = selectedColor;
        const hex = document.createElement('span');
        hex.className = 'entity-color-selected-value';
        hex.setAttribute('data-entity-color-value', entity.id);
        hex.textContent = selectedColor;
        const chevron = document.createElement('span');
        chevron.className = 'entity-color-chevron';
        chevron.textContent = '\u2304';
        trigger.append(swatch, hex, chevron);

        const header = document.createElement('div');
        header.className = 'flex items-center gap-2';
        header.append(name, trigger);

        const menu = document.createElement('div');
        menu.className = 'entity-color-menu hidden';
        menu.setAttribute('data-entity-color-menu', entity.id);
        menu.setAttribute('role', 'listbox');
        for (const color of palette) {
            menu.appendChild(createEntityColorChoice(color, entity.id, selectedColor));
        }
        const addColor = document.createElement('button');
        addColor.type = 'button';
        addColor.className = 'entity-color-choice entity-color-add-choice';
        addColor.setAttribute('data-entity-color-add', entity.id);
        addColor.setAttribute('aria-label', t('preview.addEntityColor'));
        addColor.title = t('preview.addEntityColor');
        addColor.textContent = '+';
        menu.appendChild(addColor);

        row.append(header, menu);
        list.appendChild(row);
    }
    section.classList.remove('hidden');
}

function bindEntityColorControls() {
    if (entityColorEventsBound) return;
    const list = document.getElementById('entity-colors-list');
    const addInput = document.getElementById('entity-color-add-input');
    if (!list || !addInput) return;

    list.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-entity-color-trigger]');
        if (trigger) {
            const row = trigger.closest('[data-entity-color-row]');
            const menu = row?.querySelector('[data-entity-color-menu]');
            if (!menu) return;
            const willOpen = menu.classList.contains('hidden');
            closeEntityColorMenus(willOpen ? menu : null);
            menu.classList.toggle('hidden', !willOpen);
            trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            return;
        }

        const option = event.target.closest('[data-entity-color-option]');
        if (option) {
            const entityId = option.getAttribute('data-entity-color-option');
            const color = addEntityPaletteColor(option.getAttribute('data-color-value'));
            if (color && setCurrentMeshEntityColor(entityId, color)) renderEntityColorControls();
            return;
        }

        const add = event.target.closest('[data-entity-color-add]');
        if (add) {
            pendingEntityColorId = add.getAttribute('data-entity-color-add');
            const entity = getCurrentMeshEntities().find((item) => item.id === pendingEntityColorId);
            addInput.value = normalizeEntityColor(entity?.color, '#9CA3AF');
            addInput.click();
        }
    });

    addInput.addEventListener('change', () => {
        const entityId = pendingEntityColorId;
        pendingEntityColorId = null;
        const color = addEntityPaletteColor(addInput.value);
        if (color && entityId) setCurrentMeshEntityColor(entityId, color);
        renderEntityColorControls();
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('#entity-colors-section')) closeEntityColorMenus();
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

export async function buildStlThumbnail(file, colorKey = "Blue", orientation = null, onProgress = null) {
    const fileKey = (file.name || '') + ':' + (file.size || 0);
    let baseGeometry = _thumbGeometryCache.get(fileKey);
    if (!baseGeometry) {
        onProgress?.(5, 'Reading STL model');
        const arrayBuffer = await readFileWithProgress(file, (percent) => {
            onProgress?.(5 + percent * 0.45, 'Reading STL model');
        });
        onProgress?.(55, 'Parsing STL mesh');
        baseGeometry = stlLoader.parse(arrayBuffer);
        baseGeometry.computeVertexNormals();
        _thumbGeometryCache.set(fileKey, baseGeometry);
    } else {
        onProgress?.(55, 'Using cached STL mesh');
    }
    // Clone so per-render centering does not mutate cached geometry.
    const geometry = baseGeometry.clone();
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
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.7;
    cam.position.set(center.x, center.y, center.z + cameraZ);
    cam.lookAt(center);

    onProgress?.(85, 'Rendering STL thumbnail');
    thumbRenderer.render(scene, cam);
    const dataUrl = thumbRenderer.domElement.toDataURL('image/png');
    onProgress?.(100, 'STL thumbnail ready');

    mesh.geometry.dispose();
    mesh.material.dispose();
    thumbRenderer.dispose();
    return dataUrl;
}

export async function buildNonStlThumbnail(file, colorKey, orientation = null, onProgress = null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    const is3mf = ext === '3mf';
    onProgress?.(5, `Preparing ${ext.toUpperCase()} model`);
    // The shared conversion cache avoids duplicate backend work for one file.
    // Reserve the final stages for GLB parsing and thumbnail rendering.
    const conversionProgress = (percent, detail) => {
        onProgress?.(5 + percent * 0.65, detail);
    };
    const glbBlob = await (is3mf
        ? getPreview3mf(file, conversionProgress)
        : getPreviewGlb(file, conversionProgress));
    onProgress?.(75, `Loading ${ext.toUpperCase()} preview data`);
    const url = URL.createObjectURL(glbBlob);

    const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    configurePreviewRenderer(thumbRenderer);
    thumbRenderer.setSize(220, 140);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const cam = new THREE.PerspectiveCamera(45, 220 / 140, 0.1, 10000);

    const loader = new GLTFLoader();
    onProgress?.(82, `Parsing ${ext.toUpperCase()} mesh`);
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
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.7;
    cam.position.set(center.x, center.y, center.z + cameraZ);
    cam.lookAt(center);

    onProgress?.(92, `Rendering ${ext.toUpperCase()} thumbnail`);
    thumbRenderer.render(scene, cam);
    const dataUrl = thumbRenderer.domElement.toDataURL('image/png');
    onProgress?.(100, `${ext.toUpperCase()} thumbnail ready`);

    model.traverse(c => {
        if (c.isMesh) { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); }
    });
    thumbRenderer.dispose();
    return dataUrl;
}

export async function ensureThumbnailForFile(file, colorKey, orientation = null, onProgress = null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
    const useSharedProgress = typeof onProgress !== 'function';
    const report = onProgress || ((percent, detail) => updateModelProgress(percent, `${file.name} - ${detail}`));
    if (useSharedProgress) showModelProgress(`Generating ${ext.toUpperCase() || 'model'} preview...`, file.name);
    try {
        const orient = orientation || { x: 0, y: 0, z: 0 };
        const thumb = ext === 'stl'
            ? await buildStlThumbnail(file, colorKey, orientation, report)
            : await buildNonStlThumbnail(file, colorKey, orientation, report);
        thumbnailMap.set(file.name, thumb);
        if (orientation) {
            const orientKey = file.name + '|' + orient.x + '_' + orient.y + '_' + orient.z;
            thumbnailMap.set(orientKey, thumb);
        }
        return true;
    } catch (e) {
        console.warn('Thumbnail failed for', file.name, 'color=' + colorKey + ':', e.message);
        thumbnailMap.set(file.name, buildPlaceholderThumbnail(ext));
        report(100, `${ext.toUpperCase() || 'Model'} thumbnail failed; using placeholder`);
        return false;
    } finally {
        if (useSharedProgress) completeModelProgress(`${ext.toUpperCase() || 'Model'} preview ready`);
    }
}

function readFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Model file read failed'));
        reader.onprogress = (event) => {
            if (event.lengthComputable) onProgress?.((event.loaded / event.total) * 100);
        };
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(file);
    });
}

export async function buildThumbnails(selectedFiles, colorByFilename = {}, onProgress = null, onFileReady = null) {
    const files = Array.from(selectedFiles || []);
    if (files.length === 0) return;
    const useSharedProgress = typeof onProgress !== 'function';
    const report = onProgress || ((percent, detail) => updateModelProgress(percent, detail));
    if (useSharedProgress) {
        showModelProgress(`Generating model previews (${files.length} files)...`);
        startModelProgressItems(files.map((file, index) => ({ id: index, filename: file.name })));
    }

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (useSharedProgress) updateModelProgressItem(index, { state: 'processing', percent: 0 });
        let selectedColor = colorByFilename[file.name] || quoteOptions.color;
        if (!selectedColor || String(selectedColor).trim() === '') {
            selectedColor = '#ffffff';
        }
        const thumbColorObj = colorToObj(selectedColor);
        if (thumbColorObj && thumbColorObj.hex) selectedColor = thumbColorObj.hex;
        const thumbnailReady = await ensureThumbnailForFile(file, selectedColor, null, (filePercent, detail) => {
            const overall = ((index + filePercent / 100) / files.length) * 100;
            report(overall, `${index + 1}/${files.length} - ${file.name} - ${detail}`);
            if (useSharedProgress) updateModelProgressItem(index, {
                state: 'processing', percent: filePercent, detail,
            });
        });
        if (useSharedProgress) updateModelProgressItem(index, {
            state: thumbnailReady ? 'complete' : 'error', percent: 100,
        });
        onFileReady?.({ file, index, total: files.length, thumbnailReady });
        report(((index + 1) / files.length) * 100, `${index + 1}/${files.length} - ${file.name}`);
    }
    if (useSharedProgress) completeModelProgress(`Model previews ready (${files.length} files)`);
}

// Preview modal
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
    import('./orientation-ui.js').then(m => {
        m.cleanupLayFaceMode();
        m.discardCurrentOrientationDraft();
    }).catch(() => {
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


function prefetchStepPlacementProfile(file, extension) {
    if (!authToken || !file) return;
    const normalizedExtension = String(extension || file.name?.split('.').pop() || '')
        .toLowerCase()
        .replace(/^\./, '');
    if (normalizedExtension !== 'stp' && normalizedExtension !== 'step') return;

    const prefetch = () => {
        getCoplanarClusters(file, authFetch).catch(() => {
            // The manual-placement action will retry and surface any real error.
        });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetch, { timeout: 500 });
    else setTimeout(prefetch, 0);
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
        if (ok) {
            applySavedEntityColors(rowData?._entity_colors);
            renderEntityColorControls();
            prefetchStepPlacementProfile(file, ext);
        } else hideEntityColorControls();
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
