// ── User settings: materials, colors, pricing, formulas, password ──
import {
    authToken, currentUser, setCurrentUser, setAuthToken,
    MATERIAL_OPTIONS, setMaterialOptions,
    COLOR_OPTIONS, setColorOptions,
    PRICING_CONFIG, setPricingConfig,
    quoteOptions,
    authFetch, colorToObj, materialColorsArray, escapeHtml,
    renderColorDropdown, getColorsForMaterial,
    saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap,
    defaultPrinterId, setDefaultPrinterId,
    defaultNozzle, setDefaultNozzle,
    defaultSlicerPresetId, setDefaultSlicerPresetId,
} from './state.js';
import { openLoginModal } from './auth.js';
import { renderSlicerPresetsUI, fetchSlicerPresets, fetchPrinterModels } from './presets.js';
import { refreshOptionsSummary, normalizeResultsWithCurrentOptions, renderResultsTable, recalcSummaryFromCurrentResults, reQuoteAllSelectedFiles, refreshBatchMaterialDropdown } from './quote.js';

let dom = {};

export function initSettings(d) { dom = d; }

// ── Fetch from API ──
export async function fetchUserSettings() {
    if (!authToken) return;
    try {
        const response = await authFetch('/api/user/settings');
        if (response.ok) {
            const data = await response.json();
            setMaterialOptions(data.materials || MATERIAL_OPTIONS);
            setColorOptions(data.colors || COLOR_OPTIONS);
            setPricingConfig(data.pricing_config || PRICING_CONFIG);
            setDefaultPrinterId(data.default_printer_id || null);
            setDefaultNozzle(data.default_nozzle || null);
            setDefaultSlicerPresetId(data.default_slicer_preset_id || null);
        }
    } catch (e) { console.error("Failed to fetch user settings", e); }
    updateDropdowns();
}

// ── Dropdown updates ──
export function updateDropdowns() {
    const { optMaterial, optColor } = dom;
    if (optMaterial) {
        optMaterial.innerHTML = MATERIAL_OPTIONS.map(m => `<option value="${m.name}">${m.name} (¥${Number(m.price_per_kg || 0).toFixed(2)}/KG)</option>`).join('');
        if (!MATERIAL_OPTIONS.find(m => m.name === quoteOptions.material) && MATERIAL_OPTIONS.length > 0) {
            quoteOptions.material = MATERIAL_OPTIONS[0].name;
        }
        const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color);
        if (optColor) optColor.innerHTML = rendered.html;
        quoteOptions.color = rendered.selected;
    }
    refreshOptionsSummary();
    refreshBatchMaterialDropdown();
}

export function refreshQuoteColorDropdowns() {
    const { optColor } = dom;
    const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color);
    if (optColor) optColor.innerHTML = rendered.html;
    quoteOptions.color = rendered.selected;
}

export function buildPrinterOptionsHtml(selectedId) {
    const sel = document.getElementById("cfg-printer-model-main");
    if (!sel || sel.options.length <= 1) return '<option value="">选择打印机...</option>';
    let html = '<option value="">选择打印机...</option>';
    for (const opt of sel.options) {
        if (!opt.value) continue;
        html += '<option value="' + opt.value + '"' + (opt.value === selectedId ? ' selected' : '') + '>' + opt.text + '</option>';
    }
    return html;
}

