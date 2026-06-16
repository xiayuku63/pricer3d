// ── ZIP Upload Processing ──
// Handles ZIP file parsing, SSE progress streaming, and result integration.
// Extracted from main.js to reduce orchestrator size.

import {
    authToken,
    quoteOptions, selectedFilesMap, thumbnailMap,
    currentResults, setCurrentResults,
    MATERIAL_OPTIONS,
    authFetch, escapeHtml,
    getActivePrinterCompoundId,
    setPendingQuoteFiles,
    getColorsForMaterial, pickAllowedColor,
} from './state.js';

import {
    validateFiles, renderFilePreviewChips,
    showToast, showProgress, updateProgress, showProgressSuccess, showProgressError,
    hideProgress,
} from './upload.js';

import { buildThumbnails } from './preview.js';
import { t } from './i18n.js';
import { mergeResultsByFilename, quoteSelectedFilesWithProgress, renderResultsTable, recalcSummaryFromCurrentResults } from './quote.js';
import { openLoginModal } from './auth.js';

let dom = {};
let _getMaxFiles = () => 5;

/**
 * Initialize ZIP upload module with DOM refs and max-files getter.
 * @param {object} d - DOM refs object (needs: fileInput, fileNameDisplay, errorContainer, errorMsg)
 * @param {Function} getMaxFiles - returns current max file count (Infinity for members)
 */
export function initZipUpload(d, getMaxFiles) {
    dom = d;
    if (getMaxFiles) _getMaxFiles = getMaxFiles;
}

/**
 * Handle file selection: validate, detect ZIP vs model files, dispatch accordingly.
 * This is the main entry point called by file input change and drag-drop.
 * @param {File[]} newFiles
 */
export async function handleFileSelection(newFiles) {
    if (!newFiles || newFiles.length === 0) return;

    // Validate files
    const { validFiles, invalidFiles, errors } = validateFiles(newFiles, selectedFilesMap, _getMaxFiles());

    // Show validation errors as toasts
    if (errors.length > 0) {
        errors.forEach(err => {
            if (err.type === 'count') {
                showToast(err.message, 'error', 5000);
            } else if (err.type === 'files') {
                err.invalidFiles.forEach(inf => {
                    showToast(`${inf.file.name}: ${inf.reason}`, 'warning', 5000);
                });
            }
        });
    }

    if (validFiles.length === 0) return;

    _hideError();

    // Check if any file is a ZIP — route to /api/quote/zip
    const zipFiles = validFiles.filter(function(f) { return f.name.toLowerCase().endsWith('.zip'); });
    const modelFiles = validFiles.filter(function(f) { return !f.name.toLowerCase().endsWith('.zip'); });

    if (zipFiles.length > 0) {
        await _handleZipUpload(zipFiles, modelFiles, validFiles);
        return;
    }

    // Normal model file upload (enhanced flow with progress)
    await _handleModelUpload(modelFiles);
}

// ── Internal helpers ──

function _hideError() {
    if (dom.errorContainer) dom.errorContainer.classList.add('hidden');
}

/**
 * Process ZIP file upload with SSE streaming progress.
 */
