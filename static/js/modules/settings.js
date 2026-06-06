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
    userPreferences, setUserPreferences,
    savePreferencesToStorage, loadPreferencesFromStorage,
} from './state.js';
import { t } from './i18n.js';
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
            // Sync default preset to quote options so auto-quote uses it
            if (data.default_slicer_preset_id) {
                quoteOptions.slicer_preset_id = data.default_slicer_preset_id;
                saveSlicerPresetSelection();
            }
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
    if (!sel || sel.options.length <= 1) return '<option value="">' + t('printer.selectPrinter') + '</option>';
    let html = '<option value="">' + t('printer.selectPrinter') + '</option>';
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
                <td class="px-2 py-2"><input type="text" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${escapeHtml(m.brand || t('material.genericBrand'))}" data-idx="${idx}" data-field="brand"></td>
                <td class="px-2 py-2"><input type="number" step="0.01" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${m.density}" data-idx="${idx}" data-field="density"></td>
                <td class="px-2 py-2"><input type="number" step="0.01" class="w-full border-gray-400 rounded-sm text-xs px-1 py-1" value="${m.price_per_kg}" data-idx="${idx}" data-field="price_per_kg"></td>
                <td class="px-2 py-2">
                    <div class="flex flex-wrap items-center gap-1">
                        ${materialColorsArray(m).map(c => `<span class="w-4 h-4 rounded-sm border border-gray-400 inline-block cursor-pointer" style="background:${c.hex}" title="${escapeHtml(c.name)}" data-color-idx="${idx}" data-color-hex="${c.hex}"></span>`).join('')}
                        <button type="button" class="text-xs text-indigo-600 hover:text-indigo-800 edit-colors-btn" data-idx="${idx}">${t('common.edit')}</button>
                    </div>
                </td>
                <td class="px-2 py-2 text-center"><button type="button" class="text-red-500 hover:text-red-700 delete-material-btn" data-idx="${idx}">${t('common.delete')}</button></td>
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
    if (cfgSupportPricePerG) cfgSupportPricePerG.value = String(PRICING_CONFIG.support_price_per_g ?? 0);
    if (cfgUnitCostFormula) cfgUnitCostFormula.value = String(PRICING_CONFIG.unit_cost_formula ?? '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) + support_cost_per_part_cny');
    if (cfgTotalCostFormula) cfgTotalCostFormula.value = String(PRICING_CONFIG.total_cost_formula ?? 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)');

    loadSlicerPresetSelection();
    renderSlicerPresetsUI();
}

