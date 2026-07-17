// ── Orientation UI: layface, orientation controls, training ──
import * as THREE from 'three';
import {
    currentMesh, controls, requestRender, renderer, camera,
} from './viewer.js';
import {
    renderClusters, clearClusters, setClusterHover, intersectClusters,
    placeFaceOnBed, isClusterMode,
} from './layface.js';
import {
    authToken, authFetch, quoteOptions,
    selectedFilesMap, currentPreviewFilename, currentResults,
} from './state.js';
import { t } from './i18n.js';
import { openLoginModal } from './auth.js';
import { normalizeOrientation, withResultOrientation } from './orientation-state.js';

let dom = {};
let hoverRaycaster = new THREE.Raycaster();
let hoverMouse = new THREE.Vector2();
let hoveredClusterIndex = -1;
let layFaceHoverBound = false;
let layFaceState = 'idle';
let layFaceAbortController = null;
let layFaceEscapeBound = false;

export function initOrientationUI(d) { dom = d; }

// ── Face click handler (set from main.js) ──
window._onFaceClicked = null;

function setLayFaceHint(visible, message = null) {
    const { layFaceHint } = dom;
    if (!layFaceHint) return;
    layFaceHint.textContent = message || t('orientation.pickFaceHint');
    layFaceHint.classList.toggle('hidden', !visible);
}

function setLayFaceButtonLabel(label, { disabled = false, active = false } = {}) {
    const { layFaceBtn } = dom;
    if (!layFaceBtn) return;
    const labelEl = layFaceBtn.querySelector('[data-orientation-label]');
    if (labelEl) labelEl.textContent = label;
    else layFaceBtn.textContent = label;
    layFaceBtn.disabled = disabled;
    layFaceBtn.setAttribute('aria-pressed', String(active));
    layFaceBtn.dataset.state = active ? 'active' : (disabled ? 'loading' : 'idle');
    layFaceBtn.style.opacity = disabled ? '0.72' : '';
    layFaceBtn.style.outline = active ? '2px solid rgba(34, 211, 238, 0.95)' : '';
    layFaceBtn.style.outlineOffset = active ? '2px' : '';
}

function handleLayFaceEscape(event) {
    if (event.key !== 'Escape' || layFaceState === 'idle') return;
    event.preventDefault();
    cleanupLayFaceMode();
}

function bindLayFaceEscape() {
    if (layFaceEscapeBound) return;
    document.addEventListener('keydown', handleLayFaceEscape);
    layFaceEscapeBound = true;
}

function unbindLayFaceEscape() {
    if (!layFaceEscapeBound) return;
    document.removeEventListener('keydown', handleLayFaceEscape);
    layFaceEscapeBound = false;
}

function resetClusterHoverState() {
    if (hoveredClusterIndex >= 0) {
        setClusterHover(hoveredClusterIndex, false);
        hoveredClusterIndex = -1;
        requestRender();
    }
    if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = '';
    }
}

function handleLayFaceHover(event) {
    if (!renderer || !renderer.domElement || !currentMesh || !isClusterMode()) return;
    const rect = renderer.domElement.getBoundingClientRect();
    hoverMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hoverMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hoverRaycaster.setFromCamera(hoverMouse, camera);
    const hit = intersectClusters(hoverRaycaster, currentMesh);
    const nextIndex = hit ? hit.index : -1;
    if (nextIndex === hoveredClusterIndex) {
        if (renderer.domElement) renderer.domElement.style.cursor = hit ? 'pointer' : '';
        return;
    }
    if (hoveredClusterIndex >= 0) {
        setClusterHover(hoveredClusterIndex, false);
    }
    hoveredClusterIndex = nextIndex;
    if (hoveredClusterIndex >= 0) {
        setClusterHover(hoveredClusterIndex, true);
    }
    if (renderer.domElement) renderer.domElement.style.cursor = hit ? 'pointer' : '';
    requestRender();
}

function bindLayFaceHover() {
    if (layFaceHoverBound || !renderer || !renderer.domElement) return;
    renderer.domElement.addEventListener('mousemove', handleLayFaceHover);
    renderer.domElement.addEventListener('mouseleave', resetClusterHoverState);
    layFaceHoverBound = true;
}

function unbindLayFaceHover() {
    if (!layFaceHoverBound || !renderer || !renderer.domElement) return;
    renderer.domElement.removeEventListener('mousemove', handleLayFaceHover);
    renderer.domElement.removeEventListener('mouseleave', resetClusterHoverState);
    layFaceHoverBound = false;
    resetClusterHoverState();
}

