// ── Materials / Category CRUD ──
import {
    authToken, currentUser,
    MATERIAL_OPTIONS, setMaterialOptions,
    COLOR_OPTIONS, setColorOptions,
    PRICING_CONFIG, setPricingConfig,
    quoteOptions,
    authFetch, colorToObj, materialColorsArray, escapeHtml,
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
import { renderSlicerPresetsUI, fetchSlicerPresets, fetchPrinterModels } from '../presets.js';
import { refreshOptionsSummary, normalizeResultsWithCurrentOptions, renderResultsTable, recalcSummaryFromCurrentResults, reQuoteAllSelectedFiles, refreshBatchMaterialDropdown, refreshBatchBrandDropdown } from '../quote.js';
import { _initColorWheelCanvas, updateDropdowns, refreshQuoteColorDropdowns, dom } from './common.js';

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

/**
 * Get available material types for a row, excluding types already used by same brand.
 */
function _getTypeOptionsForRow(m, rowIdx) {
    const brand = (m.brand || 'Generic').trim();
    const allTypes = new Set(Object.keys(MATERIAL_TYPE_PRESETS));
    // Include custom types from MATERIAL_OPTIONS
    for (const mat of MATERIAL_OPTIONS) {
        if (mat.name && !MATERIAL_TYPE_PRESETS[mat.name]) allTypes.add(mat.name);
    }
    // Exclude types already used by same brand in other rows
    for (let i = 0; i < MATERIAL_OPTIONS.length; i++) {
        if (i === rowIdx) continue;
        const other = MATERIAL_OPTIONS[i];
        if ((other.brand || 'Generic').trim() === brand && other.name) {
            allTypes.delete(other.name);
        }
    }
    // Always keep current row's type
    if (m.name) allTypes.add(m.name);
    return [...allTypes].sort();
}

/**
 * Render a custom combo input (input + styled dropdown) to replace <input>+<datalist>.
 * Supports typing to filter and clicking to select. Dropdown uses CSS variables for
 * dark-mode compatibility.
 * @param {string[]} opts - Array of option strings
 * @param {string} value - Current input value
 * @param {number|string} dataIdx - data-idx attribute value
 * @param {string} dataField - data-field attribute value ('brand' or 'name')
 * @returns {string} HTML string for the combo component
 */
function renderComboInput(opts, value, dataIdx, dataField) {
    const escVal = escapeHtml(value);
    const optHtml = opts.map(o =>
        `<div class="combo-opt px-2 py-1 text-xs cursor-pointer hover:bg-gray-100 truncate" data-val="${escapeHtml(o)}" onmousedown="event.preventDefault();var p=this.closest('.combo-w');var i=p.querySelector('.combo-i');i.value=this.getAttribute('data-val');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));p.querySelector('.combo-d').classList.add('hidden');i.blur();">${escapeHtml(o)}</div>`
    ).join('');
            return ` \
            <span class="combo-w relative" style="display:inline-flex;align-items:center;flex:1;min-width:0"> \
                <input type="text" class="combo-i flex-1 min-w-0 border-gray-300 rounded-md text-xs px-2 py-1.5 tw-bg-surface" value="${escVal}" autocomplete="off" data-idx="${dataIdx}" data-field="${dataField}" onfocus="this.parentElement.querySelector('.combo-d').classList.remove('hidden')" oninput="var q=this.value.toLowerCase();var d=this.parentElement.querySelector('.combo-d');d.querySelectorAll('.combo-opt').forEach(function(o){o.classList.toggle('hidden',o.textContent.toLowerCase().indexOf(q)===-1)});d.classList.remove('hidden')" onblur="setTimeout(function(el){var dd=el.parentElement?.querySelector('.combo-d');if(dd)dd.classList.add('hidden')},150,this)"> \
                <span class="combo-badge text-[11px] text-amber-500 leading-none flex-shrink-0 cursor-help ml-1 hidden" title="${dataField === 'brand' ? (t('material.brandCustom') || '自定义品牌') : (t('material.typeCustom') || '自定义类型')}">✦</span> \
                <div class="combo-d hidden absolute z-50 left-0 right-0 top-full mt-0.5 border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto" style="background:var(--color-surface);color:var(--color-text);min-width:100px">${optHtml}</div> \
            </span>`;
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

        // Populate default brand dropdown (all brands including MAJOR_BRANDS)
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

            return `
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2.5">
                    <div class="flex items-center gap-1">
                        ${renderComboInput(getBrandOptions(), brand, idx, 'brand')}
                    </div>
                </td>
                <td class="px-3 py-2.5">
                    <div class="flex items-center gap-1">
                        ${renderComboInput(_getTypeOptionsForRow(m, idx), m.name, idx, 'name')}
                    </div>
                </td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5 tw-bg-surface" value="${m.density}" data-idx="${idx}" data-field="density"></td>
                <td class="px-3 py-2.5"><input type="number" step="0.01" class="w-full border-gray-300 rounded-md text-xs px-2 py-1.5 tw-bg-surface" value="${m.price_per_kg}" data-idx="${idx}" data-field="price_per_kg"></td>
                <td class="px-3 py-2.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${materialColorsArray(m).map(c => `<span class="w-5 h-5 rounded-sm border border-gray-400 inline-block cursor-pointer" style="background:${c.hex}" title="${escapeHtml(c.name)}" data-color-idx="${idx}" data-color-hex="${c.hex}"></span>`).join('')}
                        <button type="button" class="text-xs text-indigo-600 hover:text-indigo-800 edit-colors-btn ml-1" data-idx="${idx}">${t('common.edit')}</button>
                    </div>
                </td>
                <td class="px-3 py-2.5 text-center"><button type="button" class="text-xs tw-text-danger hover:tw-text-danger delete-material-btn" data-idx="${idx}">${t('common.delete')}</button></td>
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

    // Populate default brand dropdown (all brands including MAJOR_BRANDS)
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
                _initColorWheelCanvas(colorDropdownContainer);
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
        _initColorWheelCanvas(colorDropdownContainer);
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
                _initColorWheelCanvas(colorDropdownContainer);
                colorDropdownContainer.setAttribute('data-selected-color', rendered.selected || '');
            }
        });
    }

    // Handle color selection in user center (delegated event)
    if (colorDropdownContainer) {
        colorDropdownContainer.addEventListener('click', (e) => {
            const swatch = e.target.closest('.cw-swatch');
            if (swatch) {
                const hex = swatch.getAttribute('data-color-hex');
                if (hex) {
                    colorDropdownContainer.setAttribute('data-selected-color', hex);
                    // Sync model page color
                    quoteOptions.color = hex;
                    // Update batch color dropdown trigger swatch
                    const batchColorContainer = document.getElementById('batch-color-dropdown');
                    if (batchColorContainer) {
                        const batchSwatch = batchColorContainer.querySelector('.cw-trigger .cw-swatch');
                        if (batchSwatch) batchSwatch.style.background = hex;
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