// ── Sync pricing from inputs ──
export function syncPricingFromInputs() {
    const { cfgMachineHourlyRate, cfgSetupFee, cfgMinJobFee, cfgMaterialWaste,
        cfgSupportPercent, cfgPostPerPart, cfgTimeOverheadMin, cfgTimeVolMinPerCm3,
        cfgSupportPricePerG, cfgUnitCostFormula, cfgTotalCostFormula } = dom;
    setPricingConfig({
        ...PRICING_CONFIG,
        machine_hourly_rate_cny: Number(cfgMachineHourlyRate?.value) || 0,
        setup_fee_cny: Number(cfgSetupFee?.value) || 0,
        min_job_fee_cny: Number(cfgMinJobFee?.value) || 0,
        material_waste_percent: Number(cfgMaterialWaste?.value) || 0,
        support_percent_of_model: Number(cfgSupportPercent?.value) || 0,
        post_process_fee_per_part_cny: Number(cfgPostPerPart?.value) || 0,
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
    if (title) title.textContent = t('settings.editColorsFor', { name: m.name });
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
        if (toast) { toast.textContent = t('material.colorExists'); toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2000); }
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
            if (formulaValidateMsg) { formulaValidateMsg.textContent = t('auth.sessionExpired'); formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            openLoginModal(); return false;
        }
        if (res.status === 404) {
            if (formulaValidateMsg) { formulaValidateMsg.textContent = t('settings.formulaEndpointDown'); formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            return false;
        }
        let data = null;
        try { data = await res.json(); } catch (e) {}
        if (!res.ok || !data || !data.ok) {
            const unitErr = data?.unit?.error ? t('settings.formulaUnit', { msg: data.unit.error }) : '';
            const totalErr = data?.total?.error ? t('settings.formulaTotal', { msg: data.total.error }) : '';
            const msg = [unitErr, totalErr].filter(Boolean).join('；') || t('settings.formulaValidationFailed');
            if (formulaValidateMsg) { formulaValidateMsg.textContent = msg; formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
            return false;
        }
        if (formulaValidateMsg) { formulaValidateMsg.textContent = t('settings.formulaValidationPassed'); formulaValidateMsg.className = 'text-xs text-green-600'; formulaValidateMsg.classList.remove('hidden'); setTimeout(() => formulaValidateMsg.classList.add('hidden'), 3000); }
        return true;
    } catch (e) {
        if (formulaValidateMsg) { formulaValidateMsg.textContent = e.message || t('settings.formulaValidationFailed'); formulaValidateMsg.className = 'text-xs text-red-600'; formulaValidateMsg.classList.remove('hidden'); }
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
        // Check preferences tab first, then printer tab
        const prefPrinter = document.getElementById("pref-default-printer");
        const printerId = (prefPrinter && prefPrinter.value) ? prefPrinter.value
            : (cfgModel && cfgModel.value) ? cfgModel.value : defaultPrinterId;
        const nozzle = (cfgNozzle && cfgNozzle.value) ? cfgNozzle.value : defaultNozzle;
        const presetId = (genPreset && genPreset.value) ? Number(genPreset.value) : null;
        const effectivePresetId = presetId || defaultSlicerPresetId;

        const payload = {
            materials: MATERIAL_OPTIONS,
            pricing_config: PRICING_CONFIG,
            default_printer_id: printerId || null,
            default_nozzle: nozzle || null,
            default_slicer_preset_id: effectivePresetId || null,
            user_preferences: {
                default_material: userPreferences.default_material,
                default_color: userPreferences.default_color,
                favorite_materials: userPreferences.favorite_materials,
                favorite_colors: userPreferences.favorite_colors,
                material_usage: userPreferences.material_usage,
                color_usage: userPreferences.color_usage,
                default_quantity: userPreferences.default_quantity,
                history_page_size: userPreferences.history_page_size,
                history_sort: userPreferences.history_sort,
                history_retention_days: userPreferences.history_retention_days,
                history_visible_columns: userPreferences.history_visible_columns,
            },
        };
        const res = await authFetch('/api/user/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (res.status === 401) { if (userCenterModal) userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        if (!res.ok) {
            let data = null;
            try { data = await res.json(); } catch (e) {}
            throw new Error((data && data.detail) ? String(data.detail) : t('settings.saveError'));
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
        await reQuoteAllSelectedFiles(t('settings.recalcAfterSave'));
    } catch (e) { alert(e.message); }
}

// ── Set as defaults (admin) ──
export async function setAsDefaults() {
    const { userCenterMsg } = dom;
    if (!authToken || !currentUser?.is_admin) { alert(t('settings.noAdminPermission')); return; }
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
            throw new Error((data && data.detail) ? String(data.detail) : t('settings.saveError'));
        }
        const resp = await authFetch('/api/admin/defaults/from-me', { method: 'POST' });
        if (!resp.ok && currentUser?.is_admin) {
            let data = null;
            try { data = await resp.json(); } catch (e) {}
            throw new Error((data && data.message) ? String(data.message) : t('settings.setDefaultFailed'));
        }
        if (userCenterMsg) { userCenterMsg.textContent = t('settings.setDefaultSuccess'); userCenterMsg.classList.remove('hidden'); setTimeout(() => { userCenterMsg.classList.add('hidden'); }, 3000); }
    } catch (e) { alert(e.message); }
}

// ── Change password ──
export async function changePassword() {
    const { ucOldPassword, ucNewPassword, ucConfirmPassword, ucPasswordMsg, userCenterModal } = dom;
    const oldPwd = ucOldPassword?.value;
    const newPwd = ucNewPassword?.value;
    const confPwd = ucConfirmPassword?.value;
    if (!oldPwd || !newPwd || !confPwd) { showPwdMsg(t('settings.allPasswordFieldsRequired'), false); return; }
    if (newPwd !== confPwd) { showPwdMsg(t('settings.passwordsMismatch'), false); return; }
    if (newPwd.length < 8) { showPwdMsg(t('settings.passwordTooShort'), false); return; }
    try {
        const res = await authFetch('/api/users/change-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd })
        });
        if (res.status === 401) { if (userCenterModal) userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        let data = {};
        try { data = await res.json(); } catch(e){}
        if (!res.ok) { showPwdMsg((data && data.detail) ? String(data.detail) : t('settings.changePasswordFailed'), false); return; }
        showPwdMsg(t('settings.changePasswordSuccess'), true);
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

// ── Form field validation helpers ──

/**
 * Show validation state on an input element.
 * @param {HTMLElement} input - The input element
 * @param {'error'|'success'|'clear'} state - Validation state
 * @param {string} [message] - Optional message to show below
 */
export function setFieldValidation(input, state, message) {
    if (!input) return;
    input.classList.remove('input-error', 'input-success');
    if (state === 'error') input.classList.add('input-error');
    if (state === 'success') input.classList.add('input-success');

    // Find or create hint element
    const hintId = input.id + '-hint';
    let hint = document.getElementById(hintId);
    if (!hint && message) {
        hint = document.createElement('span');
        hint.id = hintId;
        hint.className = 'form-field-hint';
        input.parentNode.insertBefore(hint, input.nextSibling);
    }
    if (hint) {
        hint.textContent = message || '';
        hint.classList.toggle('hidden', !message);
        hint.className = message
            ? (state === 'error' ? 'form-field-error' : 'form-field-hint')
            : 'form-field-hint hidden';
    }
}

/**
 * Validate the options-modal quantity input in real time.
 */
export function initOptionsFormValidation() {
    const qtyInput = document.getElementById('opt-quantity');
    const qtyDec = document.getElementById('opt-qty-dec');
    const qtyInc = document.getElementById('opt-qty-inc');
    const materialSelect = document.getElementById('opt-material');
    const qtyError = document.getElementById('opt-quantity-error');

    if (qtyInput) {
        qtyInput.addEventListener('input', () => {
            const val = parseInt(qtyInput.value, 10);
            if (isNaN(val) || val < 1) {
                setFieldValidation(qtyInput, 'error', '数量不能小于 1');
                if (qtyError) qtyError.classList.remove('hidden');
            } else {
                setFieldValidation(qtyInput, 'clear');
                if (qtyError) qtyError.classList.add('hidden');
            }
        });

        // Prevent non-numeric input
        qtyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                qtyInput.blur();
            }
        });

        // Auto-scroll focused input into view (keyboard adaptation)
        qtyInput.addEventListener('focus', () => {
            setTimeout(() => {
                qtyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
    }

    // Quantity stepper buttons
    function stepQty(delta) {
        if (!qtyInput) return;
        let val = parseInt(qtyInput.value, 10) || 1;
        val = Math.max(1, val + delta);
        qtyInput.value = val;
        qtyInput.dispatchEvent(new Event('input'));
        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate(10);
    }

    if (qtyDec) qtyDec.addEventListener('click', () => stepQty(-1));
    if (qtyInc) qtyInc.addEventListener('click', () => stepQty(1));

    // Material selection validation
    if (materialSelect) {
        materialSelect.addEventListener('change', () => {
            const matHint = document.getElementById('opt-material-hint');
            if (!materialSelect.value) {
                setFieldValidation(materialSelect, 'error');
                if (matHint) { matHint.textContent = '请选择材料'; matHint.classList.remove('hidden'); matHint.className = 'form-field-error'; }
            } else {
                setFieldValidation(materialSelect, 'clear');
                if (matHint) matHint.classList.add('hidden');
            }
        });
    }
}

/**
 * Add real-time validation for password fields.
 */
export function initPasswordFormValidation() {
    const oldPwd = document.getElementById('uc-old-password');
    const newPwd = document.getElementById('uc-new-password');
    const confPwd = document.getElementById('uc-confirm-password');

    if (newPwd) {
        newPwd.addEventListener('input', () => {
            if (newPwd.value.length > 0 && newPwd.value.length < 8) {
                setFieldValidation(newPwd, 'error', '密码至少需要 8 位');
            } else if (newPwd.value.length >= 8) {
                setFieldValidation(newPwd, 'success');
            } else {
                setFieldValidation(newPwd, 'clear');
            }
            // Also re-check confirm
            if (confPwd && confPwd.value) {
                if (confPwd.value !== newPwd.value) {
                    setFieldValidation(confPwd, 'error', '两次密码不一致');
                } else {
                    setFieldValidation(confPwd, 'success', '密码匹配');
                }
            }
        });
    }

    if (confPwd) {
        confPwd.addEventListener('input', () => {
            if (newPwd && confPwd.value && confPwd.value !== newPwd.value) {
                setFieldValidation(confPwd, 'error', '两次密码不一致');
            } else if (newPwd && confPwd.value && confPwd.value === newPwd.value) {
                setFieldValidation(confPwd, 'success', '密码匹配');
            } else {
                setFieldValidation(confPwd, 'clear');
            }
        });
    }

    // Auto-scroll focused password inputs into view
    [oldPwd, newPwd, confPwd].forEach(input => {
        if (!input) return;
        input.addEventListener('focus', () => {
            setTimeout(() => {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        });
    });
}

/**
 * Initialize all mobile form optimizations.
 * Call this once after DOM is ready.
 */
export function initMobileFormOptimizations() {
    initOptionsFormValidation();
    initPasswordFormValidation();
    initKeyboardViewportAdaptation();
    initOptionsModalAnimation();
}

/**
 * Detect virtual keyboard via visualViewport and adjust modal layout.
 */
function initKeyboardViewportAdaptation() {
    if (!window.visualViewport) return;
    const viewport = window.visualViewport;

    function onViewportResize() {
        // When keyboard opens, the viewport height shrinks significantly
        const isKeyboardOpen = viewport.height < window.innerHeight * 0.75;
        document.documentElement.classList.toggle('keyboard-open', isKeyboardOpen);

        // Keep any focused input visible
        if (isKeyboardOpen) {
            const focused = document.activeElement;
            if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) {
                setTimeout(() => {
                    focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        }
    }

    viewport.addEventListener('resize', onViewportResize);
    viewport.addEventListener('scroll', onViewportResize);
}

/**
 * Bottom-sheet slide animation for options modal on mobile.
 */
function initOptionsModalAnimation() {
    const modal = document.getElementById('options-modal');
    const panel = document.getElementById('options-modal-panel');
    if (!modal || !panel) return;

    // Override show/hide to include animation
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.attributeName !== 'class') continue;
            const isHidden = modal.classList.contains('hidden');
            if (!isHidden) {
                // Opening: remove hidden first, then animate in
                requestAnimationFrame(() => {
                    panel.classList.remove('translate-y-full');
                    panel.classList.add('translate-y-0');
                });
            } else {
                // Closing: reset for next open
                panel.classList.add('translate-y-full');
                panel.classList.remove('translate-y-0');
            }
        }
    });
    observer.observe(modal, { attributes: true });
}

// ══════════════════════════════════════════════════════════════
// ── Material & Color Preference Management ──
// ══════════════════════════════════════════════════════════════

/**
 * Toggle a material as favorite. Returns true if now favorited.
 */
export function toggleFavoriteMaterial(materialName) {
    const idx = userPreferences.favorite_materials.indexOf(materialName);
    if (idx >= 0) {
        userPreferences.favorite_materials.splice(idx, 1);
    } else {
        userPreferences.favorite_materials.push(materialName);
    }
    savePreferencesToStorage();
    _syncFavoritesToBackend();
    return idx < 0; // true = now favorited
}

/**
 * Check if a material is favorited.
 */
export function isFavoriteMaterial(materialName) {
    return userPreferences.favorite_materials.includes(materialName);
}

/**
 * Toggle a color (by hex) as favorite. Returns true if now favorited.
 */
export function toggleFavoriteColor(hex) {
    const norm = (hex || '').toLowerCase();
    const idx = userPreferences.favorite_colors.findIndex(c => c.toLowerCase() === norm);
    if (idx >= 0) {
        userPreferences.favorite_colors.splice(idx, 1);
    } else {
        userPreferences.favorite_colors.push(hex);
    }
    savePreferencesToStorage();
    _syncFavoritesToBackend();
    return idx < 0;
}

/**
 * Check if a color is favorited.
 */
export function isFavoriteColor(hex) {
    const norm = (hex || '').toLowerCase();
    return userPreferences.favorite_colors.some(c => c.toLowerCase() === norm);
}

/**
 * Record usage of a material (call after successful quote).
 */
export function trackMaterialUsage(materialName) {
    if (!materialName) return;
    userPreferences.material_usage[materialName] = (userPreferences.material_usage[materialName] || 0) + 1;
    savePreferencesToStorage();
}

/**
 * Record usage of a color (call after successful quote).
 */
export function trackColorUsage(hex) {
    if (!hex) return;
    const key = hex.toLowerCase();
    userPreferences.color_usage[key] = (userPreferences.color_usage[key] || 0) + 1;
    savePreferencesToStorage();
}

/**
 * Get materials sorted by usage (most used first), with favorites pinned at top.
 * @returns {Array} Sorted array of { name, count, isFavorite }
 */
export function getSortedMaterials() {
    const favorites = new Set(userPreferences.favorite_materials);
    const materials = MATERIAL_OPTIONS.map(m => ({
        name: m.name,
        count: userPreferences.material_usage[m.name] || 0,
        isFavorite: favorites.has(m.name),
    }));
    // Favorites first (sorted by usage desc), then non-favorites (sorted by usage desc)
    materials.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.count - a.count;
    });
    return materials;
}

/**
 * Get colors for a material sorted by usage, with favorites pinned.
 * @param {string} materialName
 * @returns {Array} Sorted array of { hex, name, count, isFavorite }
 */
export function getSortedColors(materialName) {
    const allowedColors = getColorsForMaterial(materialName);
    const favSet = new Set(userPreferences.favorite_colors.map(c => c.toLowerCase()));
    const colors = allowedColors.map(c => {
        const obj = colorToObj(c);
        if (!obj) return null;
        const hex = obj.hex || '';
        return {
            hex,
            name: obj.name || hex,
            count: userPreferences.color_usage[hex.toLowerCase()] || 0,
            isFavorite: favSet.has(hex.toLowerCase()),
        };
    }).filter(Boolean);
    colors.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.count - a.count;
    });
    return colors;
}