export function cleanupLayFaceMode() {
    layFaceAbortController?.abort();
    layFaceAbortController = null;
    layFaceState = 'idle';
    clearClusters();
    unbindLayFaceHover();
    unbindLayFaceEscape();
    setLayFaceHint(false);
    window.__onLayFaceClick = null;
    setLayFaceButtonLabel(t('orientation.autoOrient'));
}

export function syncOrientationFromMesh() {
    if (!currentMesh) return quoteOptions.orientation || { x: 0, y: 0, z: 0 };
    currentMesh.updateMatrixWorld();
    // Lay-on-face applies a quaternion. Reading rotation.x/y/z directly can
    // therefore return the old Euler values even though the model moved.
    const euler = new THREE.Euler().setFromQuaternion(currentMesh.quaternion, 'XYZ');
    const rx = THREE.MathUtils.radToDeg(euler.x) || 0;
    const ry = THREE.MathUtils.radToDeg(euler.y) || 0;
    const rz = THREE.MathUtils.radToDeg(euler.z) || 0;
    quoteOptions.orientation = { x: Math.round(rx), y: Math.round(ry), z: Math.round(rz) };
    const idx = currentResults.findIndex((item) => item && item.filename === currentPreviewFilename);
    if (idx >= 0) currentResults[idx] = withResultOrientation(currentResults[idx], quoteOptions.orientation);
    return quoteOptions.orientation;
}

// ── Center ──
export function centerModel() {
    if (!currentMesh) return;
    currentMesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(currentMesh);
    const center = box.getCenter(new THREE.Vector3());
    const bc = window._BED_CENTER || 128;
    currentMesh.position.x += (bc - center.x);
    currentMesh.position.y += (bc - center.y);
    currentMesh.position.z -= box.min.z;
    currentMesh.updateMatrixWorld(true);
    const newBox = new THREE.Box3().setFromObject(currentMesh);
    const newCenter = newBox.getCenter(new THREE.Vector3());
    controls.target.copy(newCenter);
    controls.update();
}

// ── Reset ──
export function resetOrientationHandler() {
    cleanupLayFaceMode();
    quoteOptions.orientation = { x: 0, y: 0, z: 0 };
    const idx = currentResults.findIndex((item) => item && item.filename === currentPreviewFilename);
    if (idx >= 0) currentResults[idx] = withResultOrientation(currentResults[idx], quoteOptions.orientation);
    // resetOrientation is from viewer.js
    const viewerModule = import('./viewer.js');
    viewerModule.then(m => m.resetOrientation());
}

// ── Lay on Face ──
export async function toggleLayFace() {
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    if (layFaceState === 'loading') return;
    if (layFaceState === 'active') {
        cleanupLayFaceMode();
        return;
    }

    clearClusters();
    layFaceState = 'loading';
    bindLayFaceEscape();
    setLayFaceButtonLabel(t('orientation.analyzing'), { disabled: true });
    setLayFaceHint(true, t('orientation.analyzing'));
    const formData = new FormData();
    formData.append('file', file);
    const controller = new AbortController();
    layFaceAbortController = controller;
    try {
        const resp = await authFetch('/api/orientation/coplanar', { method: 'POST', body: formData, signal: controller.signal });
        if (!resp || resp.status === 401) {
            cleanupLayFaceMode();
            openLoginModal();
            return;
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('orientation.analyzeError'));
        const clusters = data.clusters || [];
        if (clusters.length === 0) {
            cleanupLayFaceMode();
            setLayFaceButtonLabel(t('orientation.noFace'));
            setTimeout(() => setLayFaceButtonLabel(t('orientation.autoOrient')), 2000);
            return;
        }

        window.__onLayFaceClick = (raycaster) => {
            const hit = intersectClusters(raycaster, currentMesh);
            if (!hit) return false;
            const cluster = clusters[hit.index];
            if (!cluster || !cluster.normal) return false;
            cleanupLayFaceMode();
            placeFaceOnBed(currentMesh, cluster.normal, 'Z', cluster.face_vertices);
            syncOrientationFromMesh();
            return true;
        };

        renderClusters(currentMesh, clusters,
            (idx) => {
                const c = clusters[idx];
                if (c && c.normal) {
                    cleanupLayFaceMode();
                    placeFaceOnBed(currentMesh, c.normal, 'Z', c.face_vertices);
                    syncOrientationFromMesh();
                }
            },
            setClusterHover
        );
        bindLayFaceHover();
        layFaceState = 'active';
        setLayFaceHint(true, t('orientation.pickFaceHint'));
        requestRender();
        setLayFaceButtonLabel(t('orientation.exit'), { active: true });
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Lay on Face error:', e);
        cleanupLayFaceMode();
        setLayFaceButtonLabel(e.message || t('orientation.requestFailedLogin'));
        setTimeout(() => setLayFaceButtonLabel(t('orientation.autoOrient')), 3000);
    } finally {
        if (layFaceAbortController === controller) layFaceAbortController = null;
        if (layFaceState === 'loading') {
            layFaceState = 'idle';
            unbindLayFaceEscape();
            setLayFaceHint(false);
            setLayFaceButtonLabel(t('orientation.autoOrient'));
        }
    }
}

