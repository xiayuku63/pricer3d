// ── Printer model listing ──
import {
    authFetch,
    setCachedPrinterModels,
    getEnabledPrinters,
    defaultPrinterId, defaultNozzle,
    quoteOptions, getActivePrinterCompoundId,
    loadFrontSettingsSnapshot, saveFrontSettingsSnapshot,
    loadBatchSettingsSnapshot, saveBatchSettingsSnapshot,
} from '../state.js';
import { t } from '../i18n.js';
import { updateBedSize, setBedLabel } from '../viewer.js';
import { refreshStyledSelectDropdowns } from '../styled-select.js';
import { dom, _printerModels, _syncBatchPrinter, setPrinterModels } from './ui.js';
import { updatePrinterDetailPanel } from './printer.js';
import { updateLayerHeightRangeHint, syncStandardPresetForNozzle, syncSlicerPresetForNozzle, getStandardPresetNameForNozzle } from './slicer.js';
import { renderSlicerPresetsUI } from './ui.js';

function _selectFrontDefaultStandardPreset(nozzleValue) {
    const preset = document.getElementById('front-default-slicer-preset');
    const targetName = getStandardPresetNameForNozzle(nozzleValue);
    if (!preset) return;
    const selected = Array.from(preset.options).find((opt) => String(opt.textContent || '').trim() === targetName);
    preset.value = selected ? selected.value : '';
}

function _saveFrontSnapshot() {
    saveFrontSettingsSnapshot({
        printer_model: document.getElementById('front-default-printer-model')?.value || '',
        nozzle_diameter: document.getElementById('front-default-nozzle-diameter')?.value || '',
        slicer_preset_id: document.getElementById('front-default-slicer-preset')?.value || '',
        brand: document.getElementById('front-default-brand')?.value || '',
        material: document.getElementById('front-default-material')?.value || '',
        color: document.getElementById('front-default-color-dropdown')?.getAttribute('data-selected-color') || '',
    });
}

function _saveBatchSnapshot() {
    saveBatchSettingsSnapshot({
        printer_model: document.getElementById('batch-printer-model')?.value || '',
        nozzle_diameter: document.getElementById('batch-nozzle-diameter')?.value || '',
        slicer_preset_id: document.getElementById('batch-slicer-preset')?.value || '',
    });
}

