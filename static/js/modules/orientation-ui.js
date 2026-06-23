// ── Orientation UI: layface, orientation controls, training ──
import * as THREE from 'three';
import {
    currentMesh, controls, requestRender,
} from './viewer.js';
import {
    renderClusters, clearClusters, setClusterHover, intersectClusters,
    placeFaceOnBed, isClusterMode,
} from './layface.js';
import {
    authToken, authFetch, quoteOptions,
    selectedFilesMap, currentPreviewFilename,
} from './state.js';
import { t } from './i18n.js';
import { openLoginModal } from './auth.js';

let dom = {};

export function initOrientationUI(d) { dom = d; }

// ── Face click handler (set from main.js) ──
window._onFaceClicked = null;

export function syncOrientationFromMesh() {
    if (!currentMesh) return;
    currentMesh.updateMatrixWorld();
    const rx = THREE.MathUtils.radToDeg(currentMesh.rotation.x) || 0;
    const ry = THREE.MathUtils.radToDeg(currentMesh.rotation.y) || 0;
    const rz = THREE.MathUtils.radToDeg(currentMesh.rotation.z) || 0;
    quoteOptions.orientation = { x: Math.round(rx), y: Math.round(ry), z: Math.round(rz) };
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
    clearClusters();
    window.__onLayFaceClick = null;
    const { layFaceBtn } = dom;
    if (layFaceBtn) layFaceBtn.textContent = t('orientation.autoOrient');
    quoteOptions.orientation = { x: 0, y: 0, z: 0 };
    // resetOrientation is from viewer.js
    const viewerModule = import('./viewer.js');
    viewerModule.then(m => m.resetOrientation());
}

// ── Lay on Face ──
export async function toggleLayFace() {
    const { layFaceBtn } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    if (layFaceBtn && layFaceBtn.textContent.includes(t('orientation.exit').replace('🔙 ', ''))) {
        clearClusters();
        window.__onLayFaceClick = null;
        layFaceBtn.textContent = t('orientation.autoOrient');
        return;
    }

    clearClusters();
    const formData = new FormData();
    formData.append('file', file);
    try {
        const resp = await authFetch('/api/orientation/coplanar', { method: 'POST', body: formData });
        if (!resp || resp.status === 401) { openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('orientation.analyzeError'));
        const clusters = data.clusters || [];
        if (clusters.length === 0) {
            if (layFaceBtn) { layFaceBtn.textContent = t('orientation.noFace'); setTimeout(() => { layFaceBtn.textContent = t('orientation.autoOrient'); }, 2000); }
            return;
        }

        window.__onLayFaceClick = (raycaster) => {
            const hit = intersectClusters(raycaster);
            if (!hit) return false;
            const cluster = clusters[hit.index];
            if (!cluster || !cluster.normal) return false;
            placeFaceOnBed(currentMesh, cluster.normal, 'Z');
            // Force re-center + re-render
            centerModel();
            requestRender();
            syncOrientationFromMesh();
            clearClusters();
            window.__onLayFaceClick = null;
            if (layFaceBtn) layFaceBtn.textContent = t('orientation.autoOrient');
            return true;
        };

        renderClusters(currentMesh, clusters,
            (idx) => {
                const c = clusters[idx];
                if (c && c.normal) {
                    placeFaceOnBed(currentMesh, c.normal, 'Z');
                    centerModel();
                    requestRender();
                    syncOrientationFromMesh();
                    clearClusters();
                    window.__onLayFaceClick = null;
                    if (layFaceBtn) layFaceBtn.textContent = t('orientation.autoOrient');
                }
            },
            setClusterHover
        );
        requestRender();
        if (layFaceBtn) layFaceBtn.textContent = t('orientation.exit');
    } catch (e) {
        console.error('Lay on Face error:', e);
        if (layFaceBtn) { layFaceBtn.textContent = e.message || t('orientation.requestFailedLogin'); setTimeout(() => { layFaceBtn.textContent = t('orientation.autoOrient'); }, 3000); }
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
            await ensureThumbnailForFile(file, quoteOptions.color);
            const updated = await quoteSingleFileWithOptions(file, {
                material: quoteOptions.material,
                color: quoteOptions.color,
                quantity: quoteOptions.quantity || 1,
            });
            mergeResultsByFilename([updated]);
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
