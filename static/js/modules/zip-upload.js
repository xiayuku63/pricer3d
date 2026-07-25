// ── ZIP Upload Processing ──
// Handles ZIP file parsing, SSE progress streaming, and result integration.
// Extracted from main.js to reduce orchestrator size.

import {
    authToken,
    quoteOptions, selectedFilesMap, thumbnailMap,
    currentResults, setCurrentResults,
    MATERIAL_OPTIONS,
    authFetch, escapeHtml, colorToObj,
    getActivePrinterCompoundId,
    setPendingQuoteFiles,
    getColorsForMaterial, pickAllowedColor,
    loadFrontSettingsSnapshot,
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
import { resolveUploadDefaults } from './upload-defaults.js';

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

const ZIP_NEW_COLOR_VALUE = '__zip_new_color__';

function _colorHex(value) {
    const hex = String(colorToObj(value)?.hex || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '';
}

function _zipColorPalette() {
    const palette = [];
    const seen = new Set();
    // The selectable palette comes only from colors already stored in the
    // user's material library. Do not add a second hard-coded color catalog.
    for (const material of MATERIAL_OPTIONS) {
        const color = colorToObj(material?.color);
        if (!color) continue;
        const hex = _colorHex(color);
        const name = String(color.name || hex || '').trim();
        const key = (hex || name).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        palette.push({ name: name || hex, hex: hex || '#808080' });
    }
    return palette;
}

function _zipChecklistColors(previewData) {
    // The preview endpoint includes every color from the checklist, not just
    // rows that happened to match a model. All checklist colors must be
    // explicitly mapped before slicing starts.
    if (Array.isArray(previewData?.checklist_colors)) {
        return previewData.checklist_colors
            .map((item) => ({
                source: String(item?.source || '').trim(),
                count: Number(item?.count || 0),
            }))
            .filter((item) => item.source);
    }

    const colors = new Map();
    for (const matched of previewData?.matched || []) {
        const raw = String(matched?.checklist?.color || '').trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const entry = colors.get(key) || { source: raw, count: 0 };
        entry.count += 1;
        colors.set(key, entry);
    }
    return [...colors.values()];
}

function _renderZipColorMapping(previewData) {
    const section = document.getElementById('zip-preview-color-mapping');
    const body = document.getElementById('zip-preview-color-mapping-body');
    if (!section || !body) return;

    const sourceColors = _zipChecklistColors(previewData);
    if (!sourceColors.length) {
        section.classList.add('hidden');
        body.innerHTML = '';
        return;
    }

    const palette = _zipColorPalette();
    // Keep a copy outside the DOM as a fallback for native select/color-picker
    // interactions that can replace or blur the row before confirmation.
    previewData._colorMapping = {};
    body.innerHTML = sourceColors.map(({ source, count }) => {
        const sourceHex = _colorHex(source);
        const customHex = sourceHex || '#000000';
        const options = palette.map((color) =>
            `<option value="${escapeHtml(color.hex)}" data-color-name="${escapeHtml(color.name)}"></option>`
        ).join('');
        const customOption = `<option value="${ZIP_NEW_COLOR_VALUE}"></option>`;
        const swatches = palette.map((color) =>
            `<button type="button" class="zip-color-option flex items-center justify-center w-8 h-8 rounded-md" data-color-value="${escapeHtml(color.hex)}" title="\u989c\u8272\u9009\u9879" aria-label="\u989c\u8272\u9009\u9879">
                <span class="w-5 h-5 rounded-sm border" style="background:${escapeHtml(color.hex)};border-color:var(--color-border-input);"></span>
            </button>`
        ).join('');
        const sourceStyle = sourceHex ? `background:${sourceHex};` : 'background:var(--color-neutral-300);';
        return `<div class="zip-color-mapping-row rounded-lg px-3 py-2" data-source-color="${escapeHtml(source)}">
            <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                <div class="flex items-center gap-2 min-w-0 sm:w-44 flex-shrink-0">
                    <span class="w-5 h-5 rounded-sm border flex-shrink-0" style="${sourceStyle}border-color:var(--color-border-input);" title="${escapeHtml(source)}" aria-label="${escapeHtml(source)}"></span>
                    <span class="text-xs tw-text-strong truncate max-w-24" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
                    <span class="text-[10px] tw-text-muted flex-shrink-0">\u00D7${count}</span>
                </div>
                <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="text-[11px] tw-text-muted whitespace-nowrap">\u624B\u52A8\u9009\u62E9</span>
                    <div class="zip-color-picker relative flex-1 min-w-0">
                        <select class="zip-color-target hidden">
                            <option value="" selected disabled></option>${options}${customOption}
                        </select>
                        <button type="button" class="zip-color-target-trigger tw-input w-full flex items-center justify-between px-2 py-1.5" aria-label="\u9009\u62E9\u76EE\u6807\u989C\u8272" aria-expanded="false">
                            <span class="zip-color-target-swatch w-5 h-5 rounded-sm border flex-shrink-0" style="background:var(--color-neutral-200);border-color:var(--color-border-input);"></span>
                            <svg class="w-4 h-4 tw-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        <div class="zip-color-options hidden absolute right-0 top-full mt-1 z-30 p-2 rounded-lg shadow-lg grid grid-cols-5 gap-1" style="background:var(--color-surface);border:1px solid var(--color-border-strong);min-width:12rem;">
                            ${swatches}
                            <button type="button" class="zip-color-option zip-color-new-option col-span-5 flex items-center justify-center h-8 rounded-md text-xs tw-text-muted" data-color-value="${ZIP_NEW_COLOR_VALUE}">\uFF0B\u65B0\u589E\u989C\u8272</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="zip-color-custom hidden flex items-center gap-2 mt-2 sm:pl-44">
                <span class="text-[11px] tw-text-muted whitespace-nowrap">\u65B0\u589E\u989C\u8272</span>
                <input type="color" class="zip-color-custom-hex w-8 h-8 p-0 border rounded cursor-pointer flex-shrink-0" value="${customHex}" aria-label="\u65B0\u589E\u989C\u8272">
                <input type="text" class="zip-color-custom-name tw-input text-xs px-2 py-1.5 flex-1 min-w-0" placeholder="\u989C\u8272\u540D\u79F0\uFF08\u53EF\u9009\uFF09" maxlength="40">
            </div>
        </div>`;
    }).join('');
    section.classList.remove('hidden');

    body.querySelectorAll('.zip-color-mapping-row').forEach((row) => {
        const select = row.querySelector('.zip-color-target');
        const trigger = row.querySelector('.zip-color-target-trigger');
        const optionsPanel = row.querySelector('.zip-color-options');
        const custom = row.querySelector('.zip-color-custom');
        const swatch = row.querySelector('.zip-color-target-swatch');
        const customHex = row.querySelector('.zip-color-custom-hex');
        const customName = row.querySelector('.zip-color-custom-name');
        if (!select || !trigger || !optionsPanel) return;

        const sync = () => {
            const isCustom = select.value === ZIP_NEW_COLOR_VALUE;
            custom?.classList.toggle('hidden', !isCustom);
            const hex = isCustom ? customHex?.value : select.value;
            if (swatch) swatch.style.background = /^#[0-9a-fA-F]{6}$/.test(hex || '')
                ? hex
                : 'var(--color-neutral-200)';
            if (!row || !hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
                if (row) delete previewData._colorMapping[row.getAttribute('data-source-color') || ''];
                return;
            }
            const selected = select.selectedOptions?.[0];
            const name = isCustom
                ? (customName?.value.trim() || hex)
                : (selected?.dataset?.colorName || hex);
            previewData._colorMapping[row.getAttribute('data-source-color') || ''] = {
                name,
                hex: hex.toLowerCase(),
            };
            row.classList.remove('ring-2', 'ring-red-400');
        };

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            body.querySelectorAll('.zip-color-options').forEach((panel) => {
                if (panel !== optionsPanel) panel.classList.add('hidden');
            });
            const isHidden = optionsPanel.classList.toggle('hidden');
            trigger.setAttribute('aria-expanded', String(!isHidden));
        });
        optionsPanel.querySelectorAll('.zip-color-option').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                select.value = option.getAttribute('data-color-value') || '';
                optionsPanel.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
        select.addEventListener('change', sync);
        customHex?.addEventListener('input', sync);
        customHex?.addEventListener('change', sync);
        customName?.addEventListener('input', sync);
        sync();
    });
}

