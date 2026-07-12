// ── Slicer preset management ──
import {
    authToken, currentUser,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap, getActivePrinterCompoundId,
    setCachedPrinterModels,
    defaultPrinterId, defaultNozzle, defaultSlicerPresetId,
    getHiddenPrinters, setHiddenPrinters, HIDDEN_PRINTERS_KEY,
    getEnabledPrinters, setEnabledPrinters, ENABLED_PRINTERS_KEY,
} from './state.js';
import { openLoginModal } from './auth.js';
import { t, onLangChange } from './i18n.js';
import { reQuoteAllSelectedFiles } from './quote.js';
import { updateBedSize, setBedLabel } from './viewer.js';

let dom = {};
let _printerModels = [];  // cached printer list from API
let _selectedPresetId = null;  // currently selected preset via radio button

export function initPresets(d) {
    dom = d;
    // Listen for language changes to update printer options
    onLangChange(() => {
        if (_printerModels.length > 0) {
            _updatePrinterOptions();
        }
    });
}

// Update printer options when language changes
function _updatePrinterOptions() {
    const visibleModels = _printerModels.filter(p => getEnabledPrinters().includes(p.id));
    
    // Update cfg-printer-model-main
    const cfgSel = document.getElementById('cfg-printer-model-main');
    if (cfgSel) {
        const currentVal = cfgSel.value;
        cfgSel.innerHTML = '';
        visibleModels.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            cfgSel.appendChild(opt);
        });
        if (currentVal && visibleModels.find(p => p.id === currentVal)) {
            cfgSel.value = currentVal;
        } else if (visibleModels.length) {
            cfgSel.value = visibleModels[0].id;
        }
    }
    
    // Update batch-printer-model
    const batchSel = document.getElementById('batch-printer-model');
    if (batchSel) {
        const currentVal = batchSel.value;
        batchSel.innerHTML = '';
        visibleModels.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            batchSel.appendChild(opt);
        });
        if (currentVal && visibleModels.find(p => p.id === currentVal)) {
            batchSel.value = currentVal;
        } else if (visibleModels.length) {
            batchSel.value = visibleModels[0].id;
        }
    }
    
    // Update batch-slicer-preset
    renderSlicerPresetsUI();
}

function setMsg(text, ok) {
    const { slicerPresetsMsg } = dom;
    if (!slicerPresetsMsg) return;
    slicerPresetsMsg.textContent = text || "";
    slicerPresetsMsg.className = ok ? "text-xs text-green-600" : "text-xs text-red-600";
    slicerPresetsMsg.classList.remove('hidden');
    if (text) setTimeout(() => { slicerPresetsMsg.classList.add('hidden'); slicerPresetsMsg.textContent = ""; }, 2500);
}