async function _handleZipUpload(zipFiles, modelFiles, validFiles) {
    if (zipFiles.length > 1 && modelFiles.length === 0) {
        showToast('一次只能上传一个 ZIP 文件', 'error');
        return;
    }

    if (!authToken) {
        setPendingQuoteFiles(validFiles);
        dom.fileNameDisplay.textContent = '当前列表共 ' + selectedFilesMap.size + ' 个文件，请登录后继续报价';
        showToast('请先登录后再上传报价', 'warning');
        openLoginModal();
        return;
    }

    dom.fileNameDisplay.textContent = '正在解析 ZIP 文件中的清单与模型...';
    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    showProgress('解析 ZIP 文件...');

    // ── AbortController for ZIP cancellation ──
    let zipAbortController = new AbortController();
    const zipCancelBtn = document.getElementById('zip-cancel-btn');
    const zipCancelBtnText = document.getElementById('zip-cancel-btn-text');
    if (zipCancelBtn) {
        zipCancelBtn.classList.remove('hidden');
        zipCancelBtnText.textContent = t('quote.cancelProcessing');
        zipCancelBtn.onclick = () => { zipAbortController.abort(); };
    }

    try {
        const zipFormData = new FormData();
        zipFormData.append('file', zipFiles[0]);
        zipFormData.append('material', quoteOptions.material);
        zipFormData.append('color', quoteOptions.color);
        zipFormData.append('quantity', String(quoteOptions.quantity));

        const zipPrinterModel = getActivePrinterCompoundId();
        if (zipPrinterModel) zipFormData.append('printer_model', zipPrinterModel);
        const zipPresetEl = document.getElementById('batch-slicer-preset');
        const zipPresetId = (zipPresetEl && zipPresetEl.value) ? Number(zipPresetEl.value) : null;
        if (zipPresetId) zipFormData.append('slicer_preset_id', String(zipPresetId));

        const resp = await fetch('/api/quote/zip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: zipFormData,
            signal: zipAbortController.signal,
        });

        if (!resp.ok) {
            let errMsg = 'ZIP 上传失败';
            try {
                const errData = await resp.json();
                errMsg = errData.detail || errMsg;
            } catch (_) {}
            throw new Error(errMsg);
        }

        // Stream SSE events for real-time progress
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let zipData = null;

        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            while (buffer.includes('\n\n')) {
                const idx = buffer.indexOf('\n\n');
                const line = buffer.substring(0, idx).replace('data: ', '');
                buffer = buffer.substring(idx + 2);
                let event;
                try { event = JSON.parse(line); } catch (_) { continue; }
                if (event.type === 'progress') {
                    const pct = Math.round((event.current / event.total) * 100);
                    updateProgress(pct, event.filename || '');
                    const labelEl = document.getElementById('upload-progress-label');
                    if (labelEl) labelEl.textContent = t('quote.zipProgress', { current: event.current, total: event.total });
                    const detailEl = document.getElementById('upload-progress-detail');
                    if (detailEl) detailEl.textContent = event.filename || '';
                }
                if (event.type === 'done') {
                    const { type, ...rest } = event;
                    zipData = rest;
                }
                if (event.type === 'cancelled') {
                    throw new DOMException('User cancelled ZIP processing', 'AbortError');
                }
            }
        }

        if (!zipData) throw new Error('ZIP 处理失败：未收到完成事件');

        mergeResultsByFilename(zipData.results || []);
        renderResultsTable();
        recalcSummaryFromCurrentResults();

        // Fetch model files for preview thumbnails
        const zipModelFiles = [];
        for (let ri = 0; ri < (zipData.results || []).length; ri++) {
            const r = zipData.results[ri];
            if (r.checklist_file_path) {
                try {
                    const fileResp = await authFetch('/api/quote/zip/file?file_path=' + encodeURIComponent(r.checklist_file_path));
                    if (fileResp.ok) {
                        const blob = await fileResp.blob();
                        const modelFile = new File([blob], r.filename, { type: 'application/octet-stream' });
                        selectedFilesMap.set(r.filename, modelFile);
                        zipModelFiles.push(modelFile);
                    }
                } catch (fe) {
                    console.warn('Failed to fetch model file for preview:', r.filename, fe);
                }
            }
        }
        if (zipModelFiles.length > 0) {
            const colorByFilename = {};
            const mergedForColor = (typeof currentResults !== 'undefined') ? currentResults : (zipData.results || []);
            mergedForColor.forEach(r => {
                if (r && r.filename && r._checklist_source && r._checklist_source.color) {
                    colorByFilename[r.filename] = r._checklist_source.color;
                }
            });
            await buildThumbnails(zipModelFiles, colorByFilename);
            renderResultsTable();
        }

        // Show match status
        if (zipData.match_status) {
            _showMatchStatus(zipData.match_status, zipData.results);
        } else {
            dom.fileNameDisplay.textContent = 'ZIP 报价完成，共 ' + (zipData.results || []).length + ' 个文件';
            showToast(`ZIP 处理完成，共 ${(zipData.results || []).length} 个文件`, 'success');
        }

        showProgressSuccess('ZIP 解析完成');
        hideProgress();
        if (zipCancelBtn) zipCancelBtn.classList.add('hidden');

        // Process any remaining model files
        if (modelFiles.length > 0) {
            modelFiles.forEach(function(f) { selectedFilesMap.set(f.name, f); });
            await buildThumbnails(modelFiles);
            await quoteSelectedFilesWithProgress(modelFiles);
        }
    } catch (err) {
        if (zipCancelBtn) zipCancelBtn.classList.add('hidden');
        if (err.name === 'AbortError') {
            hideProgress();
            showToast(t('quote.processingCancelled'), 'warning');
            dom.fileNameDisplay.textContent = t('quote.processingCancelled');
        } else {
            showProgressError(err.message || 'ZIP 解析失败');
            hideProgress();
            showToast(err.message || 'ZIP 解析失败', 'error');
            dom.fileNameDisplay.textContent = 'ZIP 文件处理失败';
        }
    }
}

