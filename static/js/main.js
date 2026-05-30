// ── main.js — Application orchestrator ──
// All business logic lives in modules/. This file only:
//   1. Imports modules
//   2. Collects DOM refs
//   3. Inits each module with its DOM refs
//   4. Wires up event listeners
//   5. Starts the app
//
//   Modules:  auth | settings | presets | membership | quote | preview | orientation-ui
//   Shared:   state.js (all app state + utilities)
//   Three.js: viewer.js | layface.js (already modular)

import { initViewer, renderSTL, buildPlaceholderThumbnail, updateViewerSize,
    camera, renderer, controls, clearCurrentMesh, currentMesh,
    lookAtView, applyOrientationRotation, resetOrientation,
    setupFaceClickHandler, highlightFaces, resetHighlight, fitCameraToMesh,
} from './modules/viewer.js';
import { renderClusters, clearClusters, setClusterHover, intersectClusters, placeFaceOnBed, isClusterMode } from './modules/layface.js';
import { initQuoteHistory, loadQuoteHistory } from './modules/history.js';

import {
    authToken, currentUser, setCurrentUser, setAuthToken,
    currentResults, setCurrentResults, selectedFilesMap, thumbnailMap,
    quoteOptions, pendingQuoteFiles, setPendingQuoteFiles, COLOR_OPTIONS,
    PRICING_CONFIG, MATERIAL_OPTIONS, setMaterialOptions,
    loadUserSession, clearUserSession, saveUserSession, loadSlicerPresetSelection,
    saveSlicerPresetSelection, formatColorLabel, formatTimeHMS, escapeHtml,
    renderColorDropdown, getColorsForMaterial, colorToObj,
    authFetch,
} from './modules/state.js';

import {
    initAuth, refreshLoginCaptcha, openLoginModal, closeLoginModal,
    renderAuthUI, handleLoginSubmit, handleAuthSuccess, handleLogout,
    initializeAuth,
} from './modules/auth.js';
import {
    initSettings, fetchUserSettings, updateDropdowns, refreshQuoteColorDropdowns,
    buildPrinterOptionsHtml, renderUserCenterUI,
    syncPricingFromInputs, openColorEditor, closeColorEditor,
    addColorToMaterial, removeColorFromMaterial, validateCurrentFormulas,
    saveUserSettings, setAsDefaults, changePassword,
} from './modules/settings.js';
import {
    initPresets, preloadPrinterSelectors, fetchPrinterModels, fetchSlicerPresets,
    renderSlicerPresetsUI, uploadSlicerPreset, generateSlicerPreset, deleteSlicerPreset,
    loadPresetIntoForm, saveCurrentPreset, saveAsNewPreset,
    downloadSelectedPreset, deleteSelectedPreset,
    fetchPrinterPresets, savePrinterPreset, deletePrinterPreset,
    renderPrinterVisibilityList, restoreDefaultPrinters,
} from './modules/presets.js';
import {
    initMembership, openMembershipModal, closeMembershipModal,
    refreshMembershipStatus, toggleMembershipOrders,
} from './modules/membership.js';
import {
    initQuote, quoteSingleFileWithOptions, quoteSelectedFiles,
    mergeResultsByFilename, normalizeResultsWithCurrentOptions,
    reQuoteAllSelectedFiles, renderResultsTable, recalcSummaryFromCurrentResults,
    handleRowEditChange, refreshOptionsSummary, setOpenLoginModalRef,
    refreshBatchMaterialDropdown, refreshBatchColorDropdown, batchApplyToAll,
} from './modules/quote.js';
import {
    initPreview, buildStlThumbnail, buildNonStlThumbnail,
    ensureThumbnailForFile, buildThumbnails,
    openPreviewModal, closePreviewModal, previewByFilename, setupViewCube,
} from './modules/preview.js';
import {
    initOrientationUI, syncOrientationFromMesh,
    centerModel, resetOrientationHandler, toggleLayFace, submitTraining,
} from './modules/orientation-ui.js';
import { initTheme } from './modules/theme.js';
import { t, lang, toggleLang, langFlag, langLabel, initI18n } from './modules/i18n.js';