export function renderSlicerPresetsUI() {
    const { slicerPresetsTbody, genPresetSelect, slicerPresetsDownloadBtn, slicerPresetsDeleteBtn } = dom;

    // Populate the slicer config form preset dropdown
    if (genPresetSelect) {
        const items = slicerPresets || [];
        var genCurrentVal = (defaultSlicerPresetId !== null && defaultSlicerPresetId !== undefined
            && items.some(function(p) { return p.id === defaultSlicerPresetId; }))
            ? String(defaultSlicerPresetId) : "";
        genPresetSelect.innerHTML = [
            ...items.map(function(p) { return '<option value="' + p.id + '"' + (String(p.id) === genCurrentVal ? ' selected' : '') + '>' + (p.name || '#' + p.id) + '</option>'; })
        ].join('');
        if (!genPresetSelect.value && items.length) genPresetSelect.value = String(items[0].id);
    }

    // Populate the model-page batch preset selector
    const batchPreset = document.getElementById('batch-slicer-preset');
    if (batchPreset) {
        const items = slicerPresets || [];
        // Use user's saved default preset; if none, default to first saved preset (combinations)
        var batchCurrentVal;
        if (defaultSlicerPresetId !== null && defaultSlicerPresetId !== undefined
            && items.some(function(p) { return p.id === defaultSlicerPresetId; })) {
            batchCurrentVal = String(defaultSlicerPresetId);
        } else if (items.length > 0) {
            batchCurrentVal = String(items[0].id);
        } else {
            batchCurrentVal = "";
        }
        batchPreset.innerHTML = [
            '<option value="">' + t('quote.presetNone') + '</option>',
            ...items.map(function(p) { return '<option value="' + p.id + '"' + (String(p.id) === String(batchCurrentVal) ? ' selected' : '') + '>' + (p.name || '#' + p.id) + '</option>'; })
        ].join('');
    }
    if (!slicerPresetsTbody) return;
    const items = slicerPresets || [];
    _selectedPresetId = null;
    if (!items.length) {
        slicerPresetsTbody.innerHTML = '<tr><td colspan="3" class="px-3 py-3 tw-text-muted">' + t('slicer.noPresets') + '</td></tr>';
        return;
    }
    slicerPresetsTbody.innerHTML = items.map((p, idx) => `
        <tr class="preset-row hover:bg-gray-50" data-preset-id="${p.id}">
            <td class="px-3 py-2 tw-text-muted">${idx + 1}</td>
            <td class="px-3 py-2 tw-text">${p.name || '-'}</td>
            <td class="px-3 py-2 text-center">
                <button type="button" class="text-xs tw-text-danger hover:tw-text-danger preset-delete-btn" data-preset-id="${p.id}">${t('common.delete')}</button>
            </td>
        </tr>
    `).join('');

    // Delete button events
    slicerPresetsTbody.querySelectorAll('.preset-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = Number(btn.getAttribute('data-preset-id'));
            if (id) deleteSlicerPreset(id);
        });
    });

    // Row click → load preset
    slicerPresetsTbody.querySelectorAll('.preset-row').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('preset-delete-btn')) return;
            const id = row.getAttribute('data-preset-id');
            if (id) _selectedPresetId = Number(id);
        });
    });
}

function _onPresetRadioChange(val) {
    _selectedPresetId = val ? Number(val) : null;
}

export function preloadPrinterSelectors() {
    for (const selId of ["cfg-printer-model-main", "gen-printer-model"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        sel.innerHTML = "";
    }
}

export async function fetchPrinterModels() {
    const resp = await authFetch("/api/slicer/printers");
    if (!resp.ok) return;
    const data = await resp.json();
    _printerModels = data.items || [];
    setCachedPrinterModels(_printerModels);

    // Filter to enabled printers only
    const enabled = getEnabledPrinters();
    const visibleModels = enabled.length
        ? _printerModels.filter(p => enabled.includes(p.id))
        : _printerModels;

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
        const currentVal = sel.value;
        sel.innerHTML = nozzles.map(n =>
            '<option value="' + n + '"' + (n === defaultNozzle ? ' selected' : '') + '>' + n + ' mm</option>'
        ).join('');
        if (!sel.value && nozzles.length) sel.value = String(nozzles[0]);
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
                    dom.cfgNozzleDiameter.value = defaultNozzle && printer.nozzles && printer.nozzles.includes(parseFloat(defaultNozzle))
                        ? String(defaultNozzle) : String(printer.nozzle);
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
            if (defaultNozzle) {
                var batchNozzleEl = document.getElementById("batch-nozzle-diameter");
                if (batchNozzleEl) {
                    var nozzleOpts = Array.from(batchNozzleEl.options).map(function(o) { return o.value; });
                    if (nozzleOpts.indexOf(String(defaultNozzle)) >= 0) {
                        batchNozzleEl.value = String(defaultNozzle);
                    }
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
            return (defaultNozzle && printer.nozzles && printer.nozzles.includes(parseFloat(defaultNozzle)))
                ? String(defaultNozzle) : String(printer.nozzle);
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
        });
        // Initial hint update
        if (typeof updateLayerHeightRangeHint === 'function') updateLayerHeightRangeHint();
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

function _syncBatchPrinter() {
    const cid = getActivePrinterCompoundId();
    if (cid) quoteOptions.printer_model = cid;
}

export async function fetchSlicerPresets() {
    if (!authToken) return;
    try {
        const resp = await authFetch('/api/slicer/presets');
        if (resp.status === 401) {
            if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden');
            openLoginModal();
            return;
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('common.loadError'));
        setSlicerPresets(Array.isArray(data.items) ? data.items : []);
        if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined) {
            const exists = slicerPresets.some((p) => Number(p.id) === Number(quoteOptions.slicer_preset_id));
            if (!exists) { quoteOptions.slicer_preset_id = null; saveSlicerPresetSelection(); }
        }
        renderSlicerPresetsUI();
    } catch (e) { setMsg(e.message || t('common.loadError'), false); }
}

export async function uploadSlicerPreset() {
    const { slicerPresetFileInput, genPresetName } = dom;
    if (!authToken) { openLoginModal(); return; }
    const file = slicerPresetFileInput && slicerPresetFileInput.files && slicerPresetFileInput.files[0] ? slicerPresetFileInput.files[0] : null;
    if (!file) { setMsg(t('slicer.selectIniFile'), false); return; }
    const name = genPresetName ? String(genPresetName.value || "").trim() : "";
    const formData = new FormData();
    formData.append("file", file);
    if (name) formData.append("name", name);
    try {
        const resp = await authFetch('/api/slicer/presets', { method: 'POST', body: formData });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('slicer.uploadError'));
        setMsg(t('slicer.uploadSuccess'), true);
        if (genPresetName) genPresetName.value = "";
        if (slicerPresetFileInput) slicerPresetFileInput.value = "";
        const preset = data && data.preset ? data.preset : null;
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (preset && preset.id) {
            quoteOptions.slicer_preset_id = Number(preset.id);
            saveSlicerPresetSelection();
            renderSlicerPresetsUI();
            if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterUpdate'));
        }
    } catch (e) { setMsg(e.message || t('slicer.uploadError'), false); }
}

