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
    defaultBrand, setDefaultBrand,
    getBrandOptions, getMaterialsByBrand, getUsedBrandOptions, MATERIAL_TYPE_PRESETS,
} from './state.js';
import { t } from './i18n.js';
import { openLoginModal } from './auth.js';
import { renderSlicerPresetsUI, fetchSlicerPresets, fetchPrinterModels } from './presets.js';
import { refreshOptionsSummary, normalizeResultsWithCurrentOptions, renderResultsTable, recalcSummaryFromCurrentResults, reQuoteAllSelectedFiles, refreshBatchMaterialDropdown, refreshBatchBrandDropdown } from './quote.js';

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
            setDefaultBrand(data.default_brand || null);
            // Sync default preset to quote options so auto-quote uses it
            if (data.default_slicer_preset_id) {
                quoteOptions.slicer_preset_id = data.default_slicer_preset_id;
                saveSlicerPresetSelection();
            }
            // Sync default material/color/brand to quote options
            if (data.default_brand) {
                quoteOptions.brand = data.default_brand;
            }
            if (data.default_material) {
                quoteOptions.material = data.default_material;
            }
            if (data.default_color) {
                quoteOptions.color = data.default_color;
            }
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
        const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color);
        if (optColor) optColor.innerHTML = rendered.html;
        quoteOptions.color = rendered.selected;
    }
    refreshOptionsSummary();
    refreshBatchBrandDropdown();
    refreshBatchMaterialDropdown();
    // Sync batch printer with saved default
    const batchPrinterSel = document.getElementById('batch-printer-model');
    if (batchPrinterSel && defaultPrinterId) {
        const opts = Array.from(batchPrinterSel.options).map(o => o.value);
        if (opts.includes(defaultPrinterId)) batchPrinterSel.value = defaultPrinterId;
    }
    // Sync batch nozzle with saved default
    const batchNozzleSel = document.getElementById('batch-nozzle-diameter');
    if (batchNozzleSel && defaultNozzle) {
        const nozzleOpts = Array.from(batchNozzleSel.options).map(o => o.value);
        if (nozzleOpts.includes(String(defaultNozzle))) batchNozzleSel.value = String(defaultNozzle);
    }
    // Sync batch preset with saved default
    const batchPresetSel = document.getElementById('batch-slicer-preset');
    if (batchPresetSel) {
        const presetOpts = Array.from(batchPresetSel.options).map(o => o.value);
        const presetId = String(quoteOptions.slicer_preset_id || '');
        if (presetId && presetOpts.includes(presetId)) batchPresetSel.value = presetId;
    }
}

// ── Restore default materials ──
const _DEFAULT_MATERIALS = [
    { name: "PLA", brand: "Generic", density: 1.24, price_per_kg: 80.0 },
    { name: "PLA+", brand: "Generic", density: 1.24, price_per_kg: 90.0 },
    { name: "PETG", brand: "Generic", density: 1.27, price_per_kg: 100.0 },
    { name: "ABS", brand: "Generic", density: 1.04, price_per_kg: 95.0 },
    { name: "ASA", brand: "Generic", density: 1.07, price_per_kg: 120.0 },
    { name: "TPU", brand: "Generic", density: 1.21, price_per_kg: 160.0 },
    { name: "PA", brand: "Generic", density: 1.14, price_per_kg: 200.0 },
    { name: "PC", brand: "Generic", density: 1.20, price_per_kg: 180.0 },
];
export function restoreDefaultMaterials() {
    if (!confirm(t('material.confirmRestore') || '确定恢复默认材料列表？自定义材料将丢失。')) return;
    const defaultColors = [
        { name: '白色', hex: '#ffffff' }, { name: '黑色', hex: '#000000' },
        { name: '灰色', hex: '#808080' }, { name: '红色', hex: '#dc2626' },
        { name: '蓝色', hex: '#2563eb' }, { name: '绿色', hex: '#16a34a' },
        { name: '黄色', hex: '#ca8a04' }, { name: '橙色', hex: '#ea580c' },
        { name: '紫色', hex: '#933333' }, { name: '粉色', hex: '#db2777' },
    ];
    setMaterialOptions(_DEFAULT_MATERIALS.map(m => ({ ...m, colors: defaultColors.map(c => ({ ...c })) })));
    updateDropdowns();
    renderUserCenterUI(dom);
}

