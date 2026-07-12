// ── Presets module ──
// Backward-compatible re-exports from sub-modules.
// This index.js replaces the old presets.js.
// All public API functions are re-exported here with exact names.
// Internal/private helpers (setMsg, _syncBatchPrinter, _onPresetRadioChange, etc.)
// are NOT re-exported — they were not part of the original public API.

// ── UI rendering (shared state + UI) ──
export {
    initPresets,
    preloadPrinterSelectors,
    renderSlicerPresetsUI,
} from './ui.js';

// ── Slicer preset CRUD ──
export {
    fetchSlicerPresets,
    uploadSlicerPreset,
    generateSlicerPreset,
    deleteSlicerPreset,
    loadPresetIntoForm,
    saveCurrentPreset,
    showSaveAsRow,
    hideSaveAsRow,
    downloadSelectedPreset,
    deleteSelectedPreset,
    saveAsNewPreset,
    updateLayerHeightDropdown,
    updateLayerHeightRangeHint,
} from './slicer.js';

// ── Printer preset CRUD ──
export {
    fetchPrinterPresets,
    deletePrinterPreset,
    savePrinterPreset,
    renderPrinterVisibilityList,
    addEnabledPrinterSlot,
    showCustomPrinterForm,
    hideCustomPrinterForm,
    saveCustomPrinter,
    restoreDefaultPrinters,
    updatePrinterDetailPanel,
    exportPrinterConfig,
    importPrinterConfig,
} from './printer.js';

// ── Printer model listing ──
export {
    fetchPrinterModels,
} from './printers.js';