export async function generateSlicerPreset() {
    const { genPrinterModel, genLayerHeight, genInfill, genWallCount, cfgNozzleDiameter } = dom;
    if (!authToken) { openLoginModal(); return; }

    const printerId = genPrinterModel?.value;
    if (!printerId) { setMsg(t('slicer.selectPrinterFirst'), false); return; }
    const printer = _printerModels.find(p => p.id === printerId);
    if (!printer) { setMsg(t('slicer.printerDataMissing'), false); return; }

    const layer_height = Number(genLayerHeight?.value) || 0.2;
    const infill = Number(genInfill?.value) || 20;
    const wall_count = Number(genWallCount?.value) || 3;
    const name = `${layer_height.toFixed(2)}-${wall_count}-${infill}%`;

    const bed_width = printer.bed_width;
    const bed_depth = printer.bed_depth;
    const bed_height = printer.bed_height;
    const nozzle_size = Number(cfgNozzleDiameter?.value) || printer.nozzle || 0.4;
    const payload = { name, bed_width, bed_depth, bed_height, nozzle_size, infill, wall_count, layer_height };
    try {
        const resp = await authFetch('/api/slicer/presets/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('slicer.genError'));
        setMsg(t('slicer.genSuccess'), true);
        if (genPresetName) genPresetName.value = "";
        const preset = data && data.preset ? data.preset : null;
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (preset && preset.id) {
            quoteOptions.slicer_preset_id = Number(preset.id);
            saveSlicerPresetSelection();
            renderSlicerPresetsUI();
            if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterGen'));
        }
    } catch (e) { setMsg(e.message || t('slicer.genError'), false); }
}

export async function deleteSlicerPreset(presetId) {
    if (!authToken) return;
    try {
        const resp = await authFetch(`/api/slicer/presets/${presetId}`, { method: 'DELETE' });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        let data = null;
        try { data = await resp.json(); } catch (e) {}
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetDeleteError'));
        if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined && Number(quoteOptions.slicer_preset_id) === Number(presetId)) {
            quoteOptions.slicer_preset_id = null; saveSlicerPresetSelection();
        }
        setMsg(t('slicer.deleted'), true);
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterDelete'));
    } catch (e) { setMsg(e.message || t('slicer.presetDeleteError'), false); }
}

