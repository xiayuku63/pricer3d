// ── Quote: options, API, results rendering, row editing ──
import {
    authToken, currentUser,
    quoteOptions, selectedFilesMap, thumbnailMap,
    currentResults, setCurrentResults,
    MATERIAL_OPTIONS, PRICING_CONFIG, COLOR_OPTIONS,
    authFetch, formatColorLabel, formatTimeHMS, escapeHtml,
    renderColorDropdown, getColorsForMaterial,
    colorToObj, isColorInAllowedColors, pickAllowedColor,
} from './state.js';
import { buildPlaceholderThumbnail, ensureThumbnailForFile, buildThumbnails } from './preview.js';
import { loadQuoteHistory } from './history.js';

let dom = {};
let _openLoginModal = null;  // lazy-init to break circular dep with auth.js
export function setOpenLoginModalRef(fn) { _openLoginModal = fn; }

export function initQuote(d) { dom = d; }

// ── Options ──
export function refreshOptionsSummary() {
    const { optionsSummary } = dom;
    if (!optionsSummary) return;
    const colorText = formatColorLabel(quoteOptions.color);
    const pm = document.getElementById("cfg-printer-model-main");
    const pmName = (pm && pm.selectedOptions[0]) ? pm.selectedOptions[0].text : "未选择";
    optionsSummary.innerHTML = `打印机：${pmName} | 材料 ${quoteOptions.material}，颜色 ${colorText}，数量 ${quoteOptions.quantity}`;
}

export function recalcSummaryFromCurrentResults() {
    const successItems = currentResults.filter((i) => i.status === "success");
    const failedItems = currentResults.filter((i) => i.status === "failed");
    const sumFiles = document.getElementById('sum-total-files');
    const sumStatus = document.getElementById('sum-status');
    const sumCost = document.getElementById('sum-total-cost');
    const sumTime = document.getElementById('sum-total-time');
    if (sumFiles) sumFiles.textContent = currentResults.length;
    if (sumStatus) sumStatus.textContent = `${successItems.length} / ${failedItems.length}`;
    if (sumCost) sumCost.textContent = '¥ ' + successItems.reduce((s, i) => s + (i.cost_cny || 0), 0).toFixed(2);
    if (sumTime) sumTime.textContent = formatTimeHMS(successItems.reduce((s, i) => s + (i.estimated_time_h || 0), 0));
}

// ── Quote API ──
export async function quoteSingleFileWithOptions(file, options) {
    const formData = new FormData();
    formData.append("files", file);
    const optPrinter = document.getElementById("cfg-printer-model-main");
    if (optPrinter && optPrinter.value) formData.append("printer_model", optPrinter.value);
    formData.append("material", options.material);
    formData.append("color", options.color);
    formData.append("quantity", String(options.quantity));
    if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined) {
        formData.append("slicer_preset_id", String(quoteOptions.slicer_preset_id));
    }
    // 发送切片参数（从切片配置面板读取用户设置）
    const lhEl = document.getElementById("gen-layer-height");
    const wcEl = document.getElementById("gen-wall-count");
    const ifEl = document.getElementById("gen-infill");
    const tsEl = document.getElementById("gen-top-shells");
    const bsEl = document.getElementById("gen-bottom-shells");
    if (lhEl && lhEl.value) formData.append("layer_height", lhEl.value);
    if (wcEl && wcEl.value) formData.append("wall_count", wcEl.value);
    if (ifEl && ifEl.value) formData.append("infill", ifEl.value);
    if (tsEl && tsEl.value) formData.append("top_shell_layers", tsEl.value);
    if (bsEl && bsEl.value) formData.append("bottom_shell_layers", bsEl.value);
    formData.append("use_prusaslicer", "true");
    const response = await authFetch('/api/quote', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || '请求失败，请稍后重试');
    return data.results && data.results.length > 0 ? data.results[0] : { filename: file.name, status: "failed", error: "空响应" };
}

