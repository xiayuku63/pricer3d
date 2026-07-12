// ── Orientation UI: layface, orientation controls, training ──
import * as THREE from 'three';
import {
    currentMesh, controls, requestRender,
} from './viewer.js';
import {
    renderClusters, clearClusters, setClusterHover, intersectClusters,
    placeFaceOnBed, isClusterMode,
    showPlacementPlane, hidePlacementPlane,
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
    hidePlacementPlane();
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
            clearClusters();  // 先移除彩块，避免污染包围盒计算
            placeFaceOnBed(currentMesh, cluster.normal, 'Z');
            syncOrientationFromMesh();
            clearClusters();
            showPlacementPlane(currentMesh, cluster.face_vertices);
            window.__onLayFaceClick = null;
            if (layFaceBtn) layFaceBtn.textContent = t('orientation.autoOrient');
            return true;
        };

        renderClusters(currentMesh, clusters,
            (idx) => {
                const c = clusters[idx];
                if (c && c.normal) {
                    clearClusters();  // 先移除彩块，避免污染包围盒计算
                    placeFaceOnBed(currentMesh, c.normal, 'Z');
                    syncOrientationFromMesh();
                    clearClusters();
                    showPlacementPlane(currentMesh, c.face_vertices);
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

// ── Learned Auto Orient ──
export async function learnedAutoOrient() {
    const { orientLearnedBtn } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    if (orientLearnedBtn) orientLearnedBtn.disabled = true;
    // 退出手动摆放模式（如果有）
    clearClusters();
    window.__onLayFaceClick = null;

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
        quoteOptions.orientation = data.euler_angles_deg;

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
export async function saveOrientationAndRequote() {
    const { orientSaveBtn } = dom;
    if (!currentPreviewFilename) return;
    const file = selectedFilesMap.get(currentPreviewFilename);
    if (!file) return;

    const orient = quoteOptions.orientation || { x: 0, y: 0, z: 0 };
    if (orientSaveBtn) {
        orientSaveBtn.disabled = true;
        orientSaveBtn.textContent = '报价中...';
    }

    try {
        const { quoteSingleFileWithOptions } = await import('./quote-api.js');
        const { mergeResultsByFilename } = await import('./quote-api.js');
        const { renderResultsTable, recalcSummaryFromCurrentResults } = await import('./quote-render.js');
        const { ensureThumbnailForFile } = await import('./preview.js');

        const orient = quoteOptions.orientation || { x: 0, y: 0, z: 0 };

        await ensureThumbnailForFile(file, quoteOptions.color, orient);

        const updated = await quoteSingleFileWithOptions(file, {
            material: quoteOptions.material,
            color: quoteOptions.color,
            quantity: quoteOptions.quantity || 1,
            orient_x: orient.x,
            orient_y: orient.y,
            orient_z: orient.z,
        });

        mergeResultsByFilename([updated]);
        renderResultsTable();
        recalcSummaryFromCurrentResults();

        // 先更新按钮状态，再关闭弹窗
        if (orientSaveBtn) {
            orientSaveBtn.textContent = '已保存 ✓';
            orientSaveBtn.disabled = false;
        }

        // 关闭预览弹窗，回到报价结果
        const { closePreviewModal } = await import('./preview.js');
        closePreviewModal();
        // 滚动到报价表格区域
        const quoteTable = document.getElementById('results-table');
        if (quoteTable) {
            setTimeout(() => quoteTable.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        }
    } catch (e) {
        console.error('保存方向失败:', e);
        if (orientSaveBtn) {
            orientSaveBtn.textContent = '保存失败';
            setTimeout(() => {
                orientSaveBtn.textContent = '保存当前方向并报价';
            }, 3000);
        }
    } finally {
        if (orientSaveBtn) orientSaveBtn.disabled = false;
    }
}