// ── Load preset params into the form ──
export async function loadPresetIntoForm(presetId) {
    if (!authToken || !presetId) return;
    try {
        const resp = await authFetch(`/api/slicer/presets/${presetId}`);
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetLoadError'));
        }
        const data = await resp.json();
        const preset = data.preset;
        if (!preset || !preset.params) throw new Error(t('slicer.invalidPresetData'));

        const p = preset.params;
        const { genLayerHeight, genInfill, genWallCount } = dom;

        // Map param values to the closest available option in each select
        _setSelectClosest(genLayerHeight, p.layer_height);
        _setSelectClosest(genInfill, p.fill_density);
        _setSelectClosest(genWallCount, p.perimeters);

        // Hide all undo buttons
        document.querySelectorAll('.preset-undo-btn').forEach(b => b.classList.add('hidden'));

        setMsg(t('slicer.presetLoaded', { name: (preset.name || '#' + preset.id) }), true);
    } catch (e) { setMsg(e.message || t('common.loadError'), false); }
}

function _setSelectClosest(sel, targetVal) {
    if (!sel) return;
    let best = null;
    let bestDiff = Infinity;
    for (const opt of sel.options) {
        const v = Number(opt.value);
        if (Number.isNaN(v)) continue;
        const diff = Math.abs(v - targetVal);
        if (diff < bestDiff) { bestDiff = diff; best = opt.value; }
    }
    if (best !== null) sel.value = String(best);
}

// ── Save current form values back to the selected preset ──
export async function saveCurrentPreset() {
    const { genLayerHeight, genInfill, genWallCount, cfgNozzleDiameter } = dom;
    if (!authToken) { openLoginModal(); return; }

    // Get current printer from global settings
    const printerId = getActivePrinterCompoundId ? getActivePrinterCompoundId() : (dom.cfgPrinterModelMain?.value || '');
    if (!printerId) { setMsg(t('slicer.selectPrinterFirst'), false); return; }
    
    // Find printer model - try compound ID first, then base ID
    let printer = _printerModels.find(p => p.id === printerId || p.id === printerId.replace(/_\d{2}$/, ''));
    if (!printer) { setMsg(t('slicer.printerDataMissing'), false); return; }

    const layer_height = Number(genLayerHeight?.value) || 0.2;
    const infill = Number(genInfill?.value) || 20;
    const wall_count = Number(genWallCount?.value) || 3;
    // Auto-generate name (upsert by name — same params = same name)
    const name = `${layer_height.toFixed(2)}-${wall_count}-${infill}%`;

    const payload = {
        name,
        bed_width: printer.bed_width,
        bed_depth: printer.bed_depth,
        bed_height: printer.bed_height,
        nozzle_size: Number(cfgNozzleDiameter?.value) || printer.nozzle || 0.4,
        layer_height,
        infill,
        wall_count,
    };

    try {
        const resp = await authFetch('/api/slicer/presets/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetSaveError'));
        setMsg(t('slicer.saved'), true);
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterUpdate'));
    } catch (e) { setMsg(e.message || t('slicer.presetSaveError'), false); }
}

// ── Show save-as name input ──
export function showSaveAsRow() { _showSaveAsRow(); }
function _showSaveAsRow() {
    const { genSaveasRow, genSaveasName } = dom;
    if (genSaveasRow) genSaveasRow.classList.remove('hidden');
    if (genSaveasName) { genSaveasName.value = ''; genSaveasName.focus(); }
}

export function hideSaveAsRow() {
    const { genSaveasRow, genSaveasName } = dom;
    if (genSaveasRow) genSaveasRow.classList.add('hidden');
    if (genSaveasName) genSaveasName.value = '';
}

