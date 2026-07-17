// Quote configuration comparison helpers.
// These functions are intentionally DOM-free so re-quote decisions stay testable.

const CORE_SLICER_KEYS = [
    'layer_height',
    'perimeters',
    'fill_density',
    'nozzle_diameter',
    'top_shell_layers',
    'bottom_shell_layers',
    'brim_width',
    'support_material',
];

function _numberOrText(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value).trim();
}

export function normalizeSlicerPresetId(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizePrinterModel(value) {
    return String(value || '').trim();
}

export function getResultSlicerParams(result) {
    const core = result?.cost_breakdown?.gcode_summary?.core_params || {};
    return Object.fromEntries(CORE_SLICER_KEYS.map((key) => [key, _numberOrText(core[key])]));
}

export function slicerParamsEqual(left, right) {
    return CORE_SLICER_KEYS
        .filter((key) => right && right[key] !== null && right[key] !== undefined && right[key] !== '')
        .every((key) => _numberOrText(left?.[key]) === _numberOrText(right[key]));
}

function _resultParams(result) {
    const params = getResultSlicerParams(result);
    // Formula fallback results do not have a G-code summary, but they still
    // expose the two parameters used by the fallback estimator.
    if (params.layer_height === null) params.layer_height = _numberOrText(result?.layer_height);
    if (params.fill_density === null) params.fill_density = _numberOrText(result?.infill);
    if (params.perimeters === null) params.perimeters = _numberOrText(result?.wall_count ?? 3);
    return params;
}

/**
 * Return filenames whose current result inherited the old global config and
 * therefore needs a new quote after the global config changes.
 */
export function getAffectedFilenamesForGlobalSlicerChange(results, previous, next) {
    if (!results?.length) return [];
    return results
        .filter((result) => {
            if (!result?.filename) return false;
            const printerChanged = normalizePrinterModel(result._printer_model) !== normalizePrinterModel(next?.printerModel);
            const printerAffected = !result._printer_model_explicit && printerChanged;
            const previousPresetId = normalizeSlicerPresetId(previous?.presetId);
            const nextPresetId = normalizeSlicerPresetId(next?.presetId);
            const presetChanged = previousPresetId !== nextPresetId;
            const slicerAffected = !result._slicer_preset_explicit
                && (presetChanged
                    ? (!next?.params || !slicerParamsEqual(_resultParams(result), next.params))
                    : previousPresetId === null && !slicerParamsEqual(_resultParams(result), next?.params));
            return printerAffected || slicerAffected;
        })
        .map((result) => result.filename);
}

export function getAffectedFilenamesForPresetChange(results, presetId, nextParams) {
    const targetId = normalizeSlicerPresetId(presetId);
    return (results || [])
        .filter((result) => result?.filename
            && normalizeSlicerPresetId(result._slicer_preset_id) === targetId
            && (!nextParams || !slicerParamsEqual(_resultParams(result), nextParams)))
        .map((result) => result.filename);
}

export function getSlicerCoreKeys() {
    return CORE_SLICER_KEYS.slice();
}