/**
 * Render the favorites & quick-select section for the options modal.
 * Inserts a favorites bar above the material dropdown.
 * @param {string} containerId - ID of the container element
 */
export function renderFavoritesPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sortedMaterials = getSortedMaterials();
    const favMaterials = sortedMaterials.filter(m => m.isFavorite);
    const topMaterials = sortedMaterials.slice(0, 5); // top 5 by usage

    // Favorites section
    let html = '<div class="favorites-panel mb-3">';
    if (favMaterials.length > 0) {
        html += '<div class="mb-2">';
        html += '<span class="text-xs font-medium text-gray-500">' + t('preference.favorites') + '</span>';
        html += '<div class="flex flex-wrap gap-1.5 mt-1">';
        favMaterials.forEach(m => {
            html += '<button type="button" class="pref-material-chip px-2 py-1 text-xs rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors" data-material="' + escapeHtml(m.name) + '">'
                + '★ ' + escapeHtml(m.name)
                + '</button>';
        });
        html += '</div></div>';
    }

    // Quick-select: top used materials
    if (topMaterials.length > 0 && topMaterials.some(m => m.count > 0)) {
        html += '<div class="mb-2">';
        html += '<span class="text-xs font-medium text-gray-500">' + t('preference.frequentlyUsed') + '</span>';
        html += '<div class="flex flex-wrap gap-1.5 mt-1">';
        topMaterials.forEach(m => {
            if (m.count > 0) {
                html += '<button type="button" class="pref-material-chip px-2 py-1 text-xs rounded-md border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors" data-material="' + escapeHtml(m.name) + '">'
                    + escapeHtml(m.name) + ' <span class="text-gray-400">(' + m.count + ')</span>'
                    + '</button>';
            }
        });
        html += '</div></div>';
    }
    html += '</div>';

    container.innerHTML = html;

    // Wire up click events for quick-select chips
    container.querySelectorAll('.pref-material-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const matName = btn.getAttribute('data-material');
            if (matName) {
                _quickSelectMaterial(matName);
            }
        });
    });
}