// ── Header action buttons (download / delete selected) ──
export function downloadSelectedPreset() {
    if (_selectedPresetId === null || !Number.isFinite(_selectedPresetId)) return;
    const a = document.createElement('a');
    a.href = `/api/slicer/presets/${_selectedPresetId}/download?token=${authToken}`;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

export async function deleteSelectedPreset() {
    if (_selectedPresetId === null || !Number.isFinite(_selectedPresetId) || _selectedPresetId === 0) return;
    await deleteSlicerPreset(_selectedPresetId);
}

// ── Save current form values as new preset ──
export async function saveAsNewPreset() {
    const { genPrinterModel, genLayerHeight, genInfill, genWallCount,
            cfgNozzleDiameter, genSaveasName, genSaveasRow } = dom;
    if (!authToken) { openLoginModal(); return; }

    const printerId = genPrinterModel?.value;
    if (!printerId) { setMsg(t('slicer.selectPrinterFirst'), false); return; }
    const printer = _printerModels.find(p => p.id === printerId);
    if (!printer) { setMsg(t('slicer.printerDataMissing'), false); return; }

    const layer_height = Number(genLayerHeight?.value) || 0.2;
    const infill = Number(genInfill?.value) || 20;
    const wall_count = Number(genWallCount?.value) || 3;
    const autoName = `${layer_height.toFixed(2)}-${wall_count}-${infill}%`;
    const customName = genSaveasName ? String(genSaveasName.value || "").trim() : "";
    const name = customName || autoName;

    const payload = {
        name,
        bed_width: printer.bed_width,
        bed_depth: printer.bed_depth,
        bed_height: printer.bed_height,
        nozzle_size: Number(cfgNozzleDiameter?.value) || printer.nozzle || 0.4,
        layer_height,
        infill,
        wall_count,
    };

    try {
        const resp = await authFetch('/api/slicer/presets/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetSaveError'));
        setMsg(t('slicer.savedAs', { name }), true);
        // Clear save-as row
        if (genSaveasRow) genSaveasRow.classList.add('hidden');
        if (genSaveasName) genSaveasName.value = '';
        const preset = data && data.preset ? data.preset : null;
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (preset && preset.id) {
            quoteOptions.slicer_preset_id = Number(preset.id);
            saveSlicerPresetSelection();
            renderSlicerPresetsUI();
            if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterGen'));
        }
    } catch (e) { setMsg(e.message || t('slicer.presetSaveError'), false); }
}

// ── Printer presets: fetch, render, delete ──
export async function fetchPrinterPresets() {
    if (!authToken) return;
    const { printerPresetsTbody } = dom;
    if (!printerPresetsTbody) return;
    try {
        const resp = await authFetch('/api/slicer/printer-presets');
        if (!resp.ok) throw new Error(t('common.loadError'));
        const data = await resp.json();
        const items = data.items || [];
        if (!items.length) {
            printerPresetsTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">' + t('slicer.noPresets') + '</td></tr>';
            return;
        }
        printerPresetsTbody.innerHTML = items.map(p => `
            <tr>
                <td class="px-2 py-2 font-mono">${p.id}</td>
                <td class="px-2 py-2">${p.name || '-'}</td>
                <td class="px-2 py-2 text-gray-500">${p.bed_width}×${p.bed_depth}×${p.bed_height}</td>
                <td class="px-2 py-2 text-gray-500">${p.nozzle} mm</td>
                <td class="px-2 py-2 text-center">
                    <button data-pp-delete="${p.id}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button>
                </td>
            </tr>
        `).join('');
        printerPresetsTbody.querySelectorAll('[data-pp-delete]').forEach(btn => {
            btn.addEventListener('click', () => deletePrinterPreset(Number(btn.getAttribute('data-pp-delete'))));
        });
    } catch (e) { setMsg(e.message || t('common.loadError'), false); }
}

export async function deletePrinterPreset(presetId) {
    if (!authToken) return;
    try {
        const resp = await authFetch(`/api/slicer/printer-presets/${presetId}`, { method: 'DELETE' });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        if (!resp.ok) {
            let data = null;
            try { data = await resp.json(); } catch (e) {}
            throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetDeleteError'));
        }
        setMsg(t('slicer.deleted'), true);
        await fetchPrinterPresets();
    } catch (e) { setMsg(e.message || t('slicer.presetDeleteError'), false); }
}