export async function quoteSelectedFiles(selectedFiles) {
    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    const pmOpt = document.getElementById("cfg-printer-model-main");
    if (pmOpt && pmOpt.value) formData.append("printer_model", pmOpt.value);
    formData.append("material", quoteOptions.material);
    formData.append("color", quoteOptions.color);
    formData.append("quantity", String(quoteOptions.quantity));
    if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined) {
        formData.append("slicer_preset_id", String(quoteOptions.slicer_preset_id));
    }
    // 发送切片参数（从切片配置面板读取用户设置）
    const lhEl2 = document.getElementById("gen-layer-height");
    const wcEl2 = document.getElementById("gen-wall-count");
    const ifEl2 = document.getElementById("gen-infill");
    const tsEl2 = document.getElementById("gen-top-shells");
    const bsEl2 = document.getElementById("gen-bottom-shells");
    if (lhEl2 && lhEl2.value) formData.append("layer_height", lhEl2.value);
    if (wcEl2 && wcEl2.value) formData.append("wall_count", wcEl2.value);
    if (ifEl2 && ifEl2.value) formData.append("infill", ifEl2.value);
    if (tsEl2 && tsEl2.value) formData.append("top_shell_layers", tsEl2.value);
    if (bsEl2 && bsEl2.value) formData.append("bottom_shell_layers", bsEl2.value);
    formData.append("use_prusaslicer", "true");
    const response = await authFetch('/api/quote', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || '请求失败，请稍后重试');
    mergeResultsByFilename(data.results || []);
    renderResultsTable();
    recalcSummaryFromCurrentResults();
    setTimeout(() => loadQuoteHistory(authToken), 500);
}

// ── Results management ──
export function mergeResultsByFilename(incomingResults) {
    const idxByFilename = new Map();
    currentResults.forEach((item, idx) => { if (item && item.filename) idxByFilename.set(item.filename, idx); });
    (incomingResults || []).forEach((item) => {
        if (!item || !item.filename) return;
        const existingIdx = idxByFilename.get(item.filename);
        if (existingIdx === undefined) { currentResults.push(item); return; }
        currentResults[existingIdx] = item;
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
    const { fileNameDisplay, errorContainer, errorMsg } = dom;
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
        return next;
    }));

    if (fileNameDisplay) fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const existing = currentResults.find((r) => r && r.filename === file.name) || null;
        const material = existing && existing.material ? existing.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(material);
        const color = pickAllowedColor(allowedColors, existing && existing.color, quoteOptions.color);
        const quantityRaw = existing && existing.quantity ? existing.quantity : quoteOptions.quantity;
        const quantity = Math.max(1, Number.parseInt(quantityRaw, 10) || 1);
        if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}：${i + 1}/${files.length}（${file.name}）`;
        try {
            await ensureThumbnailForFile(file, color);
            const updated = await quoteSingleFileWithOptions(file, { material, color, quantity });
            mergeResultsByFilename([updated]);
        } catch (err) {
            mergeResultsByFilename([{ filename: file.name, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    }
    if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}完成（共 ${files.length} 个文件）`;
}