// ── Render user center ──
export function renderUserCenterUI() {
    const {
        materialsTbody, cfgMachineHourlyRate, cfgSetupFee, cfgMinJobFee,
        cfgMaterialWaste, cfgSupportPercent, cfgPostPerPart,
        cfgTimeOverheadMin, cfgTimeVolMinPerCm3,
        cfgDifficultyCoefficient, cfgDifficultyRatioLow, cfgDifficultyRatioHigh,
        cfgSupportPricePerG, cfgUnitCostFormula, cfgTotalCostFormula,
    } = dom;

    if (materialsTbody) {
        materialsTbody.innerHTML = MATERIAL_OPTIONS.map((m, idx) => `
            <tr>
                <td class="px-2 py-2"><input type="text" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${escapeHtml(m.name)}" data-idx="${idx}" data-field="name"></td>
                <td class="px-2 py-2"><input type="text" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${escapeHtml(m.brand || '通用')}" data-idx="${idx}" data-field="brand"></td>
                <td class="px-2 py-2"><input type="number" step="0.01" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${m.density}" data-idx="${idx}" data-field="density"></td>
                <td class="px-2 py-2"><input type="number" step="0.01" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${m.price_per_kg}" data-idx="${idx}" data-field="price_per_kg"></td>
                <td class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-1">
                        ${materialColorsArray(m).map(c => `<span class="w-4 h-4 rounded-sm border border-gray-400 inline-block cursor-pointer" style="background:${c.hex}" title="${escapeHtml(c.name)}" data-color-idx="${idx}" data-color-hex="${c.hex}"></span>`).join('')}
                        <button type="button" class="text-xs text-indigo-600 hover:text-indigo-800 edit-colors-btn" data-idx="${idx}">编辑</button>
                    </div>
                </td>
                <td class="px-2 py-2 text-center"><button type="button" class="text-red-500 hover:text-red-700 delete-material-btn" data-idx="${idx}">删除</button></td>
            </tr>
        `).join('');
    }
    if (cfgMachineHourlyRate) cfgMachineHourlyRate.value = String(PRICING_CONFIG.machine_hourly_rate_cny ?? 15);
    if (cfgSetupFee) cfgSetupFee.value = String(PRICING_CONFIG.setup_fee_cny ?? 0);
    if (cfgMinJobFee) cfgMinJobFee.value = String(PRICING_CONFIG.min_job_fee_cny ?? 0);
    if (cfgMaterialWaste) cfgMaterialWaste.value = String(PRICING_CONFIG.material_waste_percent ?? 5);
    if (cfgSupportPercent) cfgSupportPercent.value = String(PRICING_CONFIG.support_percent_of_model ?? 0);
    if (cfgPostPerPart) cfgPostPerPart.value = String(PRICING_CONFIG.post_process_fee_per_part_cny ?? 0);
    if (cfgTimeOverheadMin) cfgTimeOverheadMin.value = String(PRICING_CONFIG.time_overhead_min ?? 5);
    if (cfgTimeVolMinPerCm3) cfgTimeVolMinPerCm3.value = String(PRICING_CONFIG.time_vol_min_per_cm3 ?? 0.8);
    if (cfgDifficultyCoefficient) cfgDifficultyCoefficient.value = String(((Number(PRICING_CONFIG.difficulty_coefficient ?? 0.25) || 0) * 100).toFixed(2));
    if (cfgDifficultyRatioLow) cfgDifficultyRatioLow.value = String(PRICING_CONFIG.difficulty_ratio_low ?? 0.8);
    if (cfgDifficultyRatioHigh) cfgDifficultyRatioHigh.value = String(PRICING_CONFIG.difficulty_ratio_high ?? 4.0);
    if (cfgSupportPricePerG) cfgSupportPricePerG.value = String(PRICING_CONFIG.support_price_per_g ?? 0);
    if (cfgUnitCostFormula) cfgUnitCostFormula.value = String(PRICING_CONFIG.unit_cost_formula ?? '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) * difficulty_multiplier + support_cost_per_part_cny');
    if (cfgTotalCostFormula) cfgTotalCostFormula.value = String(PRICING_CONFIG.total_cost_formula ?? 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)');

    loadSlicerPresetSelection();
    renderSlicerPresetsUI();
}

// ── Sync pricing from inputs ──
export function syncPricingFromInputs() {
    const { cfgMachineHourlyRate, cfgSetupFee, cfgMinJobFee, cfgMaterialWaste,
        cfgSupportPercent, cfgPostPerPart, cfgTimeOverheadMin, cfgTimeVolMinPerCm3,
        cfgDifficultyCoefficient, cfgDifficultyRatioLow, cfgDifficultyRatioHigh,
        cfgSupportPricePerG, cfgUnitCostFormula, cfgTotalCostFormula } = dom;
    const diffCoeffPercent = Number(cfgDifficultyCoefficient?.value) || 0;
    setPricingConfig({
        ...PRICING_CONFIG,
        machine_hourly_rate_cny: Number(cfgMachineHourlyRate?.value) || 0,
        setup_fee_cny: Number(cfgSetupFee?.value) || 0,
        min_job_fee_cny: Number(cfgMinJobFee?.value) || 0,
        material_waste_percent: Number(cfgMaterialWaste?.value) || 0,
        support_percent_of_model: Number(cfgSupportPercent?.value) || 0,
        post_process_fee_per_part_cny: Number(cfgPostPerPart?.value) || 0,
        difficulty_coefficient: Math.max(0, diffCoeffPercent) / 100.0,
        difficulty_ratio_low: Number(cfgDifficultyRatioLow?.value) || 0,
        difficulty_ratio_high: Number(cfgDifficultyRatioHigh?.value) || 0,
        support_mode: 'on',
        support_price_per_g: Number(cfgSupportPricePerG?.value) || 0,
        time_overhead_min: Number(cfgTimeOverheadMin?.value) || 0,
        time_vol_min_per_cm3: Number(cfgTimeVolMinPerCm3?.value) || 0,
        unit_cost_formula: String(cfgUnitCostFormula?.value || '').trim(),
        total_cost_formula: String(cfgTotalCostFormula?.value || '').trim(),
    });
}

// ── Color editor ──
let _colorEditMaterialIdx = -1;

