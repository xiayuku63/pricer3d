export function collectAppDomRefs() {
    const $ = (id) => document.getElementById(id);

    const dom = {
        openLoginBtn: $('open-login-btn'),
        userMenu: $('user-menu'), userMenuBtn: $('user-menu-btn'), userDropdown: $('user-dropdown'),
        openMembershipBtn: $('open-membership-btn'), openAdminUsersBtn: $('open-admin-users-btn'),
        openUserCenterBtn: $('open-user-center-btn'), logoutBtn: $('logout-btn'),
        loginModal: $('login-modal'), loginBackdrop: $('login-backdrop'),
        loginUsername: $('login-username'), loginPassword: $('login-password'),
        loginCaptchaImg: $('login-captcha-img'), loginCaptchaCode: $('login-captcha-code'),
        loginAcceptLegal: $('login-accept-legal'), loginSubmitBtn: $('login-submit-btn'),
        loginError: $('login-error'),

        membershipModal: $('membership-modal'), membershipBackdrop: $('membership-backdrop'),
        membershipCloseBtn: $('membership-close-btn'), membershipPlans: $('membership-plans'),
        membershipMsg: $('membership-msg'), membershipRefreshBtn: $('membership-refresh-btn'),
        membershipOrdersBtn: $('membership-orders-btn'), membershipOrders: $('membership-orders'),
        membershipOrdersTbody: $('membership-orders-tbody'),
        membershipStatusLevel: $('membership-status-level'),
        membershipStatusExpire: $('membership-status-expire'),
        membershipStatusBadge: $('membership-status-badge'),
        membershipBenefitDiscount: $('membership-benefit-discount'),

        optionsSummary: $('options-summary'), optionsModal: $('options-modal'),
        optionsBackdrop: $('options-backdrop'), optionsCloseBtn: $('options-close-btn'),
        optionsSaveBtn: $('options-save-btn'), optMaterial: $('opt-material'),
        optColor: $('opt-color'), optQuantity: $('opt-quantity'),

        previewModal: $('preview-modal'), previewBackdrop: $('preview-backdrop'),
        viewCube: $('view-cube'), previewCloseBtn: $('preview-close-btn'),
        previewContainer: $('preview-container'), previewPlaceholder: $('preview-placeholder'),

        form: $('quote-form'), fileInput: $('file-upload'),
        fileNameDisplay: $('file-name'),
        resultContainer: $('result-container'), errorContainer: $('error-container'),
        errorMsg: $('error-msg'), batchResultsBody: $('batch-results-body'),

        userCenterModal: $('user-center-modal'), userCenterBackdrop: $('user-center-backdrop'),
        userCenterCloseBtn: $('user-center-close-btn'),
        userCenterSetDefaultsBtn: $('user-center-set-defaults-btn'),
        userCenterSaveBtn: $('user-center-save-btn'), materialsTbody: $('materials-tbody'),
        addMaterialBtn: $('add-material-btn'), userCenterMsg: $('user-center-msg'),
        userCenterHint: $('user-center-hint'),

        frontDefaultBrand: $('front-default-brand'),
        frontDefaultPrinterModel: $('front-default-printer-model'),
        frontDefaultNozzleDiameter: $('front-default-nozzle-diameter'),
        frontDefaultSlicerPreset: $('front-default-slicer-preset'),
        frontDefaultMaterial: $('front-default-material'),
        frontDefaultColorDropdown: $('front-default-color-dropdown'),
        frontDefaultSaveBtn: $('front-default-save-btn'),
        frontDefaultMsg: $('front-default-msg'),

        cfgMachineHourlyRate: $('cfg-machine-hourly-rate'), cfgSetupFee: $('cfg-setup-fee'),
        cfgMinJobFee: $('cfg-min-job-fee'), cfgMaterialWaste: $('cfg-material-waste'),
        cfgSupportPercent: $('cfg-support-percent'), cfgPostPerPart: $('cfg-post-per-part'),
        cfgTimeOverheadMin: $('cfg-time-overhead-min'), cfgTimeVolMinPerCm3: $('cfg-time-vol-min-per-cm3'),
        cfgSupportPricePerG: $('cfg-support-price-per-g'),
        cfgUnitCostFormula: $('cfg-unit-cost-formula'), cfgTotalCostFormula: $('cfg-total-cost-formula'),

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

        layFaceBtn: $('lay-face-btn'), orientResetBtn: $('orient-reset-btn'),
        orientCenterBtn: $('orient-center-btn'), orientTrainBtn: $('orient-train-btn'),
        orientTrainStatus: $('orient-train-status'), orientLearnedBtn: $('orient-learned-btn'), orientSaveBtn: $('orient-save-btn'),
        layFaceHint: $('lay-face-hint'),

        ucTabBtns: document.querySelectorAll('.uc-tab-btn'),
        ucTabPanes: document.querySelectorAll('.uc-tab-pane'),
        ucOldPassword: $('uc-old-password'), ucNewPassword: $('uc-new-password'),
        ucConfirmPassword: $('uc-confirm-password'), ucPasswordMsg: $('uc-password-msg'),
        ucChangePasswordBtn: $('uc-change-password-btn'),

        formulaResetBtn: $('formula-reset-btn'), formulaValidateBtn: $('formula-validate-btn'),
        formulaValidateMsg: $('formula-validate-msg'), formulaVarsToggleBtn: $('formula-vars-toggle-btn'),
        formulaVarsPanel: $('formula-vars-panel'),
    };

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

    return { dom, mobileNav };
}