/**
 * Process normal (non-ZIP) model file upload.
 */
async function _handleModelUpload(modelFiles) {
    modelFiles.forEach((file) => selectedFilesMap.set(file.name, file));
    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');

    renderFilePreviewChips(modelFiles);

    if (!authToken) {
        setPendingQuoteFiles(modelFiles);
        dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，请登录后继续为新增 ${modelFiles.length} 个文件自动报价`;
        showToast('请先登录后再上传报价', 'warning');
        openLoginModal();
        return;
    }

    dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，正在为新增 ${modelFiles.length} 个文件生成静态图与自动报价...`;
    showToast(`开始处理 ${modelFiles.length} 个文件...`, 'info', 2000);

    try {
        showProgress(`生成模型预览 (${modelFiles.length} 个文件)...`);
        await buildThumbnails(modelFiles);
        renderFilePreviewChips(modelFiles);
        await quoteSelectedFilesWithProgress(modelFiles);
        dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${modelFiles.length} 个文件报价完成`;
        renderFilePreviewChips([]);
    } catch (err) {
        showProgressError(err.message || '报价失败');
        hideProgress();
        showToast(err.message || '报价失败，请重试', 'error');
        dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${modelFiles.length} 个文件自动报价失败`;
    }
}

/**
 * Display match status badges for ZIP results.
 */
function _showMatchStatus(ms, results) {
    const statusClass = ms.mode === 'all' ? 'text-green-700 bg-green-50 border-green-300'
        : ms.mode === 'partial' ? 'text-amber-700 bg-amber-50 border-amber-300'
        : 'text-red-700 bg-red-50 border-red-300';
    let statusHtml = '<span class="inline-block px-2 py-0.5 rounded border text-xs ' + statusClass + '">' + escapeHtml(ms.message) + '</span>';
    if (ms.warnings && ms.warnings.length > 0) {
        const warningsByFile = {};
        ms.warnings.forEach(w => {
            const fn = w.filename || '';
            if (!warningsByFile[fn]) warningsByFile[fn] = [];
            warningsByFile[fn].push(w);
        });
        const mergedResults = (typeof currentResults !== 'undefined') ? currentResults : (results || []);
        mergedResults.forEach(r => {
            if (!r || !r.filename) return;
            const stem = r.filename.replace(/\.[^.]+$/, '');
            if (warningsByFile[stem]) {
                r._warnings = warningsByFile[stem];
            }
        });
        const summaryMsg = t('quote.warningsSummary', { count: ms.warnings.length });
        statusHtml += ' <span class="inline-block ml-1 px-2 py-0.5 rounded border text-xs text-amber-700 bg-amber-50 border-amber-300">\u26A0\uFE0F ' + escapeHtml(summaryMsg) + '</span>';
        showToast(summaryMsg, 'warning');
    }
    dom.fileNameDisplay.innerHTML = statusHtml;
    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    showToast(ms.message, ms.mode === 'all' ? 'success' : 'warning');
    if (ms.warnings && ms.warnings.length > 0) {
        renderResultsTable();
    }
}