/**
 * Quick-select a material: update dropdown, refresh color dropdown, and record usage.
 */
function _quickSelectMaterial(materialName) {
    quoteOptions.material = materialName;
    // Update the material select
    const optMaterial = document.getElementById('opt-material');
    if (optMaterial) {
        optMaterial.value = materialName;
    }
    // Refresh color dropdown
    const rendered = renderColorDropdown(materialName, quoteOptions.color);
    const optColor = document.getElementById('opt-color');
    if (optColor) optColor.innerHTML = rendered.html;
    quoteOptions.color = rendered.selected;
    // Re-render favorites panel
    renderFavoritesPanel('pref-favorites-panel');
    // Render color quick-select for the new material
    renderColorFavoritesPanel('pref-color-favorites-panel');
    refreshOptionsSummary();
}

/**
 * Render color favorites & quick-select for the current material.
 * @param {string} containerId
 */
export function renderColorFavoritesPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sortedColors = getSortedColors(quoteOptions.material);
    const favColors = sortedColors.filter(c => c.isFavorite);
    const topColors = sortedColors.filter(c => c.count > 0).slice(0, 6);

    let html = '<div class="color-favorites-panel">';
    if (favColors.length > 0) {
        html += '<div class="mb-2">';
        html += '<span class="text-xs font-medium text-gray-500">' + t('preference.colorFavorites') + '</span>';
        html += '<div class="flex flex-wrap gap-1.5 mt-1">';
        favColors.forEach(c => {
            html += '<button type="button" class="pref-color-chip flex items-center gap-1 px-1.5 py-1 text-xs rounded-md border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors" data-color-hex="' + c.hex + '">'
                + '<span class="w-3.5 h-3.5 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + c.hex + '"></span>'
                + '<span class="text-indigo-700 font-mono text-[10px]">★ ' + c.hex + '</span>'
                + '</button>';
        });
        html += '</div></div>';
    }
    if (topColors.length > 0) {
        html += '<div>';
        html += '<span class="text-xs font-medium text-gray-500">' + t('preference.frequentColors') + '</span>';
        html += '<div class="flex flex-wrap gap-1.5 mt-1">';
        topColors.forEach(c => {
            html += '<button type="button" class="pref-color-chip flex items-center gap-1 px-1.5 py-1 text-xs rounded-md border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors" data-color-hex="' + c.hex + '">'
                + '<span class="w-3.5 h-3.5 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + c.hex + '"></span>'
                + '<span class="font-mono text-[10px]">' + c.hex + ' <span class="text-gray-400">(' + c.count + ')</span></span>'
                + '</button>';
        });
        html += '</div></div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // Wire up click events for color chips
    container.querySelectorAll('.pref-color-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const hex = btn.getAttribute('data-color-hex');
            if (hex) _quickSelectColor(hex);
        });
    });
}