// ── Results table ──
export function renderResultsTable() {
    const tbody = document.getElementById('batch-results-body');
    if (!tbody) return;
    // PrusaSlicer 始终启用
    const showPrusaStatus = true;
    tbody.innerHTML = '';
    if (!currentResults.length) {
        tbody.innerHTML = '<tr class="border-t border-gray-100"><td class="px-2 py-2 text-gray-500" colspan="13">暂无数据，请在表格底部上传并自动报价</td></tr>';
        return;
    }
    currentResults.forEach((item) => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-100';
        tr.setAttribute('data-row-file', item.filename);
        const ext = item.filename && item.filename.includes('.') ? item.filename.split('.').pop().toLowerCase() : '-';

        if (item.status === 'success') {
            const breakdown = item?.cost_breakdown && typeof item.cost_breakdown === 'object' ? item.cost_breakdown : null;
            const prusaUsed = !!(breakdown && breakdown.prusaslicer_used);
            const prusaErrorRaw = breakdown?.slicer_error ? String(breakdown.slicer_error) : "";
            const prusaError = prusaErrorRaw ? escapeHtml(prusaErrorRaw) : "";
            const prusaExtraHtml = showPrusaStatus
                ? (prusaUsed
                    ? '<div class="text-[10px] text-indigo-600">PrusaSlicer</div>'
                    : (prusaError ? `<div class="text-[10px] text-amber-700">PrusaSlicer失败：${prusaError}</div>` : ''))
                : '';

            // G-code 分析详情
            const gcode = breakdown?.gcode_summary;
            const gcodeToggleHtml = gcode
                ? `<button type="button" data-toggle-gcode="${escapeHtml(item.filename)}" class="text-[10px] text-indigo-500 hover:text-indigo-700 underline ml-1">📊详情</button>`
                : '';

            let markupPercent = Number(item.difficulty_markup_percent);
            if (!Number.isFinite(markupPercent)) {
                const multiplierRaw = Number(item.difficulty_multiplier);
                if (Number.isFinite(multiplierRaw)) markupPercent = (multiplierRaw - 1) * 100;
            }
            if (!Number.isFinite(markupPercent)) {
                const vol = Number(item.volume_cm3), area = Number(item.surface_area_cm2);
                const coeff = Number(PRICING_CONFIG.difficulty_coefficient);
                const low = Number(PRICING_CONFIG.difficulty_ratio_low);
                const high = Number(PRICING_CONFIG.difficulty_ratio_high);
                if (Number.isFinite(vol) && vol > 0 && Number.isFinite(area) && Number.isFinite(coeff) && Number.isFinite(low) && Number.isFinite(high) && high > low) {
                    const ratio = area / vol;
                    const score = Math.max(0, Math.min(1, (ratio - low) / (high - low)));
                    markupPercent = Math.max(0, (1 + Math.max(0, coeff) * score - 1) * 100);
                } else { markupPercent = 0; }
            }
            const markupText = Number.isFinite(markupPercent) ? markupPercent.toFixed(2) : '0.00';

            const geometryText = `<div class="whitespace-nowrap">体积: ${item.volume_cm3} cm³</div><div class="whitespace-nowrap">表面积: ${item.surface_area_cm2} cm²</div><div class="whitespace-nowrap">难度加价: +${markupText}%</div><div class="whitespace-nowrap">尺寸: ${item.dimensions}</div>`;
            const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
            const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
            const previewButtonHtml = isRealThumbnail
                ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors"><img src="${thumbnail}" alt="静态图" class="w-32 h-20 object-cover bg-white" /></button>`
                : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5">预览</button>`;

            const materialOptionsHtml = MATERIAL_OPTIONS.map((m) => `<option value="${m.name}" ${m.name === item.material ? 'selected' : ''}>${m.name}</option>`).join('');
            const renderedRowColors = renderColorDropdown(item.material, item.color, true);
            tr.innerHTML = `
                <td class="px-2 py-1.5">${item.filename}</td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${item.quantity}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>
                <td class="px-2 py-1.5 text-[10px] leading-tight">${geometryText}</td>
                <td class="px-2 py-1.5">${item.weight_g}</td>
                <td class="px-2 py-1.5">${formatTimeHMS(item.unit_time_h || (item.estimated_time_h / Math.max(1, item.quantity)))}</td>
                <td class="px-2 py-1.5">${formatTimeHMS(item.estimated_time_h)}</td>
                <td class="px-2 py-1.5">¥ ${item.unit_cost_cny}</td>
                <td class="px-2 py-1.5">¥ ${item.cost_cny}</td>
                <td data-role="status-cell" class="px-2 py-1.5 text-green-600"><div>成功</div>${prusaExtraHtml}${gcodeToggleHtml}</td>
                <td class="px-2 py-1.5 space-x-1"><button type="button" data-delete-file="${item.filename}" class="text-[11px] text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded px-2 py-0.5">删除</button></td>
            `;
        } else {
            const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
            const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
            const previewButtonHtml = isRealThumbnail
                ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors"><img src="${thumbnail}" alt="静态图" class="w-32 h-20 object-cover bg-white" /></button>`
                : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5">预览</button>`;
            const selectedMaterial = item.material || quoteOptions.material;
            const selectedColor = item.color || quoteOptions.color;
            const materialOptionsHtml = MATERIAL_OPTIONS.map((m) => `<option value="${m.name}" ${m.name === selectedMaterial ? 'selected' : ''}>${m.name}</option>`).join('');
            const renderedRowColors = renderColorDropdown(selectedMaterial, selectedColor, true);
            const quantityValue = item.quantity || quoteOptions.quantity || 1;
            tr.innerHTML = `
                <td class="px-2 py-1.5">${item.filename}</td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${quantityValue}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>
                <td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td>
                <td data-role="status-cell" class="px-2 py-1.5 text-red-600">${item.error || '失败'}</td>
                <td class="px-2 py-1.5 space-x-1"><button type="button" data-delete-file="${item.filename}" class="text-[11px] text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded px-2 py-0.5">删除</button></td>
            `;
        }
        tbody.appendChild(tr);

        // ── G-code 详情展开行 ──
        const gcodeData = item.status === 'success' && item.cost_breakdown?.gcode_summary;
        if (gcodeData) {
            const detailTr = document.createElement('tr');
            detailTr.className = 'border-t border-gray-100 bg-gray-50';
            detailTr.setAttribute('data-gcode-detail', item.filename);
            detailTr.style.display = 'none';
            detailTr.innerHTML = _buildGcodeDetailHtml(gcodeData);
            tbody.appendChild(detailTr);
        }
    });
}