export async function fetchPrinterModels() {
    const resp = await authFetch("/api/slicer/printers");
    if (!resp.ok) return;
    const data = await resp.json();
    setPrinterModels(data.items || []);
    setCachedPrinterModels(_printerModels);

    // Filter to enabled printers only
    const enabled = getEnabledPrinters();
    const visibleModels = enabled.length
        ? _printerModels.filter(p => enabled.includes(p.id))
        : _printerModels;

    const currentCfgNozzle = document.getElementById('cfg-nozzle-diameter')?.value || '';
    const currentBatchNozzle = document.getElementById('batch-nozzle-diameter')?.value || '';
    const frontSnapshot = loadFrontSettingsSnapshot();
    const batchSnapshot = loadBatchSettingsSnapshot();

    function _sameNozzle(left, right) {
        const a = Number.parseFloat(left);
        const b = Number.parseFloat(right);
        return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.0001;
    }

    function _preferredNozzle(model, currentValue) {
        const nozzles = (model && model.nozzles) ? model.nozzles : [0.4];
        const candidates = [currentValue, defaultNozzle, model?.nozzle, nozzles[0]];
        return candidates.find((candidate) => nozzles.some((n) => _sameNozzle(n, candidate))) ?? nozzles[0];
    }

    function _pickVisibleModelId(candidates, fallbackId) {
        const candidateList = Array.isArray(candidates) ? candidates : [candidates];
        for (const candidate of candidateList) {
            if (candidate && visibleModels.some((model) => model.id === candidate)) return candidate;
        }
        return fallbackId || '';
    }

    // ── Helper: get compound id for model + nozzle ──
    function _compoundId(modelId, nozzle) {
        const n = String(Math.round(nozzle * 10)).padStart(2, '0').slice(-2);
        return `${modelId}_${n}`;
    }

    // ── Helper: populate nozzle dropdown for given model ──
    function _populateNozzleDropdown(selId, modelId) {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const model = visibleModels.find(p => p.id === modelId);
        const nozzles = (model && model.nozzles) ? model.nozzles : [0.4];
        const preferred = _preferredNozzle(model, sel.value);
        sel.innerHTML = nozzles.map(n =>
            '<option value="' + n + '"' + (_sameNozzle(n, preferred) ? ' selected' : '') + '>' + n + 'mm</option>'
        ).join('');
        if (nozzles.length) sel.value = String(preferred);
    }

    // ── Populate default-printer selectors ──
    for (const selId of ["front-default-printer-model"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        sel.innerHTML = '';
        visibleModels.forEach(function(p) {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        // Prefer user's saved default; let onchange handler fill nozzle + bed
        var prefId = defaultPrinterId && visibleModels.some(function(p) { return p.id === defaultPrinterId; })
            ? defaultPrinterId : (visibleModels.length > 0 ? visibleModels[0].id : "");
        if (frontSnapshot?.printer_model && visibleModels.some(function(p) { return p.id === frontSnapshot.printer_model; })) {
            prefId = frontSnapshot.printer_model;
        }
        if (prefId) {
            sel.value = prefId;
            // Manually trigger nozzle/bed info for the selected model
            var printer = visibleModels.find(function(p) { return p.id === prefId; });
            if (printer) {
                if (selId === 'front-default-printer-model') {
                    const frontDefaultNozzle = document.getElementById('front-default-nozzle-diameter');
                    if (frontDefaultNozzle) frontDefaultNozzle.value = String(_preferredNozzle(printer, frontSnapshot?.nozzle_diameter || frontDefaultNozzle.value));
                }
            }
        }
    }

    // ── Populate model-page batch printer selector ──
    const batchSel = document.getElementById("batch-printer-model");
    if (batchSel) {
        batchSel.innerHTML = '';
        visibleModels.forEach(function(p) {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            batchSel.appendChild(opt);
        });
        if (visibleModels.length > 0) {
            // Batch controls drive import-time slicing. Prefer authenticated
            // defaults first, then in-session UI value, then older snapshots.
            var preferredId = _pickVisibleModelId(
                [defaultPrinterId, batchSel.value, batchSnapshot?.printer_model],
                visibleModels[0].id,
            );
            batchSel.value = preferredId;
            _populateNozzleDropdown("batch-nozzle-diameter", preferredId);
            // Import-time slicing should follow saved defaults after login/save.
            if (defaultNozzle || currentBatchNozzle || batchSnapshot?.nozzle_diameter) {
                var batchNozzleEl = document.getElementById("batch-nozzle-diameter");
                if (batchNozzleEl) {
                    const batchModel = visibleModels.find(function(p) { return p.id === preferredId; });
                    batchNozzleEl.value = String(_preferredNozzle(batchModel, defaultNozzle || currentBatchNozzle || batchSnapshot?.nozzle_diameter));
                }
            }
            _syncBatchPrinter();
            _saveBatchSnapshot();
        }
    }

    // ── Batch nozzle change → update compound id ──
    const batchNozzle = document.getElementById("batch-nozzle-diameter");
    if (batchNozzle && batchSel) {
        batchSel.addEventListener("change", () => {
            _populateNozzleDropdown("batch-nozzle-diameter", batchSel.value);
            _syncBatchPrinter();
            renderSlicerPresetsUI();
            _saveBatchSnapshot();
            var _changedPrinter = _printerModels.find(function(p) { return p.id === batchSel.value; });
            if (_changedPrinter && _changedPrinter.bed_width && _changedPrinter.bed_depth) {
                setBedLabel(_changedPrinter.bed_width, _changedPrinter.bed_depth, _changedPrinter.bed_height);
                updateBedSize(_changedPrinter.bed_width, _changedPrinter.bed_depth);
            }
        });
        if (batchNozzle) {
            batchNozzle.addEventListener("change", () => {
                _syncBatchPrinter();
                renderSlicerPresetsUI();
                _saveBatchSnapshot();
            });
        }
    }

    const frontDefaultPrinter = document.getElementById('front-default-printer-model');
    const frontDefaultNozzle = document.getElementById('front-default-nozzle-diameter');
    if (frontDefaultPrinter && frontDefaultNozzle) {
        frontDefaultPrinter.addEventListener('change', () => {
            _populateNozzleDropdown('front-default-nozzle-diameter', frontDefaultPrinter.value);
            renderSlicerPresetsUI();
            _selectFrontDefaultStandardPreset(frontDefaultNozzle.value);
            _saveFrontSnapshot();
        });
        frontDefaultNozzle.addEventListener('change', () => {
            renderSlicerPresetsUI();
            _selectFrontDefaultStandardPreset(frontDefaultNozzle.value);
            _saveFrontSnapshot();
        });
    }

    // ── Populate preset form printer selector ──
    const genSel = document.getElementById("gen-printer-model");
    if (genSel) {
        genSel.innerHTML = '';
        visibleModels.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            genSel.appendChild(opt);
        });
        if (visibleModels.length > 0) genSel.value = visibleModels[0].id;
    }

    const cfgNozzle = document.getElementById('cfg-nozzle-diameter');
    const printerBedInfo = document.getElementById('printer-bed-info');
    function _syncPrinterSlicerControls() {
        const printerId = genSel?.value;
        const printer = _printerModels.find((item) => item.id === printerId);
        if (cfgNozzle && printer) {
            const nozzles = Array.isArray(printer.nozzles) && printer.nozzles.length ? printer.nozzles : [printer.nozzle || 0.4];
            const preferred = _preferredNozzle(printer, cfgNozzle.value || currentCfgNozzle);
            cfgNozzle.innerHTML = nozzles.map((n) =>
                '<option value="' + n + '"' + (_sameNozzle(n, preferred) ? ' selected' : '') + '>' + n + 'mm</option>'
            ).join('');
            cfgNozzle.value = String(preferred);
        }
        if (printerBedInfo) {
            printerBedInfo.textContent = printer
                ? `${printer.bed_width}x${printer.bed_depth}x${printer.bed_height} mm`
                : '';
        }
        updateLayerHeightRangeHint();
        void syncStandardPresetForNozzle();
    }

    if (genSel) {
        genSel.addEventListener('change', _syncPrinterSlicerControls);
    }
    if (cfgNozzle) {
        cfgNozzle.addEventListener('change', () => {
            updateLayerHeightRangeHint();
            void syncStandardPresetForNozzle();
        });
    }
    _syncPrinterSlicerControls();
    _saveFrontSnapshot();
    refreshStyledSelectDropdowns([
        'front-default-printer-model',
        'front-default-nozzle-diameter',
        'front-default-slicer-preset',
        'batch-printer-model',
        'batch-nozzle-diameter',
        'batch-slicer-preset',
    ]);

    // ── Auto-fill nozzle + bed info when printer changes in printer tab ──
    // ── Update 3D viewer bed size to match the currently selected batch printer ──
    var _batchSelFinal = document.getElementById("batch-printer-model");
    if (_batchSelFinal && _batchSelFinal.value) {
        var _curPrinter = _printerModels.find(function(p) { return p.id === _batchSelFinal.value; });
        if (_curPrinter && _curPrinter.bed_width && _curPrinter.bed_depth) {
            setBedLabel(_curPrinter.bed_width, _curPrinter.bed_depth, _curPrinter.bed_height);
            updateBedSize(_curPrinter.bed_width, _curPrinter.bed_depth);
        }
    }
}
