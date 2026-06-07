// -- Quote API & results management --
import {
    authToken, quoteOptions, selectedFilesMap,
    currentResults, setCurrentResults,
    MATERIAL_OPTIONS, authFetch,
    getColorsForMaterial, pickAllowedColor,
    getActivePrinterCompoundId,
    userPreferences, savePreferencesToStorage,
} from './state.js';
import { renderResultsTable, recalcSummaryFromCurrentResults } from './quote-render.js';
import { ensureThumbnailForFile } from './preview.js';
import { loadQuoteHistory } from './history.js';
import { t } from './i18n.js';
import { uploadWithProgress, showProgress, showProgressSuccess, showProgressError, hideProgress, showToast } from './upload.js';

let _dom = {};
export function setApiDom(d) { _dom = d; }

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

export async function quoteSingleFileWithOptions(file, options) {
    const formData = new FormData();
    formData.append("files", file);
    // Use per-file printer if provided, else global
    const printerModel = options._printer_model || _getActivePrinterModel();
    if (printerModel) formData.append("printer_model", printerModel);
    formData.append("material", options.material);
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
    const response = await authFetch('/api/quote', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || t('quote.requestFailed'));
    return data.results && data.results.length > 0 ? data.results[0] : { filename: file.name, status: "failed", error: "空响应" };
}

export async function quoteSelectedFiles(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, false);
}

export async function quoteSelectedFilesWithProgress(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, true);
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
    const printerModel = _getActivePrinterModel();
    if (printerModel) formData.append("printer_model", printerModel);
    formData.append("material", quoteOptions.material);
    formData.append("color", quoteOptions.color);
    formData.append("quantity", String(quoteOptions.quantity));
    const presetId = _getActiveSlicerPresetId();
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
    if (useProgress) {
        showProgress(`批量报价 (${selectedFiles.length} 个文件)...`);
        try {
            const result = await uploadWithProgress('/api/quote', formData, authToken);
            if (!result.ok) throw new Error(result.error || t('quote.requestFailed'));
            const data = result.data;
            mergeResultsByFilename(data.results || []);
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            _trackMaterialColorUsage();
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
        mergeResultsByFilename(data.results || []);
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        _trackMaterialColorUsage();
        setTimeout(() => loadQuoteHistory(authToken), 500);
    }
}

// ── Track material/color usage for preferences ──
function _trackMaterialColorUsage() {
    try {
        const mat = quoteOptions.material;
        const col = quoteOptions.color;
        if (mat) {
            userPreferences.material_usage[mat] = (userPreferences.material_usage[mat] || 0) + 1;
        }
        if (col) {
            const key = col.toLowerCase();
            userPreferences.color_usage[key] = (userPreferences.color_usage[key] || 0) + 1;
        }
        savePreferencesToStorage();
    } catch (e) { /* ignore tracking errors */ }
}

// ── Results management ──
export function mergeResultsByFilename(incomingResults) {
    const idxByFilename = new Map();
    currentResults.forEach((item, idx) => { if (item && item.filename) idxByFilename.set(item.filename, idx); });
    (incomingResults || []).forEach((item) => {
        if (!item || !item.filename) return;
        const existingIdx = idxByFilename.get(item.filename);
        if (existingIdx === undefined) { currentResults.push(item); return; }
        // Preserve per-file printer + preset from existing item
        const existing = currentResults[existingIdx];
        currentResults[existingIdx] = {
            ...item,
            _printer_model: existing._printer_model || item._printer_model,
            _slicer_preset_id: existing._slicer_preset_id !== undefined ? existing._slicer_preset_id : item._slicer_preset_id,
            _checklist_params: item._checklist_params !== undefined ? item._checklist_params : existing._checklist_params,
            _checklist_source: item._checklist_source || existing._checklist_source,
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
        const allowedColors = getColorsForMaterial(selectedMaterial);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        const q = Number.parseInt(next.quantity, 10);
        next.quantity = Number.isFinite(q) && q >= 1 ? q : (quoteOptions.quantity || 1);
        return next;
    }));
}

export async function reQuoteAllSelectedFiles(reasonLabel) {
    const { fileNameDisplay, errorContainer, errorMsg } = _dom;
    if (!authToken) return;
    const files = Array.from(selectedFilesMap.values());
    if (!files.length) return;
    if (errorMsg) errorMsg.textContent = '';
    if (errorContainer) errorContainer.classList.add('hidden');

    currentResults.splice(0, currentResults.length, ...currentResults.map((item) => {
        if (!item || !item.filename) return item;
        const next = { ...item };
        const materialNames = new Set(MATERIAL_OPTIONS.map((m) => m && m.name).filter(Boolean));
        next.material = materialNames.has(next.material) ? next.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(next.material);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        next._recalculating = true;
        return next;
    }));
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    if (fileNameDisplay) fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const existing = currentResults.find((r) => r && r.filename === file.name) || null;
        const material = existing && existing.material ? existing.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(material);
        const color = pickAllowedColor(allowedColors, existing && existing.color, quoteOptions.color);
        const quantityRaw = existing && existing.quantity ? existing.quantity : quoteOptions.quantity;
        const quantity = Math.max(1, Number.parseInt(quantityRaw, 10) || 1);
        // Per-file printer + preset
        const pm = (existing && existing._printer_model) ? existing._printer_model : '';
        const sp = (existing && existing._slicer_preset_id !== undefined) ? existing._slicer_preset_id : null;
        if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}：${i + 1}/${files.length}（${file.name}）`;
        try {
            await ensureThumbnailForFile(file, color);
            const opts = { material, color, quantity, _printer_model: pm };
            if (sp !== null) opts._slicer_preset_id = sp;
            const updated = await quoteSingleFileWithOptions(file, opts);
            mergeResultsByFilename([updated]);
        } catch (err) {
            mergeResultsByFilename([{ filename: file.name, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    }
    if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}完成（共 ${files.length} 个文件）`;
}
