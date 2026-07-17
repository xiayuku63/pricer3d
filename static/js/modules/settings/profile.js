// ── Profile / save user settings, form validation ──
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
    getBrandOptions, getMaterialsByBrand, getUsedBrandOptions, MATERIAL_TYPE_PRESETS,
} from '../state.js';
import { t } from '../i18n.js';
import { openLoginModal } from '../auth.js';
import { renderSlicerPresetsUI, fetchSlicerPresets, fetchPrinterModels } from '../presets.js';
import { refreshOptionsSummary, normalizeResultsWithCurrentOptions, renderResultsTable, recalcSummaryFromCurrentResults, reQuoteAllSelectedFiles, getSlicerConfigSnapshot, getAffectedFilenamesForSlicerConfigChange, refreshBatchMaterialDropdown, refreshBatchBrandDropdown } from '../quote.js';
import { updateDropdowns, dom } from './common.js';
import { syncPricingFromInputs, validateCurrentFormulas } from './pricing.js';

// ── Save user settings ──
export async function saveUserSettings() {
    const { userCenterModal, userCenterMsg, userCenterSaveBtn } = dom;
    if (!authToken) return;
    const previousSlicerConfig = getSlicerConfigSnapshot();
    const previousPricingConfig = JSON.stringify(PRICING_CONFIG);
    
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
        // Snapshot the user's selection before any async preset/printer
        // refresh can rebuild the controls and restore the previous default.
        const nozzle = String((cfgNozzle && cfgNozzle.value) || defaultNozzle || '').trim();
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
            // Send a detached payload so later DOM rerenders cannot mutate the
            // object while the request is being serialized.
            materials: MATERIAL_OPTIONS.map((material) => ({
                name: String(material.name || '').trim(),
                brand: String(material.brand || 'Generic').trim(),
                density: Number(material.density) || 1,
                price_per_kg: Number(material.price_per_kg) || 0,
                color: {
                    name: String(material.color?.name || material.color?.hex || '#000000').trim(),
                    hex: String(material.color?.hex || '').trim(),
                },
                max_volumetric_speed: material.max_volumetric_speed != null
                    ? Number(material.max_volumetric_speed)
                    : null,
            })),
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
            throw new Error(
                (data && (data.detail || data.message))
                    ? String(data.detail || data.message)
                    : t('settings.saveError')
            );
        }
        const savedSettings = await res.json().catch(() => ({}));
        const savedNozzle = String(savedSettings.default_nozzle || nozzle || '').trim();
        if (savedNozzle !== nozzle) {
            throw new Error(`喷嘴直径保存失败：服务端返回 ${savedNozzle || '空值'}，期望 ${nozzle || '空值'}`);
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
        setDefaultNozzle(savedNozzle || null);
        setDefaultSlicerPresetId(effectivePresetId || null);
        // Keep the active quote options aligned with the defaults just saved.
        // Existing result rows may still carry their previous per-file values;
        // reQuoteAllSelectedFiles uses this active value as the fallback.
        quoteOptions.printer_model = printerId || '';
        quoteOptions.slicer_preset_id = effectivePresetId || null;
        saveSlicerPresetSelection();
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
        const refreshedNozzle = document.getElementById('cfg-nozzle-diameter');
        if (refreshedNozzle && savedNozzle) refreshedNozzle.value = savedNozzle;
        const refreshedBatchNozzle = document.getElementById('batch-nozzle-diameter');
        if (refreshedBatchNozzle && savedNozzle && Array.from(refreshedBatchNozzle.options).some((option) => option.value === savedNozzle)) {
            refreshedBatchNozzle.value = savedNozzle;
        }
        updateDropdowns();
        if (refreshedNozzle && savedNozzle) refreshedNozzle.value = savedNozzle;
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
        const nextSlicerConfig = getSlicerConfigSnapshot();
        const affectedBySlicer = new Set(getAffectedFilenamesForSlicerConfigChange(previousSlicerConfig, nextSlicerConfig));
        const pricingChanged = previousPricingConfig !== JSON.stringify(PRICING_CONFIG);
        if (pricingChanged) {
            await reQuoteAllSelectedFiles(t('settings.recalcAfterSave'));
        } else if (affectedBySlicer.size > 0) {
            await reQuoteAllSelectedFiles(t('settings.recalcAfterSave'), (result) => affectedBySlicer.has(result?.filename));
        }
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
