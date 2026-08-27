// -- Quote API & results management --
import {
    authToken, quoteOptions, selectedFilesMap,
    currentResults, setCurrentResults, thumbnailMap,
    MATERIAL_OPTIONS, authFetch,
    getColorsForMaterial, pickAllowedColor,
    getActivePrinterCompoundId,
    loadFrontSettingsSnapshot,

} from './state.js';
import { renderResultsTable, recalcSummaryFromCurrentResults } from './quote-render.js';
import { ensureThumbnailForFile } from './preview.js';
import { loadQuoteHistory } from './history.js';
import { t } from './i18n.js';
import { uploadWithProgress, showProgress, updateProgress, showProgressSuccess, showProgressError, hideProgress, showToast } from './upload.js';
import { getAffectedFilenamesForGlobalSlicerChange, getAffectedFilenamesForPresetChange } from './quote-config.js';
import { getResultOrientation, resolveRequoteOrientation, withResultOrientation } from './orientation-state.js';
import { resolveUploadDefaults } from './upload-defaults.js';

let _dom = {};
export function setApiDom(d) { _dom = d; }

// ── Global abort controller for recalc ──
let _globalAbortController = null;

export function abortActiveRecalc() {
    if (_globalAbortController) {
        _globalAbortController.abort();
        _globalAbortController = null;
    }
}

let _quoteBatchId = null;

function _newAbortController() {
    abortActiveRecalc();
    _globalAbortController = new AbortController();
    _quoteBatchId = (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return _globalAbortController;
}

/** Stop button, part 2: the fetch abort alone does NOT stop the backend
 * (Windows/uvicorn never surfaces the disconnect), so tell the server the
 * batch is cancelled; workers skip every file that has not started. */
export function cancelActiveQuoteBatch() {
    const batchId = _quoteBatchId;
    abortActiveRecalc();
    if (!batchId) return Promise.resolve();
    return authFetch('/api/quote/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
    }).catch(() => {});
}

// ── Quote API ──

function _getActivePrinterModel() {
    return getActivePrinterCompoundId();
}

function _getActiveSlicerPresetId() {
    // Prefer the model-page batch selector; fall back to quoteOptions
    const batch = document.getElementById('batch-slicer-preset');
    if (batch && batch.value) return Number(batch.value);
    return (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined)
        ? quoteOptions.slicer_preset_id : null;
}

function _getUploadDefaults() {
    return resolveUploadDefaults({
        root: document,
        snapshot: loadFrontSettingsSnapshot() || {},
        fallback: {
            printer_model: _getActivePrinterModel(),
            slicer_preset_id: quoteOptions.slicer_preset_id,
            brand: quoteOptions.brand,
            material: quoteOptions.material,
            color: quoteOptions.color,
        },
    });
}

function _getActiveSlicerParams() {
    const value = (id, fallback) => {
        const element = document.getElementById(id);
        return element && element.value !== '' ? Number(element.value) : fallback;
    };
    return {
        layer_height: value('gen-layer-height', 0.2),
        perimeters: value('gen-wall-count', 3),
        fill_density: value('gen-infill', 20),
    };
}

async function _syncThumbnailsWithQuoteResults(files, results) {
    const filesByName = new Map((files || []).map((file) => [file.name, file]));
    for (const result of results || []) {
        const file = filesByName.get(result?.filename);
        if (!file || !result?.color) continue;
        // The upload preview is generated before the API response arrives. Rebuild
        // it from the server-selected color so it cannot retain a stale global default.
        await ensureThumbnailForFile(file, result.color, getResultOrientation(result), () => {});
    }
}

export function getSlicerConfigSnapshot() {
    return {
        printerModel: _getActivePrinterModel(),
        presetId: _getActiveSlicerPresetId(),
        params: _getActiveSlicerParams(),
    };
}

export function getAffectedFilenamesForSlicerConfigChange(previous, next) {
    return getAffectedFilenamesForGlobalSlicerChange(currentResults, previous, next);
}

export function getAffectedFilenamesForSlicerPresetChange(presetId, nextParams) {
    return getAffectedFilenamesForPresetChange(currentResults, presetId, nextParams);
}