// ── Save printer preset (custom user-defined printer) ──
export async function savePrinterPreset() {
    if (!authToken) { openLoginModal(); return; }
    const nameEl = document.getElementById('pp-name');
    const name = (nameEl?.value || '').trim();
    if (!name) return;
    // Gather nozzle sizes from checkboxes if available, else use defaults
    const nozzleCheckboxes = document.querySelectorAll('.custom-pp-nozzle:checked');
    let nozzles;
    if (nozzleCheckboxes.length) {
        nozzles = Array.from(nozzleCheckboxes).map(cb => parseFloat(cb.value)).filter(n => !isNaN(n));
    } else {
        nozzles = [0.2, 0.4, 0.6, 0.8];
    }
    if (!nozzles.length) nozzles = [0.4];
    const payload = {
        name,
        bed_width: Number(document.getElementById('pp-bed-x')?.value) || 256,
        bed_depth: Number(document.getElementById('pp-bed-y')?.value) || 256,
        bed_height: Number(document.getElementById('pp-bed-z')?.value) || 256,
        nozzle: nozzles.includes(0.4) ? 0.4 : nozzles[0],
        nozzles,
    };
    try {
        const resp = await authFetch('/api/printer/presets', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('common.loadError'));
        if (nameEl) nameEl.value = '';
        document.getElementById('printer-preset-form')?.classList.add('hidden');
        await fetchPrinterPresets();
        await fetchPrinterModels();
    } catch (e) { console.error(e); }
}

// ── Enabled printers management (table rows with select + delete) ──
export function renderPrinterVisibilityList() {
    const tbody = document.getElementById('enabled-printers-tbody');
    if (!tbody) return;
    if (!_printerModels.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="px-3 py-3 tw-text-muted">暂无机型数据</td></tr>';
        return;
    }
    const enabled = getEnabledPrinters();
    tbody.innerHTML = '';
    enabled.forEach((printerId, idx) => {
        const printer = _printerModels.find(p => p.id === printerId);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        // 机型名称（下拉选择）
        const tdName = document.createElement('td');
        tdName.className = 'px-3 py-2';
        const sel = document.createElement('select');
        sel.className = 'w-full rounded-md text-xs px-2 py-1.5 bg-white';
        _printerModels.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === printerId) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
            const current = getEnabledPrinters();
            current[idx] = sel.value;
            setEnabledPrinters(current);
            renderPrinterVisibilityList();
            fetchPrinterModels();
        });
        tdName.appendChild(sel);
        // 打印尺寸
        const tdSize = document.createElement('td');
        tdSize.className = 'px-3 py-2 text-gray-500 font-mono';
        tdSize.textContent = printer ? `${printer.bed_width}×${printer.bed_depth}×${printer.bed_height}` : '-';
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.className = 'px-3 py-2 text-center';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'text-xs tw-text-danger hover:tw-text-danger';
        delBtn.textContent = t('common.delete');
        delBtn.addEventListener('click', () => {
            const current = getEnabledPrinters();
            current.splice(idx, 1);
            setEnabledPrinters(current);
            renderPrinterVisibilityList();
            fetchPrinterModels();
        });
        tdDel.appendChild(delBtn);
        tr.appendChild(tdName);
        tr.appendChild(tdSize);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
    });
}

// ── Add enabled printer slot ──
export function addEnabledPrinterSlot() {
    const enabled = getEnabledPrinters();
    // Find first printer not already enabled
    const available = _printerModels.find(p => !enabled.includes(p.id));
    if (available) {
        enabled.push(available.id);
        setEnabledPrinters(enabled);
        renderPrinterVisibilityList();
        fetchPrinterModels();
    }
}

// ── Custom printer form management ──
export function showCustomPrinterForm() {
    const form = document.getElementById('custom-printer-form');
    if (form) form.classList.remove('hidden');
    const nameEl = document.getElementById('custom-pp-name');
    if (nameEl) { nameEl.value = ''; nameEl.focus(); }
}