/**
 * Quick-select a color.
 */
function _quickSelectColor(hex) {
    quoteOptions.color = hex;
    // Update the hidden input if present
    const colorVal = document.querySelector('#opt-color .row-color-value');
    if (colorVal) colorVal.value = hex;
    // Update the swatch display
    const swatch = document.querySelector('#opt-color .color-dd-swatch');
    if (swatch) swatch.style.background = hex;
    const label = document.querySelector('#opt-color .color-dd-label');
    if (label) label.textContent = hex;
    refreshOptionsSummary();
}

/**
 * Sync favorites to backend (debounced).
 */
let _syncTimer = null;
function _syncFavoritesToBackend() {
    if (!authToken) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
        try {
            const payload = {
                user_preferences: {
                    default_material: userPreferences.default_material,
                    default_color: userPreferences.default_color,
                    favorite_materials: userPreferences.favorite_materials,
                    favorite_colors: userPreferences.favorite_colors,
                    material_usage: userPreferences.material_usage,
                    color_usage: userPreferences.color_usage,
                    default_quantity: userPreferences.default_quantity,
                    history_page_size: userPreferences.history_page_size,
                    history_sort: userPreferences.history_sort,
                    history_retention_days: userPreferences.history_retention_days,
                    history_visible_columns: userPreferences.history_visible_columns,
                },
            };
            await authFetch('/api/user/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            console.warn('Failed to sync preferences to backend', e);
        }
    }, 1000);
}