// ── G-code 详情构建 ──
function _buildGcodeDetailHtml(gcode) {
    const cp = gcode.core_params || {};
    let html = '<td colspan="13" class="px-3 py-2"><div class="grid grid-cols-3 md:grid-cols-5 gap-x-3 gap-y-1 text-[11px]">';

    // 核心切片参数
    const add = (label, value, unit) => {
        if (value != null && value !== '') {
            html += `<div><span class="text-gray-400">${label}</span> <span class="font-semibold">${value}${unit || ''}</span></div>`;
        }
    };

    add('层高', cp.layer_height, ' mm');
    add('初始层高', cp.first_layer_height, ' mm');
    add('喷嘴直径', cp.nozzle_diameter, ' mm');
    add('外墙层数', cp.perimeters);
    add('填充密度', cp.fill_density, '%');
    add('顶部外壳层数', cp.top_shell_layers);
    add('底部外壳层数', cp.bottom_shell_layers);
    add('底边宽度', cp.brim_width, ' mm');
    add('支撑', cp.support_material === '1' ? '是' : '否');
    add('总层数', gcode.layer_count);

    // 分隔线
    html += '<div class="col-span-full border-t border-gray-200 my-1"></div>';

    // 耗材 + 时间
    if (gcode.filament_mm != null) {
        add('耗材线长', (gcode.filament_mm / 1000).toFixed(2), ' m');
    }
    if (gcode.filament_g != null && gcode.filament_g > 0) {
        add('耗材重量', gcode.filament_g.toFixed(2), ' g');
    }
    if (gcode.time_display) {
        add('预估时间', gcode.time_display);
    }

    // 层高分布
    if (gcode.heights && gcode.heights.length) {
        const hParts = gcode.heights.map(h => `${h.height.toFixed(3)}mm×${h.count}`).join(', ');
        html += `<div class="col-span-full"><span class="text-gray-400">层高分布</span> <span>${hParts}</span></div>`;
    }

    html += '</div></td>';
    return html;
}

