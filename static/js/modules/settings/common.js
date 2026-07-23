// ── Common: imports, DOM init, color wheel, fetch, dropdown helpers ──
import {
    authToken, currentUser, setCurrentUser, setAuthToken,
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
    loadFrontSettingsSnapshot,
    getBrandOptions, getMaterialsByBrand, getUsedBrandOptions, MATERIAL_TYPE_PRESETS,
} from '../state.js';
import { t } from '../i18n.js';
import { renderSlicerPresetsUI, fetchSlicerPresets, fetchPrinterModels } from '../presets.js';
import { refreshOptionsSummary, normalizeResultsWithCurrentOptions, renderResultsTable, recalcSummaryFromCurrentResults, reQuoteAllSelectedFiles, refreshBatchMaterialDropdown, refreshBatchBrandDropdown, maybeSnapshotBatchDirty } from '../quote.js';
import { refreshStyledSelectDropdowns } from '../styled-select.js';

export let dom = {};

export function initSettings(d) { dom = d; }

// Initialize the color wheel canvas after rendering a full-mode color wheel panel
export function _initColorWheelCanvas(container) {
    const canvas = container.querySelector('.cw-canvas');
    if (canvas) {
        const hex = container.querySelector('.row-color-value')?.value || '#d1d5db';
        const [r, g, b] = hexToRgb(hex);
        // Approximate hue/sat from hex for the selection dot
        let hue = 0, sat = 100;
        // Simple heuristic: compute hue from RGB
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
        if (mx !== mn) {
            const d = mx - mn;
            sat = (d / (1 - Math.abs(mx + mn - 1))) * 100;
            let h = 0;
            if (mx === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
            else if (mx === gn) h = ((bn - rn) / d + 2) / 6;
            else h = ((rn - gn) / d + 4) / 6;
            hue = h * 360;
        }
        drawColorWheel(canvas, hue, sat);
    }
}

// ── Fetch from API ──
export async function fetchUserSettings() {
    if (!authToken) return;
    try {
        const response = await authFetch('/api/user/settings');
        if (response.ok) {
            const data = await response.json();
            setMaterialOptions(data.materials || MATERIAL_OPTIONS);
            setPricingConfig(data.pricing_config || PRICING_CONFIG);
            setDefaultPrinterId(data.default_printer_id || null);
            setDefaultNozzle(data.default_nozzle || null);
            setDefaultSlicerPresetId(data.default_slicer_preset_id || null);
            setDefaultMaterial(data.default_material || null);
            setDefaultColor(data.default_color || null);
            setDefaultBrand(data.default_brand || null);
        }
    } catch (e) { console.error("Failed to fetch user settings", e); }

    // Fetch brand settings
    try {
        const brandResp = await authFetch('/api/user/brand-settings');
        if (brandResp.ok) {
            const brand = await brandResp.json();
            const bn = document.getElementById('brand-name');
            const bp = document.getElementById('brand-phone');
            const be = document.getElementById('brand-email');
            const ba = document.getElementById('brand-address');
            const bnote = document.getElementById('brand-note');
            const blp = document.getElementById('brand-logo-preview');
            if (bn) bn.value = brand.brand_name || '';
            if (bp) bp.value = brand.brand_phone || '';
            if (be) be.value = brand.brand_contact_email || '';
            if (ba) ba.value = brand.brand_address || '';
            if (bnote) bnote.value = brand.brand_note || '';
            if (blp && brand.brand_logo_url) {
                blp.innerHTML = `<img src="${brand.brand_logo_url}" class="w-full h-full object-contain rounded-md" />`;
                const delBtn = document.getElementById('brand-logo-delete-btn');
                if (delBtn) delBtn.classList.remove('hidden');
            } else {
                const delBtn = document.getElementById('brand-logo-delete-btn');
                if (delBtn) delBtn.classList.add('hidden');
            }
        }
    } catch (e) { console.error("Failed to fetch brand settings", e); }

    updateDropdowns();
    updateUploadLimitHint();
}

// ── Dropdown updates ──
export function updateDropdowns() {
    const { optMaterial, optColor } = dom;
    if (optMaterial) {
        optMaterial.innerHTML = MATERIAL_OPTIONS.map(m => `<option value="${m.name}">${m.name} (¥${Number(m.price_per_kg || 0).toFixed(2)}/KG)</option>`).join('');
        if (!MATERIAL_OPTIONS.find(m => m.name === quoteOptions.material) && MATERIAL_OPTIONS.length > 0) {
            quoteOptions.material = MATERIAL_OPTIONS[0].name;
        }
        const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color, false, quoteOptions.brand);
        if (optColor) optColor.innerHTML = rendered.html;
        _initColorWheelCanvas(optColor);
        quoteOptions.color = rendered.selected;
    }

    refreshOptionsSummary();
    refreshBatchBrandDropdown();
    refreshBatchMaterialDropdown();
    refreshStyledSelectDropdowns();
    refreshDefaultMaterialControls({ preserveValues: false, updateQuoteOptions: false });
    maybeSnapshotBatchDirty();
}