/**
 * Load preferences from both localStorage and backend.
 * Call this during app initialization.
 */
export async function loadPreferences() {
    // Load from localStorage first (instant)
    loadPreferencesFromStorage();
    // Then try to load from backend
    if (authToken) {
        try {
            const res = await authFetch('/api/user/settings');
            if (res.ok) {
                const data = await res.json();
                if (data.user_preferences) {
                    setUserPreferences(data.user_preferences);
                    savePreferencesToStorage();
                }
            }
        } catch (e) {
            console.warn('Failed to load preferences from backend', e);
        }
    }
}

/**
 * Render usage statistics panel (for user center / settings page).
 * @param {string} containerId
 */
export function renderUsageStats(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const matEntries = Object.entries(userPreferences.material_usage)
        .sort((a, b) => b[1] - a[1]);
    const colorEntries = Object.entries(userPreferences.color_usage)
        .sort((a, b) => b[1] - a[1]);

    let html = '<div class="usage-stats space-y-3">';

    // Material usage stats
    if (matEntries.length > 0) {
        const maxCount = matEntries[0][1];
        html += '<div>';
        html += '<h4 class="text-xs font-semibold text-gray-600 mb-1.5">' + t('preference.materialStats') + '</h4>';
        html += '<div class="space-y-1">';
        matEntries.slice(0, 8).forEach(([name, count]) => {
            const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
            html += '<div class="flex items-center gap-2">';
            html += '<span class="text-xs text-gray-600 w-16 truncate">' + escapeHtml(name) + '</span>';
            html += '<div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">';
            html += '<div class="h-full bg-indigo-400 rounded-full" style="width:' + pct + '%"></div>';
            html += '</div>';
            html += '<span class="text-xs text-gray-400 w-8 text-right">' + count + '</span>';
            html += '</div>';
        });
        html += '</div></div>';
    }

    // Color usage stats
    if (colorEntries.length > 0) {
        const maxCount = colorEntries[0][1];
        html += '<div>';
        html += '<h4 class="text-xs font-semibold text-gray-600 mb-1.5">' + t('preference.colorStats') + '</h4>';
        html += '<div class="flex flex-wrap gap-2">';
        colorEntries.slice(0, 12).forEach(([hex, count]) => {
            const obj = colorToObj(hex);
            const displayHex = obj?.hex || hex;
            html += '<div class="flex items-center gap-1 px-1.5 py-1 rounded-md bg-gray-50 border border-gray-200">';
            html += '<span class="w-4 h-4 rounded-sm border border-gray-400" style="background:' + displayHex + '"></span>';
            html += '<span class="text-[10px] text-gray-500 font-mono">' + count + '×</span>';
            html += '</div>';
        });
        html += '</div></div>';
    }

    if (matEntries.length === 0 && colorEntries.length === 0) {
        html += '<p class="text-xs text-gray-400 text-center py-4">' + t('preference.noStats') + '</p>';
    }

    html += '</div>';
    container.innerHTML = html;
}

/**
 * Add star/favorite toggle buttons to material dropdown items.
 * Call this after updateDropdowns() renders the material select.
 */
export function enhanceMaterialDropdownWithFavorites() {
    const optMaterial = document.getElementById('opt-material');
    if (!optMaterial) return;

    // Wrap each option with a star indicator if favorited
    Array.from(optMaterial.options).forEach(opt => {
        if (isFavoriteMaterial(opt.value)) {
            opt.textContent = '★ ' + opt.textContent;
        }
    });
}

/**
 * Enhance the options modal with preference features.
 * Call this when the options modal is opened.
 */
export function initPreferencesUI() {
    renderFavoritesPanel('pref-favorites-panel');
    renderColorFavoritesPanel('pref-color-favorites-panel');
    enhanceMaterialDropdownWithFavorites();
}

/**
 * Render the preferences tab in user center.
 * Populates default material/color selects, favorite materials list, favorite colors, and usage stats.
 */