export async function quoteSingleFileWithOptions(file, options, signal) {
    const formData = new FormData();
    formData.append("files", file);
    // Use per-file printer if provided, else global
    const printerModel = options._printer_model || _getActivePrinterModel();
    if (printerModel) formData.append("printer_model", printerModel);
    formData.append("material", options.material);
    if (options.brand) formData.append("brand", options.brand);
    formData.append("color", options.color);
    formData.append("quantity", String(options.quantity));
    // Use per-file preset if provided, else global
    const presetId = options._slicer_preset_id !== undefined ? options._slicer_preset_id : _getActiveSlicerPresetId();
    if (presetId !== null && presetId !== undefined) {
        formData.append("slicer_preset_id", String(presetId));
    }
    // 始终发送切片参数（用户面板设置），后端按优先级处理：
    // 用户预设 → 预设内容优先；系统预设/无预设 → 表单参数覆盖
    const lhEl = document.getElementById("gen-layer-height");
    const wcEl = document.getElementById("gen-wall-count");
    const ifEl = document.getElementById("gen-infill");
    if (lhEl && lhEl.value) formData.append("layer_height", lhEl.value);
    if (wcEl && wcEl.value) formData.append("wall_count", wcEl.value);
    if (ifEl && ifEl.value) formData.append("infill", ifEl.value);
    formData.append("use_prusaslicer", "true");
    const autoOrientCheckbox1 = document.getElementById('batch-auto-orient');
    const orientation = options.orientation || options._orientation;
    const autoOrientRequested = options.auto_orient === true
        || (options.auto_orient == null && autoOrientCheckbox1?.checked);
    const hasExplicitOrientation = options.orient_x != null
        || options.orient_y != null
        || options.orient_z != null;
    // Explicit/manual angles take precedence; smart placement must not double-rotate the model.
    if (autoOrientRequested && !orientation && !hasExplicitOrientation) {
        formData.append('auto_orient', 'true');
    }
    // Pass an explicit orientation when saving from the preview.
    const orientX = options.orient_x != null ? options.orient_x : orientation?.x;
    const orientY = options.orient_y != null ? options.orient_y : orientation?.y;
    const orientZ = options.orient_z != null ? options.orient_z : orientation?.z;
    if (orientX != null) formData.append('orient_x', String(orientX));
    if (orientY != null) formData.append('orient_y', String(orientY));
    if (orientZ != null) formData.append('orient_z', String(orientZ));
    if (options.entity_colors && typeof options.entity_colors === 'object') {
        formData.append('entity_colors_json', JSON.stringify(options.entity_colors));
    }
    const fetchOpts = { method: 'POST', body: formData };
    if (_quoteBatchId) fetchOpts.headers = { 'X-Quote-Batch-Id': _quoteBatchId };
    if (signal) fetchOpts.signal = signal;
    const response = await authFetch('/api/quote', fetchOpts);
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.message || data.detail || data.error || t('quote.requestFailed'));
        error.status = response.status;
        throw error;
    }
    return data.results && data.results.length > 0 ? data.results[0] : { filename: file.name, status: "failed", error: "空响应" };
}

export async function quoteSelectedFiles(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, false);
}

export async function quoteSelectedFilesWithProgress(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, true);
}

function _buildPendingQuoteResult(file, colorOverride = null) {
    const defaults = _getUploadDefaults();
    const existing = currentResults.find((item) => item && item.filename === file.name) || null;
    return {
        ...(existing || {}),
        filename: file.name,
        status: 'pending',
        _calculating: true,
        material: existing?.material || defaults.material || quoteOptions.material,
        brand: existing?.brand || defaults.brand || quoteOptions.brand || '',
        color: colorOverride || existing?.color || defaults.color || quoteOptions.color || '#ffffff',
        quantity: Math.max(1, Number.parseInt(existing?.quantity ?? quoteOptions.quantity, 10) || 1),
        _printer_model: existing?._printer_model || defaults.printer_model || '',
        _slicer_preset_id: existing && Object.prototype.hasOwnProperty.call(existing, '_slicer_preset_id')
            ? existing._slicer_preset_id
            : defaults.slicer_preset_id,
    };
}

