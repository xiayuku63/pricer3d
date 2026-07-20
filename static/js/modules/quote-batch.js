// -- Batch edit operations --
import {
    quoteOptions, currentResults, setCurrentResults,
    MATERIAL_OPTIONS, renderColorDropdown, getActivePrinterCompoundId,
    getUsedBrandOptions, getMaterialsByBrand, getColorsForMaterial, pickAllowedColor,
} from './state.js';
import { renderResultsTable, recalcSummaryFromCurrentResults, refreshOptionsSummary } from './quote-render.js';
import { reQuoteAllSelectedFiles } from './quote-api.js';
import { t } from './i18n.js';

let _dom = {};
export function setBatchDom(d) { _dom = d; }

// ── Dirty-field tracking ──
const BATCH_FIELDS = ['_printer_model', '_nozzle_diameter', '_slicer_preset_id', 'brand', 'material', 'color', 'quantity'];
const BATCH_SELECT_IDS = {
    brand: 'batch-brand',
    material: 'batch-material',
    quantity: 'batch-quantity',
    color: 'batch-color-dropdown',
    _printer_model: 'batch-printer-model',
    _nozzle_diameter: 'batch-nozzle-diameter',
    _slicer_preset_id: 'batch-slicer-preset',
};
let _batchDirty = new Set();  // currently dirty fields
let _batchSnapshot = {};      // field key → initial string value

/**
 * Get the current value of a single batch field.
 */
function _getBatchFieldValue(field) {
    switch (field) {
        case '_printer_model': { const el = document.getElementById('batch-printer-model'); return el ? el.value : ''; }
        case '_nozzle_diameter': { const el = document.getElementById('batch-nozzle-diameter'); return el ? el.value : ''; }
        case '_slicer_preset_id': { const el = document.getElementById('batch-slicer-preset'); return el ? el.value : ''; }
        case 'brand': { const el = document.getElementById('batch-brand'); return el ? el.value : ''; }
        case 'material': { const el = document.getElementById('batch-material'); return el ? el.value : ''; }
        case 'color': {
            const container = document.getElementById('batch-color-dropdown');
            if (!container) return '';
            const input = container.querySelector('.row-color-value');
            return input ? input.value : (container.getAttribute('data-selected-color') || '');
        }
        case 'quantity': { const el = document.getElementById('batch-quantity'); return el ? el.value : ''; }
        default: return '';
    }
}

/**
 * Snapshot the current batch field values and clear all dirty markers.
 * Call after all batch form elements have been populated (initialization)
 * or after a successful apply.
 */
export function snapshotBatchDirty() {
    _batchDirty.clear();
    for (const field of BATCH_FIELDS) {
        _batchSnapshot[field] = _getBatchFieldValue(field);
    }
    _updateDirtyUI();
}

/**
 * Mark a batch field's dirty state by comparing its current value
 * against the snapshot taken at last snapshotBatchDirty().
 */
export function markBatchDirty(field) {
    if (!BATCH_FIELDS.includes(field)) return;
    const currentVal = _getBatchFieldValue(field);
    const snapVal = _batchSnapshot[field];
    const changed = currentVal !== snapVal;
    if (changed) {
        _batchDirty.add(field);
    } else {
        _batchDirty.delete(field);
    }
    _updateDirtyUI();
}

function _updateDirtyUI() {
    // Update all wrappers with `.batch-dirty`
    for (const field of BATCH_FIELDS) {
        const wrappers = document.querySelectorAll(`[data-batch-field="${field}"]`);
        const isDirty = _batchDirty.has(field);
        wrappers.forEach(w => w.classList.toggle('batch-dirty', isDirty));
    }
}

/**
 * Check whether any batch field has been modified.
 */
export function hasBatchDirty() {
    return _batchDirty.size > 0;
}

/**
 * Get the current set of dirty field names.
 */
export function getBatchDirtyFields() {
    return new Set(_batchDirty);
}

// ── Brand dropdown ──
export function refreshBatchBrandDropdown() {
    const sel = document.getElementById('batch-brand');
    if (!sel) return;
    const brands = getUsedBrandOptions();
    const prev = sel.value || quoteOptions.brand || '';
    sel.innerHTML = brands.map(b => `<option value="${b}">${b}</option>`).join('');
    // 恢复选中：优先用上次值，其次 quoteOptions.brand
    if (prev && brands.includes(prev)) {
        sel.value = prev;
    } else if (quoteOptions.brand && brands.includes(quoteOptions.brand)) {
        sel.value = quoteOptions.brand;
    } else if (brands.length > 0) {
        sel.value = brands[0];
    }
}

// ── Batch edit bar ──
export function refreshBatchMaterialDropdown() {
    const brandSel = document.getElementById('batch-brand');
    const brand = brandSel ? brandSel.value : quoteOptions.brand;
    const sel = document.getElementById('batch-material');
    if (!sel) return;
    const materials = getMaterialsByBrand(brand);
    sel.innerHTML = materials.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    // 恢复选中的材料（如果在当前品牌下存在）
    if (materials.find(m => m.name === quoteOptions.material)) {
        sel.value = quoteOptions.material;
    } else if (materials.length > 0) {
        sel.value = materials[0].name;
    }
    refreshBatchColorDropdown();
}