export function renderPreferencesTab() {
    // ── Default material select ──
    const defaultMatSelect = document.getElementById('pref-default-material');
    if (defaultMatSelect) {
        let opts = '<option value="">-- 不指定 --</option>';
        MATERIAL_OPTIONS.forEach(m => {
            const sel = userPreferences.default_material === m.name ? ' selected' : '';
            opts += '<option value="' + escapeHtml(m.name) + '"' + sel + '>' + escapeHtml(m.name) + '</option>';
        });
        defaultMatSelect.innerHTML = opts;
        defaultMatSelect.onchange = () => {
            userPreferences.default_material = defaultMatSelect.value || null;
            savePreferencesToStorage();
            _syncFavoritesToBackend();
            // Refresh default color options for selected material
            _renderDefaultColorOptions();
        };
    }
    // ── Default color select ──
    _renderDefaultColorOptions();
    // ── Default printer select ──
    const defaultPrinterSelect = document.getElementById('pref-default-printer');
    if (defaultPrinterSelect) {
        const mainPrinterSelect = document.getElementById('cfg-printer-model-main');
        let opts = '<option value="">-- 不指定 --</option>';
        if (mainPrinterSelect && mainPrinterSelect.options.length > 1) {
            Array.from(mainPrinterSelect.options).forEach(opt => {
                if (!opt.value) return;
                const sel = defaultPrinterId === opt.value ? ' selected' : '';
                opts += '<option value="' + opt.value + '"' + sel + '>' + opt.text + '</option>';
            });
        }
        defaultPrinterSelect.innerHTML = opts;
        defaultPrinterSelect.onchange = () => {
            setDefaultPrinterId(defaultPrinterSelect.value || null);
        };
    }

    // ── Default quantity ──
    const defaultQtyInput = document.getElementById('pref-default-quantity');
    if (defaultQtyInput) {
        defaultQtyInput.value = userPreferences.default_quantity || 1;
        defaultQtyInput.onchange = () => {
            userPreferences.default_quantity = Math.max(1, Number(defaultQtyInput.value) || 1);
            savePreferencesToStorage();
            _syncFavoritesToBackend();
        };
    }

    // ── History preferences ──
    const historyPageSize = document.getElementById('pref-history-page-size');
    if (historyPageSize) {
        historyPageSize.value = String(userPreferences.history_page_size || 20);
        historyPageSize.onchange = () => {
            userPreferences.history_page_size = Number(historyPageSize.value) || 20;
            savePreferencesToStorage();
            _syncFavoritesToBackend();
        };
    }

    const historySort = document.getElementById('pref-history-sort');
    if (historySort) {
        historySort.value = userPreferences.history_sort || 'newest';
        historySort.onchange = () => {
            userPreferences.history_sort = historySort.value;
            savePreferencesToStorage();
            _syncFavoritesToBackend();
        };
    }

    const historyRetention = document.getElementById('pref-history-retention');
    if (historyRetention) {
        historyRetention.value = String(userPreferences.history_retention_days || 0);
        historyRetention.onchange = () => {
            userPreferences.history_retention_days = Number(historyRetention.value) || 0;
            savePreferencesToStorage();
            _syncFavoritesToBackend();
        };
    }

    // ── History visible columns ──
    const historyColCheckboxes = document.querySelectorAll('.pref-history-col-cb');
    if (historyColCheckboxes.length > 0) {
        const visibleCols = userPreferences.history_visible_columns || ['material', 'quantity'];
        historyColCheckboxes.forEach(cb => {
            cb.checked = visibleCols.includes(cb.value);
            cb.onchange = () => {
                const cols = [];
                historyColCheckboxes.forEach(c => { if (c.checked) cols.push(c.value); });
                userPreferences.history_visible_columns = cols;
                savePreferencesToStorage();
                _syncFavoritesToBackend();
            };
        });
    }

    // ── History export button ──
    const historyExportBtn = document.getElementById('pref-history-export-btn');
    if (historyExportBtn) {
        historyExportBtn.onclick = () => _exportQuoteHistory();
    }

    // ── History clear button ──
    const historyClearBtn = document.getElementById('pref-history-clear-btn');
    if (historyClearBtn) {
        historyClearBtn.onclick = () => _clearQuoteHistory();
    }

    // ── Favorite materials list (checkboxes) ──
    const favMatContainer = document.getElementById('pref-favorite-materials');
    if (favMatContainer) {
        const sorted = getSortedMaterials();
        favMatContainer.innerHTML = sorted.map(m => {
            const checked = m.isFavorite ? ' checked' : '';
            return '<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">'
                + '<input type="checkbox" class="pref-fav-mat-cb rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" data-material="' + escapeHtml(m.name) + '"' + checked + '>'
                + '<span class="text-xs text-gray-700">' + escapeHtml(m.name) + '</span>'
                + (m.count > 0 ? '<span class="text-[10px] text-gray-400 ml-auto">(' + m.count + '次)</span>' : '')
                + '</label>';
        }).join('');
        // Wire checkbox change
        favMatContainer.querySelectorAll('.pref-fav-mat-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const name = cb.getAttribute('data-material');
                toggleFavoriteMaterial(name);
            });
        });
    }

    // ── Favorite colors ──
    const favColorContainer = document.getElementById('pref-favorite-colors');
    if (favColorContainer) {
        const favColors = userPreferences.favorite_colors || [];
        if (favColors.length === 0) {
            favColorContainer.innerHTML = '<span class="text-xs text-gray-400">暂无收藏颜色。在报价参数弹窗中点击颜色芯片可添加收藏。</span>';
        } else {
            favColorContainer.innerHTML = favColors.map(hex => {
                return '<div class="flex items-center gap-1.5 px-2 py-1 rounded-md border border-indigo-200 bg-indigo-50">'
                    + '<span class="w-4 h-4 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + hex + '"></span>'
                    + '<span class="text-xs font-mono text-indigo-700">' + hex + '</span>'
                    + '<button type="button" class="pref-remove-fav-color text-red-400 hover:text-red-600 text-xs ml-1" data-hex="' + hex + '">×</button>'
                    + '</div>';
            }).join('');
            favColorContainer.querySelectorAll('.pref-remove-fav-color').forEach(btn => {
                btn.addEventListener('click', () => {
                    toggleFavoriteColor(btn.getAttribute('data-hex'));
                    renderPreferencesTab(); // re-render
                });
            });
        }
    }

    // ── Usage stats ──
    renderUsageStats('pref-usage-stats');
}