/** Resolve initial thumbnail colors from the exact defaults used by pending rows. */
export function getInitialQuoteColorMap(files) {
    const colors = {};
    Array.from(files || []).forEach((file) => {
        if (file?.name) colors[file.name] = _buildPendingQuoteResult(file).color;
    });
    return colors;
}

/** Insert the row as soon as its thumbnail is ready, before calculation starts. */
export function markFileAsCalculating(file, colorOverride = null) {
    if (!file?.name) return;
    mergeResultsByFilename([_buildPendingQuoteResult(file, colorOverride)]);
    renderResultsTable();
    recalcSummaryFromCurrentResults();
}

function _pendingQuoteOptions(file) {
    const item = currentResults.find((result) => result && result.filename === file.name) || {};
    const defaults = _getUploadDefaults();
    const smartPlacementEnabled = Boolean(document.getElementById('batch-auto-orient')?.checked);
    return {
        material: item.material || defaults.material || quoteOptions.material,
        brand: item.brand || defaults.brand || quoteOptions.brand || '',
        color: item.color || defaults.color || quoteOptions.color || '#ffffff',
        quantity: Math.max(1, Number.parseInt(item.quantity ?? quoteOptions.quantity, 10) || 1),
        _printer_model: item._printer_model || defaults.printer_model || '',
        _slicer_preset_id: Object.prototype.hasOwnProperty.call(item, '_slicer_preset_id')
            ? item._slicer_preset_id
            : defaults.slicer_preset_id,
        orientation: getResultOrientation(item),
        auto_orient: smartPlacementEnabled,
        entity_colors: item._entity_colors || {},
    };
}

/** Quote files through a small worker pool (default 2) so rows still
 * transition calculating → done one by one, while slicing latency no longer
 * serializes N files into N sequential round-trips. 429 responses back off
 * once instead of failing the row. */
export async function quoteSelectedFilesSequentially(selectedFiles, useProgress = false) {
    const files = Array.from(selectedFiles || []);
    if (!files.length) return;
    const controller = _newAbortController();
    const signal = controller.signal;

    files.forEach((file) => {
        const existing = currentResults.find((item) => item && item.filename === file.name);
        if (!existing || !existing._calculating) markFileAsCalculating(file);
    });
    if (useProgress) showProgress(`逐项计算报价 (${files.length} 个文件)...`);

    let nextIndex = 0;
    let completed = 0;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const runOne = async (file) => {
        markFileAsCalculating(file);
        try {
            const updated = await quoteSingleFileWithOptions(file, _pendingQuoteOptions(file), signal);
            mergeResultsByFilename([updated]);
            if (updated?.color) {
                await ensureThumbnailForFile(file, updated.color, getResultOrientation(updated), () => {});
            }
        } catch (error) {
            if (error.status === 429 && !signal.aborted) {
                // Server rate limit (30/min per IP): back off, then retry once.
                await sleep(3000);
                if (!signal.aborted) {
                    try {
                        const updated = await quoteSingleFileWithOptions(file, _pendingQuoteOptions(file), signal);
                        mergeResultsByFilename([updated]);
                        if (updated?.color) {
                            await ensureThumbnailForFile(file, updated.color, getResultOrientation(updated), () => {});
                        }
                    } catch (retryError) {
                        if (retryError.name === 'AbortError' || signal.aborted) return;
                        mergeResultsByFilename([{
                            filename: file.name,
                            status: 'failed',
                            error: retryError.message || t('quote.requestFailed'),
                        }]);
                    }
                }
            } else if (error.name === 'AbortError' || signal.aborted) {
                return;
            } else {
                mergeResultsByFilename([{
                    filename: file.name,
                    status: 'failed',
                    error: error.message || t('quote.requestFailed'),
                }]);
            }
        }
        completed += 1;
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        if (useProgress) updateProgress((completed / files.length) * 100, `${completed}/${files.length} - ${file.name}`);
    };

    const worker = async () => {
        while (!signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= files.length) return;
            await runOne(files[index]);
        }
    };

    const poolSize = Math.min(2, files.length);
    const workers = [];
    for (let i = 0; i < poolSize; i += 1) workers.push(worker());
    await Promise.all(workers);

    if (useProgress && !signal.aborted) {
        showProgressSuccess(`报价完成，共处理 ${files.length} 个文件`);
        hideProgress();
        showToast(`报价完成：${files.length} 个文件已处理`, 'success');
        setTimeout(() => loadQuoteHistory(authToken), 500);
    }
    return currentResults;
}

