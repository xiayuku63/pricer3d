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
    quoteOptions, pendingQuoteFiles, COLOR_OPTIONS,
    PRICING_CONFIG, MATERIAL_OPTIONS, setMaterialOptions,
    loadUserSession, clearUserSession, saveUserSession, loadSlicerPresetSelection,
    saveSlicerPresetSelection, formatColorLabel, formatTimeHMS, escapeHtml,
    renderColorDropdown, getColorsForMaterial, colorToObj, pickAllowedColor,
    authFetch,
    setDefaultSlicerPresetId,
    getMaterialsByBrand, MATERIAL_TYPE_PRESETS, getUsedBrandOptions, getBrandOptions,
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
    restoreDefaultMaterials,
    initMobileFormOptimizations,
    initBrandLogoUpload, updateUploadLimitHint,
} from './modules/settings.js';
import {
    initPresets, preloadPrinterSelectors, fetchPrinterModels, fetchSlicerPresets,
    renderSlicerPresetsUI, uploadSlicerPreset, generateSlicerPreset, deleteSlicerPreset,
    loadPresetIntoForm, saveCurrentPreset, saveAsNewPreset,
    downloadSelectedPreset, deleteSelectedPreset,
    fetchPrinterPresets, savePrinterPreset, deletePrinterPreset,
    renderPrinterVisibilityList, restoreDefaultPrinters, addEnabledPrinterSlot,
    updatePrinterDetailPanel,
    showCustomPrinterForm, hideCustomPrinterForm, saveCustomPrinter,
    updateLayerHeightRangeHint,
    updateLayerHeightDropdown,
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
    refreshBatchBrandDropdown,
    handleCardEditChange, exportCSV, exportExcel,
    initTableEnhancements,
    openMaterialCompare,
} from './modules/quote.js';
import {
    setupEnhancedDragDrop, renderFilePreviewChips,
} from './modules/upload.js';
import {
    initPreview, buildStlThumbnail, buildNonStlThumbnail,
    openPreviewModal, closePreviewModal, previewByFilename, setupViewCube,
} from './modules/preview.js';
import {
    initOrientationUI, syncOrientationFromMesh,
    centerModel, resetOrientationHandler, toggleLayFace, submitTraining,
} from './modules/orientation-ui.js';
import { initTheme } from './modules/theme.js';
import { t, lang, toggleLang, langFlag, langLabel, initI18n } from './modules/i18n.js';
import { initOnboarding, checkAndStart as checkOnboarding, startGuide } from './modules/onboarding.js';
import { initZipUpload, handleFileSelection } from './modules/zip-upload.js';

