// ── Shared module-level state ──
// These are exported so sibling sub-modules can share them.
// They were originally module-level variables in presets.js and are NOT re-exported
// from index.js (not part of the public API).
export let dom = {};
export let _printerModels = [];
export let _selectedPresetId = null;
export function setPrinterModels(v) { _printerModels = v; }

import {
    authToken, currentUser,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap, getActivePrinterCompoundId,
    setCachedPrinterModels,
    defaultPrinterId, defaultNozzle, defaultSlicerPresetId,
    getHiddenPrinters, setHiddenPrinters, HIDDEN_PRINTERS_KEY,
    getEnabledPrinters, setEnabledPrinters, ENABLED_PRINTERS_KEY,
} from '../state.js';
import { openLoginModal } from '../auth.js';
import { t, onLangChange } from '../i18n.js';
import { reQuoteAllSelectedFiles } from '../quote.js';
import { updateBedSize, setBedLabel } from '../viewer.js';
import { deleteSlicerPreset, getStandardPresetNameForNozzle } from './slicer.js';
import { filterPresetsForNozzle } from './nozzle-rules.js';

async function _syncBatchPresetControls() {
    const batchPreset = document.getElementById('batch-slicer-preset');
    if (!batchPreset || !batchPreset.value) return;
    const presetId = batchPreset.value;
    try {
        const response = await authFetch(`/api/slicer/presets/${presetId}`);
        if (!response.ok) return;
        const data = await response.json();
        const params = data.preset?.params;
        if (!params) return;
        const layer = document.getElementById('gen-layer-height');
        const walls = document.getElementById('gen-wall-count');
        const infill = document.getElementById('gen-infill');
        if (layer && params.layer_height != null) layer.value = Number(params.layer_height).toFixed(2);
        if (walls && params.perimeters != null) walls.value = String(params.perimeters);
        if (infill && params.fill_density != null) infill.value = String(params.fill_density);
    } catch (error) {
        console.warn('Failed to sync initial batch slicer preset:', error);
    }
}

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

    // Update printer selects
    ['batch-printer-model', 'front-default-printer-model'].forEach((selId) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '';
        visibleModels.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
        if (currentVal && visibleModels.find((p) => p.id === currentVal)) {
            sel.value = currentVal;
        } else if (visibleModels.length) {
            sel.value = visibleModels[0].id;
        }
    });

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
export { setMsg };

export function renderSlicerPresetsUI() {
    const { slicerPresetsTbody, genPresetSelect, slicerPresetsDownloadBtn, slicerPresetsDeleteBtn } = dom;
    const frontNozzle = document.getElementById('front-default-nozzle-diameter')?.value || '0.4';
    const batchNozzle = document.getElementById('batch-nozzle-diameter')?.value || '0.4';

    // Populate the slicer config form preset dropdown
    if (genPresetSelect) {
        const items = slicerPresets || [];
        var genCurrentVal = (defaultSlicerPresetId !== null && defaultSlicerPresetId !== undefined
            && items.some(function(p) { return p.id === defaultSlicerPresetId; }))
            ? String(defaultSlicerPresetId) : "";
        genPresetSelect.innerHTML = [
            '<option value="">' + t('quote.presetNone') + '</option>',
            ...items.map(function(p) { return '<option value="' + p.id + '"' + (String(p.id) === genCurrentVal ? ' selected' : '') + '>' + (p.name || '#' + p.id) + '</option>'; })
        ].join('');
        if (!genCurrentVal) genPresetSelect.value = '';
    }

    const frontPreset = document.getElementById('front-default-slicer-preset');
    if (frontPreset) {
        const items = filterPresetsForNozzle(slicerPresets || [], frontNozzle);
        const standardFrontPreset = items.find(function(p) {
            return String(p.name || '').trim() === getStandardPresetNameForNozzle(frontNozzle);
        });
        var frontCurrentVal = (defaultSlicerPresetId !== null && defaultSlicerPresetId !== undefined
            && items.some(function(p) { return p.id === defaultSlicerPresetId; }))
            ? String(defaultSlicerPresetId)
            : (standardFrontPreset ? String(standardFrontPreset.id) : "");
        frontPreset.innerHTML = [
            '<option value="">' + t('quote.presetNone') + '</option>',
            ...items.map(function(p) { return '<option value="' + p.id + '"' + (String(p.id) === frontCurrentVal ? ' selected' : '') + '>' + (p.name || '#' + p.id) + '</option>'; })
        ].join('');
        if (!frontCurrentVal) frontPreset.value = '';
    }

    // Populate the model-page batch preset selector
    const batchPreset = document.getElementById('batch-slicer-preset');
    if (batchPreset) {
        const items = filterPresetsForNozzle(slicerPresets || [], batchNozzle);
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
        // The selector is populated after the saved default is loaded. Sync
        // the effective controls immediately; no change event fires here.
        void _syncBatchPresetControls();
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

export function _onPresetRadioChange(val) {
    _selectedPresetId = val ? Number(val) : null;
}

export function preloadPrinterSelectors() {
    for (const selId of ["gen-printer-model", "front-default-printer-model"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        sel.innerHTML = "";
    }
}

export function _syncBatchPrinter() {
    const cid = getActivePrinterCompoundId();
    if (cid) quoteOptions.printer_model = cid;
}
