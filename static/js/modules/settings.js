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
    defaultMaterial, setDefaultMaterial,
    defaultColor, setDefaultColor,
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
            setDefaultMaterial(data.default_material || null);
            setDefaultColor(data.default_color || null);
            // Sync default preset to quote options so auto-quote uses it
            if (data.default_slicer_preset_id) {
                quoteOptions.slicer_preset_id = data.default_slicer_preset_id;
                saveSlicerPresetSelection();
            }
            // Sync default material/color to quote options
            if (data.default_material) {
                quoteOptions.material = data.default_material;
            }
            if (data.default_color) {
                quoteOptions.color = data.default_color;
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
        const majorBrands = [
            { value: '通用', label: t('material.genericBrand') },
            { value: 'eSUN', label: t('material.brandESUN') },
            { value: 'Polymaker', label: 'Polymaker' },
            { value: 'Hatchbox', label: 'Hatchbox' },
            { value: 'Prusament', label: 'Prusament' },
            { value: 'SUNLU', label: 'SUNLU' },
            { value: 'Creality', label: 'Creality' },
            { value: 'Overture', label: 'Overture' },
            { value: 'ColorFabb', label: 'ColorFabb' },
            { value: 'MatterHackers', label: 'MatterHackers' },
            { value: 'Bambu Lab', label: 'Bambu Lab' },
            { value: 'Anycubic', label: 'Anycubic' },
            { value: 'Elegoo', label: 'Elegoo' },
            { value: 'Jayo', label: 'Jayo' },
            { value: 'Eryone', label: 'Eryone' },
            { value: 'custom', label: t('material.brandCustom') },
        ];
        materialsTbody.innerHTML = MATERIAL_OPTIONS.map((m, idx) => {
            const brand = m.brand || '通用';
            const isCustom = !majorBrands.some(b => b.value === brand);
            const brandOptionsHtml = majorBrands.map(b => {
                if (b.value === 'custom') return `<option value="custom" ${isCustom ? 'selected' : ''}>${b.label}</option>`;
                return `<option value="${b.value}" ${brand === b.value ? 'selected' : ''}>${b.label}</option>`;
            }).join('');
            const customBrandInput = isCustom ? `<input type="text" class="w-full border-gray-400 rounded-sm text-xs px-2 py-1.5 mt-1" value="${escapeHtml(brand)}" data-idx="${idx}" data-field="brand">` : '';
            
            return `
            <tr>
                <td class="px-3 py-2.5">
                    <select class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5 material-brand-select min-w-[120px]" data-idx="${idx}" data-field="brand">${brandOptionsHtml}</select>
                    <div class="custom-brand-input" data-idx="${idx}">${customBrandInput}</div>
                </td>
                <td class="px-3 py-2.5"><input type="text" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5" value="${escapeHtml(m.name)}" data-idx="${idx}" data-field="name"></td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5" value="${m.density}" data-idx="${idx}" data-field="density"></td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5" value="${m.price_per_kg}" data-idx="${idx}" data-field="price_per_kg"></td>
                <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${materialColorsArray(m).map(c => `<span class="w-5 h-5 rounded-sm border border-gray-400 inline-block cursor-pointer" style="background:${c.hex}" title="${escapeHtml(c.name)}" data-color-idx="${idx}" data-color-hex="${c.hex}"></span>`).join('')}
                        <button type="button" class="text-xs text-indigo-600 hover:text-indigo-800 edit-colors-btn ml-1" data-idx="${idx}">${t('common.edit')}</button>
                    </div>
                </td>
                <td class="px-3 py-2.5 text-center"><button type="button" class="text-red-500 hover:text-red-700 delete-material-btn" data-idx="${idx}">${t('common.delete')}</button></td>
            </tr>
        `}).join('');    }

    // Populate default material dropdown
    const defaultMaterialSel = document.getElementById('uc-default-material');
    if (defaultMaterialSel) {
        defaultMaterialSel.innerHTML = '<option value="">' + t('settings.notSet') + '</option>' +
            MATERIAL_OPTIONS.map(m => `<option value="${escapeHtml(m.name)}" ${defaultMaterial === m.name ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
    }

    // Populate default color dropdown using renderColorDropdown (色块+hex)
    const colorDropdownContainer = document.getElementById('uc-default-color-dropdown');
    if (colorDropdownContainer) {
        const matName = defaultMaterial || (MATERIAL_OPTIONS[0] ? MATERIAL_OPTIONS[0].name : '');
        const rendered = renderColorDropdown(matName, defaultColor || '');
        colorDropdownContainer.innerHTML = rendered.html;
        // Store the selected color in a hidden data attribute for save
        colorDropdownContainer.setAttribute('data-selected-color', rendered.selected || '');
    }

    // Update color dropdown when material changes
    if (defaultMaterialSel) {
        defaultMaterialSel.addEventListener('change', () => {
            const matName = defaultMaterialSel.value;
            if (colorDropdownContainer) {
                const rendered = renderColorDropdown(matName, '');
                colorDropdownContainer.innerHTML = rendered.html;
                colorDropdownContainer.setAttribute('data-selected-color', rendered.selected || '');
            }
        });
    }

    // Handle color selection in user center (delegated event)
    if (colorDropdownContainer) {
        colorDropdownContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.color-dd-item');
            if (item) {
                const hex = item.getAttribute('data-color-hex');
                if (hex) {
                    colorDropdownContainer.setAttribute('data-selected-color', hex);
                    // Sync model page color
                    quoteOptions.color = hex;
                    // Update batch color dropdown swatch
                    const batchColorContainer = document.getElementById('batch-color-dropdown');
                    if (batchColorContainer) {
                        const batchSwatch = batchColorContainer.querySelector('.color-dd-swatch');
                        if (batchSwatch) batchSwatch.style.background = hex;
                        const batchLabel = batchColorContainer.querySelector('.color-dd-label');
                        if (batchLabel) batchLabel.textContent = hex;
                        const batchValueInput = batchColorContainer.querySelector('.row-color-value');
                        if (batchValueInput) batchValueInput.value = hex;
                    }
                }
            }
        });
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
    const { userCenterModal, userCenterMsg, userCenterSaveBtn } = dom;
    if (!authToken) return;
    
    // Show loading state on button
    const originalBtnText = userCenterSaveBtn ? userCenterSaveBtn.textContent : '';
    if (userCenterSaveBtn) {
        userCenterSaveBtn.disabled = true;
        userCenterSaveBtn.textContent = t('settings.saving');
    }
    
    try {
        const formulaOk = await validateCurrentFormulas();
        if (!formulaOk) {
            if (userCenterSaveBtn) { userCenterSaveBtn.disabled = false; userCenterSaveBtn.textContent = originalBtnText; }
            return;
        }
        syncPricingFromInputs();

        // Capture user center printer / nozzle / preset as defaults
        const cfgModel = document.getElementById("cfg-printer-model-main");
        const cfgNozzle = document.getElementById("cfg-nozzle-diameter");
        const genPreset = document.getElementById("gen-preset-select");
        const printerId = (cfgModel && cfgModel.value) ? cfgModel.value : defaultPrinterId;
        const nozzle = (cfgNozzle && cfgNozzle.value) ? cfgNozzle.value : defaultNozzle;
        const presetId = (genPreset && genPreset.value) ? Number(genPreset.value) : null;
        const effectivePresetId = presetId || defaultSlicerPresetId;

        // Capture default material and color
        const defaultMaterialSel = document.getElementById("uc-default-material");
        const colorDropdownContainer = document.getElementById("uc-default-color-dropdown");
        const newDefaultMaterial = (defaultMaterialSel && defaultMaterialSel.value) ? defaultMaterialSel.value : null;
        const newDefaultColor = colorDropdownContainer ? (colorDropdownContainer.getAttribute('data-selected-color') || null) : null;

        const payload = {
            materials: MATERIAL_OPTIONS,
            pricing_config: PRICING_CONFIG,
            default_printer_id: printerId || null,
            default_nozzle: nozzle || null,
            default_slicer_preset_id: effectivePresetId || null,
            default_material: newDefaultMaterial,
            default_color: newDefaultColor,
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
        // Show success feedback on button
        if (userCenterSaveBtn) {
            userCenterSaveBtn.textContent = t('settings.saved');
            userCenterSaveBtn.classList.add('bg-green-600');
            userCenterSaveBtn.classList.remove('bg-indigo-600');
        }
        if (userCenterMsg) { userCenterMsg.classList.remove('hidden'); }
        // Update local defaults so subsequent page loads see them
        setDefaultPrinterId(printerId || null);
        setDefaultNozzle(nozzle || null);
        setDefaultSlicerPresetId(effectivePresetId || null);
        setDefaultMaterial(newDefaultMaterial);
        setDefaultColor(newDefaultColor);
        // Sync batch toolbar with new defaults
        await fetchPrinterModels();
        await fetchSlicerPresets();
        setColorOptions(Array.from(new Set(MATERIAL_OPTIONS.flatMap((m) => Array.isArray(m.colors) ? m.colors : []))));
        updateDropdowns();
        normalizeResultsWithCurrentOptions();
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        // Close modal after brief delay to show feedback
        setTimeout(() => {
            if (userCenterModal) userCenterModal.classList.add('hidden');
            // Restore button state
            if (userCenterSaveBtn) {
                userCenterSaveBtn.disabled = false;
                userCenterSaveBtn.textContent = originalBtnText;
                userCenterSaveBtn.classList.remove('bg-green-600');
                userCenterSaveBtn.classList.add('bg-indigo-600');
            }
            if (userCenterMsg) userCenterMsg.classList.add('hidden');
        }, 1200);
        await reQuoteAllSelectedFiles(t('settings.recalcAfterSave'));
    } catch (e) {
        // Restore button state on error
        if (userCenterSaveBtn) {
            userCenterSaveBtn.disabled = false;
            userCenterSaveBtn.textContent = originalBtnText;
        }
        alert(e.message);
    }
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
                setFieldValidation(qtyInput, 'error', t('quote.countMustBePositive'));
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
                if (matHint) { matHint.textContent = t('settings.selectMaterial'); matHint.classList.remove('hidden'); matHint.className = 'form-field-error'; }
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
                setFieldValidation(newPwd, 'error', t('settings.passwordMinLength'));
            } else if (newPwd.value.length >= 8) {
                setFieldValidation(newPwd, 'success');
            } else {
                setFieldValidation(newPwd, 'clear');
            }
            // Also re-check confirm
            if (confPwd && confPwd.value) {
                if (confPwd.value !== newPwd.value) {
                    setFieldValidation(confPwd, 'error', t('settings.passwordsMismatch'));
                } else {
                    setFieldValidation(confPwd, 'success', t('settings.passwordMatch'));
                }
            }
        });
    }

    if (confPwd) {
        confPwd.addEventListener('input', () => {
            if (newPwd && confPwd.value && confPwd.value !== newPwd.value) {
                setFieldValidation(confPwd, 'error', t('settings.passwordsMismatch'));
            } else if (newPwd && confPwd.value && confPwd.value === newPwd.value) {
                setFieldValidation(confPwd, 'success', t('settings.passwordMatch'));
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