// ── Training ──
export async function submitTraining() {
    const { orientTrainBtn, orientTrainStatus } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    const euler = quoteOptions.orientation || { x: 0, y: 0, z: 0 };
    const formData = new FormData();
    formData.append('file', file);
    formData.append('x', String(euler.x || 0));
    formData.append('y', String(euler.y || 0));
    formData.append('z', String(euler.z || 0));

    if (orientTrainBtn) orientTrainBtn.disabled = true;
    if (orientTrainStatus) { orientTrainStatus.textContent = t('orientation.submitting'); orientTrainStatus.classList.remove('hidden'); }
    try {
        const resp = await authFetch('/api/orientation/train', { method: 'POST', body: formData });
        if (resp.status === 401) {
            // close preview, open login
            const { closePreviewModal } = await import('./preview.js');
            closePreviewModal();
            openLoginModal();
            return;
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('orientation.requestFailed'));
        if (orientTrainStatus) { orientTrainStatus.textContent = t('orientation.marked'); orientTrainStatus.className = 'text-xs text-green-600'; }

        // 标记成功 → 用当前朝向立即重新报价
        try {
            const { quoteSingleFileWithOptions } = await import('./quote-api.js');
            const { mergeResultsByFilename } = await import('./quote-api.js');
            const { renderResultsTable, recalcSummaryFromCurrentResults } = await import('./quote-render.js');
            const { ensureThumbnailForFile } = await import('./preview.js');
            const orient = syncOrientationFromMesh() || quoteOptions.orientation || { x: 0, y: 0, z: 0 };
            const ctx = getCurrentPreviewQuoteContext();
            await ensureThumbnailForFile(file, ctx.color, orient);
            const updated = await quoteSingleFileWithOptions(file, {
                material: ctx.material,
                color: ctx.color,
                quantity: ctx.quantity,
                _printer_model: ctx.printerModel,
                _slicer_preset_id: ctx.slicerPresetId,
                orient_x: orient.x,
                orient_y: orient.y,
                orient_z: orient.z,
            });
            mergeResultsByFilename([{ ...updated, euler_angles_deg: updated.euler_angles_deg || { ...orient } }]);
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            if (orientTrainStatus) {
                orientTrainStatus.textContent = t('orientation.markedAndQuoted') || (t('orientation.marked') + ' — 报价已刷新');
            }
        } catch (requoteErr) {
            console.warn('重新报价失败:', requoteErr);
            // 不阻塞，标记本身已成功
        }
    } catch (e) {
        if (orientTrainStatus) { orientTrainStatus.textContent = t('orientation.markFailed', { msg: (e.message || t('common.unknownError')) }); orientTrainStatus.className = 'text-xs text-red-600'; }
    } finally {
        if (orientTrainBtn) orientTrainBtn.disabled = false;
        setTimeout(() => {
            if (orientTrainStatus) { orientTrainStatus.classList.add('hidden'); orientTrainStatus.textContent = ''; }
        }, 5000);
    }
}

