// ── Settings module index: re-exports everything from sub-modules for backward compatibility ──
export {
    initSettings,
    fetchUserSettings,
    updateDropdowns,
    refreshQuoteColorDropdowns,
    refreshDefaultMaterialControls,
    buildPrinterOptionsHtml,
    updateUploadLimitHint,
} from './common.js';

export {
    restoreDefaultMaterials,
    renderUserCenterUI,
} from './materials.js';

export {
    syncPricingFromInputs,
    validateCurrentFormulas,
} from './pricing.js';

export {
    changePassword,
} from './password.js';

export {
    initBrandLogoUpload,
} from './brand.js';

export {
    saveUserSettings,
    setAsDefaults,
    setFieldValidation,
    initOptionsFormValidation,
    initPasswordFormValidation,
    initMobileFormOptimizations,
} from './profile.js';