function _collectZipColorMapping(previewData) {
    const body = document.getElementById('zip-preview-color-mapping-body');
    const mapping = { ...(previewData?._colorMapping || {}) };
    if (!body) return mapping;
    body.querySelectorAll('.zip-color-mapping-row').forEach((row) => {
        const source = row.getAttribute('data-source-color') || '';
        const select = row.querySelector('.zip-color-target');
        if (!source || !select) return;
        const isCustom = select.value === ZIP_NEW_COLOR_VALUE;
        const customHex = row.querySelector('.zip-color-custom-hex')?.value || '';
        const customName = row.querySelector('.zip-color-custom-name')?.value.trim() || '';
        const hex = isCustom ? customHex : select.value;
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const selected = select.selectedOptions?.[0];
        const name = isCustom ? (customName || hex) : (selected?.dataset?.colorName || hex);
        mapping[source] = { name, hex: hex.toLowerCase() };
    });
    return mapping;
}

/**
 * Process ZIP file upload with SSE streaming progress.
 * Two-step flow: preview first, then confirm to slice.
 */
async function _handleZipUpload(zipFiles, modelFiles, validFiles) {
    if (zipFiles.length > 1 && modelFiles.length === 0) {
        showToast(t('zipPreview.oneZipOnly') || '一次只能上传一个 ZIP 文件', 'error');
        return;
    }

    if (!authToken) {
        setPendingQuoteFiles(validFiles);
        dom.fileNameDisplay.textContent = '当前列表共 ' + selectedFilesMap.size + ' 个文件，请登录后继续报价';
        showToast('请先登录后再上传报价', 'warning');
        openLoginModal();
        return;
    }

    dom.fileNameDisplay.textContent = t('zipPreview.parsing') || '正在解析 ZIP 文件中的清单与模型...';
    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    showProgress(t('zipPreview.parsing') || '解析 ZIP 文件...');

    try {
        // ── Step 1: Call preview endpoint ──
        const previewFormData = new FormData();
        previewFormData.append('file', zipFiles[0]);

        const previewResp = await fetch('/api/quote/zip/preview', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: previewFormData,
        });

        if (!previewResp.ok) {
            let errMsg = 'ZIP 上传失败';
            try {
                const errData = await previewResp.json();
                errMsg = errData.message || errData.detail || errData.error || errMsg;
            } catch (_) {}
            throw new Error(errMsg);
        }

        const previewData = await previewResp.json();
        updateProgress(100, '清单与模型解析完成');

        // ── Step 2: Show preview modal and wait for user confirmation ──
        const previewChoice = await _showZipPreviewModal(previewData);
        if (!previewChoice?.confirmed) {
            hideProgress();
            dom.fileNameDisplay.textContent = t('zipPreview.cancelled') || '已取消 ZIP 切片';
            dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
            showToast(t('zipPreview.cancelled') || '已取消', 'info');
            return;
        }

        // ── Step 3: Confirm → call slice endpoint with session_id ──
        showProgress(t('zipPreview.slicing') || '开始切片...');

        // AbortController for cancellation
        let zipAbortController = new AbortController();
        const zipCancelBtn = document.getElementById('zip-cancel-btn');
        const zipCancelBtnText = document.getElementById('zip-cancel-btn-text');
        if (zipCancelBtn) {
            zipCancelBtn.classList.remove('hidden');
            zipCancelBtnText.textContent = t('quote.cancelProcessing');
            zipCancelBtn.onclick = () => { zipAbortController.abort(); };
        }

        const uploadDefaults = resolveUploadDefaults({
            root: document,
            snapshot: loadFrontSettingsSnapshot() || {},
            fallback: {
                printer_model: getActivePrinterCompoundId(),
                slicer_preset_id: quoteOptions.slicer_preset_id,
                brand: quoteOptions.brand,
                material: quoteOptions.material,
                color: quoteOptions.color,
            },
        });
        const sliceFormData = new FormData();
        sliceFormData.append('session_id', previewData.session_id);
        sliceFormData.append('material', uploadDefaults.material);
        sliceFormData.append('color', uploadDefaults.color);
        sliceFormData.append('quantity', String(quoteOptions.quantity));
        const colorMapping = previewChoice.colorMapping || {};
        if (Object.keys(colorMapping).length > 0) {
            sliceFormData.append('color_mapping', JSON.stringify(colorMapping));
        }

        if (uploadDefaults.printer_model) sliceFormData.append('printer_model', uploadDefaults.printer_model);
        if (uploadDefaults.slicer_preset_id !== null) {
            sliceFormData.append('slicer_preset_id', String(uploadDefaults.slicer_preset_id));
        }
        const zipLayerEl = document.getElementById('gen-layer-height');
        const zipWallEl = document.getElementById('gen-wall-count');
        const zipInfillEl = document.getElementById('gen-infill');
        if (zipLayerEl && zipLayerEl.value) sliceFormData.append('layer_height', zipLayerEl.value);
        if (zipWallEl && zipWallEl.value) sliceFormData.append('wall_count', zipWallEl.value);
        if (zipInfillEl && zipInfillEl.value) sliceFormData.append('infill', zipInfillEl.value);

        const resp = await fetch('/api/quote/zip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: sliceFormData,
            signal: zipAbortController.signal,
        });

        if (!resp.ok) {
            let errMsg = 'ZIP 切片失败';
            try {
                const errData = await resp.json();
                errMsg = errData.message || errData.detail || errData.error || errMsg;
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
                const rawLine = buffer.substring(0, idx);
                const line = rawLine.startsWith('data: ') ? rawLine.slice(6) : rawLine;
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

        (zipData.created_materials || []).forEach((material) => {
            if (!material || !material.name) return;
            const color = material.color || {};
            const colorKey = String(color.hex || color.name || '').trim().toLowerCase();
            const exists = MATERIAL_OPTIONS.some((existing) => {
                const existingColor = existing?.color || {};
                const existingColorKey = String(existingColor.hex || existingColor.name || '').trim().toLowerCase();
                return String(existing?.brand || 'Generic') === String(material.brand || 'Generic')
                    && String(existing?.name || '') === String(material.name)
                    && existingColorKey === colorKey;
            });
            if (!exists) MATERIAL_OPTIONS.push(material);
        });

        mergeResultsByFilename(zipData.results || []);
        renderResultsTable();
        recalcSummaryFromCurrentResults();

        // Fetch model files for preview thumbnails
        const zipModelFiles = [];
        for (let ri = 0; ri < (zipData.results || []).length; ri++) {
            const r = zipData.results[ri];
            const modelPath = r.checklist_file_path || r.model_file_path;
            if (modelPath) {
                try {
                    const fileResp = await authFetch('/api/quote/zip/file?file_path=' + encodeURIComponent(modelPath));
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
                if (r && r.filename && r.color) {
                    colorByFilename[r.filename] = r.color;
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
        await new Promise(r => setTimeout(r, 600)); // 最小显示时间
        hideProgress();
        if (zipCancelBtn) zipCancelBtn.classList.add('hidden');

        // Process any remaining model files
        if (modelFiles.length > 0) {
            modelFiles.forEach(function(f) { selectedFilesMap.set(f.name, f); });
            await buildThumbnails(modelFiles);
            await quoteSelectedFilesWithProgress(modelFiles);
        }
    } catch (err) {
        const zipCancelBtn = document.getElementById('zip-cancel-btn');
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
 * Show the ZIP preview modal with match results.
 * Returns a Promise with the confirmation state and grouped color mapping.
 */
function _showZipPreviewModal(previewData) {
    return new Promise((resolve) => {
        const modal = document.getElementById('zip-preview-modal');
        const panel = document.getElementById('zip-preview-panel');
        const closeBtn = document.getElementById('zip-preview-close-btn');
        const cancelBtn = document.getElementById('zip-preview-cancel-btn');
        const confirmBtn = document.getElementById('zip-preview-confirm-btn');
        const backdrop = document.getElementById('zip-preview-backdrop');
        const colorMappingBody = document.getElementById('zip-preview-color-mapping-body');

        if (!modal || !panel) {
            // Fallback: if modal not found, auto-confirm
            resolve({ confirmed: true, colorMapping: {} });
            return;
        }

        // Guard all required interactive elements
        if (!closeBtn || !cancelBtn || !confirmBtn || !backdrop) {
            resolve({ confirmed: true, colorMapping: {} });
            return;
        }

        // Populate summary
        const summaryEl = document.getElementById('zip-preview-summary');
        const ms = previewData.match_summary || {};
        const summaryParts = [];
        if (ms.matched > 0) {
            summaryParts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium">✓ ${ms.matched} ${t('zipPreview.matched') || '已匹配'}</span>`);
        }
        if (ms.bom_only > 0) {
            summaryParts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-800 text-xs font-medium">${ms.bom_only} ${t('zipPreview.bomOnly') || '清单多余'}</span>`);
        }
        if (ms.model_only > 0) {
            summaryParts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">${ms.model_only} ${t('zipPreview.modelOnly') || '无清单'}</span>`);
        }
        summaryEl.innerHTML = summaryParts.join('');
        _renderZipColorMapping(previewData);

        // Populate matched table
        const matchedSection = document.getElementById('zip-preview-matched');
        const matchedBody = document.getElementById('zip-preview-matched-body');
        const matchedCount = document.getElementById('zip-preview-matched-count');
        if (previewData.matched && previewData.matched.length > 0) {
            matchedSection.classList.remove('hidden');
            matchedCount.textContent = `(${previewData.matched.length})`;
            matchedBody.innerHTML = previewData.matched.map(m => {
                const cl = m.checklist || {};
                return `<tr>
                    <td class="px-3 py-1.5 text-gray-800">${escapeHtml(m.filename)}</td>
                    <td class="px-3 py-1.5 text-gray-600">${escapeHtml(cl.material_type || '-')}</td>
                    <td class="px-3 py-1.5 text-gray-600">${escapeHtml(cl.color || '-')}</td>
                    <td class="px-3 py-1.5 text-gray-600">${cl.quantity || '-'}</td>
                </tr>`;
            }).join('');
        } else {
            matchedSection.classList.add('hidden');
        }

        // Populate BOM-only table
        const bomSection = document.getElementById('zip-preview-bom-only');
        const bomBody = document.getElementById('zip-preview-bom-body');
        const bomCount = document.getElementById('zip-preview-bom-count');
        if (previewData.bom_only && previewData.bom_only.length > 0) {
            bomSection.classList.remove('hidden');
            bomCount.textContent = `(${previewData.bom_only.length})`;
            bomBody.innerHTML = previewData.bom_only.map(b => {
                return `<tr>
                    <td class="px-3 py-1.5 text-red-800">${escapeHtml(b.filename)}</td>
                    <td class="px-3 py-1.5 text-red-600">${escapeHtml(b.reason)}</td>
                </tr>`;
            }).join('');
        } else {
            bomSection.classList.add('hidden');
        }

        // Populate model-only table
        const modelSection = document.getElementById('zip-preview-model-only');
        const modelBody = document.getElementById('zip-preview-model-body');
        const modelCount = document.getElementById('zip-preview-model-count');
        if (previewData.model_only && previewData.model_only.length > 0) {
            modelSection.classList.remove('hidden');
            modelCount.textContent = `(${previewData.model_only.length})`;
            modelBody.innerHTML = previewData.model_only.map(m => {
                return `<tr>
                    <td class="px-3 py-1.5 text-amber-800">${escapeHtml(m.filename)}</td>
                    <td class="px-3 py-1.5 text-amber-600">${escapeHtml(m.reason)}</td>
                </tr>`;
            }).join('');
        } else {
            modelSection.classList.add('hidden');
        }

        // Show modal with animation
        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            panel.classList.remove('translate-y-full');
        });

        function close(result) {
            modal.classList.add('hidden');
            cleanup();
            resolve(result);
        }

        function cleanup() {
            modal.onclick = null;
        }


        // Event delegation on modal - handles all button clicks
        modal.onclick = function(e) {
            const target = e.target;
            if (target.closest('#zip-preview-close-btn') || target.closest('#zip-preview-cancel-btn')) {
                close(false);
            } else if (target.closest('#zip-preview-confirm-btn')) {
                const colorMapping = _collectZipColorMapping(previewData);
                const missing = _zipChecklistColors(previewData)
                    .filter(({ source }) => !colorMapping[String(source).trim()]);
                if (missing.length > 0) {
                    colorMappingBody?.querySelectorAll('.zip-color-mapping-row').forEach((row) => {
                        const source = row.getAttribute('data-source-color') || '';
                        row.classList.toggle('ring-2', missing.some((item) => item.source === source));
                        row.classList.toggle('ring-red-400', missing.some((item) => item.source === source));
                    });
                    showToast(`\u8BF7\u4E3A\u6E05\u5355\u4E2D\u7684\u6BCF\u79CD\u989C\u8272\u624B\u52A8\u9009\u62E9\u76EE\u6807\u989C\u8272\uFF08\u8FD8\u7F3A\u5C11\uFF1A${missing.map((item) => item.source).join('\u3001')}\uFF09`, 'warning');
                    return;
                }
                close({ confirmed: true, colorMapping });
            } else if (target.id === 'zip-preview-backdrop' || target.id === 'zip-preview-modal') {
                close(false);
            }
        };
    });
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