/**
 * Export quote history as CSV file.
 */
async function _exportQuoteHistory() {
    const msg = document.getElementById('pref-history-msg');
    if (!authToken) { _showHistoryMsg('请先登录', false); return; }
    try {
        const res = await authFetch('/api/quote/history?limit=10000');
        if (!res.ok) {
            _showHistoryMsg('导出失败', false);
            return;
        }
        const data = await res.json();
        const records = data.items || data || [];
        if (!records.length) {
            _showHistoryMsg('暂无历史记录可导出', false);
            return;
        }
        // Build CSV
        const headers = ['时间', '文件名', '材料', '数量', '体积(cm³)', '重量(g)', '时间(h)', '费用(¥)', '状态'];
        const rows = records.map(r => [
            r.created_at || '',
            r.filename || '',
            r.material || '',
            r.quantity || 1,
            r.volume_cm3 || '',
            r.weight_g || '',
            r.estimated_time_h || '',
            r.cost_cny || '',
            r.status || '',
        ]);
        const BOM = '\uFEFF';
        const csv = BOM + [headers, ...rows].map(row =>
            row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '报价历史_' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _showHistoryMsg('导出成功', true);
    } catch (e) {
        _showHistoryMsg('导出失败: ' + e.message, false);
    }
}

/**
 * Clear all quote history (with confirmation).
 */
async function _clearQuoteHistory() {
    if (!authToken) { _showHistoryMsg('请先登录', false); return; }
    if (!confirm('确定要清空所有报价历史记录吗？此操作不可撤销。')) return;
    try {
        const res = await authFetch('/api/quote/history', { method: 'DELETE' });
        if (!res.ok) {
            let data = null;
            try { data = await res.json(); } catch (e) {}
            _showHistoryMsg(data?.detail || '清空失败', false);
            return;
        }
        _showHistoryMsg('历史记录已清空', true);
    } catch (e) {
        _showHistoryMsg('清空失败: ' + e.message, false);
    }
}

/**
 * Show a message in the history preferences section.
 */
function _showHistoryMsg(text, ok) {
    const msg = document.getElementById('pref-history-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? 'text-xs text-green-600 block mt-2' : 'text-xs text-red-600 block mt-2';
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
}

/**
 * Helper: render default color options based on current default material.
 */
function _renderDefaultColorOptions() {
    const defaultColorSelect = document.getElementById('pref-default-color');
    if (!defaultColorSelect) return;
    const matName = userPreferences.default_material;
    let colors = [];
    if (matName) {
        colors = getColorsForMaterial(matName);
    } else {
        // Show all unique colors
        colors = COLOR_OPTIONS;
    }
    const normColors = (colors || []).map(c => colorToObj(c)).filter(Boolean);
    let opts = '<option value="">-- 不指定 --</option>';
    normColors.forEach(c => {
        const sel = userPreferences.default_color === c.hex ? ' selected' : '';
        opts += '<option value="' + c.hex + '"' + sel + '>' + (c.name || c.hex) + ' (' + c.hex + ')</option>';
    });
    defaultColorSelect.innerHTML = opts;
    defaultColorSelect.onchange = () => {
        userPreferences.default_color = defaultColorSelect.value || null;
        savePreferencesToStorage();
        _syncFavoritesToBackend();
    };
}
