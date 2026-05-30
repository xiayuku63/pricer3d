// ── Slicer preset management ──
import {
    authToken, currentUser,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap, getActivePrinterCompoundId,
    setCachedPrinterModels,
    defaultPrinterId, defaultNozzle, defaultSlicerPresetId,
    getHiddenPrinters, setHiddenPrinters, HIDDEN_PRINTERS_KEY,
} from './state.js';
import { openLoginModal } from './auth.js';
import { t } from './i18n.js';
import { reQuoteAllSelectedFiles } from './quote.js';

let dom = {};
let _printerModels = [];  // cached printer list from API
let _selectedPresetId = null;  // currently selected preset via radio button

export function initPresets(d) { dom = d; }

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
            '<option value="">' + t('slicer.noPreset') + '</option>',
            ...items.map(function(p) { return '<option value="' + p.id + '"' + (String(p.id) === genCurrentVal ? ' selected' : '') + '>' + (p.name || '#' + p.id) + '</option>'; })
        ].join('');
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
    _updatePresetActionButtons();

    if (!items.length) {
        slicerPresetsTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">' + t('slicer.noPresets') + '</td></tr>';
        return;
    }
    slicerPresetsTbody.innerHTML = items.map((p) => `
        <tr class="preset-row hover:bg-gray-50 cursor-pointer" data-preset-id="${p.id}">
            <td class="px-2 py-2 text-center">
                <input type="radio" name="preset-select" value="${p.id}" class="preset-radio w-3 h-3 text-indigo-600">
            </td>
            <td class="px-2 py-2 font-mono text-gray-400">${p.id}</td>
            <td class="px-2 py-2">${p.name || '-'}</td>
            <td class="px-2 py-2">${p.ext || '-'}</td>
            <td class="px-2 py-2">${p.created_at || '-'}</td>
        </tr>
    `).join('');

    // Click row → select radio
    slicerPresetsTbody.querySelectorAll('.preset-row').forEach((row) => {
        row.addEventListener('click', (e) => {
            // Don't select if clicking the radio itself (already handled)
            if (e.target.tagName === 'INPUT') return;
            const radio = row.querySelector('.preset-radio');
            if (radio) { radio.checked = true; _onPresetRadioChange(radio.value); }
        });
    });
    // Radio change
    slicerPresetsTbody.querySelectorAll('.preset-radio').forEach((radio) => {
        radio.addEventListener('change', () => _onPresetRadioChange(radio.value));
    });
}

function _onPresetRadioChange(val) {
    _selectedPresetId = val ? Number(val) : null;
    _updatePresetActionButtons();
}

function _updatePresetActionButtons() {
    const { slicerPresetsDownloadBtn, slicerPresetsDeleteBtn } = dom;
    const hasSelection = _selectedPresetId !== null && Number.isFinite(_selectedPresetId);
    if (slicerPresetsDownloadBtn) slicerPresetsDownloadBtn.disabled = !hasSelection;
    if (slicerPresetsDeleteBtn) {
        // Also disable delete for system preset (id=0)
        const isSystem = _selectedPresetId === 0;
        slicerPresetsDeleteBtn.disabled = !hasSelection || isSystem;
    }
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

    // Filter out hidden printers
    const hidden = getHiddenPrinters();
    const visibleModels = hidden.length
        ? _printerModels.filter(p => !hidden.includes(p.id))
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
        sel.innerHTML = '<option value="">--</option>' + nozzles.map(n =>
            '<option value="' + n + '" ' + (String(n) === String(currentVal) ? 'selected' : '') + '>' + n + '</option>'
        ).join('');
    }

    // ── Populate printer model tab ──
    for (const selId of ["cfg-printer-model-main"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        sel.innerHTML = "<option value=\"\">" + t('printer.selectPrinter') + "</option>";
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
        batchSel.innerHTML = "<option value=\"\">" + t('printer.selectPrinter') + "</option>";
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
        });
        if (batchNozzle) {
            batchNozzle.addEventListener("change", _syncBatchPrinter);
        }
    }

    // ── Populate preset form printer selector ──
    const genSel = document.getElementById("gen-printer-model");
    if (genSel) {
        genSel.innerHTML = "<option value=\"\">" + t('printer.selectPrinter') + "</option>";
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
    const { genPresetSelect, genPrinterModel, genLayerHeight, genInfill, genWallCount, cfgNozzleDiameter } = dom;
    if (!authToken) { openLoginModal(); return; }

    const presetId = genPresetSelect?.value;
    if (!presetId) { setMsg(t('slicer.selectPresetToSave'), false); return; }

    const selectedPreset = (slicerPresets || []).find(p => String(p.id) === presetId);
    if (!selectedPreset) { setMsg(t('slicer.presetGone'), false); return; }

    // For system preset (id=0), force save-as instead
    if (presetId === '0') {
        setMsg(t('slicer.systemPresetReadOnly'), false);
        return;
    }

    const printerId = genPrinterModel?.value;
    if (!printerId) { setMsg(t('slicer.selectPrinterFirst'), false); return; }
    const printer = _printerModels.find(p => p.id === printerId);
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
            printerPresetsTbody.innerHTML = '<tr><td colspan="3" class="px-2 py-3 text-gray-500">' + t('slicer.noPresets') + '</td></tr>';
            return;
        }
        printerPresetsTbody.innerHTML = items.map(p => `
            <tr>
                <td class="px-2 py-2 font-mono">${p.id}</td>
                <td class="px-2 py-2">${p.name || '-'}</td>
                <td class="px-2 py-2 text-center">
                    <button data-pp-delete="${p.id}" class="text-red-500 hover:text-red-700 text-xs">${t('common.delete')}</button>
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
    const payload = {
        name,
        bed_width: Number(document.getElementById('pp-bed-x')?.value) || 256,
        bed_depth: Number(document.getElementById('pp-bed-y')?.value) || 256,
        bed_height: Number(document.getElementById('pp-bed-z')?.value) || 256,
        nozzle: 0.4,
        nozzles: [0.2, 0.4, 0.6, 0.8],
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

// ── Printer visibility management (localStorage) ──
export function renderPrinterVisibilityList() {
    const container = document.getElementById('printer-visibility-list');
    if (!container || !_printerModels.length) return;
    const hidden = getHiddenPrinters();
    container.innerHTML = _printerModels.map(p => {
        const isHidden = hidden.includes(p.id);
        return `<label class="flex items-center gap-2 py-1 px-1 hover:bg-gray-50 rounded cursor-pointer text-xs">
            <input type="checkbox" class="pp-vis-toggle w-3 h-3 rounded" value="${p.id}" ${isHidden ? '' : 'checked'}>
            <span class="${isHidden ? 'text-gray-300 line-through' : 'text-gray-700'}">${p.name} <span class="text-gray-400">(${p.bed_width}×${p.bed_depth}×${p.bed_height})</span></span>
        </label>`;
    }).join('');
    container.querySelectorAll('.pp-vis-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.value;
            const hidden = getHiddenPrinters();
            if (cb.checked) {
                const idx = hidden.indexOf(id);
                if (idx >= 0) hidden.splice(idx, 1);
            } else {
                if (!hidden.includes(id)) hidden.push(id);
            }
            setHiddenPrinters(hidden);
            renderPrinterVisibilityList();
            fetchPrinterModels();
        });
    });
}

export function restoreDefaultPrinters() {
    setHiddenPrinters([]);
    renderPrinterVisibilityList();
    fetchPrinterModels();
}