export function openColorEditor(materialIdx) {
    _colorEditMaterialIdx = materialIdx;
    const m = MATERIAL_OPTIONS[materialIdx];
    if (!m) return;
    const colors = materialColorsArray(m);
    const title = document.getElementById('color-editor-title');
    if (title) title.textContent = `编辑颜色 - ${m.name}`;
    const list = document.getElementById('color-editor-list');
    if (list) {
        list.innerHTML = colors.map(c => `
            <div class="flex items-center gap-2 p-1.5 bg-gray-50 rounded-md">
                <span class="w-6 h-6 rounded-sm border border-gray-400 flex-shrink-0" style="background:${c.hex}"></span>
                <span class="text-xs flex-1 font-mono">${c.hex}</span>
                <button type="button" class="text-red-400 hover:text-red-600 text-xs remove-color-btn" data-color-hex="${c.hex}">×</button>
            </div>
        `).join('');
    }
    const picker = document.getElementById('color-editor-picker');
    if (picker) picker.value = '#6366f1';
    const hexDisplay = document.getElementById('color-editor-hex');
    if (hexDisplay) hexDisplay.textContent = '#6366f1';
    const nameInput = document.getElementById('color-editor-name');
    if (nameInput) nameInput.value = '';
    const modal = document.getElementById('color-editor-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeColorEditor() {
    const modal = document.getElementById('color-editor-modal');
    if (modal) modal.classList.add('hidden');
    _colorEditMaterialIdx = -1;
}

export function addColorToMaterial() {
    const m = MATERIAL_OPTIONS[_colorEditMaterialIdx];
    if (!m) return;
    const hex = document.getElementById('color-editor-picker')?.value;
    if (!hex) return;
    if (!m.colors || !Array.isArray(m.colors)) m.colors = [];
    const existing = materialColorsArray(m);
    if (existing.some(c => c.hex === hex)) {
        const toast = document.getElementById('color-editor-toast');
        if (toast) { toast.textContent = '该颜色已存在'; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2000); }
        return;
    }
    m.colors.push({ name: hex, hex });
    if (!COLOR_OPTIONS.some(c => c.hex === hex)) COLOR_OPTIONS.push({ name: hex, hex });
    refreshQuoteColorDropdowns();
    renderUserCenterUI();
    openColorEditor(_colorEditMaterialIdx);
}

export function removeColorFromMaterial(hex) {
    const m = MATERIAL_OPTIONS[_colorEditMaterialIdx];
    if (!m || !Array.isArray(m.colors)) return;
    m.colors = m.colors.filter(c => colorToObj(c)?.hex !== hex);
    renderUserCenterUI();
    openColorEditor(_colorEditMaterialIdx);
}