export async function quoteSelectedFilesSequentiallyWithProgress(selectedFiles) {
    return quoteSelectedFilesSequentially(selectedFiles, true);
}

async function _quoteSelectedFilesInternal(selectedFiles, useProgress) {
    // 上传前检查打印机/喷嘴/切片配置是否已设置
    var printerEl = document.getElementById('batch-printer-model');
    var nozzleEl = document.getElementById('batch-nozzle-diameter');
    var presetEl = document.getElementById('batch-slicer-preset');
    var missing = [];
    if (!printerEl || !printerEl.value) missing.push(t('quote.printerModel'));
    if (!nozzleEl || !nozzleEl.value) missing.push(t('quote.nozzleDiameter'));
    if (!presetEl || !presetEl.value) missing.push(t('quote.preset'));
    if (missing.length > 0) {
        var warningMsg = t('quote.missingConfig', {items: missing.join('、')});
        if (_dom.errorMsg) { _dom.errorMsg.textContent = warningMsg; }
        if (_dom.errorContainer) _dom.errorContainer.classList.remove('hidden');
    }

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    // Upload-time row initialization should inherit the front default settings
    // bar so newly uploaded models start from the saved defaults.
    const uploadDefaults = _getUploadDefaults();
    if (uploadDefaults.printer_model) formData.append("printer_model", uploadDefaults.printer_model);
    formData.append("material", uploadDefaults.material);
    if (uploadDefaults.brand) formData.append("brand", uploadDefaults.brand);
    formData.append("color", uploadDefaults.color);
    formData.append("quantity", String(quoteOptions.quantity));
    const presetId = uploadDefaults.slicer_preset_id;
    if (presetId !== null && presetId !== undefined) {
        formData.append("slicer_preset_id", String(presetId));
    }
    // 发送切片参数（从切片配置面板读取用户设置）
    const lhEl2 = document.getElementById("gen-layer-height");
    const wcEl2 = document.getElementById("gen-wall-count");
    const ifEl2 = document.getElementById("gen-infill");
    if (lhEl2 && lhEl2.value) formData.append("layer_height", lhEl2.value);
    if (wcEl2 && wcEl2.value) formData.append("wall_count", wcEl2.value);
    if (ifEl2 && ifEl2.value) formData.append("infill", ifEl2.value);
    formData.append("use_prusaslicer", "true");
    const autoOrientCheckbox2 = document.getElementById('batch-auto-orient');
    if (autoOrientCheckbox2 && autoOrientCheckbox2.checked) {
        formData.append('auto_orient', 'true');
    }
    if (useProgress) {
        showProgress(`批量报价 (${selectedFiles.length} 个文件)...`);
        try {
            const result = await uploadWithProgress('/api/quote', formData, authToken);
            if (!result.ok) throw new Error(result.error || t('quote.requestFailed'));
            const data = result.data;
            const results = data.results || [];
            mergeResultsByFilename(results);
            await _syncThumbnailsWithQuoteResults(selectedFiles, results);
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            showProgressSuccess(`报价完成，共处理 ${(data.results || []).length} 个文件`);
            hideProgress();
            showToast(`报价完成：${(data.results || []).length} 个文件已处理`, 'success');
            setTimeout(() => loadQuoteHistory(authToken), 500);
        } catch (err) {
            showProgressError(err.message || '报价失败');
            hideProgress();
            throw err;
        }
    } else {
        const response = await authFetch('/api/quote', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || t('quote.requestFailed'));
        const results = data.results || [];
        mergeResultsByFilename(results);
        await _syncThumbnailsWithQuoteResults(selectedFiles, results);
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        setTimeout(() => loadQuoteHistory(authToken), 500);
    }
}