// ── G-code 详情切换事件委托 ──

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
    const { errorContainer, errorMsg } = dom;
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
        if (errorMsg) { errorMsg.textContent = '数量必须大于等于 1'; errorContainer.classList.remove('hidden'); }
        return;
    }

    if (!currentResults.length) {
        if (errorMsg) { errorMsg.textContent = '没有可批量设置的文件，请先上传文件并报价'; errorContainer.classList.remove('hidden'); }
        return;
    }

    if (errorContainer) errorContainer.classList.add('hidden');

    // 1) 先更新模型数据
    setCurrentResults(currentResults.map(item => {
        if (!item || !item.filename) return item;
        return { ...item, material, color, quantity };
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

// ── Row editing ──
const _rowEditTimers = new Map();
const _rowEditSignals = new Map();

export function handleRowEditChange(event) {
    const target = event.target;
    if (!target.classList.contains('row-edit')) return;
    const row = target.closest('tr[data-row-file]');
    if (!row) return;
    const filename = row.getAttribute('data-row-file');
    if (_rowEditTimers.has(filename)) { clearTimeout(_rowEditTimers.get(filename)); }
    if (_rowEditSignals.has(filename)) { _rowEditSignals.get(filename).cancelled = true; }
    _rowEditTimers.set(filename, setTimeout(async () => {
        _rowEditTimers.delete(filename);
        const signal = { cancelled: false };
        _rowEditSignals.set(filename, signal);
        await _handleRowEdit(event, signal);
        if (_rowEditSignals.get(filename) === signal) _rowEditSignals.delete(filename);
    }, 400));
}

async function _handleRowEdit(event, signal) {
    const { errorContainer, errorMsg } = dom;
    const target = event.target;
    if (!authToken) {
        if (errorMsg) { errorMsg.textContent = '请先登录后再修改报价参数'; errorContainer.classList.remove('hidden'); }
        _openLoginModal?.(); return;
    }
    const row = target.closest('tr[data-row-file]');
    if (!row) return;
    const filename = row.getAttribute('data-row-file');
    const file = selectedFilesMap.get(filename);
    if (!file) return;
    const materialSelect = row.querySelector('[data-field="material"]');
    const colorCell = row.querySelector('[data-field="color"]');
    const colorValueInput = colorCell ? colorCell.querySelector('.row-color-value') : null;
    const material = materialSelect.value;
    const currentColor = colorValueInput ? colorValueInput.value : '';
    const rendered = renderColorDropdown(material, currentColor, true);
    if (target === materialSelect && colorCell) {
        colorCell.innerHTML = rendered.html;
    }
    const newColorValueInput = colorCell ? colorCell.querySelector('.row-color-value') : null;
    const color = newColorValueInput ? newColorValueInput.value : rendered.selected;
    const quantity = Number.parseInt(row.querySelector('[data-field="quantity"]').value, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
        if (errorMsg) { errorMsg.textContent = '数量必须大于等于 1'; errorContainer.classList.remove('hidden'); }
        return;
    }
    if (errorContainer) errorContainer.classList.add('hidden');
    row.querySelector('[data-role="status-cell"]').textContent = '重算中...';
    row.querySelector('[data-role="status-cell"]').className = 'px-2 py-1.5 text-amber-600';
    try {
        await ensureThumbnailForFile(file, color);
        if (signal.cancelled) return;
        const updated = await quoteSingleFileWithOptions(file, { material, color, quantity });
        if (signal.cancelled) return;
        const idx = currentResults.findIndex((i) => i.filename === filename);
        if (idx >= 0) currentResults[idx] = updated;
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    } catch (err) {
        if (signal.cancelled) return;
        if (errorMsg) { errorMsg.textContent = err.message; errorContainer.classList.remove('hidden'); }
        row.querySelector('[data-role="status-cell"]').textContent = '重算失败';
        row.querySelector('[data-role="status-cell"]').className = 'px-2 py-1.5 text-red-600';
    }
}