// ═══════════════════════════════════════════════
//  App entry point
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Apply theme immediately (before any rendering)
    initTheme();
    // Init i18n (language switcher)
    initI18n();
    const MAX_FILES = 20;
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const ALLOWED_EXTENSIONS = ['.stl', '.stp', '.step', '.obj', '.3mf', '.zip'];

    // ── Collect ALL DOM refs ──
    const $ = (id) => document.getElementById(id);
    const dom = {
        // Auth
        openLoginBtn: $('open-login-btn'),
        userMenu: $('user-menu'), userMenuBtn: $('user-menu-btn'), userDropdown: $('user-dropdown'),
        openMembershipBtn: $('open-membership-btn'), openAdminUsersBtn: $('open-admin-users-btn'),
        openUserCenterBtn: $('open-user-center-btn'), logoutBtn: $('logout-btn'),
        loginModal: $('login-modal'), loginBackdrop: $('login-backdrop'),
        loginUsername: $('login-username'), loginPassword: $('login-password'),
        loginCaptchaImg: $('login-captcha-img'), loginCaptchaCode: $('login-captcha-code'),
        loginAcceptLegal: $('login-accept-legal'), loginSubmitBtn: $('login-submit-btn'),
        loginError: $('login-error'),

        // Membership
        membershipModal: $('membership-modal'), membershipBackdrop: $('membership-backdrop'),
        membershipCloseBtn: $('membership-close-btn'), membershipPlans: $('membership-plans'),
        membershipMsg: $('membership-msg'), membershipRefreshBtn: $('membership-refresh-btn'),
        membershipOrdersBtn: $('membership-orders-btn'), membershipOrders: $('membership-orders'),
        membershipOrdersTbody: $('membership-orders-tbody'),

        // Quote options
        optionsSummary: $('options-summary'), optionsModal: $('options-modal'),
        optionsBackdrop: $('options-backdrop'), optionsCloseBtn: $('options-close-btn'),
        optionsSaveBtn: $('options-save-btn'), optMaterial: $('opt-material'),
        optColor: $('opt-color'), optQuantity: $('opt-quantity'),

        // Preview
        previewModal: $('preview-modal'), previewBackdrop: $('preview-backdrop'),
        viewCube: $('view-cube'), previewCloseBtn: $('preview-close-btn'),
        previewContainer: $('preview-container'), previewPlaceholder: $('preview-placeholder'),

        // Upload
        form: $('quote-form'), fileInput: $('file-upload'),
        fileNameDisplay: $('file-name'),
        resultContainer: $('result-container'), errorContainer: $('error-container'),
        errorMsg: $('error-msg'), batchResultsBody: $('batch-results-body'),

        // User center
        userCenterModal: $('user-center-modal'), userCenterBackdrop: $('user-center-backdrop'),
        userCenterCloseBtn: $('user-center-close-btn'),
        userCenterSetDefaultsBtn: $('user-center-set-defaults-btn'),
        userCenterSaveBtn: $('user-center-save-btn'), materialsTbody: $('materials-tbody'),
        addMaterialBtn: $('add-material-btn'), userCenterMsg: $('user-center-msg'),
        userCenterHint: $('user-center-hint'),

        // Pricing inputs
        cfgMachineHourlyRate: $('cfg-machine-hourly-rate'), cfgSetupFee: $('cfg-setup-fee'),
        cfgMinJobFee: $('cfg-min-job-fee'), cfgMaterialWaste: $('cfg-material-waste'),
        cfgSupportPercent: $('cfg-support-percent'), cfgPostPerPart: $('cfg-post-per-part'),
        cfgTimeOverheadMin: $('cfg-time-overhead-min'), cfgTimeVolMinPerCm3: $('cfg-time-vol-min-per-cm3'),
        cfgDifficultyCoefficient: $('cfg-difficulty-coefficient'), cfgDifficultyRatioLow: $('cfg-difficulty-ratio-low'),
        cfgDifficultyRatioHigh: $('cfg-difficulty-ratio-high'), cfgSupportPricePerG: $('cfg-support-price-per-g'),
        cfgUnitCostFormula: $('cfg-unit-cost-formula'), cfgTotalCostFormula: $('cfg-total-cost-formula'),

        // Slicer presets
        slicerPresetFileInput: $('slicer-preset-file'), slicerPresetUploadBtn: $('slicer-preset-upload-btn'),
        slicerPresetsRefreshBtn: $('slicer-presets-refresh-btn'), slicerPresetsMsg: $('slicer-presets-msg'),
        slicerPresetsTbody: $('slicer-presets-tbody'), slicerPresetsDownloadBtn: $('slicer-presets-download-btn'), slicerPresetsDeleteBtn: $('slicer-presets-delete-btn'),
        genPresetSelect: $('gen-preset-select'), genPresetSaveBtn: $('gen-preset-save-btn'),
        genPresetSaveasBtn: $('gen-preset-saveas-btn'),
        genSaveasRow: $('gen-autoname-row'), genSaveasName: $('gen-autoname-preview'),
        genPresetName: $('gen-preset-name'), genPrinterModel: $('gen-printer-model'),
        genLayerHeight: $('gen-layer-height'), genInfill: $('gen-infill'),
        genWallCount: $('gen-wall-count'), genTopShells: $('gen-top-shells'),
        genBottomShells: $('gen-bottom-shells'), genBrimWidth: $('gen-brim-width'),
        slicerPresetGenerateBtn: $('slicer-preset-generate-btn'),
        cfgNozzleDiameter: $('cfg-nozzle-diameter'), printerBedInfo: $('printer-bed-info'),

        // Orientation
        layFaceBtn: $('lay-face-btn'), orientResetBtn: $('orient-reset-btn'),
        orientCenterBtn: $('orient-center-btn'), orientTrainBtn: $('orient-train-btn'),
        orientTrainStatus: $('orient-train-status'),

        // User center tabs + password
        ucTabBtns: document.querySelectorAll('.uc-tab-btn'),
        ucTabPanes: document.querySelectorAll('.uc-tab-pane'),
        ucOldPassword: $('uc-old-password'), ucNewPassword: $('uc-new-password'),
        ucConfirmPassword: $('uc-confirm-password'), ucPasswordMsg: $('uc-password-msg'),
        ucChangePasswordBtn: $('uc-change-password-btn'),

        // Formula
        formulaResetBtn: $('formula-reset-btn'), formulaValidateBtn: $('formula-validate-btn'),
        formulaValidateMsg: $('formula-validate-msg'), formulaVarsToggleBtn: $('formula-vars-toggle-btn'),
        formulaVarsPanel: $('formula-vars-panel'),
    };

    // ── Init all modules with their DOM refs ──
    initAuth(dom);
    initSettings(dom);
    initPresets(dom);
    initMembership(dom);
    initQuote(dom);
    initPreview(dom);
    initOrientationUI(dom);

    // Break circular dep: quote.js needs openLoginModal from auth.js
    setOpenLoginModalRef(openLoginModal);

    // ── Three.js setup ──
    try { initViewer(dom.previewContainer, dom.previewPlaceholder); } catch(e) { console.error('initViewer failed (non-fatal):', e); }

    // ── Quote history ──
    initQuoteHistory();

    // ═══════════════════════════════════════════════
    //  Event wiring
    // ═══════════════════════════════════════════════

    // Auth - form events are wired by _wireLoginForm() in auth.js init
    if (dom.openLoginBtn) dom.openLoginBtn.addEventListener('click', openLoginModal);

    // Language switcher
    const langSwitchBtn = document.getElementById('lang-switch-btn');
    if (langSwitchBtn) {
        const updateLangBtn = () => {
            langSwitchBtn.textContent = `${langFlag(lang)} ${langLabel(lang)}`;
        };
        updateLangBtn();
        langSwitchBtn.addEventListener('click', () => {
            toggleLang();
            updateLangBtn();
        });
    }
    // Listen for i18n-change event to update data-i18n elements dynamically
    window.addEventListener('i18n-change', () => {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = t(key);
        });
    });
    if (dom.userMenuBtn) dom.userMenuBtn.addEventListener('click', () => dom.userDropdown.classList.toggle('hidden'));
    if (dom.openAdminUsersBtn) dom.openAdminUsersBtn.addEventListener('click', () => { dom.userDropdown.classList.add('hidden'); window.location.href = '/admin/users'; });
    if (dom.openMembershipBtn) dom.openMembershipBtn.addEventListener('click', () => { dom.userDropdown.classList.add('hidden'); openMembershipModal(); });
    if (dom.openUserCenterBtn) dom.openUserCenterBtn.addEventListener('click', () => {
        dom.userDropdown.classList.add('hidden');
        if (!currentUser) return;
        renderUserCenterUI();
        if (dom.userCenterSetDefaultsBtn) dom.userCenterSetDefaultsBtn.classList.toggle('hidden', !(currentUser && currentUser.is_admin));
        if (dom.ucOldPassword) dom.ucOldPassword.value = '';
        if (dom.ucNewPassword) dom.ucNewPassword.value = '';
        if (dom.ucConfirmPassword) dom.ucConfirmPassword.value = '';
        if (dom.ucPasswordMsg) { dom.ucPasswordMsg.textContent = ''; dom.ucPasswordMsg.className = 'text-xs hidden'; }
        const defaultTab = document.querySelector('.uc-tab-btn[data-uc-tab="materials"]');
        if (defaultTab) defaultTab.click();
        dom.userCenterModal.classList.remove('hidden');
        fetchPrinterModels();
        fetchSlicerPresets();
        fetchPrinterPresets();
        renderPrinterVisibilityList();
    });
    if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', handleLogout);
    document.addEventListener('click', (event) => {
        if (dom.userMenu && !dom.userMenu.contains(event.target)) dom.userDropdown.classList.add('hidden');
    });

    // Membership
    if (dom.membershipCloseBtn) dom.membershipCloseBtn.addEventListener('click', closeMembershipModal);
    if (dom.membershipBackdrop) dom.membershipBackdrop.addEventListener('click', closeMembershipModal);
    if (dom.membershipRefreshBtn) dom.membershipRefreshBtn.addEventListener('click', refreshMembershipStatus);
    if (dom.membershipOrdersBtn) dom.membershipOrdersBtn.addEventListener('click', toggleMembershipOrders);

    // Slicer presets
    if (dom.slicerPresetsRefreshBtn) dom.slicerPresetsRefreshBtn.addEventListener('click', fetchSlicerPresets);
    if (dom.slicerPresetsDownloadBtn) dom.slicerPresetsDownloadBtn.addEventListener('click', downloadSelectedPreset);
    if (dom.slicerPresetsDeleteBtn) dom.slicerPresetsDeleteBtn.addEventListener('click', deleteSelectedPreset);
    if (dom.slicerPresetUploadBtn) dom.slicerPresetUploadBtn.addEventListener('click', uploadSlicerPreset);
    if (dom.slicerPresetGenerateBtn) dom.slicerPresetGenerateBtn.addEventListener('click', generateSlicerPreset);

    // ── Slicer preset form: select preset → load params ──
    if (dom.genPresetSelect) {
        dom.genPresetSelect.addEventListener('change', async () => {
            const val = dom.genPresetSelect.value;
            if (!val) {
                // "-- 新建 / 未选择 --" → disable save
                if (dom.genPresetSaveBtn) dom.genPresetSaveBtn.disabled = true;
                return;
            }
            await loadPresetIntoForm(val);
            // Enable save button when a preset is selected (and not system preset)
            if (dom.genPresetSaveBtn) dom.genPresetSaveBtn.disabled = false;
        });
    }

    // ── Slicer preset form: save button ──
    if (dom.genPresetSaveBtn) {
        dom.genPresetSaveBtn.addEventListener('click', saveCurrentPreset);
    }

    // ── Slicer preset form: save-as button (direct save with auto-generated name)
    if (dom.genPresetSaveasBtn) {
        dom.genPresetSaveasBtn.addEventListener('click', saveAsNewPreset);
    }

    // ── Global: close color dropdowns on outside click ──
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.color-dd-wrapper')) {
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(l => l.classList.add('hidden'));
        }
    });

    // ── Global: color dropdown toggle + item selection ──
    document.addEventListener('click', (e) => {
        // Toggle dropdown
        const trigger = e.target.closest('.color-dd-trigger');
        if (trigger) {
            e.stopPropagation();
            const wrapper = trigger.closest('.color-dd-wrapper');
            if (!wrapper) return;
            const list = wrapper.querySelector('.color-dd-list');
            if (!list) return;
            const wasHidden = list.classList.contains('hidden');
            // Close all other dropdowns first
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(l => l.classList.add('hidden'));
            if (wasHidden) list.classList.remove('hidden');
            return;
        }
        // Select a color item
        const item = e.target.closest('.color-dd-item');
        if (item) {
            e.stopPropagation();
            const hex = item.getAttribute('data-color-hex');
            if (!hex) return;
            const wrapper = item.closest('.color-dd-wrapper');
            if (!wrapper) return;
            // Update hidden input
            const valueInput = wrapper.querySelector('.row-color-value');
            if (valueInput) valueInput.value = hex;
            // Update trigger swatch
            const swatch = wrapper.querySelector('.color-dd-swatch');
            if (swatch) swatch.style.background = hex;
            // Update trigger label (for full mode)
            const label = wrapper.querySelector('.color-dd-label');
            const nameSpan = item.querySelector('span:nth-child(2)');
            if (label && nameSpan) label.textContent = nameSpan.textContent;
            // Highlight selected item
            wrapper.querySelectorAll('.color-dd-item').forEach(el => el.classList.remove('bg-indigo-50'));
            item.classList.add('bg-indigo-50');
            // Close dropdown
            const list = wrapper.querySelector('.color-dd-list');
            if (list) list.classList.add('hidden');
            // Update quoteOptions if in options modal
            const inModal = wrapper.closest('#options-modal');
            if (inModal) {
                quoteOptions.color = hex;
                refreshOptionsSummary();
            }
            // For table rows: trigger re-quote
            const row = wrapper.closest('tr[data-row-file]');
            if (row) {
                const rowEditEl = row.querySelector('.row-edit');
                if (rowEditEl) rowEditEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // ── Global: G-code 详情展开/收起 ──
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-toggle-gcode]');
        if (!btn) return;
        e.stopPropagation();
        const filename = btn.getAttribute('data-toggle-gcode');
        const detailRow = document.querySelector(`tr[data-gcode-detail="${CSS.escape(filename)}"]`);
        if (!detailRow) return;
        const hidden = detailRow.style.display === 'none';
        detailRow.style.display = hidden ? '' : 'none';
        btn.textContent = hidden ? '📊收起' : '📊详情';
    });

    // Options modal — color dropdown
    if (dom.optMaterial) dom.optMaterial.addEventListener('change', () => {
        const rendered = renderColorDropdown(dom.optMaterial.value, quoteOptions.color);
        dom.optColor.innerHTML = rendered.html;
    });
    if (dom.optionsSaveBtn) dom.optionsSaveBtn.addEventListener('click', () => {
        const quantity = Number.parseInt(dom.optQuantity?.value, 10);
        if (!Number.isFinite(quantity) || quantity < 1) {
            if (dom.errorMsg) { dom.errorMsg.textContent = '数量必须大于等于 1'; dom.errorContainer.classList.remove('hidden'); }
            return;
        }
        quoteOptions.material = dom.optMaterial.value;
        const wrapper = dom.optColor.querySelector('.color-dd-wrapper');
        const hiddenInput = wrapper ? wrapper.querySelector('.row-color-value') : null;
        if (hiddenInput) quoteOptions.color = hiddenInput.value;
        quoteOptions.quantity = quantity;
        refreshOptionsSummary();
        dom.optionsModal.classList.add('hidden');
    });
    if (dom.optionsCloseBtn) dom.optionsCloseBtn.addEventListener('click', () => dom.optionsModal.classList.add('hidden'));
    if (dom.optionsBackdrop) dom.optionsBackdrop.addEventListener('click', () => dom.optionsModal.classList.add('hidden'));

    // Batch edit bar
    const batchMaterial = document.getElementById('batch-material');
    const batchApplyBtn = document.getElementById('batch-apply-btn');
    const batchQuantity = document.getElementById('batch-quantity');
    const batchPrinterModel = document.getElementById('batch-printer-model');
    const batchSlicerPreset = document.getElementById('batch-slicer-preset');

    if (batchMaterial) batchMaterial.addEventListener('change', refreshBatchColorDropdown);
    if (batchApplyBtn) batchApplyBtn.addEventListener('click', batchApplyToAll);
    if (batchQuantity) {
        batchQuantity.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); batchApplyToAll(); }
        });
    }
    // Batch preset change → show params summary + update quoteOptions
    if (batchSlicerPreset) {
        batchSlicerPreset.addEventListener('change', async () => {
            const val = batchSlicerPreset.value;
            const paramsEl = document.getElementById('batch-preset-params');
            if (!val) {
                quoteOptions.slicer_preset_id = null;
                saveSlicerPresetSelection();
                if (paramsEl) { paramsEl.classList.add('hidden'); paramsEl.textContent = ''; }
                return;
            }
            quoteOptions.slicer_preset_id = Number(val);
            saveSlicerPresetSelection();
            // Show param summary
            try {
                const resp = await authFetch(`/api/slicer/presets/${val}`);
                if (resp.ok) {
                    const data = await resp.json();
                    const p = data.preset?.params;
                    if (p && paramsEl) {
                        paramsEl.textContent = `层高:${p.layer_height || '-'} 墙:${p.perimeters || '-'} 填充:${p.fill_density || '-'}%`;
                        paramsEl.classList.remove('hidden');
                    }
                }
            } catch (e) { /* ignore */ }
        });
    }

    // Open options modal
    const openOptionsTrigger = document.querySelector('[data-open-options]');
    if (openOptionsTrigger) {
        openOptionsTrigger.addEventListener('click', () => {
            updateDropdowns();
            dom.optMaterial.value = quoteOptions.material;
            const rendered = renderColorDropdown(dom.optMaterial.value, quoteOptions.color);
            dom.optColor.innerHTML = rendered.html;
            dom.optQuantity.value = String(quoteOptions.quantity);
            dom.optionsModal.classList.remove('hidden');
        });
    }

    // Preview modal
    if (dom.previewCloseBtn) dom.previewCloseBtn.addEventListener('click', closePreviewModal);
    if (dom.previewBackdrop) dom.previewBackdrop.addEventListener('click', closePreviewModal);
    setupViewCube();

    // Orientation
    if (dom.orientCenterBtn) dom.orientCenterBtn.addEventListener('click', centerModel);
    if (dom.orientResetBtn) dom.orientResetBtn.addEventListener('click', resetOrientationHandler);
    if (dom.layFaceBtn) dom.layFaceBtn.addEventListener('click', toggleLayFace);
    if (dom.orientTrainBtn) dom.orientTrainBtn.addEventListener('click', submitTraining);

    // User center
    if (dom.userCenterCloseBtn) dom.userCenterCloseBtn.addEventListener('click', () => { dom.userCenterModal.classList.add('hidden'); dom.userCenterMsg.classList.add('hidden'); });
    if (dom.userCenterBackdrop) dom.userCenterBackdrop.addEventListener('click', () => { dom.userCenterModal.classList.add('hidden'); dom.userCenterMsg.classList.add('hidden'); });
    if (dom.userCenterSaveBtn) dom.userCenterSaveBtn.addEventListener('click', saveUserSettings);
    if (dom.userCenterSetDefaultsBtn) dom.userCenterSetDefaultsBtn.addEventListener('click', setAsDefaults);
    if (dom.ucChangePasswordBtn) dom.ucChangePasswordBtn.addEventListener('click', changePassword);

    // Printer preset management
    const ppAddBtn = document.getElementById('printer-preset-add-btn');
    const ppSaveBtn = document.getElementById('pp-save-btn');
    const ppCancelBtn = document.getElementById('pp-cancel-btn');
    if (ppAddBtn) ppAddBtn.addEventListener('click', () => {
        document.getElementById('printer-preset-form')?.classList.remove('hidden');
    });
    if (ppCancelBtn) ppCancelBtn.addEventListener('click', () => {
        document.getElementById('printer-preset-form')?.classList.add('hidden');
    });
    if (ppSaveBtn) ppSaveBtn.addEventListener('click', savePrinterPreset);

    // Printer visibility
    const ppRestoreBtn = document.getElementById('printer-restore-defaults-btn');
    if (ppRestoreBtn) ppRestoreBtn.addEventListener('click', restoreDefaultPrinters);

    // User center tabs
    dom.ucTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-uc-tab');
            dom.ucTabBtns.forEach(b => { b.classList.remove('text-indigo-700', 'bg-indigo-50', 'active'); b.classList.add('text-gray-600'); });
            btn.classList.add('text-indigo-700', 'bg-indigo-50', 'active');
            btn.classList.remove('text-gray-600');
            dom.ucTabPanes.forEach(pane => { pane.classList.add('hidden'); pane.classList.remove('block'); });
            const targetPane = document.getElementById(`uc-tab-${tabId}`);
            if (targetPane) { targetPane.classList.remove('hidden'); targetPane.classList.add('block'); }
            if (dom.userCenterSaveBtn) dom.userCenterSaveBtn.classList.toggle('hidden', tabId === 'security');
            if (dom.userCenterHint) dom.userCenterHint.classList.toggle('invisible', tabId !== 'security');
            if (tabId === 'security') dom.userCenterMsg.classList.add('hidden');
        });
    });

    // Materials table
    if (dom.materialsTbody) {
        dom.materialsTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT') return;
            const idx = target.getAttribute('data-idx');
            const field = target.getAttribute('data-field');
            if (field === 'name') MATERIAL_OPTIONS[idx].name = target.value;
            else if (field === 'brand') MATERIAL_OPTIONS[idx].brand = target.value;
            else if (field === 'density') MATERIAL_OPTIONS[idx].density = parseFloat(target.value) || 1.0;
            else if (field === 'price_per_kg') MATERIAL_OPTIONS[idx].price_per_kg = parseFloat(target.value) || 0.0;
        });
        dom.materialsTbody.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-material-btn')) {
                const idx = e.target.getAttribute('data-idx');
                MATERIAL_OPTIONS.splice(idx, 1);
                renderUserCenterUI();
            } else if (e.target.classList.contains('edit-colors-btn')) {
                openColorEditor(parseInt(e.target.getAttribute('data-idx')));
            }
        });
    }
    if (dom.addMaterialBtn) dom.addMaterialBtn.addEventListener('click', () => {
        MATERIAL_OPTIONS.push({ name: "NewMaterial", brand: "通用", density: 1.0, price_per_kg: 200.0, colors: [{ name: "黑色", hex: "#000000" }, { name: "白色", hex: "#ffffff" }] });
        renderUserCenterUI();
    });

    // Color editor
    const colorEditorList = document.getElementById('color-editor-list');
    if (colorEditorList) {
        colorEditorList.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-color-btn');
            if (!btn) return;
            removeColorFromMaterial(btn.getAttribute('data-color-hex'));
        });
    }
    const colorEditorClose = document.getElementById('color-editor-close');
    if (colorEditorClose) colorEditorClose.addEventListener('click', closeColorEditor);
    const colorEditorAdd = document.getElementById('color-editor-add');
    if (colorEditorAdd) colorEditorAdd.addEventListener('click', addColorToMaterial);

    // Formula
    if (dom.formulaVarsToggleBtn) {
        dom.formulaVarsToggleBtn.addEventListener('click', () => {
            const hidden = dom.formulaVarsPanel.classList.contains('hidden');
            dom.formulaVarsPanel.classList.toggle('hidden', !hidden);
            dom.formulaVarsToggleBtn.textContent = hidden ? '收起变量字典' : '展开变量字典';
        });
    }
    if (dom.formulaResetBtn) {
        dom.formulaResetBtn.addEventListener('click', () => {
            dom.cfgUnitCostFormula.value = '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) * difficulty_multiplier + support_cost_per_part_cny';
            dom.cfgTotalCostFormula.value = 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)';
            syncPricingFromInputs();
            if (dom.formulaValidateMsg) dom.formulaValidateMsg.classList.add('hidden');
        });
    }
    if (dom.formulaValidateBtn) dom.formulaValidateBtn.addEventListener('click', validateCurrentFormulas);

    // Pricing inputs auto-sync
    [
        dom.cfgMachineHourlyRate, dom.cfgSetupFee, dom.cfgMinJobFee, dom.cfgMaterialWaste,
        dom.cfgSupportPercent, dom.cfgPostPerPart, dom.cfgTimeOverheadMin, dom.cfgTimeVolMinPerCm3,
        dom.cfgDifficultyCoefficient, dom.cfgDifficultyRatioLow, dom.cfgDifficultyRatioHigh,
        dom.cfgSupportPricePerG, dom.cfgUnitCostFormula, dom.cfgTotalCostFormula,
    ].forEach((el) => el && el.addEventListener('change', syncPricingFromInputs));

    // Results table events
    if (dom.batchResultsBody) {
        // Row editing
        dom.batchResultsBody.addEventListener('change', handleRowEditChange);
        // Delete / Preview buttons
        dom.batchResultsBody.addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('[data-delete-file]');
            if (deleteBtn) {
                const filename = deleteBtn.getAttribute('data-delete-file');
                selectedFilesMap.delete(filename);
                thumbnailMap.delete(filename);
                setCurrentResults(currentResults.filter((i) => i && i.filename !== filename));
                renderResultsTable();
                recalcSummaryFromCurrentResults();
                if (selectedFilesMap.size === 0) {
                    dom.fileNameDisplay.textContent = '未选择文件（最多20个，单文件需小于100MB）';
                    dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
                } else {
                    dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件`;
                    dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
                }
                closePreviewModal();
                return;
            }
            const previewBtn = event.target.closest('[data-preview-file]');
            if (previewBtn) {
                previewByFilename(previewBtn.getAttribute('data-preview-file'), previewBtn.getAttribute('data-preview-ext'));
            }
        });
    }

    // File upload
    if (dom.fileInput) {
        dom.fileInput.addEventListener('change', async (e) => {
            const newFiles = Array.from(e.target.files || []);
            dom.fileInput.value = '';
            if (newFiles.length === 0) return;

            const combined = new Map(selectedFilesMap);
            newFiles.forEach((file) => combined.set(file.name, file));

            if (combined.size > MAX_FILES) {
                dom.errorMsg.textContent = `最多支持 ${MAX_FILES} 个文件（当前已选择 ${selectedFilesMap.size} 个，本次新增 ${newFiles.length} 个）`;
                dom.errorContainer.classList.remove('hidden');
                return;
            }
            const invalidByType = newFiles.find((f) => {
                const name = f.name.toLowerCase();
                return !ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
            });
            if (invalidByType) {
                dom.errorMsg.textContent = `不支持的格式：${invalidByType.name}。仅支持 ${ALLOWED_EXTENSIONS.join('/')}`;
                dom.errorContainer.classList.remove('hidden');
                return;
            }
            const invalidBySize = newFiles.find((f) => f.size >= MAX_FILE_SIZE);
            if (invalidBySize) {
                dom.errorMsg.textContent = `文件过大：${invalidBySize.name}，单文件必须小于100MB`;
                dom.errorContainer.classList.remove('hidden');
                return;
            }

            dom.errorContainer.classList.add('hidden');

            // Check if any file is a ZIP — route to /api/quote/zip
            const zipFiles = newFiles.filter(function(f) { return f.name.toLowerCase().endsWith('.zip'); });
            const modelFiles = newFiles.filter(function(f) { return !f.name.toLowerCase().endsWith('.zip'); });

            if (zipFiles.length > 0) {
                // Only support single ZIP upload at a time (combined with model files is ok)
                if (zipFiles.length > 1 && modelFiles.length === 0) {
                    dom.errorMsg.textContent = '一次只能上传一个 ZIP 文件';
                    dom.errorContainer.classList.remove('hidden');
                    return;
                }

                if (!authToken) {
                    setPendingQuoteFiles(newFiles);
                    dom.fileNameDisplay.textContent = '当前列表共 ' + selectedFilesMap.size + ' 个文件，请登录后继续报价';
                    dom.errorMsg.textContent = '请先登录后再上传报价';
                    dom.errorContainer.classList.remove('hidden');
                    openLoginModal();
                    return;
                }

                dom.fileNameDisplay.textContent = '正在解析 ZIP 文件中的清单与模型...';
                dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');

                try {
                    // Upload ZIP to new endpoint
                    var zipFormData = new FormData();
                    zipFormData.append('file', zipFiles[0]);
                    zipFormData.append('material', quoteOptions.material);
                    zipFormData.append('color', quoteOptions.color);
                    zipFormData.append('quantity', String(quoteOptions.quantity));

                    var zipResp = await authFetch('/api/quote/zip', { method: 'POST', body: zipFormData });
                    var zipData = await zipResp.json();
                    if (!zipResp.ok) throw new Error(zipData.detail || 'ZIP 上传失败');

                    // Process results
                    mergeResultsByFilename(zipData.results || []);
                    renderResultsTable();
                    recalcSummaryFromCurrentResults();

                    // Show match status message
                    if (zipData.match_status) {
                        var ms = zipData.match_status;
                        var statusClass = ms.mode === 'all' ? 'text-green-700 bg-green-50 border-green-300'
                            : ms.mode === 'partial' ? 'text-amber-700 bg-amber-50 border-amber-300'
                            : 'text-red-700 bg-red-50 border-red-300';
                        dom.fileNameDisplay.innerHTML = '<span class="inline-block px-2 py-0.5 rounded border text-xs ' + statusClass + '">' + escapeHtml(ms.message) + '</span>';
                        dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
                    } else {
                        dom.fileNameDisplay.textContent = 'ZIP 报价完成，共 ' + (zipData.results || []).length + ' 个文件';
                    }

                    // Also process any non-ZIP model files from same selection
                    if (modelFiles.length > 0) {
                        modelFiles.forEach(function(f) { selectedFilesMap.set(f.name, f); });
                        await buildThumbnails(modelFiles);
                        await quoteSelectedFiles(modelFiles);
                    }
                } catch (err) {
                    dom.errorMsg.textContent = err.message || 'ZIP 解析失败';
                    dom.errorContainer.classList.remove('hidden');
                    dom.fileNameDisplay.textContent = 'ZIP 文件处理失败';
                }
                return;
            }

            // Normal model file upload (existing flow)
            newFiles.forEach((file) => selectedFilesMap.set(file.name, file));
            dom.fileNameDisplay.classList.add('text-indigo-600', 'font-medium');

            if (!authToken) {
                setPendingQuoteFiles(newFiles);
                dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，请登录后继续为新增 ${newFiles.length} 个文件自动报价`;
                dom.errorMsg.textContent = '请先登录后再上传报价';
                dom.errorContainer.classList.remove('hidden');
                openLoginModal();
                return;
            }
            dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，正在为新增 ${newFiles.length} 个文件生成静态图与自动报价...`;
            try {
                await buildThumbnails(newFiles);
                await quoteSelectedFiles(newFiles);
                dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${newFiles.length} 个文件报价完成`;
            } catch (err) {
                dom.errorMsg.textContent = err.message;
                dom.errorContainer.classList.remove('hidden');
                dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${newFiles.length} 个文件自动报价失败`;
            }
        });
    }

    // PrusaSlicer 始终启用 — 不再需要复选框

    // Load app version from API
    async function loadAppVersion() {
        const versionEl = document.getElementById('app-version');
        if (!versionEl) return;
        try {
            const resp = await fetch('/api/version');
            const data = await resp.json();
            let text = `v${data.version || '?'}`;
            if (data.deployed_at) {
                const dt = data.deployed_at.replace('T', ' ').substring(0, 16);
                text += ` · ${dt}`;
            }
            versionEl.textContent = text;
            versionEl.title = `环境: ${data.env || 'unknown'}`;
        } catch (e) {
            versionEl.textContent = 'v?';
        }
    }

    // Drag & drop
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
        });
        dropZone.addEventListener('dragenter', () => dropZone.classList.add('border-indigo-400', 'bg-indigo-50'));
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-indigo-400', 'bg-indigo-50'));
        dropZone.addEventListener('dragover', () => dropZone.classList.add('border-indigo-400', 'bg-indigo-50'));
        dropZone.addEventListener('drop', (e) => {
            dropZone.classList.remove('border-indigo-400', 'bg-indigo-50');
            const droppedFiles = Array.from(e.dataTransfer.files);
            const valid = droppedFiles.filter(f => {
                const ext = '.' + f.name.split('.').pop().toLowerCase();
                return ALLOWED_EXTENSIONS.includes(ext) && f.size < MAX_FILE_SIZE;
            });
            if (valid.length === 0) {
                dom.errorMsg.textContent = '不支持的文件格式或文件过大（支持 .stl/.step/.stp/.obj/.3mf，最大100MB）';
                dom.errorContainer.classList.remove('hidden');
                return;
            }
            if (valid.length + selectedFilesMap.size > MAX_FILES) {
                dom.errorMsg.textContent = `单次最多上传 ${MAX_FILES} 个文件`;
                dom.errorContainer.classList.remove('hidden');
                return;
            }
            const dt = new DataTransfer();
            valid.forEach(f => dt.items.add(f));
            dom.fileInput.files = dt.files;
            dom.fileInput.dispatchEvent(new Event('change'));
        });
    }

    // ═══════════════════════════════════════════════
    //  Startup
    // ═══════════════════════════════════════════════
    loadAppVersion();
    preloadPrinterSelectors();
    window.addEventListener('resize', updateViewerSize);

    // Before unload warning
    window.addEventListener('beforeunload', (event) => {
        if (selectedFilesMap.size > 0) {
            event.preventDefault();
            event.returnValue = '您有未保存的文件，确定要离开吗？';
        }
    });

    refreshOptionsSummary();
    initializeAuth().then(() => {
        // Load presets for model-page selector after auth
        if (authToken) fetchSlicerPresets();
    });
});
