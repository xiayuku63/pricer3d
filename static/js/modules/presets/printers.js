// ── Printer model listing ──
import {
    authFetch,
    setCachedPrinterModels,
    getEnabledPrinters,
    defaultPrinterId, defaultNozzle,
    quoteOptions, getActivePrinterCompoundId,
} from '../state.js';
import { t } from '../i18n.js';
import { updateBedSize, setBedLabel } from '../viewer.js';
import { dom, _printerModels, _syncBatchPrinter, setPrinterModels } from './ui.js';
import { updatePrinterDetailPanel } from './printer.js';
import { updateLayerHeightRangeHint, syncStandardPresetForNozzle } from './slicer.js';

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
            '<option value="' + n + '"' + (_sameNozzle(n, preferred) ? ' selected' : '') + '>' + n + ' mm</option>'
        ).join('');
        if (nozzles.length) sel.value = String(preferred);
    }

    // ── Populate printer model tab ──
    for (const selId of ["cfg-printer-model-main"]) {
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
        if (prefId) {
            sel.value = prefId;
            // Manually trigger nozzle/bed info for the selected model
            var printer = visibleModels.find(function(p) { return p.id === prefId; });
            if (printer) {
                if (dom.cfgNozzleDiameter) {
                    dom.cfgNozzleDiameter.value = String(_preferredNozzle(printer, currentCfgNozzle));
                }
                if (dom.printerBedInfo) {
                    dom.printerBedInfo.textContent = t('printer.bedInfo', { x: printer.bed_width, y: printer.bed_depth, z: printer.bed_height });
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
            // Prefer user's saved default, else fall back to first visible model
            var preferredId = defaultPrinterId && visibleModels.some(function(p) { return p.id === defaultPrinterId; })
                ? defaultPrinterId : visibleModels[0].id;
            batchSel.value = preferredId;
            _populateNozzleDropdown("batch-nozzle-diameter", preferredId);
            // If user has a saved nozzle default, set it after populating
            if (defaultNozzle || currentBatchNozzle) {
                var batchNozzleEl = document.getElementById("batch-nozzle-diameter");
                if (batchNozzleEl) {
                    const batchModel = visibleModels.find(function(p) { return p.id === preferredId; });
                    batchNozzleEl.value = String(_preferredNozzle(batchModel, currentBatchNozzle));
                }
            }
            _syncBatchPrinter();
        }
    }

    // ── Batch nozzle change → update compound id ──
    const batchNozzle = document.getElementById("batch-nozzle-diameter");
    if (batchNozzle && batchSel) {
        batchSel.addEventListener("change", () => {
            _populateNozzleDropdown("batch-nozzle-diameter", batchSel.value);
            _syncBatchPrinter();
            var _changedPrinter = _printerModels.find(function(p) { return p.id === batchSel.value; });
            if (_changedPrinter && _changedPrinter.bed_width && _changedPrinter.bed_depth) {
                setBedLabel(_changedPrinter.bed_width, _changedPrinter.bed_depth, _changedPrinter.bed_height);
                updateBedSize(_changedPrinter.bed_width, _changedPrinter.bed_depth);
            }
        });
        if (batchNozzle) {
            batchNozzle.addEventListener("change", _syncBatchPrinter);
        }
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

    // ── Auto-fill nozzle + bed info when printer changes in printer tab ──
    const cfgPrinter = document.getElementById("cfg-printer-model-main");
    if (cfgPrinter && dom.cfgNozzleDiameter) {
        var resolveNozzle = function(printer) {
            return String(_preferredNozzle(printer, currentCfgNozzle));
        };
        var updateNozzleAndBed = function() {
            var printer = visibleModels.find(function(p) { return p.id === cfgPrinter.value; });
            if (printer) {
                dom.cfgNozzleDiameter.value = resolveNozzle(printer);
                if (dom.printerBedInfo) {
                    dom.printerBedInfo.textContent = t('printer.bedInfo', { x: printer.bed_width, y: printer.bed_depth, z: printer.bed_height });
                }
                setBedLabel(printer.bed_width, printer.bed_depth, printer.bed_height);
                updateBedSize(printer.bed_width, printer.bed_depth);
                updatePrinterDetailPanel(printer);
            } else {
                updatePrinterDetailPanel(null);
            }
        };
        cfgPrinter.onchange = updateNozzleAndBed;
        // Trigger initial fill
        var printer = visibleModels.find(function(p) { return p.id === cfgPrinter.value; });
        if (printer) {
            dom.cfgNozzleDiameter.value = resolveNozzle(printer);
            if (dom.printerBedInfo) {
                dom.printerBedInfo.textContent = t('printer.bedInfo', { x: printer.bed_width, y: printer.bed_depth, z: printer.bed_height });
            }
            setBedLabel(printer.bed_width, printer.bed_depth, printer.bed_height);
            updateBedSize(printer.bed_width, printer.bed_depth);
            updatePrinterDetailPanel(printer);
        }
    }

    // ── Update detail panel when nozzle changes ──
    if (dom.cfgNozzleDiameter) {
        dom.cfgNozzleDiameter.addEventListener('change', function() {
            var cfgPrinterEl = document.getElementById("cfg-printer-model-main");
            var printer = cfgPrinterEl ? visibleModels.find(function(p) { return p.id === cfgPrinterEl.value; }) : null;
            if (printer) {
                var pdNozzle = document.getElementById('pd-nozzle');
                if (pdNozzle) pdNozzle.textContent = dom.cfgNozzleDiameter.value + ' mm';
            }
            // Update layer height range hint when nozzle changes
            if (typeof updateLayerHeightRangeHint === 'function') updateLayerHeightRangeHint();
            if (typeof syncStandardPresetForNozzle === 'function') syncStandardPresetForNozzle();
        });
        // Initial hint update
        if (typeof updateLayerHeightRangeHint === 'function') updateLayerHeightRangeHint();
        if (typeof syncStandardPresetForNozzle === 'function') syncStandardPresetForNozzle();
    }

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