export function hideCustomPrinterForm() {
    const form = document.getElementById('custom-printer-form');
    if (form) form.classList.add('hidden');
}

export async function saveCustomPrinter() {
    if (!authToken) { openLoginModal(); return; }
    const nameEl = document.getElementById('custom-pp-name');
    const name = (nameEl?.value || '').trim();
    if (!name) {
        _showCustomPpMsg('请输入打印机名称', false);
        return;
    }
    // Gather selected nozzle sizes
    const nozzleCheckboxes = document.querySelectorAll('.custom-pp-nozzle:checked');
    const nozzles = Array.from(nozzleCheckboxes).map(cb => parseFloat(cb.value)).filter(n => !isNaN(n));
    if (!nozzles.length) {
        _showCustomPpMsg('请至少选择一个喷嘴尺寸', false);
        return;
    }
    const payload = {
        name,
        bed_width: Number(document.getElementById('custom-pp-bed-x')?.value) || 256,
        bed_depth: Number(document.getElementById('custom-pp-bed-y')?.value) || 256,
        bed_height: Number(document.getElementById('custom-pp-bed-z')?.value) || 256,
        nozzle: nozzles.includes(0.4) ? 0.4 : nozzles[0],
        nozzles,
    };
    try {
        const resp = await authFetch('/api/printer/presets', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '保存失败');
        _showCustomPpMsg('保存成功', true);
        // Add to enabled printers list
        const presetId = `user_${data.preset?.id}`;
        const enabled = getEnabledPrinters();
        if (!enabled.includes(presetId)) {
            enabled.push(presetId);
            setEnabledPrinters(enabled);
        }
        // Refresh
        hideCustomPrinterForm();
        await fetchPrinterModels();
        renderPrinterVisibilityList();
    } catch (e) {
        _showCustomPpMsg(e.message || '保存失败', false);
    }
}