export function refreshBatchColorDropdown() {
    const container = document.getElementById('batch-color-dropdown');
    const materialSelect = document.getElementById('batch-material');
    if (!container || !materialSelect) return;
    const material = materialSelect.value;
    const brandSelect = document.getElementById('batch-brand');
    const brand = brandSelect ? brandSelect.value : quoteOptions.brand;
    const colorInput = container.querySelector('.row-color-value');
    const allowedColors = getColorsForMaterial(material, brand);
    const currentColor = pickAllowedColor(
        allowedColors,
        colorInput ? colorInput.value : quoteOptions.color,
        quoteOptions.color,
    );
    const rendered = renderColorDropdown(material, currentColor, true, brand);
    container.innerHTML = rendered.html;
}

export async function batchApplyToAll() {
    const { errorContainer, errorMsg } = _dom;
    const msgEl = document.getElementById('batch-msg');
    const autoOrient = document.getElementById('batch-auto-orient');
    const doAutoOrient = autoOrient ? autoOrient.checked : false;

    // 只获取已修改（dirty）的字段
    const dirtyFields = getBatchDirtyFields();

    if (!dirtyFields.size) {
        if (msgEl) { msgEl.textContent = t('quote.noChangesToApply'); msgEl.classList.remove('hidden'); }
        return;
    }

    // 读取当前字段值
    const printerModel = document.getElementById('batch-printer-model');
    const nozzleDiam = document.getElementById('batch-nozzle-diameter');
    const slicerPreset = document.getElementById('batch-slicer-preset');
    const brandSelect = document.getElementById('batch-brand');
    const materialSelect = document.getElementById('batch-material');
    const colorContainer = document.getElementById('batch-color-dropdown');
    const quantityInput = document.getElementById('batch-quantity');

    if (!materialSelect || !colorContainer || !quantityInput) return;

    const material = materialSelect.value;
    const colorInput = colorContainer.querySelector('.row-color-value');
    const color = colorInput ? colorInput.value : '';
    const quantity = Number.parseInt(quantityInput.value, 10);
    const brand = brandSelect ? brandSelect.value : '';

    if (dirtyFields.has('_printer_model') || dirtyFields.has('_nozzle_diameter') || dirtyFields.has('_slicer_preset_id')) {
        if (!printerModel || !printerModel.value) {
            if (errorMsg) { errorMsg.textContent = '请先选择打印机型号或安装预设'; errorContainer.classList.remove('hidden'); }
            return;
        }
    }

    if (dirtyFields.has('quantity')) {
        if (!Number.isFinite(quantity) || quantity < 1) {
            if (errorMsg) { errorMsg.textContent = t('quote.countMustBePositive'); errorContainer.classList.remove('hidden'); }
            return;
        }
    }

    if (!currentResults.length) {
        if (errorMsg) { errorMsg.textContent = '没有可批量设置的文件，请先上传文件并报价'; errorContainer.classList.remove('hidden'); }
        return;
    }

    if (errorContainer) errorContainer.classList.add('hidden');

    // 1) 只更新被修改的字段到每个条目，未修改字段保持不变
    setCurrentResults(currentResults.map(item => {
        if (!item || !item.filename) return item;
        const updated = { ...item };

        if (dirtyFields.has('brand')) {
            updated.brand = brand;
        }
        if (dirtyFields.has('material')) {
            updated.material = material;
        }
        if (dirtyFields.has('color')) {
            updated.color = color;
        }
        if (dirtyFields.has('quantity')) {
            updated.quantity = quantity;
        }
        if (dirtyFields.has('_printer_model') || dirtyFields.has('_nozzle_diameter') || dirtyFields.has('_slicer_preset_id')) {
            updated._printer_model = getActivePrinterCompoundId();
            updated._slicer_preset_id = quoteOptions.slicer_preset_id;
            updated._printer_model_explicit = true;
            updated._slicer_preset_explicit = true;
        }

        updated._recalculating = true;
        return updated;
    }));

    // 2) 同步修改过的字段到 quoteOptions
    if (dirtyFields.has('brand')) quoteOptions.brand = brand;
    if (dirtyFields.has('material')) quoteOptions.material = material;
    if (dirtyFields.has('color')) quoteOptions.color = color;
    if (dirtyFields.has('quantity')) quoteOptions.quantity = quantity;
    refreshOptionsSummary();

    // 3) 刷新表格显示
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    // 4) 后台重新计算精确报价
    if (msgEl) { msgEl.textContent = t('quote.recalculating'); msgEl.classList.remove('hidden'); }
    try {
        await reQuoteAllSelectedFiles('批量设置');

        // 构建修改描述
        const parts = [];
        if (dirtyFields.has('brand')) parts.push(brand);
        if (dirtyFields.has('material')) parts.push(material);
        if (dirtyFields.has('color')) parts.push(color);
        if (dirtyFields.has('quantity')) parts.push(`×${quantity}`);
        if (dirtyFields.has('_printer_model')) parts.push('打印机');
        if (dirtyFields.has('_nozzle_diameter')) parts.push('喷嘴');
        if (dirtyFields.has('_slicer_preset_id')) parts.push('预设');
        const desc = parts.join(' / ');
        if (msgEl) { msgEl.textContent = `${t('quote.applied')}：${desc}`; }

        // 5) 应用成功后重新 snapShot，标记所有字段为"未修改"
        snapshotBatchDirty();
    } catch (err) {
        if (msgEl) { msgEl.textContent = t('quote.partialRecalcFailed'); }
    }
}