// ── Results management ──

/** A (re-)uploaded file invalidates its previous quote row: drop the stale
 * row so the orientation-preserving merge and _pendingQuoteOptions don't
 * resurrect the OLD file's placement angle for the new upload. */
export function clearResultsForFiles(files) {
    const names = new Set((files || []).map((f) => f && f.name).filter(Boolean));
    if (!names.size) return;
    setCurrentResults(currentResults.filter((item) => !(item && names.has(item.filename))));
}

export function stopActiveQuote() {
    abortActiveRecalc();
    let stopped = 0;
    currentResults.forEach((item) => {
        if (!item) return;
        if (!(item._calculating || item._recalculating)) return;
        item._calculating = false;
        item._recalculating = false;
        if (item.status !== 'success') {
            item.status = 'failed';
            item.error = t('quote.quoteStopped');
            stopped += 1;
        }
    });
    hideProgress();
    if (stopped) {
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    }
    showToast(t('quote.quoteStoppedToast', { count: stopped }), 'info');
    return stopped;
}

export function clearAllResults() {
    selectedFilesMap.clear();
    thumbnailMap.clear();
    setCurrentResults([]);
    renderResultsTable();
    recalcSummaryFromCurrentResults();
    if (_dom.fileNameDisplay) {
        _dom.fileNameDisplay.textContent = t('quote.noFileSelected');
        _dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
    }
}

export function mergeResultsByFilename(incomingResults) {
    const idxByFilename = new Map();
    currentResults.forEach((item, idx) => { if (item && item.filename) idxByFilename.set(item.filename, idx); });
    (incomingResults || []).forEach((item) => {
        if (!item || !item.filename) return;
        const existingIdx = idxByFilename.get(item.filename);
        if (existingIdx === undefined) {
        currentResults.push({
                ...item,
                _printer_model_explicit: item._printer_model_explicit ?? Boolean(item._checklist_source),
                _slicer_preset_explicit: item._slicer_preset_explicit ?? Boolean(item._checklist_source),
            });
            return;
        }
        // Preserve per-file fields from existing item
        const existing = currentResults[existingIdx];
        const preservedOrientation = getResultOrientation(item) || getResultOrientation(existing);
        currentResults[existingIdx] = {
            ...(preservedOrientation ? withResultOrientation(item, preservedOrientation) : item),
            // Preserve color from existing item when incoming color is empty/undefined
            // This ensures inline recolors persist through API responses
            color: (item.color && String(item.color).trim())
                ? item.color
                : (existing.color || item.color),
            brand: item.brand !== undefined ? item.brand : existing.brand,
            _printer_model: item._printer_model !== undefined ? item._printer_model : existing._printer_model,
            _nozzle_diameter: item._nozzle_diameter !== undefined ? item._nozzle_diameter : existing._nozzle_diameter,
            _entity_colors: item._entity_colors !== undefined ? item._entity_colors : existing._entity_colors,
            _slicer_preset_id: item._slicer_preset_id !== undefined ? item._slicer_preset_id : existing._slicer_preset_id,
            _printer_model_explicit: existing._printer_model_explicit ?? item._printer_model_explicit ?? false,
            _slicer_preset_explicit: existing._slicer_preset_explicit ?? item._slicer_preset_explicit ?? false,
            _checklist_params: item._checklist_params !== undefined ? item._checklist_params : existing._checklist_params,
            _checklist_source: item._checklist_source || existing._checklist_source,
            _warnings: item._warnings || existing._warnings,
        };
    });
}

export function normalizeResultsWithCurrentOptions() {
    const materialNames = new Set(MATERIAL_OPTIONS.map((m) => m && m.name).filter(Boolean));
    setCurrentResults(currentResults.map((item) => {
        if (!item || !item.filename) return item;
        const next = { ...item };
        const selectedMaterial = materialNames.has(next.material) ? next.material : quoteOptions.material;
        next.material = selectedMaterial;
        const allowedColors = getColorsForMaterial(selectedMaterial, next.brand);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        const q = Number.parseInt(next.quantity, 10);
        next.quantity = Number.isFinite(q) && q >= 1 ? q : (quoteOptions.quantity || 1);
        return next;
    }));
}