// ── Learned Auto Orient ──
export async function learnedAutoOrient() {
    const { orientLearnedBtn } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    if (orientLearnedBtn) orientLearnedBtn.disabled = true;
    // 退出手动摆放模式（如果有）
    cleanupLayFaceMode();

    try {
        // 先清除彩块避免干扰
        clearClusters();

        const formData = new FormData();
        formData.append('file', file);

        const resp = await authFetch('/api/orientation/auto-learned', { method: 'POST', body: formData });
        if (resp.status === 401) {
            const { closePreviewModal } = await import('./preview.js');
            closePreviewModal();
            openLoginModal();
            return;
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '智能摆放请求失败');

        // 应用旋转到模型
        const { applyOrientationRotation, fitCameraToMesh } = await import('./viewer.js');
        // 先重置位置，避免累计偏移
        if (currentMesh.position.z !== 0) {
            currentMesh.position.z = 0;
        }
        applyOrientationRotation(data.euler_angles_deg);
        // 再次确保贴到 Z=0 并适配相机
        currentMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(currentMesh);
        if (box.min.z > 0.1) {
            currentMesh.position.z -= box.min.z;
        }
        requestRender();
        setTimeout(() => fitCameraToMesh(currentMesh), 50);

        // 更新 state
        const { quoteOptions } = await import('./state.js');
        quoteOptions.orientation = normalizeOrientation(data.euler_angles_deg);
        const idx = currentResults.findIndex((item) => item && item.filename === currentPreviewFilename);
        if (idx >= 0) currentResults[idx] = withResultOrientation(currentResults[idx], quoteOptions.orientation);

        if (orientLearnedBtn) {
            const p = data.prusa;
            let label = t('orientation.learnedSuccess');
            if (p && p.filament_cm3) {
                const timeMin = Math.round(p.print_time_s / 60);
                label = `✓ ${p.filament_cm3.toFixed(1)}cm³ / ${timeMin}min`;
            }
            orientLearnedBtn.textContent = label;
            setTimeout(() => {
                orientLearnedBtn.textContent = t('orientation.autoLearn');
            }, 2000);
        }

        console.log('智能摆放完成:', data);
    } catch (e) {
        console.error('智能摆放失败:', e);
        if (orientLearnedBtn) {
            orientLearnedBtn.textContent = t('orientation.learnedFailed');
            setTimeout(() => {
                orientLearnedBtn.textContent = t('orientation.autoLearn');
            }, 3000);
        }
    } finally {
        if (orientLearnedBtn) orientLearnedBtn.disabled = false;
    }
}

// ── 保存当前方向并重新报价 ──
function getCurrentPreviewQuoteContext() {
    const rowData = Array.isArray(currentResults)
        ? currentResults.find((item) => item && item.filename === currentPreviewFilename)
        : null;
    return {
        rowData,
        material: (rowData && rowData.material) || quoteOptions.material,
        color: (rowData && rowData.color) || quoteOptions.color,
        quantity: (rowData && rowData.quantity) || quoteOptions.quantity || 1,
        printerModel: (rowData && rowData._printer_model) || '',
        slicerPresetId: (rowData && rowData._slicer_preset_id !== undefined)
            ? rowData._slicer_preset_id
            : null,
    };
}

export async function saveOrientationAndRequote() {
    const { orientSaveBtn } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    const orient = syncOrientationFromMesh() || quoteOptions.orientation || { x: 0, y: 0, z: 0 };
    if (orientSaveBtn) {
        orientSaveBtn.disabled = true;
        orientSaveBtn.textContent = 'Saving quote...';
    }

    try {
        const { quoteSingleFileWithOptions, mergeResultsByFilename } = await import('./quote-api.js');
        const { renderResultsTable, recalcSummaryFromCurrentResults } = await import('./quote-render.js');
        const { ensureThumbnailForFile, closePreviewModal } = await import('./preview.js');

        const ctx = getCurrentPreviewQuoteContext();
        await ensureThumbnailForFile(file, ctx.color, orient);

        const updated = await quoteSingleFileWithOptions(file, {
            material: ctx.material,
            color: ctx.color,
            quantity: ctx.quantity,
            _printer_model: ctx.printerModel,
            _slicer_preset_id: ctx.slicerPresetId,
            orient_x: orient.x,
            orient_y: orient.y,
            orient_z: orient.z,
        });

        // The quote response is authoritative for time/cost. Attach the
        // selected orientation after spreading it so the refreshed row keeps
        // the newly sliced values while retaining the viewer state.
        mergeResultsByFilename([withResultOrientation({
            ...updated,
            material: ctx.material,
            color: ctx.color,
            quantity: ctx.quantity,
            _printer_model: ctx.printerModel || updated._printer_model,
            _slicer_preset_id: ctx.slicerPresetId !== null ? ctx.slicerPresetId : updated._slicer_preset_id,
        }, orient)]);
        renderResultsTable();
        recalcSummaryFromCurrentResults();

        if (orientSaveBtn) {
            orientSaveBtn.textContent = 'Saved ?';
            orientSaveBtn.disabled = false;
        }

        closePreviewModal();
        const quoteTable = document.getElementById('results-table');
        if (quoteTable) {
            setTimeout(() => quoteTable.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        }
    } catch (e) {
        console.error('Failed to save orientation:', e);
        if (orientSaveBtn) {
            orientSaveBtn.textContent = 'Save failed';
            setTimeout(() => {
                orientSaveBtn.textContent = 'Save orientation and re-quote';
            }, 3000);
        }
    } finally {
        if (orientSaveBtn) orientSaveBtn.disabled = false;
    }
}