// ═══════════════════════════════════════════════
//  App entry point
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Apply theme immediately (before any rendering)
    initTheme();
    // Init i18n (language switcher)
    initI18n();
    const _getMaxFiles = () => (currentUser && currentUser.is_member) ? Infinity : 5;
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
        membershipStatusLevel: $('membership-status-level'),
        membershipStatusExpire: $('membership-status-expire'),
        membershipStatusBadge: $('membership-status-badge'),
        membershipBenefitDiscount: $('membership-benefit-discount'),

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
        cfgSupportPricePerG: $('cfg-support-price-per-g'),
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

    // ── Mobile Navigation Drawer DOM refs ──
    const mobileNav = {
        menuBtn: $('mobile-menu-btn'),
        drawer: $('mobile-nav-drawer'),
        backdrop: $('mobile-nav-backdrop'),
        closeBtn: $('mobile-nav-close-btn'),
        openLoginBtn: $('mobile-open-login-btn'),
        logoutBtn: $('mobile-logout-btn'),
        openMembershipBtn: $('mobile-open-membership-btn'),
        openUserCenterBtn: $('mobile-open-user-center-btn'),
        openAdminUsersBtn: $('mobile-open-admin-users-btn'),
        openQuoteHistoryBtn: $('mobile-open-quote-history-btn'),
        langSwitchBtn: $('mobile-lang-switch-btn'),
        langLabel: $('mobile-lang-label'),
        appVersion: $('mobile-app-version'),
    };

    // ── Init all modules with their DOM refs ──
    initAuth(dom);
    initSettings(dom);
    initPresets(dom);
    initMembership(dom);
    initQuote(dom);
    initTableEnhancements();
    initPreview(dom);
    initOrientationUI(dom);
    initOnboarding();
    initMobileFormOptimizations();
    initBrandLogoUpload();
    initZipUpload(dom, _getMaxFiles);

    // Break circular dep: quote.js needs openLoginModal from auth.js
    setOpenLoginModalRef(openLoginModal);

    // ── Three.js setup ──
    try { initViewer(dom.previewContainer, dom.previewPlaceholder); } catch(e) { console.error('initViewer failed (non-fatal):', e); }

    // ── Quote history ──
    initQuoteHistory();

    // ── Helpers: reduce boilerplate ──
    function _showError(msg) {
        if (dom.errorMsg) dom.errorMsg.textContent = msg;
        if (dom.errorContainer) dom.errorContainer.classList.remove('hidden');
    }
    function _hideError() {
        if (dom.errorContainer) dom.errorContainer.classList.add('hidden');
    }
    function _bind(el, event, handler) {
        if (el) el.addEventListener(event, handler);
    }

    // ═══════════════════════════════════════════════
    //  Event wiring
    // ═══════════════════════════════════════════════

    // Auth - form events are wired by _wireLoginForm() in auth.js init
    _bind(dom.openLoginBtn, 'click', openLoginModal);

    // Language switcher
    const langSwitchBtn = document.getElementById('lang-switch-btn');
    if (langSwitchBtn) {
        const updateLangBtn = () => {
            langSwitchBtn.textContent = `${langFlag(lang)} ${langLabel(lang)}`;
            // Sync mobile lang label
            if (mobileNav.langLabel) mobileNav.langLabel.textContent = `${langFlag(lang)} ${langLabel(lang)}`;
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
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const ph = el.getAttribute('data-i18n-placeholder');
            if (ph) el.placeholder = t(ph);
        });
        // Re-render auth UI (member badge, etc.)
        renderAuthUI();
        // Re-render user center if it's open
        if (dom.userCenterModal && !dom.userCenterModal.classList.contains('hidden')) {
            renderUserCenterUI();
        }
    });
    _bind(dom.userMenuBtn, 'click', () => dom.userDropdown.classList.toggle('hidden'));
    _bind(dom.openAdminUsersBtn, 'click', () => { dom.userDropdown.classList.add('hidden'); window.location.href = '/admin/users'; });
    _bind(dom.openMembershipBtn, 'click', () => { dom.userDropdown.classList.add('hidden'); openMembershipModal(); });
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
    _bind(dom.logoutBtn, 'click', handleLogout);
    document.addEventListener('click', (event) => {
        if (dom.userMenu && !dom.userMenu.contains(event.target)) dom.userDropdown.classList.add('hidden');
    });

    // Membership
    _bind(dom.membershipCloseBtn, 'click', closeMembershipModal);
    _bind(dom.membershipBackdrop, 'click', closeMembershipModal);
    _bind(dom.membershipRefreshBtn, 'click', refreshMembershipStatus);
    _bind(dom.membershipOrdersBtn, 'click', toggleMembershipOrders);

    // Slicer presets
    _bind(dom.slicerPresetsRefreshBtn, 'click', fetchSlicerPresets);
    _bind(dom.slicerPresetsDownloadBtn, 'click', downloadSelectedPreset);
    _bind(dom.slicerPresetsDeleteBtn, 'click', deleteSelectedPreset);
    _bind(dom.slicerPresetUploadBtn, 'click', uploadSlicerPreset);
    _bind(dom.slicerPresetGenerateBtn, 'click', generateSlicerPreset);

    // ── Slicer preset form: select preset → load params ──
    if (dom.genPresetSelect) {
        dom.genPresetSelect.addEventListener('change', async () => {
            const val = dom.genPresetSelect.value;
            if (!val) {
                // "-- 新建 / 未选择 --" → disable save
                if (dom.genPresetSaveBtn) dom.genPresetSaveBtn.disabled = true;
                // Sync batch slicer preset
                const batchSel = document.getElementById('batch-slicer-preset');
                if (batchSel) batchSel.value = '';
                quoteOptions.slicer_preset_id = null;
                saveSlicerPresetSelection();
                setDefaultSlicerPresetId(null);
                return;
            }
            await loadPresetIntoForm(val);
            // Enable save button when a preset is selected (and not system preset)
            if (dom.genPresetSaveBtn) dom.genPresetSaveBtn.disabled = false;
            // Sync batch slicer preset
            const batchSel = document.getElementById('batch-slicer-preset');
            if (batchSel) batchSel.value = val;
            quoteOptions.slicer_preset_id = Number(val);
            saveSlicerPresetSelection();
            setDefaultSlicerPresetId(Number(val));
        });
    }

    // ── Slicer preset form: save button ──
    _bind(dom.genPresetSaveBtn, 'click', saveCurrentPreset);

    // ── Slicer preset form: save-as button (direct save with auto-generated name)
    _bind(dom.genPresetSaveasBtn, 'click', saveAsNewPreset);

    // ── Global: color dropdown close on outside click + toggle + item selection ──
    document.addEventListener('click', (e) => {
        // Close all color dropdowns on outside click
        if (!e.target.closest('.color-dd-wrapper')) {
            document.querySelectorAll('.color-dd-list:not(.hidden)').forEach(l => l.classList.add('hidden'));
        }
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
        btn.textContent = hidden ? '📊详情' : '📊收起';
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
    _bind(dom.optionsCloseBtn, 'click', () => dom.optionsModal.classList.add('hidden'));
    _bind(dom.optionsBackdrop, 'click', () => dom.optionsModal.classList.add('hidden'));

    // Batch edit bar
    const batchBrand = document.getElementById('batch-brand');
    const batchMaterial = document.getElementById('batch-material');
    const batchApplyBtn = document.getElementById('batch-apply-btn');
    const batchQuantity = document.getElementById('batch-quantity');
    const batchPrinterModel = document.getElementById('batch-printer-model');
    const batchSlicerPreset = document.getElementById('batch-slicer-preset');

    if (batchBrand) batchBrand.addEventListener('change', refreshBatchMaterialDropdown);
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
                // Sync gen-preset-select in user center
                const genSel = document.getElementById('gen-preset-select');
                if (genSel) genSel.value = '';
                setDefaultSlicerPresetId(null);
                return;
            }
            quoteOptions.slicer_preset_id = Number(val);
            saveSlicerPresetSelection();
            // Sync gen-preset-select in user center
            const genSel = document.getElementById('gen-preset-select');
            if (genSel) genSel.value = val;
            setDefaultSlicerPresetId(Number(val));
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
    _bind(dom.previewCloseBtn, 'click', closePreviewModal);
    _bind(dom.previewBackdrop, 'click', closePreviewModal);
    setupViewCube();

    // Orientation
    _bind(dom.orientCenterBtn, 'click', centerModel);
    _bind(dom.orientResetBtn, 'click', resetOrientationHandler);
    _bind(dom.layFaceBtn, 'click', toggleLayFace);
    _bind(dom.orientTrainBtn, 'click', submitTraining);

    // User center
    const hideUserCenter = () => { dom.userCenterModal.classList.add('hidden'); dom.userCenterMsg.classList.add('hidden'); };
    _bind(dom.userCenterCloseBtn, 'click', hideUserCenter);
    _bind(dom.userCenterBackdrop, 'click', hideUserCenter);
    _bind(dom.userCenterSaveBtn, 'click', saveUserSettings);
    _bind(dom.userCenterSetDefaultsBtn, 'click', setAsDefaults);
    _bind(dom.ucChangePasswordBtn, 'click', changePassword);

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
    const ppAddSlotBtn = document.getElementById('printer-add-slot-btn');
    if (ppAddSlotBtn) ppAddSlotBtn.addEventListener('click', addEnabledPrinterSlot);

    // Custom printer form
    const customPrinterBtn = document.getElementById('printer-add-custom-btn');
    if (customPrinterBtn) customPrinterBtn.addEventListener('click', showCustomPrinterForm);
    const customPpSaveBtn = document.getElementById('custom-pp-save-btn');
    if (customPpSaveBtn) customPpSaveBtn.addEventListener('click', saveCustomPrinter);
    const customPpCancelBtn = document.getElementById('custom-pp-cancel-btn');
    if (customPpCancelBtn) customPpCancelBtn.addEventListener('click', hideCustomPrinterForm);

    // ── Sync user center → model page (printer, nozzle, material) ──
    // Printer sync
    const ucPrinterSel = document.getElementById('cfg-printer-model-main');
    if (ucPrinterSel) {
        ucPrinterSel.addEventListener('change', () => {
            const batchPrinter = document.getElementById('batch-printer-model');
            if (batchPrinter && ucPrinterSel.value) {
                batchPrinter.value = ucPrinterSel.value;
                batchPrinter.dispatchEvent(new Event('change'));
            }
        });
    }
    // Nozzle sync
    const ucNozzleSel = document.getElementById('cfg-nozzle-diameter');
    if (ucNozzleSel) {
        ucNozzleSel.addEventListener('change', () => {
            const batchNozzle = document.getElementById('batch-nozzle-diameter');
            if (batchNozzle && ucNozzleSel.value) {
                batchNozzle.value = ucNozzleSel.value;
                batchNozzle.dispatchEvent(new Event('change'));
            }
        });
    }
    // Material sync
    const ucMaterialSel = document.getElementById('uc-default-material');
    if (ucMaterialSel) {
        ucMaterialSel.addEventListener('change', () => {
            const batchMat = document.getElementById('batch-material');
            if (batchMat && ucMaterialSel.value) {
                batchMat.value = ucMaterialSel.value;
                batchMat.dispatchEvent(new Event('change'));
            }
            // Update quoteOptions material
            if (ucMaterialSel.value) quoteOptions.material = ucMaterialSel.value;
        });
    }

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

    // Print-params sub-tabs (材料设置 / 机型配置 / 切片配置)
    const ppSubTabBtns = document.querySelectorAll('.pp-sub-tab-btn');
    const ppSubPanes = document.querySelectorAll('.pp-sub-pane');
    ppSubTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const subTabId = btn.getAttribute('data-pp-tab');
            ppSubTabBtns.forEach(b => { b.classList.remove('text-indigo-700', 'border-indigo-600'); b.classList.add('text-gray-500', 'border-transparent'); });
            btn.classList.add('text-indigo-700', 'border-indigo-600');
            btn.classList.remove('text-gray-500', 'border-transparent');
            ppSubPanes.forEach(pane => { pane.classList.add('hidden'); });
            const targetPane = document.getElementById(`pp-sub-${subTabId}`);
            if (targetPane) targetPane.classList.remove('hidden');
        });
    });

    // Materials table
    if (dom.materialsTbody) {
        dom.materialsTbody.addEventListener('change', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT') return;
            const idx = target.getAttribute('data-idx');
            const field = target.getAttribute('data-field');
            if (field === 'name') {
                MATERIAL_OPTIONS[idx].name = target.value;
                // 材料类型变更时自动填充密度和单价
                const preset = MATERIAL_TYPE_PRESETS[target.value];
                if (preset) {
                    const row = target.closest('tr');
                    const densityInput = row.querySelector('[data-field="density"]');
                    const priceInput = row.querySelector('[data-field="price_per_kg"]');
                    if (densityInput) { densityInput.value = preset.density; MATERIAL_OPTIONS[idx].density = preset.density; }
                    if (priceInput) { priceInput.value = preset.price_per_kg; MATERIAL_OPTIONS[idx].price_per_kg = preset.price_per_kg; }
                }
            }
            else if (field === 'brand') {
                MATERIAL_OPTIONS[idx].brand = target.value;
                // 品牌变更后重建默认品牌下拉 + 刷新默认材料列表
                const brandSel = document.getElementById('uc-default-brand');
                const matSel = document.getElementById('uc-default-material');
                if (brandSel) {
                    const allBrands = getBrandOptions();
                    const prevBrand = brandSel.value;
                    brandSel.innerHTML = allBrands.map(b =>
                        '<option value="' + escapeHtml(b) + '"' + (b === prevBrand ? ' selected' : '') + '>' + escapeHtml(b) + '</option>
                    ).join('');
                    if (!brandSel.value && brandSel.options.length) brandSel.value = brandSel.options[0].value;
                    quoteOptions.brand = brandSel.value;
                }
                if (matSel) {
                    const selectedBrand = brandSel ? brandSel.value : '';
                    const prevMat = matSel.value;
                    const materials = getMaterialsByBrand(selectedBrand);
                    matSel.innerHTML = materials.map(m =>
                        '<option value="' + escapeHtml(m.name) + '"' + (m.name === prevMat ? ' selected' : '') + '>' + escapeHtml(m.name) + '</option>'
                    ).join('');
                    if (!matSel.value && matSel.options.length) matSel.value = matSel.options[0].value;
                    quoteOptions.material = matSel.value;
                }
            }
            else if (field === 'density') MATERIAL_OPTIONS[idx].density = parseFloat(target.value) || 1.0;
            else if (field === 'price_per_kg') MATERIAL_OPTIONS[idx].price_per_kg = parseFloat(target.value) || 0.0;
        });
        // ── Input event: real-time sync for datalist-based text inputs ──
        dom.materialsTbody.addEventListener('input', (e) => {
            const target = e.target;
            if (target.tagName !== 'INPUT' || target.type === 'number') return;
            const idx = target.getAttribute('data-idx');
            const field = target.getAttribute('data-field');
            if (idx == null || !field) return;
            if (field === 'brand') {
                MATERIAL_OPTIONS[idx].brand = target.value;
                // Update custom badge visibility in real-time
                const knownBrands = ['Generic','eSUN','Polymaker','Hatchbox','Prusament','Prusa','SUNLU','Creality','Overture','ColorFabb','MatterHackers','Bambu Lab','Anycubic','Elegoo','Jayo','Eryone','Voron'];
                const cell = target.closest('td');
                if (cell) {
                    let badge = cell.querySelector('.custom-brand-badge');
                    const isCustom = !knownBrands.includes(target.value.trim());
                    if (isCustom && !badge) {
                        badge = document.createElement('span');
                        badge.className = 'custom-brand-badge text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0';
                        badge.textContent = '自定义';
                        target.parentElement.appendChild(badge);
                    } else if (!isCustom && badge) {
                        badge.remove();
                    }
                }
            }
            else if (field === 'name') {
                MATERIAL_OPTIONS[idx].name = target.value;
                // Update custom type badge visibility in real-time
                const presetTypes = Object.keys(MATERIAL_TYPE_PRESETS);
                const cell = target.closest('td');
                if (cell) {
                    let badge = cell.querySelector('.custom-type-badge');
                    const isCustom = !presetTypes.includes(target.value.trim());
                    if (isCustom && !badge) {
                        badge = document.createElement('span');
                        badge.className = 'custom-type-badge text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0';
                        badge.textContent = '自定义';
                        target.parentElement.appendChild(badge);
                    } else if (!isCustom && badge) {
                        badge.remove();
                    }
                }
            }
        });
        dom.materialsTbody.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-material-btn')) {
                const idx = e.target.getAttribute('data-idx');
                MATERIAL_OPTIONS.splice(idx, 1);
                // 删除后同步 quoteOptions
                const remainingBrands = getUsedBrandOptions();
                if (!remainingBrands.includes(quoteOptions.brand)) {
                    quoteOptions.brand = remainingBrands[0] || '';
                }
                const remainingMaterials = getMaterialsByBrand(quoteOptions.brand);
                if (!remainingMaterials.some(m => m.name === quoteOptions.material)) {
                    quoteOptions.material = remainingMaterials[0]?.name || '';
                }
                renderUserCenterUI();
            } else if (e.target.classList.contains('edit-colors-btn')) {
                openColorEditor(parseInt(e.target.getAttribute('data-idx')));
            }
        });
    }
    if (dom.addMaterialBtn) dom.addMaterialBtn.addEventListener('click', () => {
        const defaultType = Object.keys(MATERIAL_TYPE_PRESETS)[0] || 'PLA';
        const defaultPreset = MATERIAL_TYPE_PRESETS[defaultType] || { density: 1.24, price_per_kg: 80 };
        MATERIAL_OPTIONS.push({ name: defaultType, brand: "Generic", density: defaultPreset.density, price_per_kg: defaultPreset.price_per_kg, colors: [{ name: "黑色", hex: "#000000" }, { name: "白色", hex: "#ffffff" }] });
        renderUserCenterUI();
    });
    const matRestoreBtn = document.getElementById('material-restore-defaults-btn');
    if (matRestoreBtn) matRestoreBtn.addEventListener('click', restoreDefaultMaterials);

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
            dom.formulaVarsToggleBtn.textContent = hidden ? t('settings.collapseVarDict') : t('settings.expandVarDict');
        });
    }
    if (dom.formulaResetBtn) {
        dom.formulaResetBtn.addEventListener('click', () => {
            dom.cfgUnitCostFormula.value = '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) + support_cost_per_part_cny';
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
                    dom.fileNameDisplay.textContent = t('quote.noFileSelected');
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
                return;
            }
            // Toggle detail sections (cost breakdown / material info / print suggestions)
            const toggleBtn = event.target.closest('[data-toggle-detail]');
            if (toggleBtn) {
                const filename = toggleBtn.getAttribute('data-toggle-detail');
                const detailContent = document.querySelector('[data-detail-content="' + filename + '"]');
                if (detailContent) {
                    const isHidden = detailContent.classList.contains('hidden');
                    detailContent.classList.toggle('hidden');
                    const svg = toggleBtn.querySelector('svg');
                    if (svg) svg.style.transform = isHidden ? 'rotate(180deg)' : '';
                }
                return;
            }
            // Re-quote single file
            const requoteBtn = event.target.closest('[data-requote-file]');
            if (requoteBtn) {
                const filename = requoteBtn.getAttribute('data-requote-file');
                const file = selectedFilesMap.get(filename);
                if (file) {
                    const existing = currentResults.find((r) => r && r.filename === filename);
                    const material = existing?.material || quoteOptions.material;
                    const allowedColors = getColorsForMaterial(material);
                    const color = pickAllowedColor(allowedColors, existing?.color, quoteOptions.color);
                    const quantity = existing?.quantity || quoteOptions.quantity || 1;
                    const pm = existing?._printer_model || '';
                    const sp = existing?._slicer_preset_id;
                    const idx = currentResults.findIndex((i) => i && i.filename === filename);
                    if (idx >= 0) currentResults[idx] = { ...currentResults[idx], _recalculating: true };
                    renderResultsTable();
                    recalcSummaryFromCurrentResults();
                    quoteSingleFileWithOptions(file, { material, color, quantity, _printer_model: pm, _slicer_preset_id: sp })
                        .then((updated) => {
                            mergeResultsByFilename([updated]);
                            renderResultsTable();
                            recalcSummaryFromCurrentResults();
                        })
                        .catch((err) => {
                            mergeResultsByFilename([{ filename, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
                            renderResultsTable();
                            recalcSummaryFromCurrentResults();
                        });
                }
                return;
            }
            // Material comparison button
            const compareBtn = event.target.closest('[data-compare-material]');
            if (compareBtn) {
                openMaterialCompare(compareBtn.getAttribute('data-compare-material'));
                return;
            }
        });
    }

    // 移动端卡片事件
    const cardsContainer = document.getElementById('batch-results-cards');
    if (cardsContainer) {
        cardsContainer.addEventListener('change', handleCardEditChange);
        cardsContainer.addEventListener('click', (event) => {
            const deleteBtn = event.target.closest('[data-delete-file]');
            if (deleteBtn) {
                const filename = deleteBtn.getAttribute('data-delete-file');
                selectedFilesMap.delete(filename);
                thumbnailMap.delete(filename);
                setCurrentResults(currentResults.filter((i) => i && i.filename !== filename));
                renderResultsTable();
                recalcSummaryFromCurrentResults();
                if (selectedFilesMap.size === 0) {
                    dom.fileNameDisplay.textContent = t('quote.noFileSelected');
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
                return;
            }
            // Toggle detail sections for mobile cards
            const toggleBtn = event.target.closest('[data-toggle-detail]');
            if (toggleBtn) {
                const filename = toggleBtn.getAttribute('data-toggle-detail');
                const detailContent = document.querySelector('[data-detail-content="' + filename + '"]');
                if (detailContent) {
                    const isHidden = detailContent.classList.contains('hidden');
                    detailContent.classList.toggle('hidden');
                    const svg = toggleBtn.querySelector('svg');
                    if (svg) svg.style.transform = isHidden ? 'rotate(180deg)' : '';
                }
                return;
            }
            // Material comparison button (mobile cards)
            const compareBtn = event.target.closest('[data-compare-material]');
            if (compareBtn) {
                openMaterialCompare(compareBtn.getAttribute('data-compare-material'));
                return;
            }
        });
    }

    // 导出按钮（登录用户可用）
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportExcel);

    // PDF 导出按钮
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', handleExportPdfFromResults);
    }

    // ── PDF export from current results ──
    async function handleExportPdfFromResults() {
        if (!currentUser || !authToken) { openLoginModal(); return; }
        const successItems = currentResults.filter(r => r && r.status === 'success');
        if (successItems.length === 0) {
            alert('没有可导出的报价结果，请先上传模型并报价');
            return;
        }
        const btn = document.getElementById('export-pdf-btn');
        const origText = btn?.textContent;
        try {
            if (btn) { btn.disabled = true; btn.textContent = t('common.loading') || '生成中...'; }
            // Build items payload from current results
            const batchNozzle = document.getElementById('batch-nozzle-diameter')?.value || '';
            const batchLayerHeight = document.getElementById('gen-layer-height')?.value || '';
            const batchWallCount = document.getElementById('gen-wall-count')?.value || '';
            const batchInfill = document.getElementById('gen-infill')?.value || '';
            const items = successItems.map(r => {
                const rawThumb = thumbnailMap.get(r.filename) || '';
                return {
                filename: r.filename || '',
                material: r.material || '',
                color: r.color || '',
                quantity: r.quantity || 1,
                volume_cm3: r.volume_cm3 || 0,
                weight_g: r.weight_g || 0,
                estimated_time_h: r.estimated_time_h || 0,
                cost_cny: r.cost_cny || 0,
                printer_model: r._printer_model || quoteOptions.printer_model || '',
                nozzle_diameter: batchNozzle,
                layer_height: r.cost_breakdown?.gcode_summary?.core_params?.layer_height || batchLayerHeight || '',
                wall_count: r.cost_breakdown?.gcode_summary?.core_params?.perimeters || batchWallCount || '',
                infill_percent: r.cost_breakdown?.gcode_summary?.core_params?.fill_density || batchInfill || '',
                brand: (MATERIAL_OPTIONS.find(m => m.name === r.material) || {}).brand || quoteOptions.brand || '',
                created_at: new Date().toISOString(),
                thumbnail_b64: rawThumb.includes(',') ? rawThumb.split(',')[1] : rawThumb,
                };
            });
            const body = JSON.stringify({ items });
            const resp = await authFetch('/api/quote/export-pdf-inline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            if (resp.status === 403) {
                alert('会员专属功能，请先升级会员');
                return;
            }
            if (!resp.ok) throw new Error('导出失败');
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `quote_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(e.message || '导出失败');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }
    }

    // ── File upload (delegated to zip-upload.js) ──
    // handleFileSelection is imported from modules/zip-upload.js

    if (dom.fileInput) {
        dom.fileInput.addEventListener('change', async (e) => {
            const newFiles = Array.from(e.target.files || []);
            dom.fileInput.value = '';
            await handleFileSelection(newFiles);
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
            let text = data.version || '?';
            if (!text.startsWith('v')) text = `v${text}`;
            if (data.deployed_at) {
                const dt = data.deployed_at.replace('T', ' ').substring(0, 16);
                text += ` · ${dt}`;
            }
            versionEl.textContent = text;
            versionEl.title = `环境: ${data.env || 'unknown'}`;
            // Also update mobile nav version
            if (mobileNav.appVersion) mobileNav.appVersion.textContent = text;
        } catch (e) {
            versionEl.textContent = 'v?';
        }
    }

    // Enhanced Drag & Drop (using upload module)
    if (dom.fileInput) {
        setupEnhancedDragDrop(dom.fileInput, async (droppedFiles) => {
            await handleFileSelection(droppedFiles);
        });
    }

    // File preview chip remove button handler
    const previewChipsContainer = document.getElementById('file-preview-chips');
    if (previewChipsContainer) {
        previewChipsContainer.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-remove-file]');
            if (removeBtn) {
                const filename = removeBtn.getAttribute('data-remove-file');
                selectedFilesMap.delete(filename);
                thumbnailMap.delete(filename);
                setCurrentResults(currentResults.filter((i) => i && i.filename !== filename));
                renderResultsTable();
                recalcSummaryFromCurrentResults();
                renderFilePreviewChips([]);
                if (selectedFilesMap.size === 0) {
                    dom.fileNameDisplay.textContent = t('quote.noFileSelected');
                    dom.fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
                } else {
                    dom.fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件`;
                }
            }
        });
    }

    // ═══════════════════════════════════════════════
    //  Startup
    // ═══════════════════════════════════════════════

    // ═══════════════════════════════════════════════
    //  Mobile Navigation Drawer
    // ═══════════════════════════════════════════════
    function openMobileNav() {
        if (!mobileNav.drawer) return;
        mobileNav.drawer.classList.add('open');
        mobileNav.backdrop.classList.add('visible');
        mobileNav.menuBtn.classList.add('open');
        mobileNav.menuBtn.setAttribute('aria-expanded', 'true');
        document.body.classList.add('nav-open');
        syncMobileNavAuthState();
    }

    function closeMobileNav() {
        if (!mobileNav.drawer) return;
        mobileNav.drawer.classList.remove('open');
        mobileNav.backdrop.classList.remove('visible');
        mobileNav.menuBtn.classList.remove('open');
        mobileNav.menuBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
    }

    function syncMobileNavAuthState() {
        // Sync mobile drawer buttons with desktop auth state
        if (currentUser) {
            if (mobileNav.openLoginBtn) mobileNav.openLoginBtn.classList.add('hidden');
            if (mobileNav.logoutBtn) mobileNav.logoutBtn.classList.remove('hidden');
            if (mobileNav.openMembershipBtn) mobileNav.openMembershipBtn.classList.toggle('hidden', false);
            if (mobileNav.openUserCenterBtn) mobileNav.openUserCenterBtn.classList.remove('hidden');
            if (mobileNav.openAdminUsersBtn) mobileNav.openAdminUsersBtn.classList.toggle('hidden', !currentUser.is_admin);
        } else {
            if (mobileNav.openLoginBtn) mobileNav.openLoginBtn.classList.remove('hidden');
            if (mobileNav.logoutBtn) mobileNav.logoutBtn.classList.add('hidden');
            if (mobileNav.openMembershipBtn) mobileNav.openMembershipBtn.classList.add('hidden');
            if (mobileNav.openUserCenterBtn) mobileNav.openUserCenterBtn.classList.add('hidden');
            if (mobileNav.openAdminUsersBtn) mobileNav.openAdminUsersBtn.classList.add('hidden');
        }
    }

    // Set active nav item based on current page
    function highlightActiveMobileNavItem() {
        const path = window.location.pathname;
        document.querySelectorAll('.mobile-nav-item').forEach(item => item.classList.remove('active'));
        let activeSelector = '[data-page="quote"]';
        if (path.includes('/admin/users')) activeSelector = '[data-page="admin"]';
        const activeItem = document.querySelector(`.mobile-nav-item${activeSelector}`);
        if (activeItem) activeItem.classList.add('active');
    }
    highlightActiveMobileNavItem();

    // Wire hamburger button
    _bind(mobileNav.menuBtn, 'click', () => {
        if (mobileNav.drawer?.classList.contains('open')) {
            closeMobileNav();
        } else {
            openMobileNav();
        }
    });

    // Wire close button and backdrop
    _bind(mobileNav.closeBtn, 'click', closeMobileNav);
    _bind(mobileNav.backdrop, 'click', closeMobileNav);

    // Wire mobile nav action buttons (delegate to desktop handlers)
    _bind(mobileNav.openLoginBtn, 'click', () => { closeMobileNav(); openLoginModal(); });
    _bind(mobileNav.logoutBtn, 'click', () => { closeMobileNav(); handleLogout(); });
    _bind(mobileNav.openMembershipBtn, 'click', () => { closeMobileNav(); openMembershipModal(); });
    _bind(mobileNav.openQuoteHistoryBtn, 'click', () => {
        closeMobileNav();
        loadQuoteHistory(authToken);
        // Try to find and click the desktop history button to open modal
        const histBtn = document.getElementById('open-quote-history-btn');
        if (histBtn) histBtn.click();
    });
    if (mobileNav.openUserCenterBtn) mobileNav.openUserCenterBtn.addEventListener('click', () => {
        closeMobileNav();
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
    _bind(mobileNav.openAdminUsersBtn, 'click', () => { closeMobileNav(); window.location.href = '/admin/users'; });

    // Wire mobile language switcher
    if (mobileNav.langSwitchBtn) {
        const updateMobileLangBtn = () => {
            if (mobileNav.langLabel) mobileNav.langLabel.textContent = `${langFlag(lang)} ${langLabel(lang)}`;
        };
        updateMobileLangBtn();
        mobileNav.langSwitchBtn.addEventListener('click', () => {
            toggleLang();
            updateMobileLangBtn();
        });
    }

    // Sync mobile app version with desktop
    if (mobileNav.appVersion) {
        const desktopVersion = document.getElementById('app-version');
        if (desktopVersion) {
            const observer = new MutationObserver(() => {
                mobileNav.appVersion.textContent = desktopVersion.textContent;
            });
            observer.observe(desktopVersion, { childList: true, characterData: true, subtree: true });
        }
    }

    // ── Swipe-to-close gesture ──
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoveX = 0;
    let isSwiping = false;

    if (mobileNav.drawer) {
        mobileNav.drawer.addEventListener('touchstart', (e) => {
            if (!mobileNav.drawer.classList.contains('open')) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = false;
        }, { passive: true });

        mobileNav.drawer.addEventListener('touchmove', (e) => {
            if (!mobileNav.drawer.classList.contains('open')) return;
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            // Only trigger if horizontal swipe is dominant
            if (Math.abs(dx) > Math.abs(dy) && dx < -30) {
                isSwiping = true;
            }
        }, { passive: true });

        mobileNav.drawer.addEventListener('touchend', () => {
            if (isSwiping) {
                closeMobileNav();
                isSwiping = false;
            }
        }, { passive: true });
    }

    // Close mobile nav on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileNav.drawer?.classList.contains('open')) {
            closeMobileNav();
        }
    });

    // Export syncMobileNavAuthState so auth.js can call it after login/logout
    window.__syncMobileNavAuthState = syncMobileNavAuthState;
    loadAppVersion();
    preloadPrinterSelectors();
    window.addEventListener('resize', updateViewerSize);

    // Before unload warning — custom modal instead of browser native dialog
    window.addEventListener('beforeunload', (event) => {
        if (selectedFilesMap.size > 0) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    // Intercept link clicks and navigation when files are selected
    document.addEventListener('click', (e) => {
        if (selectedFilesMap.size === 0) return;
        const link = e.target.closest('a[href]');
        if (!link || link.target === '_blank') return;
        const href = link.getAttribute('href');
        if (!href || href === '#' || href.startsWith('javascript:')) return;
        e.preventDefault();
        _showLeaveConfirmModal(() => { window.location.href = href; });
    });
    function _showLeaveConfirmModal(onConfirm) {
        const modal = document.getElementById('leave-confirm-modal');
        const cancelBtn = document.getElementById('leave-confirm-cancel');
        const okBtn = document.getElementById('leave-confirm-ok');
        if (!modal) { onConfirm(); return; }
        modal.classList.remove('hidden');
        function close() { modal.classList.add('hidden'); cancelBtn.onclick = null; okBtn.onclick = null; }
        cancelBtn.onclick = close;
        okBtn.onclick = function() { close(); onConfirm(); };
        modal.querySelector('.bg-black\/50')?.addEventListener('click', close, { once: true });
    }

    refreshOptionsSummary();
    initializeAuth().then(() => {
        // Load presets for model-page selector after auth
        if (authToken) fetchSlicerPresets();
        // Check if this user needs the onboarding guide
        if (authToken) checkOnboarding();
    });
});