// ── Formula validation ──
export async function validateCurrentFormulas() {
    const { formulaValidateMsg } = dom;
    if (!authToken) return false;
    try {
        syncPricingFromInputs();
        const payload = {
            unit_cost_formula: PRICING_CONFIG.unit_cost_formula,
            total_cost_formula: PRICING_CONFIG.total_cost_formula,
        };
        const res = await authFetch('/api/formula/validate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.status === 401) {
            if (formulaValidateMsg) { formulaValidateMsg.textContent = '登录已失效，请重新登录'; formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            openLoginModal(); return false;
        }
        if (res.status === 404) {
            if (formulaValidateMsg) { formulaValidateMsg.textContent = '校验接口未生效，请重启后端服务'; formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            return false;
        }
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok || !data || !data.ok) {
            const unitErr = data?.unit?.error ? `单件公式：${data.unit.error}` : '';
            const totalErr = data?.total?.error ? `总价公式：${data.total.error}` : '';
            const msg = [unitErr, totalErr].filter(Boolean).join('；') || '公式校验失败';
            if (formulaValidateMsg) { formulaValidateMsg.textContent = msg; formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            return false;
        }
        if (formulaValidateMsg) { formulaValidateMsg.textContent = '公式校验通过'; formulaValidateMsg.className = 'text-xs text-green-600'; formulaValidateMsg.classList.remove('hidden'); setTimeout(() => formulaValidateMsg.classList.add('hidden'), 3000); }
        return true;
    } catch (e) {
        if (formulaValidateMsg) { formulaValidateMsg.textContent = e.message || '公式校验失败'; formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
        return false;
    }
}

// ── Save user settings ──
export async function saveUserSettings() {
    const { userCenterModal, userCenterMsg } = dom;
    if (!authToken) return;
    try {
        const formulaOk = await validateCurrentFormulas();
        if (!formulaOk) return;
        syncPricingFromInputs();

        // Capture user center printer / nozzle / preset as defaults
        const cfgModel = document.getElementById("cfg-printer-model-main");
        const cfgNozzle = document.getElementById("cfg-nozzle-diameter");
        const genPreset = document.getElementById("gen-preset-select");
        const printerId = (cfgModel && cfgModel.value) ? cfgModel.value : defaultPrinterId;
        const nozzle = (cfgNozzle && cfgNozzle.value) ? cfgNozzle.value : defaultNozzle;
        const presetId = (genPreset && genPreset.value) ? Number(genPreset.value) : null;
        const effectivePresetId = presetId || defaultSlicerPresetId;

        const payload = {
            materials: MATERIAL_OPTIONS,
            pricing_config: PRICING_CONFIG,
            default_printer_id: printerId || null,
            default_nozzle: nozzle || null,
            default_slicer_preset_id: effectivePresetId || null,
        };
        const res = await authFetch('/api/user/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.status === 401) { if (userCenterModal) userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        if (!res.ok) {
            let data = null;
            try { data = await res.json(); } catch (e) {}
            throw new Error((data && data.detail) ? String(data.detail) : '保存失败');
        }
        if (userCenterMsg) { userCenterMsg.classList.remove('hidden'); setTimeout(() => userCenterMsg.classList.add('hidden'), 3000); }
        // Update local defaults so subsequent page loads see them
        setDefaultPrinterId(printerId || null);
        setDefaultNozzle(nozzle || null);
        setDefaultSlicerPresetId(effectivePresetId || null);
        // Sync batch toolbar with new defaults
        await fetchPrinterModels();
        await fetchSlicerPresets();
        setColorOptions(Array.from(new Set(MATERIAL_OPTIONS.flatMap((m) => Array.isArray(m.colors) ? m.colors : []))));
        updateDropdowns();
        normalizeResultsWithCurrentOptions();
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        if (userCenterModal) userCenterModal.classList.add('hidden');
        await reQuoteAllSelectedFiles('按新设置重算报价');
    } catch (e) { alert(e.message); }
}

// ── Set as defaults (admin) ──
export async function setAsDefaults() {
    const { userCenterMsg } = dom;
    if (!authToken || !currentUser?.is_admin) { alert('无管理员权限'); return; }
    try {
        const formulaOk = await validateCurrentFormulas();
        if (!formulaOk) return;
        syncPricingFromInputs();
        const payload = { materials: MATERIAL_OPTIONS, pricing_config: PRICING_CONFIG };
        const saveRes = await authFetch('/api/user/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (saveRes.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        if (!saveRes.ok) {
            let data = null;
            try { data = await saveRes.json(); } catch (e) {}
            throw new Error((data && data.detail) ? String(data.detail) : '保存失败');
        }
        const resp = await authFetch('/api/admin/defaults/from-me', { method: 'POST' });
        if (!resp.ok && currentUser?.is_admin) {
            let data = null;
            try { data = await resp.json(); } catch (e) {}
            throw new Error((data && data.message) ? String(data.message) : '设为默认失败');
        }
        if (userCenterMsg) { userCenterMsg.textContent = '已设为全局默认（新用户生效）'; userCenterMsg.classList.remove('hidden'); setTimeout(() => { userCenterMsg.classList.add('hidden'); }, 3000); }
    } catch (e) { alert(e.message); }
}

// ── Change password ──
export async function changePassword() {
    const { ucOldPassword, ucNewPassword, ucConfirmPassword, ucPasswordMsg, userCenterModal } = dom;
    const oldPwd = ucOldPassword?.value;
    const newPwd = ucNewPassword?.value;
    const confPwd = ucConfirmPassword?.value;
    if (!oldPwd || !newPwd || !confPwd) { showPwdMsg("所有密码字段必填", false); return; }
    if (newPwd !== confPwd) { showPwdMsg("两次输入的新密码不一致", false); return; }
    if (newPwd.length < 6) { showPwdMsg("新密码长度不能少于6位", false); return; }
    try {
        const res = await authFetch('/api/users/change-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd })
        });
        if (res.status === 401) { if (userCenterModal) userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        let data = {};
        try { data = await res.json(); } catch(e){}
        if (!res.ok) { showPwdMsg((data && data.detail) ? String(data.detail) : '修改失败', false); return; }
        showPwdMsg("修改成功，请重新登录", true);
        setTimeout(async () => {
            if (userCenterModal) userCenterModal.classList.add('hidden');
            setCurrentUser(null);
            setAuthToken("");
            const { renderAuthUI: rau, openLoginModal: olm } = await import('./auth.js');
            rau();
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            olm();
        }, 1500);
    } catch (e) { showPwdMsg(e.message, false); }
}

function showPwdMsg(text, ok) {
    const { ucPasswordMsg } = dom;
    if (!ucPasswordMsg) return;
    ucPasswordMsg.textContent = text;
    ucPasswordMsg.className = ok ? "text-xs text-green-600 block" : "text-xs text-red-600 block";
}
