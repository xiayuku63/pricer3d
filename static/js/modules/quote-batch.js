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
    const materialSelect = document.getElementById('batch-material');
    const colorContainer = document.getElementById('batch-color-dropdown');
    const quantityInput = document.getElementById('batch-quantity');
    const brandSelect = document.getElementById('batch-brand');
    const msgEl = document.getElementById('batch-msg');
    if (!materialSelect || !colorContainer || !quantityInput) return;

    const material = materialSelect.value;
    const colorInput = colorContainer.querySelector('.row-color-value');
    const color = colorInput ? colorInput.value : '';
    const quantity = Number.parseInt(quantityInput.value, 10);
    const brand = brandSelect ? brandSelect.value : '';

    if (!Number.isFinite(quantity) || quantity < 1) {
        if (errorMsg) { errorMsg.textContent = t('quote.countMustBePositive'); errorContainer.classList.remove('hidden'); }
        return;
    }

    if (!currentResults.length) {
        if (errorMsg) { errorMsg.textContent = '没有可批量设置的文件，请先上传文件并报价'; errorContainer.classList.remove('hidden'); }
        return;
    }

    if (errorContainer) errorContainer.classList.add('hidden');

    // 1) 先更新模型数据（包括 per-file printer + preset）
    setCurrentResults(currentResults.map(item => {
        if (!item || !item.filename) return item;
        return { ...item, brand, material, color, quantity,
            _printer_model: getActivePrinterCompoundId(),
            _slicer_preset_id: quoteOptions.slicer_preset_id,
            _printer_model_explicit: true,
            _slicer_preset_explicit: true,
            _recalculating: true };
    }));

    // 2) 更新报价选项
    quoteOptions.brand = brand;
    quoteOptions.material = material;
    quoteOptions.color = color;
    quoteOptions.quantity = quantity;
    refreshOptionsSummary();

    // 3) 立即刷新表格，让用户看到修改后的参数
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    // 4) 后台重新计算精确报价
    if (msgEl) { msgEl.textContent = '重算中...'; msgEl.classList.remove('hidden'); }
    try {
        await reQuoteAllSelectedFiles('批量设置');
        if (msgEl) { msgEl.textContent = `已应用：${brand ? brand + ' / ' : ''}${material} / ${color} / ×${quantity}`; }
    } catch (err) {
        if (msgEl) { msgEl.textContent = '部分重算失败'; }
    }
}
