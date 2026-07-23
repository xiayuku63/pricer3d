// -- Quote row-level rendering helpers --
import {
    escapeHtml, getCachedPrinterModels, slicerPresets,
    getPrinterBaseId, getResultNozzleDiameter,
} from './state.js';
import { t } from './i18n.js';
import { filterPresetsForNozzle, getStandardPresetNameForNozzle } from './presets/nozzle-rules.js';

export function buildRowDropdownsHtml(item) {
    const printerModels = getCachedPrinterModels();
    const selectedPrinterId = getPrinterBaseId(item._printer_model);
    const selectedPrinter = printerModels.find((printer) => printer.id === selectedPrinterId);
    const selectedNozzle = getResultNozzleDiameter(item, selectedPrinter);
    const pmOptions = printerModels.map(p =>
        `<option value="${p.id}" ${p.id === selectedPrinterId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    const nozzles = selectedPrinter?.nozzles?.length
        ? selectedPrinter.nozzles
        : [selectedPrinter?.nozzle || selectedNozzle || 0.4];
    const nozzleOptions = nozzles.map((nozzle) =>
        `<option value="${nozzle}" ${Math.abs(Number(nozzle) - Number(selectedNozzle)) < 0.0001 ? 'selected' : ''}>${nozzle}mm</option>`
    ).join('');
    const presets = filterPresetsForNozzle(slicerPresets || [], selectedNozzle);
    const requestedPresetId = item._slicer_preset_id;
    const hasRequestedPreset = requestedPresetId !== null
        && requestedPresetId !== undefined
        && String(requestedPresetId) !== '';
    const selectedPresetId = presets.some((preset) => String(preset.id) === String(requestedPresetId || ''))
        ? requestedPresetId
        : (hasRequestedPreset
            ? (presets.find((preset) => String(preset.name || '').trim() === getStandardPresetNameForNozzle(selectedNozzle))?.id || '')
            : '');
    const presetOptions = ['<option value="">' + t('quote.presetNone') + '</option>',
        ...presets.map(p => `<option value="${p.id}" ${String(p.id) === String(selectedPresetId || '') ? 'selected' : ''}>${p.name || '#' + p.id}</option>`)
    ].join('');
    return { pmOptions, nozzleOptions, presetOptions };
}

function buildChecklistHtml(item) {
    if (!item._checklist_params || !item._checklist_source) return '';
    const src = item._checklist_source;
    const tip = t('quote.usedChecklist') + '：'
        + (src.printer_model ? t('quote.printerModel') + ':' + src.printer_model + ' ' : '')
        + (src.nozzle ? t('quote.nozzleDiameter') + ':' + src.nozzle + 'mm | ' : '')
        + '层高:' + src.layer_height + 'mm 墙层数:' + src.wall_count + ' 填充:' + src.infill + '%';
    return ` <span class="inline-block whitespace-nowrap text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1 cursor-help" title="${tip}">\u{1F4CB}${t('quote.badgeChecklist')}</span>`;
}

function buildBomDataBadgeHtml(item) {
    const src = item._checklist_source || {};
    const parts = [];
    if (src.material_type) parts.push(t('quote.materialType') + ':' + src.material_type);
    if (src.material_brand) parts.push(t('quote.materialBrand') + ':' + src.material_brand);
    if (src.material) parts.push(t('quote.material') + ':' + src.material);
    if (src.color) parts.push(t('quote.color') + ':' + src.color);
    if (src.quantity) parts.push(t('quote.quantity') + ':' + src.quantity);
    const tip = t('quote.usedBomData') + (parts.length ? '：' + parts.join(' | ') : '');
    return ` <span class="inline-block whitespace-nowrap text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 cursor-help" title="${tip}">📋${t('quote.badgeBomData')}</span>`;
}

function buildDefaultBadgeHtml() {
    return ` <span class="inline-block whitespace-nowrap text-[10px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1 cursor-help" title="${t('quote.usedDefault')}">\u{1F4CB}${t('quote.badgeDefault')}</span>`;
}

export function buildParamBadge(item) {
    let badge = '';
    if (item._checklist_params) {
        const src = item._checklist_source || {};
        const hasPrintParams = src.layer_height || src.wall_count || src.infill || src.printer_model || src.nozzle;
        badge = hasPrintParams ? buildChecklistHtml(item) : buildBomDataBadgeHtml(item);
    } else {
        badge = buildDefaultBadgeHtml();
    }
    badge += buildWarningsBadgeHtml(item);
    return badge;
}

function buildWarningsBadgeHtml(item) {
    if (!item._warnings || !item._warnings.length) return '';
    const count = item._warnings.length;
    const tipLines = item._warnings.map(w => {
        const base = t('quote.paramWarning', { param: w.param, value: w.value, default: w.default_used });
        return w.reason ? `${base} (${w.reason})` : base;
    });
    const tip = tipLines.join('\n');
    return ` <span class="text-[10px] text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 cursor-help" title="${escapeHtml(tip)}">\u26A0\uFE0F${t('quote.warningsSummary', { count })}</span>`;
}
