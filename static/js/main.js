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
    recolorCurrentMesh,
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
    setDefaultSlicerPresetId, currentPreviewFilename,
    getMaterialsByBrand, MATERIAL_TYPE_PRESETS, getUsedBrandOptions,
} from './modules/state.js';

import {
    initAuth, refreshLoginCaptcha, openLoginModal, closeLoginModal,
    renderAuthUI, handleLoginSubmit, handleAuthSuccess, handleLogout,
    initializeAuth,
} from './modules/auth.js';
import {
    initSettings, fetchUserSettings, updateDropdowns, refreshQuoteColorDropdowns,
    buildPrinterOptionsHtml, renderUserCenterUI,
    syncPricingFromInputs, validateCurrentFormulas,
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
    ensureThumbnailForFile,
} from './modules/preview.js';
import {
    initOrientationUI, syncOrientationFromMesh,
    centerModel, resetOrientationHandler, toggleLayFace, submitTraining, learnedAutoOrient, saveOrientationAndRequote,
} from './modules/orientation-ui.js';
import { initTheme } from './modules/theme.js';
import { t, lang, toggleLang, langFlag, langLabel, initI18n } from './modules/i18n.js';
import { initOnboarding, checkAndStart as checkOnboarding, startGuide } from './modules/onboarding.js';
import { initZipUpload, handleFileSelection } from './modules/zip-upload.js';
import { initLiveClock } from './modules/live-clock.js';
import { collectAppDomRefs } from './modules/app-dom.js';
import { initColorDropdownUI, initMobileNavigation, initAppLifecycle } from './modules/app-shell.js';
import { initSettingsAreaEvents, initResultsAreaEvents } from './modules/app-events.js';

// ═══════════════════════════════════════════════
//  App entry point
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Apply theme immediately (before any rendering)
    initTheme();
    // Init i18n (language switcher)
    initI18n();
    // Init live clock
    initLiveClock();
    const _getMaxFiles = () => (currentUser && currentUser.is_member) ? Infinity : 5;
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const ALLOWED_EXTENSIONS = ['.stl', '.stp', '.step', '.obj', '.3mf', '.zip'];

    const { dom, mobileNav } = collectAppDomRefs();

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
    _bind(dom.openLoginBtn, 'click', () => openLoginModal(dom));

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
    _bind(dom.openAdminUsersBtn, 'click', () => { dom.userDropdown.classList.add('hidden'); window.__navigateIfLeaving('/admin/users'); });
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
        const defaultTab = document.querySelector('.uc-tab-btn[data-uc-tab="print-params"]') || document.querySelector('.uc-tab-btn');
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

    initColorDropdownUI({
        quoteOptions,
        currentResults,
        selectedFilesMap,
        thumbnailMap,
        dom,
        ensureThumbnailForFile,
        recolorCurrentMesh,
        getCurrentPreviewFilename: () => currentPreviewFilename,
        refreshOptionsSummary,
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
    _bind(document.getElementById('batch-recalculate-btn'), 'click', () => reQuoteAllSelectedFiles(t('quote.recalculate')));
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
    _bind(dom.orientLearnedBtn, 'click', learnedAutoOrient);
    _bind(dom.orientSaveBtn, 'click', saveOrientationAndRequote);

    // User center
    const hideUserCenter = () => { dom.userCenterModal.classList.add('hidden'); dom.userCenterMsg.classList.add('hidden'); };
    _bind(dom.userCenterCloseBtn, 'click', hideUserCenter);
    _bind(dom.userCenterBackdrop, 'click', hideUserCenter);
    _bind(dom.userCenterSaveBtn, 'click', saveUserSettings);
    _bind(dom.userCenterSetDefaultsBtn, 'click', setAsDefaults);
    _bind(dom.ucChangePasswordBtn, 'click', changePassword);

    initSettingsAreaEvents({
        dom,
        state: {
            MATERIAL_OPTIONS,
            quoteOptions,
            MATERIAL_TYPE_PRESETS,
            getUsedBrandOptions,
            getMaterialsByBrand,
            escapeHtml,
        },
        settings: {
            renderUserCenterUI,
            syncPricingFromInputs,
            validateCurrentFormulas,
            saveUserSettings,
            setAsDefaults,
            changePassword,
            restoreDefaultMaterials,
        },
        presets: {
            fetchPrinterModels,
            fetchSlicerPresets,
            fetchPrinterPresets,
            savePrinterPreset,
            restoreDefaultPrinters,
            addEnabledPrinterSlot,
            showCustomPrinterForm,
            hideCustomPrinterForm,
            saveCustomPrinter,
            downloadSelectedPreset,
            deleteSelectedPreset,
            uploadSlicerPreset,
            generateSlicerPreset,
        },
        i18n: { t },
    });

    initResultsAreaEvents({
        dom,
        state: {
            selectedFilesMap,
            thumbnailMap,
            currentResults,
            setCurrentResults,
            currentUser,
            authToken,
            quoteOptions,
            MATERIAL_OPTIONS,
            getColorsForMaterial,
            pickAllowedColor,
            authFetch,
        },
        quote: {
            handleRowEditChange,
            handleCardEditChange,
            renderResultsTable,
            recalcSummaryFromCurrentResults,
            quoteSingleFileWithOptions,
            mergeResultsByFilename,
            openMaterialCompare,
            exportCSV,
            exportExcel,
        },
        preview: {
            previewByFilename,
            closePreviewModal,
        },
        upload: {
            renderFilePreviewChips,
            setupEnhancedDragDrop,
        },
        zipUpload: {
            handleFileSelection,
        },
        auth: {
            openLoginModal,
        },
        i18n: { t },
    });

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

    initMobileNavigation({
        mobileNav,
        dom,
        getCurrentUser: () => currentUser,
        getAuthToken: () => authToken,
        openLoginModal,
        handleLogout,
        openMembershipModal,
        loadQuoteHistory,
        renderUserCenterUI,
        fetchPrinterModels,
        fetchSlicerPresets,
        fetchPrinterPresets,
        renderPrinterVisibilityList,
        closePreviewModal,
        langApi: {
            toggle: toggleLang,
            flag: () => langFlag(lang),
            label: () => langLabel(lang),
        },
    });

    initAppLifecycle({
        mobileNav,
        loadAppVersion,
        preloadPrinterSelectors,
        updateViewerSize,
        getSelectedFilesCount: () => selectedFilesMap.size + currentResults.length,
    });

    refreshOptionsSummary();
    initializeAuth().then(() => {
        // Load presets for model-page selector after auth
        if (authToken) fetchSlicerPresets();
        // Check if this user needs the onboarding guide
        if (authToken) checkOnboarding();
    });
});
