// ── Slicer preset management ──
import {
    authToken,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection,
    setDefaultSlicerPresetId,
    selectedFilesMap, getActivePrinterCompoundId,
} from '../state.js';
import { openLoginModal } from '../auth.js';
import { t } from '../i18n.js';
import { reQuoteAllSelectedFiles, getSlicerConfigSnapshot, getAffectedFilenamesForSlicerConfigChange, getAffectedFilenamesForSlicerPresetChange } from '../quote.js';
import { dom, _printerModels, _selectedPresetId, setMsg, renderSlicerPresetsUI } from './ui.js';
import { fetchPrinterModels } from './printers.js';
import { LAYER_HEIGHT_BY_NOZZLE, getNozzleSettings } from './nozzle-rules.js';

async function _fetchPresetParams(presetId) {
    if (!presetId) return null;
    try {
        const resp = await authFetch(`/api/slicer/presets/${presetId}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        const params = data?.preset?.params;
        if (!params) return null;
        return {
            layer_height: Number(params.layer_height),
            perimeters: Number(params.perimeters),
            fill_density: Number(params.fill_density),
        };
    } catch (e) {
        return null;
    }
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
    const previousSlicerConfig = getSlicerConfigSnapshot();
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
            const presetParams = await _fetchPresetParams(preset.id);
            const affected = previousSlicerConfig.presetId === Number(preset.id)
                ? new Set(getAffectedFilenamesForSlicerPresetChange(preset.id, presetParams))
                : new Set(getAffectedFilenamesForSlicerConfigChange(
                    previousSlicerConfig,
                    { ...previousSlicerConfig, presetId: Number(preset.id), params: presetParams },
                ));
            if (affected.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterUpdate'), (result) => affected.has(result?.filename));
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
    const previousSlicerConfig = getSlicerConfigSnapshot();
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
            const nextSlicerConfig = { ...previousSlicerConfig, presetId: Number(preset.id), params: { layer_height, perimeters: wall_count, fill_density: infill } };
            const affected = new Set(getAffectedFilenamesForSlicerConfigChange(previousSlicerConfig, nextSlicerConfig));
            if (affected.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterGen'), (result) => affected.has(result?.filename));
        }
    } catch (e) { setMsg(e.message || t('slicer.genError'), false); }
}

export async function deleteSlicerPreset(presetId) {
    if (!authToken) return;
    const previousSlicerConfig = getSlicerConfigSnapshot();
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
        const nextSlicerConfig = {
            ...previousSlicerConfig,
            // Deleting an unrelated preset must not invalidate current quotes.
            presetId: quoteOptions.slicer_preset_id ?? null,
        };
        const affected = new Set(getAffectedFilenamesForSlicerConfigChange(previousSlicerConfig, nextSlicerConfig));
        if (affected.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterDelete'), (result) => affected.has(result?.filename));
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

    const nextParams = { layer_height, perimeters: wall_count, fill_density: infill };
    const savedPresetId = _selectedPresetId;

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
        const affected = new Set(getAffectedFilenamesForSlicerPresetChange(savedPresetId, nextParams));
        if (affected.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterUpdate'), (result) => affected.has(result?.filename));
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

    const previousSlicerConfig = getSlicerConfigSnapshot();
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
            const nextSlicerConfig = { ...previousSlicerConfig, presetId: Number(preset.id), params: { layer_height, perimeters: wall_count, fill_density: infill } };
            const affected = new Set(getAffectedFilenamesForSlicerConfigChange(previousSlicerConfig, nextSlicerConfig));
            if (affected.size > 0) await reQuoteAllSelectedFiles(t('slicer.recalcAfterGen'), (result) => affected.has(result?.filename));
        }
    } catch (e) { setMsg(e.message || t('slicer.presetSaveError'), false); }
}

// ── Per-nozzle valid layer heights ──
const STANDARD_WALL_COUNT = 2;
const STANDARD_INFILL = 15;
let _standardPresetSync = null;

function _nozzleSettings(nozzleValue) {
    return getNozzleSettings(nozzleValue);
}

function _setStandardSlicerForm(settings) {
    const layerSelect = document.getElementById('gen-layer-height');
    const wallSelect = document.getElementById('gen-wall-count');
    const infillSelect = document.getElementById('gen-infill');
    if (layerSelect) layerSelect.value = settings.defaultVal.toFixed(2);
    if (wallSelect) wallSelect.value = String(STANDARD_WALL_COUNT);
    if (infillSelect) infillSelect.value = String(STANDARD_INFILL);
}

export function getStandardPresetNameForNozzle(nozzleValue) {
    const { settings } = _nozzleSettings(nozzleValue);
    return `${settings.defaultVal.toFixed(2)}-${STANDARD_WALL_COUNT}-${STANDARD_INFILL}%`;
}

function _selectPresetAndSyncForm(preset) {
    if (!preset) return;
    const presetSelect = document.getElementById('gen-preset-select');
    const batchPresetSelect = document.getElementById('batch-slicer-preset');
    const frontPresetSelect = document.getElementById('front-default-slicer-preset');
    if (presetSelect) presetSelect.value = String(preset.id);
    if (batchPresetSelect) batchPresetSelect.value = String(preset.id);
    if (frontPresetSelect) frontPresetSelect.value = String(preset.id);
    quoteOptions.slicer_preset_id = Number(preset.id);
    saveSlicerPresetSelection();
    setDefaultSlicerPresetId(Number(preset.id));
    const params = preset.params || {};
    _setSelectClosest(document.getElementById('gen-layer-height'), params.layer_height);
    _setSelectClosest(document.getElementById('gen-wall-count'), params.perimeters || STANDARD_WALL_COUNT);
    _setSelectClosest(document.getElementById('gen-infill'), params.fill_density || STANDARD_INFILL);
}

function _clearSelectedPreset() {
    const presetSelect = document.getElementById('gen-preset-select');
    const batchPresetSelect = document.getElementById('batch-slicer-preset');
    const frontPresetSelect = document.getElementById('front-default-slicer-preset');
    quoteOptions.slicer_preset_id = null;
    saveSlicerPresetSelection();
    setDefaultSlicerPresetId(null);
    if (presetSelect) presetSelect.value = '';
    if (batchPresetSelect) batchPresetSelect.value = '';
    if (frontPresetSelect) frontPresetSelect.value = '';
}

/** Select or create the standard 2-wall/15% preset for the active nozzle. */
export async function syncStandardPresetForNozzle() {
    const nozzleEl = document.getElementById('cfg-nozzle-diameter');
    const { key, settings } = _nozzleSettings(nozzleEl?.value);
    updateLayerHeightDropdown();
    _setStandardSlicerForm(settings);

    const standardName = getStandardPresetNameForNozzle(key);
    const existing = (slicerPresets || []).find((preset) => String(preset.name || '').trim() === standardName);
    if (existing) {
        _selectPresetAndSyncForm(existing);
        return existing;
    }
    if (!authToken || _standardPresetSync) return null;

    const printerId = getActivePrinterCompoundId ? getActivePrinterCompoundId() : '';
    const baseId = String(printerId || '').replace(/_\d{2}$/, '');
    const printer = _printerModels.find((item) => item.id === printerId || item.id === baseId);
    if (!printer) return null;

    _standardPresetSync = (async () => {
        try {
            const response = await authFetch('/api/slicer/presets/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: standardName,
                    bed_width: printer.bed_width,
                    bed_depth: printer.bed_depth,
                    bed_height: printer.bed_height,
                    nozzle_size: Number(nozzleEl?.value) || Number(key),
                    layer_height: settings.defaultVal,
                    wall_count: STANDARD_WALL_COUNT,
                    infill: STANDARD_INFILL,
                }),
            });
            if (!response.ok) return null;
            await fetchSlicerPresets();
            const created = (slicerPresets || []).find((preset) => String(preset.name || '').trim() === standardName);
            if (created) _selectPresetAndSyncForm(created);
            return created || null;
        } catch (error) {
            console.warn('Failed to sync standard nozzle preset:', error);
            return null;
        } finally {
            _standardPresetSync = null;
        }
    })();
    return _standardPresetSync;
}

export function syncSlicerPresetForNozzle() {
    const nozzleEl = document.getElementById('cfg-nozzle-diameter');
    const nozzleValue = nozzleEl?.value || '0.4';
    const { settings } = _nozzleSettings(nozzleValue);
    const layerSelect = document.getElementById('gen-layer-height');
    const wallSelect = document.getElementById('gen-wall-count');
    const infillSelect = document.getElementById('gen-infill');

    if (layerSelect) layerSelect.value = settings.defaultVal.toFixed(2);
    if (wallSelect) wallSelect.value = String(STANDARD_WALL_COUNT);
    if (infillSelect) infillSelect.value = String(STANDARD_INFILL);

    const targetName = getStandardPresetNameForNozzle(nozzleValue);
    const matched = (slicerPresets || []).find((preset) => String(preset.name || '').trim() === targetName);
    if (matched) {
        _selectPresetAndSyncForm(matched);
    } else {
        _clearSelectedPreset();
    }

    updateLayerHeightDropdown();
    updateLayerHeightRangeHint();
    return matched || null;
}

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
    // Get current nozzle diameter
    const nozzleEl = document.getElementById('cfg-nozzle-diameter');
    const nozzle = nozzleEl ? parseFloat(nozzleEl.value) : 0.4;
    if (isNaN(nozzle) || nozzle <= 0) {
        if (hintEl) hintEl.textContent = '';
        updateLayerHeightDropdown();
        return;
    }
    const key = nozzle.toFixed(1);
    const settings = LAYER_HEIGHT_BY_NOZZLE[key];
    if (hintEl && settings) {
        hintEl.textContent = `有效值: ${settings.valid.map(v => v.toFixed(2)).join(', ')}mm`;
    } else if (hintEl) {
        hintEl.textContent = '';
    }
    // Also update the layer height dropdown options
    updateLayerHeightDropdown();
}