export async function reQuoteAllSelectedFiles(reasonLabel, shouldRequote) {
    const { fileNameDisplay, errorContainer, errorMsg } = _dom;
    if (!authToken) return;
    const files = Array.from(selectedFilesMap.values()).filter((file) => {
        if (typeof shouldRequote !== 'function') return true;
        const result = currentResults.find((item) => item && item.filename === file.name) || null;
        return shouldRequote(result, file);
    });
    if (!files.length) return;
    if (errorMsg) errorMsg.textContent = '';
    if (errorContainer) errorContainer.classList.add('hidden');

    // 中断上一个重算
    abortActiveRecalc();
    const controller = _newAbortController();
    const signal = controller.signal;

    const smartPlacementEnabled = Boolean(document.getElementById('batch-auto-orient')?.checked);
    const filesToRequote = new Set(files.map((file) => file.name));
    currentResults.splice(0, currentResults.length, ...currentResults.map((item) => {
        if (!item || !item.filename) return item;
        if (!filesToRequote.has(item.filename)) return item;
        const next = { ...item };
        const materialNames = new Set(MATERIAL_OPTIONS.map((m) => m && m.name).filter(Boolean));
        next.material = materialNames.has(next.material) ? next.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(next.material, next.brand);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        next._recalculating = true;
        return next;
    }));
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    if (fileNameDisplay) fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    for (let i = 0; i < files.length; i += 1) {
        // 检查是否已被中断
        if (signal.aborted) break;
        const file = files[i];
        const existing = currentResults.find((r) => r && r.filename === file.name) || null;
        const material = existing && existing.material ? existing.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(material, existing && existing.brand);
        const color = pickAllowedColor(allowedColors, existing && existing.color, quoteOptions.color);
        const quantityRaw = existing && existing.quantity ? existing.quantity : quoteOptions.quantity;
        const quantity = Math.max(1, Number.parseInt(quantityRaw, 10) || 1);
        // Keep per-file overrides when present, otherwise use the active
        // defaults. A user-center save updates quoteOptions before re-quote.
        const pm = existing?._printer_model_explicit
            ? (existing._printer_model || '')
            : (quoteOptions.printer_model || _getActivePrinterModel() || '');
        const sp = existing?._slicer_preset_explicit
            ? (existing._slicer_preset_id ?? null)
            : (quoteOptions.slicer_preset_id ?? _getActiveSlicerPresetId() ?? null);
        const orientation = resolveRequoteOrientation(existing, smartPlacementEnabled);
        if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}：${i + 1}/${files.length}（${file.name}）`;
        try {
            await ensureThumbnailForFile(file, color);
            if (signal.aborted) break;
            // null is meaningful: it explicitly selects "no preset" and must
            // not fall back to the current global preset.
            const opts = { material, color, quantity, _printer_model: pm, _slicer_preset_id: sp, orientation, auto_orient: smartPlacementEnabled };
            if (existing?.brand) opts.brand = existing.brand;
            const updated = await quoteSingleFileWithOptions(file, opts, signal);
            const merged = orientation ? withResultOrientation(updated, orientation) : updated;
            mergeResultsByFilename([merged]);
            // Refresh the thumbnail in the row's final pose — the plain
            // pre-quote rebuild above always renders the original orientation,
            // which previously left smart-placed rows with a stale thumbnail.
            const resultOrientation = getResultOrientation(merged) || orientation;
            if (resultOrientation) {
                await ensureThumbnailForFile(file, updated.color || color, resultOrientation, () => {});
            }
        } catch (err) {
            // AbortError: 静默处理
            // Chromium may surface an aborted fetch as TypeError("Failed to fetch")
            // instead of AbortError. Never replace a valid result with a failure
            // while this recalculation has been superseded.
            if (err.name === 'AbortError' || signal.aborted) break;
            mergeResultsByFilename([{ filename: file.name, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    }
    if (fileNameDisplay) fileNameDisplay.textContent = signal.aborted
        ? `${reasonLabel}已中断`
        : `${reasonLabel}完成（共 ${files.length} 个文件）`;
}