function _showCustomPpMsg(text, ok) {
    const msg = document.getElementById('custom-pp-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? 'text-xs text-green-600' : 'text-xs text-red-600';
    msg.classList.remove('hidden');
    if (text) setTimeout(() => { msg.classList.add('hidden'); msg.textContent = ''; }, 2500);
}

export function restoreDefaultPrinters() {
    if (!confirm(t('printer.confirmRestore') || '确定恢复默认机型？自定义启用机型将丢失。')) return;
    localStorage.removeItem(ENABLED_PRINTERS_KEY);
    renderPrinterVisibilityList();
    fetchPrinterModels();
}

// ── Update printer detail panel ──
export function updatePrinterDetailPanel(printer) {
    const panel = document.getElementById('printer-detail-panel');
    if (!panel) return;
    if (!printer) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    const pdNozzle = document.getElementById('pd-nozzle');
    const pdBedSize = document.getElementById('pd-bed-size');
    const pdVolume = document.getElementById('pd-volume');
    const pdNozzles = document.getElementById('pd-nozzles');
    if (pdNozzle) pdNozzle.textContent = (printer.nozzle || 0.4) + ' mm';
    if (pdBedSize) pdBedSize.textContent = printer.bed_width + '×' + printer.bed_depth + '×' + printer.bed_height + ' mm';
    const volL = ((printer.bed_width * printer.bed_depth * printer.bed_height) / 1000000).toFixed(1);
    if (pdVolume) pdVolume.textContent = volL + ' L';
    if (pdNozzles) pdNozzles.textContent = (printer.nozzles || []).map(n => n + ' mm').join(', ');
}

// ── Per-nozzle valid layer heights ──
const LAYER_HEIGHT_BY_NOZZLE = {
    '0.2': { min: 0.06, max: 0.14, valid: [0.06, 0.08, 0.10, 0.12, 0.14], defaultVal: 0.10 },
    '0.4': { min: 0.08, max: 0.28, valid: [0.08, 0.12, 0.16, 0.20, 0.24, 0.28], defaultVal: 0.20 },
    '0.6': { min: 0.18, max: 0.42, valid: [0.18, 0.24, 0.30, 0.36, 0.42], defaultVal: 0.30 },
    '0.8': { min: 0.24, max: 0.56, valid: [0.24, 0.32, 0.40, 0.48, 0.56], defaultVal: 0.40 },
};

// ── Update layer height dropdown options based on current nozzle ──
export function updateLayerHeightDropdown() {
    const nozzleEl = document.getElementById('cfg-nozzle-diameter');
    const nozzle = nozzleEl ? nozzleEl.value : '0.4';
    const settings = LAYER_HEIGHT_BY_NOZZLE[nozzle] || LAYER_HEIGHT_BY_NOZZLE['0.4'];
    const sel = document.getElementById('gen-layer-height');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = settings.valid.map(v => {
        const label = v === settings.defaultVal ? `${v.toFixed(2)} 标准` : v.toFixed(2);
        return `<option value="${v.toFixed(2)}">${label}</option>`;
    }).join('');
    // Try to keep the current selection, or use the nozzle default
    if (settings.valid.includes(parseFloat(currentVal))) {
        sel.value = parseFloat(currentVal).toFixed(2);
    } else {
        sel.value = settings.defaultVal.toFixed(2);
    }
}

// ── Update layer height range hint based on current nozzle ──
export function updateLayerHeightRangeHint() {
    const hintEl = document.getElementById('layer-height-range-hint');
    if (!hintEl) return;
    // Get current nozzle diameter
    const nozzleEl = document.getElementById('cfg-nozzle-diameter');
    const nozzle = nozzleEl ? parseFloat(nozzleEl.value) : 0.4;
    if (isNaN(nozzle) || nozzle <= 0) {
        hintEl.textContent = '';
        return;
    }
    const key = nozzle.toFixed(1);
    const settings = LAYER_HEIGHT_BY_NOZZLE[key];
    if (settings) {
        hintEl.textContent = `有效值: ${settings.valid.map(v => v.toFixed(2)).join(', ')}mm`;
    } else {
        hintEl.textContent = '';
    }
    // Also update the layer height dropdown options
    updateLayerHeightDropdown();
}

// ── Export / Import printer configuration ──
function _setPrinterConfigMsg(text, ok) {
    const msg = document.getElementById('printer-config-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? 'text-xs text-green-600 mt-1' : 'text-xs text-red-600 mt-1';
    msg.classList.remove('hidden');
    if (text) setTimeout(() => msg.classList.add('hidden'), 3000);
}

export async function exportPrinterConfig() {
    if (!authToken) { openLoginModal(); return; }
    try {
        const resp = await authFetch('/api/user/settings/export');
        if (resp.status === 401) { openLoginModal(); return; }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.detail || '导出失败');
        }
        const data = await resp.json();
        // Extract printer-related config
        const printerConfig = {
            version: 1,
            exported_at: new Date().toISOString(),
            default_printer_id: data.default_printer_id,
            default_nozzle: data.default_nozzle,
            default_slicer_preset_id: data.default_slicer_preset_id,
            pricing_config: data.pricing_config,
            materials: data.materials,
        };
        const blob = new Blob([JSON.stringify(printerConfig, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pricer3d_printer_config_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _setPrinterConfigMsg('配置已导出', true);
    } catch (e) {
        _setPrinterConfigMsg(e.message || '导出失败', false);
    }
}

export async function importPrinterConfig(file) {
    if (!authToken) { openLoginModal(); return; }
    if (!file) { _setPrinterConfigMsg('请选择配置文件', false); return; }
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version) { _setPrinterConfigMsg('无效的配置文件', false); return; }
        const resp = await authFetch('/api/user/settings/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (resp.status === 401) { openLoginModal(); return; }
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.detail || '导入失败');
        }
        _setPrinterConfigMsg('配置已导入，正在刷新...', true);
        // Reload settings and printer models
        setTimeout(async () => {
            const { fetchUserSettings } = await import('./settings.js');
            await fetchUserSettings();
            await fetchPrinterModels();
            await fetchPrinterPresets();
        }, 500);
    } catch (e) {
        _setPrinterConfigMsg(e.message || '导入失败', false);
    }
}
