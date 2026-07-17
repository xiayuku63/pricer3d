// ── Pricing config and formula validation ──
import {
    authToken, currentUser,
    MATERIAL_OPTIONS, setMaterialOptions,
    PRICING_CONFIG, setPricingConfig,
    quoteOptions,
    authFetch, colorToObj, escapeHtml,
    renderColorDropdown, getColorsForMaterial,
    hexToRgb, drawColorWheel,
    saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap,
    defaultPrinterId, setDefaultPrinterId,
    defaultNozzle, setDefaultNozzle,
    defaultSlicerPresetId, setDefaultSlicerPresetId,
    defaultMaterial, setDefaultMaterial,
    defaultColor, setDefaultColor,
    defaultBrand, setDefaultBrand,
    getBrandOptions, getMaterialsByBrand, getUsedBrandOptions, MATERIAL_TYPE_PRESETS,
} from '../state.js';
import { t } from '../i18n.js';
import { openLoginModal } from '../auth.js';
import { dom } from './common.js';

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