export function refreshQuoteColorDropdowns() {
    const { optColor } = dom;
    const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color, false, quoteOptions.brand);
    if (optColor) optColor.innerHTML = rendered.html;
    _initColorWheelCanvas(optColor);
    quoteOptions.color = rendered.selected;
}

function _renderDefaultColorDropdown(container, materialName, preferredColor, brand, shouldUpdateQuoteOptions) {
    if (!container || !materialName) return '';
    const rendered = renderColorDropdown(materialName, preferredColor || '', true, brand);
    container.innerHTML = rendered.html;
    _initColorWheelCanvas(container);
    container.setAttribute('data-selected-color', rendered.selected || '');
    if (shouldUpdateQuoteOptions) quoteOptions.color = rendered.selected || quoteOptions.color;
    return rendered.selected || '';
}

export function refreshDefaultMaterialControls(options = {}) {
    const { preserveValues = false, updateQuoteOptions = false } = options;
    const brandSel = document.getElementById('front-default-brand');
    const materialSel = document.getElementById('front-default-material');
    const colorContainer = document.getElementById('front-default-color-dropdown');
    if (!brandSel || !materialSel) return;
    const frontSnapshot = loadFrontSettingsSnapshot() || {};

    const usedBrands = getUsedBrandOptions();
    const desiredBrand = preserveValues
        ? (brandSel.value || '')
        : (frontSnapshot.brand || defaultBrand || brandSel.value || '');
    brandSel.innerHTML = usedBrands.map((brand) =>
        `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`
    ).join('');
    const activeBrand = usedBrands.includes(desiredBrand)
        ? desiredBrand
        : (usedBrands[0] || '');
    brandSel.value = activeBrand;

    const materials = getMaterialsByBrand(activeBrand);
    const desiredMaterial = preserveValues
        ? (materialSel.value || '')
        : (frontSnapshot.material || defaultMaterial || materialSel.value || '');
    materialSel.innerHTML = materials.map((material) =>
        `<option value="${escapeHtml(material.name)}">${escapeHtml(material.name)}</option>`
    ).join('');
    const nextMaterial = materials.some((material) => material.name === desiredMaterial)
        ? desiredMaterial
        : (materials[0]?.name || '');
    materialSel.value = nextMaterial;

    const desiredColor = preserveValues
        ? (colorContainer?.getAttribute('data-selected-color') || '')
        : (frontSnapshot.color || defaultColor || '');
    if (colorContainer && nextMaterial) {
        _renderDefaultColorDropdown(colorContainer, nextMaterial, desiredColor, activeBrand, updateQuoteOptions);
    }

    if (updateQuoteOptions) {
        quoteOptions.brand = activeBrand || '';
        quoteOptions.material = nextMaterial || '';
        const nextColor = colorContainer?.getAttribute('data-selected-color') || '';
        if (nextColor) quoteOptions.color = nextColor;
    }

    refreshStyledSelectDropdowns(['front-default-brand', 'front-default-material']);
}

export function buildPrinterOptionsHtml(selectedId) {
    const sel = document.getElementById("cfg-printer-model-main");
    if (!sel || sel.options.length === 0) return '';
    let html = '';
    for (const opt of sel.options) {
        if (!opt.value) continue;
        html += '<option value="' + opt.value + '"' + (opt.value === selectedId ? ' selected' : '') + '>' + opt.text + '</option>';
    }
    return html;
}

// ── Upload limit hint ──
export function updateUploadLimitHint() {
    const hint = document.getElementById('upload-limit-hint');
    if (!hint) return;
    const used = currentUser?.model_count_used;
    const limit = currentUser?.model_count_limit;
    if (limit != null && used != null) {
        const remaining = Math.max(0, limit - used);
        hint.textContent = t('quote.modelCountLimit', { used, limit, remaining }) || `免费用户：已用 ${used}/${limit} 个模型（剩余 ${remaining}）`;
    } else {
        hint.textContent = t('quote.memberUnlimited') || '会员：无限制';
    }
}
