// ── Slicer preset management ──
import {
    authToken,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection,
    selectedFilesMap, getActivePrinterCompoundId,
} from '../state.js';
import { openLoginModal } from '../auth.js';
import { t } from '../i18n.js';
import { reQuoteAllSelectedFiles } from '../quote.js';
import { dom, _printerModels, _selectedPresetId, setMsg, renderSlicerPresetsUI } from './ui.js';
import { fetchPrinterModels } from './printers.js';

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
    const baseId = printerId.replace(/_\d{2}$/, '');
    let printer = _printerModels.find(p => p.id === printerId || p.id === baseId);
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