export function refreshQuoteColorDropdowns() {
    const { optColor } = dom;
    const rendered = renderColorDropdown(quoteOptions.material, quoteOptions.color);
    if (optColor) optColor.innerHTML = rendered.html;
    quoteOptions.color = rendered.selected;
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
            { value: 'Generic', label: t('material.genericBrand') },
            { value: 'eSUN', label: 'eSUN' },
            { value: 'Polymaker', label: 'Polymaker' },
            { value: 'Hatchbox', label: 'Hatchbox' },
            { value: 'Prusament', label: 'Prusament' },
            { value: 'Prusa', label: 'Prusa' },
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
            { value: 'Voron', label: 'Voron' },
            { value: 'custom', label: t('material.brandCustom') },
        ];

        // Populate default brand dropdown (only brands with materials configured)
        const defaultBrandSel = document.getElementById('uc-default-brand');
        if (defaultBrandSel) {
            const usedBrands = getUsedBrandOptions();
            defaultBrandSel.innerHTML = usedBrands.map(b =>
                `<option value="${escapeHtml(b)}" ${defaultBrand === b ? 'selected' : ''}>${escapeHtml(b)}</option>`
            ).join('');
            if (!defaultBrandSel.value && defaultBrandSel.options.length) defaultBrandSel.value = defaultBrandSel.options[0].value;
        }

        materialsTbody.innerHTML = MATERIAL_OPTIONS.map((m, idx) => {
            const brand = m.brand || 'Generic';
            const knownBrandValues = majorBrands.filter(b => b.value !== 'custom').map(b => b.value);
            const isCustomBrand = !knownBrandValues.includes(brand);
            
            // 构建材料类型选项
            const presetTypes = Object.keys(MATERIAL_TYPE_PRESETS);
            const isInPreset = presetTypes.includes(m.name);
            
            const brandCustomBadge = isCustomBrand ? `<span class="custom-brand-badge text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0" title="${t('material.brandCustom') || '自定义品牌'}">${t('material.brandCustom') || '自定义'}</span>` : '';
            const typeCustomBadge = !isInPreset ? `<span class="custom-type-badge text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0" title="${t('material.typeCustom') || '自定义类型'}">${t('material.typeCustom') || '自定义'}</span>` : '';
            
            return `
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2.5">
                    <div class="flex items-center gap-1">
                        <input type="text" list="brand-options-${idx}" class="flex-1 w-full border-gray-300 rounded-md text-xs px-2 py-1.5 material-brand-input min-w-[100px]" value="${escapeHtml(brand)}" data-idx="${idx}" data-field="brand" placeholder="${t('material.brandPlaceholder') || '输入或选择品牌'}">
                        ${brandCustomBadge}
                    </div>
                    <datalist id="brand-options-${idx}">
                        ${majorBrands.filter(b => b.value !== 'custom').map(b => `<option value="${b.value}">${b.label}</option>`).join('')}
                    </datalist>
                </td>
                <td class="px-3 py-2.5">
                    <div class="flex items-center gap-1">
                        <input type="text" list="type-options-${idx}" class="flex-1 w-full border-gray-300 rounded-md text-xs px-2 py-1.5 material-type-input" value="${escapeHtml(m.name)}" data-idx="${idx}" data-field="name" placeholder="${t('material.typePlaceholder') || '输入或选择类型'}">
                        ${typeCustomBadge}
                    </div>
                    <datalist id="type-options-${idx}">
                        ${presetTypes.map(tp => `<option value="${tp}">`).join('')}
                    </datalist>
                </td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5" value="${m.density}" data-idx="${idx}" data-field="density"></td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5" value="${m.price_per_kg}" data-idx="${idx}" data-field="price_per_kg"></td>
                <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${materialColorsArray(m).map(c => `<span class="w-5 h-5 rounded-sm border border-gray-400 inline-block cursor-pointer" style="background:${c.hex}" title="${escapeHtml(c.name)}" data-color-idx="${idx}" data-color-hex="${c.hex}"></span>`).join('')}
                        <button type="button" class="text-xs text-indigo-600 hover:text-indigo-800 edit-colors-btn ml-1" data-idx="${idx}">${t('common.edit')}</button>
                    </div>
                </td>
                <td class="px-3 py-2.5 text-center"><button type="button" class="text-xs text-red-500 hover:text-red-700 delete-material-btn" data-idx="${idx}">${t('common.delete')}</button></td>
            </tr>
        `}).join('');

        // ── 材料表格排序 ──
        const thead = materialsTbody.closest('table')?.querySelector('thead');
        if (thead) {
            // 排序状态（模块级变量）
            if (!renderUserCenterUI._matSort) renderUserCenterUI._matSort = { key: '', dir: 'asc' };
            const st = renderUserCenterUI._matSort;
            const sortArrows = thead.querySelectorAll('.sort-arrow');
            // 更新箭头显示
            const updateArrows = () => {
                sortArrows.forEach(s => s.textContent = '');
                const activeTh = thead.querySelector(`[data-sort-key="${st.key}"] .sort-arrow`);
                if (activeTh) activeTh.textContent = st.dir === 'asc' ? ' ▲' : ' ▼';
            };
            updateArrows();
            // 绑定点击
            thead.querySelectorAll('[data-sort-key]').forEach(th => {
                th.onclick = () => {
                    const key = th.getAttribute('data-sort-key');
                    if (st.key === key) { st.dir = st.dir === 'asc' ? 'desc' : 'asc'; }
                    else { st.key = key; st.dir = 'asc'; }
                    const getVal = (m) => {
                        if (key === 'brand') return (m.brand || '').toLowerCase();
                        if (key === 'name') return (m.name || '').toLowerCase();
                        if (key === 'density') return Number(m.density) || 0;
                        if (key === 'price') return Number(m.price_per_kg) || 0;
                        return '';
                    };
                    MATERIAL_OPTIONS.sort((a, b) => {
                        const va = getVal(a), vb = getVal(b);
                        if (typeof va === 'number' && typeof vb === 'number') return st.dir === 'asc' ? va - vb : vb - va;
                        return st.dir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
                    });
                    updateArrows();
                    renderUserCenterUI(dom);
                };
            });
        }
    }

    // Populate default brand dropdown (only brands with materials configured)
    const defaultBrandSel = document.getElementById('uc-default-brand');
    if (defaultBrandSel) {
        const usedBrands = getUsedBrandOptions();
        defaultBrandSel.innerHTML = usedBrands.map(b =>
            `<option value="${escapeHtml(b)}" ${defaultBrand === b ? 'selected' : ''}>${escapeHtml(b)}</option>`
        ).join('');
        // 如果已选品牌不在列表中，重置为第一个
        if (!defaultBrandSel.value && defaultBrandSel.options.length) {
            defaultBrandSel.value = defaultBrandSel.options[0].value;
        }
        if (defaultBrandSel.value !== defaultBrand) {
            quoteOptions.brand = defaultBrandSel.value;
        }
    }

    // Populate default material dropdown (filtered by selected brand)
    const defaultMaterialSel = document.getElementById('uc-default-material');
    const _refreshDefaultMaterialList = (brand) => {
        if (!defaultMaterialSel) return;
        const materials = getMaterialsByBrand(brand);
        defaultMaterialSel.innerHTML = materials.map(m =>
            `<option value="${escapeHtml(m.name)}" ${defaultMaterial === m.name ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
        ).join('');
        // 如果已选材料不在列表中，重置为第一个
        if (!defaultMaterialSel.value && defaultMaterialSel.options.length) {
            defaultMaterialSel.value = defaultMaterialSel.options[0].value;
        }
        if (defaultMaterialSel.value !== defaultMaterial) {
            quoteOptions.material = defaultMaterialSel.value;
        }
    };
    _refreshDefaultMaterialList(defaultBrandSel ? defaultBrandSel.value : '');

    // Brand → Material filtering
    const _brandSel = document.getElementById('uc-default-brand');
    if (_brandSel) {
        _brandSel.addEventListener('change', () => {
            _refreshDefaultMaterialList(_brandSel.value);
            // Reset color dropdown
            if (colorDropdownContainer) {
                const matName = defaultMaterialSel.value;
                const rendered = renderColorDropdown(matName, '');
                colorDropdownContainer.innerHTML = rendered.html;
                colorDropdownContainer.setAttribute('data-selected-color', rendered.selected || '');
            }
        });
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

     // ── Brand customization: show/hide based on membership ──
     const isMember = currentUser?.membership_level === 'member';
     const brandForm = document.getElementById('brand-member-only');
     const brandHint = document.getElementById('brand-upgrade-hint');
     if (brandForm) brandForm.classList.toggle('hidden', !isMember);
     if (brandHint) brandHint.classList.toggle('hidden', isMember);

     // ── Formula read-only for free users ──
     const formulaTextareas = document.querySelectorAll('#cfg-unit-cost-formula, #cfg-total-cost-formula');
     formulaTextareas.forEach(ta => {
         ta.readOnly = !isMember;
         ta.classList.toggle('bg-gray-100', !isMember);
         ta.classList.toggle('cursor-not-allowed', !isMember);
     });
     const formulaValidateBtn = document.getElementById('formula-validate-btn');
     const formulaResetBtn = document.getElementById('formula-reset-btn');
     if (formulaValidateBtn) formulaValidateBtn.classList.toggle('hidden', !isMember);
     if (formulaResetBtn) formulaResetBtn.classList.toggle('hidden', !isMember);
     let upgradeHint = document.getElementById('formula-member-hint');
     if (!upgradeHint) {
         upgradeHint = document.createElement('p');
         upgradeHint.id = 'formula-member-hint';
         upgradeHint.className = 'text-xs text-amber-600 mt-1';
         const container = document.getElementById('formula-container');
         if (container) container.parentNode.insertBefore(upgradeHint, container);
     }
     upgradeHint.textContent = isMember ? '' : (t('settings.formulaMemberOnly') || '升级会员可自定义计算公式');
     upgradeHint.classList.toggle('hidden', isMember);
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

        // Capture default brand, material and color
        const defaultBrandSel = document.getElementById("uc-default-brand");
        const defaultMaterialSel = document.getElementById("uc-default-material");
        const colorDropdownContainer = document.getElementById("uc-default-color-dropdown");
        const newDefaultBrand = (defaultBrandSel && defaultBrandSel.value) ? defaultBrandSel.value : null;
        const newDefaultMaterial = (defaultMaterialSel && defaultMaterialSel.value) ? defaultMaterialSel.value : null;
        const newDefaultColor = colorDropdownContainer ? (colorDropdownContainer.getAttribute('data-selected-color') || null) : null;

        const isMemberSave = currentUser?.membership_level === 'member';
        const pricingToSend = isMemberSave ? PRICING_CONFIG : (() => {
            const { unit_cost_formula, total_cost_formula, ...rest } = PRICING_CONFIG;
            return rest;
        })();
        const payload = {
            materials: MATERIAL_OPTIONS,
            pricing_config: pricingToSend,
            default_printer_id: printerId || null,
            default_nozzle: nozzle || null,
            default_slicer_preset_id: effectivePresetId || null,
            default_brand: newDefaultBrand,
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

        // Save brand settings (member only)
        if (currentUser?.membership_level === 'member') {
            try {
                const brandPayload = {
                    brand_name: document.getElementById('brand-name')?.value || '',
                    brand_phone: document.getElementById('brand-phone')?.value || '',
                    brand_contact_email: document.getElementById('brand-email')?.value || '',
                    brand_address: document.getElementById('brand-address')?.value || '',
                    brand_note: document.getElementById('brand-note')?.value || '',
                };
                await authFetch('/api/user/brand-settings', {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brandPayload)
                });
            } catch (e) { console.error("Failed to save brand settings", e); }
        }
        // Update local defaults so subsequent page loads see them
        setDefaultPrinterId(printerId || null);
        setDefaultNozzle(nozzle || null);
        setDefaultSlicerPresetId(effectivePresetId || null);
        setDefaultMaterial(newDefaultMaterial);
        setDefaultColor(newDefaultColor);
        setDefaultBrand(newDefaultBrand);
        // Sync quoteOptions so batch toolbar updates immediately
        quoteOptions.brand = newDefaultBrand || '';
        // 确保材料在当前品牌下有效
        const validMaterials = getMaterialsByBrand(quoteOptions.brand);
        if (newDefaultMaterial && validMaterials.some(m => m.name === newDefaultMaterial)) {
            quoteOptions.material = newDefaultMaterial;
        } else if (validMaterials.length) {
            quoteOptions.material = validMaterials[0].name;
        }
        quoteOptions.color = newDefaultColor || quoteOptions.color;
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

// ── Logo upload handler ──
export function initBrandLogoUpload() {
    const uploadBtn = document.getElementById('brand-logo-upload-btn');
    const fileInput = document.getElementById('brand-logo-input');
    const preview = document.getElementById('brand-logo-preview');
    if (!uploadBtn || !fileInput) return;
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            alert(t('settings.logoTooLarge') || 'Logo 文件不能超过 2MB');
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        try {
            const resp = await authFetch('/api/user/brand-logo', { method: 'POST', body: fd });
            if (resp.ok) {
                const data = await resp.json();
                if (preview && data.url) {
                    preview.innerHTML = `<img src="${data.url}" class="w-full h-full object-contain rounded-md" />`;
                }
            }
        } catch (e) { console.error("Logo upload failed", e); }
        fileInput.value = '';
    });
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


