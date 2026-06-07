// -- Batch edit operations --
import {
    quoteOptions, currentResults, setCurrentResults,
    MATERIAL_OPTIONS, renderColorDropdown, getActivePrinterCompoundId,
} from './state.js';
import { renderResultsTable, recalcSummaryFromCurrentResults, refreshOptionsSummary } from './quote-render.js';
import { reQuoteAllSelectedFiles } from './quote-api.js';
import { t } from './i18n.js';

let _dom = {};
export function setBatchDom(d) { _dom = d; }

// ── Batch edit bar ──
export function refreshBatchMaterialDropdown() {
    const sel = document.getElementById('batch-material');
    if (!sel) return;
    sel.innerHTML = MATERIAL_OPTIONS.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    sel.value = quoteOptions.material;
    refreshBatchColorDropdown();
}

export function refreshBatchColorDropdown() {
    const container = document.getElementById('batch-color-dropdown');
    const materialSelect = document.getElementById('batch-material');
    if (!container || !materialSelect) return;
    const material = materialSelect.value;
    const colorInput = container.querySelector('.row-color-value');
    const currentColor = colorInput ? colorInput.value : quoteOptions.color;
    const rendered = renderColorDropdown(material, currentColor, true);
    container.innerHTML = rendered.html;
}

export async function batchApplyToAll() {
    const { errorContainer, errorMsg } = _dom;
    const materialSelect = document.getElementById('batch-material');
    const colorContainer = document.getElementById('batch-color-dropdown');
    const quantityInput = document.getElementById('batch-quantity');
    const msgEl = document.getElementById('batch-msg');
    if (!materialSelect || !colorContainer || !quantityInput) return;

    const material = materialSelect.value;
    const colorInput = colorContainer.querySelector('.row-color-value');
    const color = colorInput ? colorInput.value : '';
    const quantity = Number.parseInt(quantityInput.value, 10);

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
        return { ...item, material, color, quantity,
            _printer_model: getActivePrinterCompoundId(),
            _slicer_preset_id: quoteOptions.slicer_preset_id,
            _recalculating: true };
    }));

    // 2) 更新报价选项
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
        if (msgEl) { msgEl.textContent = `已应用：${material} / ${color} / ×${quantity}`; }
    } catch (err) {
        if (msgEl) { msgEl.textContent = '部分重算失败'; }
    }
}
