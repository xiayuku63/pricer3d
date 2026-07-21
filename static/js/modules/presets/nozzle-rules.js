const LAYER_HEIGHT_BY_NOZZLE = {
    '0.2': { min: 0.06, max: 0.14, valid: [0.06, 0.08, 0.10, 0.12, 0.14], defaultVal: 0.10 },
    '0.4': { min: 0.08, max: 0.28, valid: [0.08, 0.16, 0.20, 0.24, 0.28], defaultVal: 0.20 },
    '0.6': { min: 0.18, max: 0.42, valid: [0.18, 0.24, 0.30, 0.36, 0.42], defaultVal: 0.30 },
    '0.8': { min: 0.24, max: 0.56, valid: [0.24, 0.32, 0.40, 0.48, 0.56], defaultVal: 0.40 },
};

export function normalizeNozzleValue(nozzleValue) {
    const numeric = Number(nozzleValue || 0.4);
    return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.4';
}

export function getNozzleSettings(nozzleValue) {
    const key = normalizeNozzleValue(nozzleValue);
    return { key, settings: LAYER_HEIGHT_BY_NOZZLE[key] || LAYER_HEIGHT_BY_NOZZLE['0.4'] };
}

export function parsePresetLayerHeight(preset) {
    const layerFromParams = Number(preset?.params?.layer_height);
    if (Number.isFinite(layerFromParams) && layerFromParams > 0) return layerFromParams;

    const name = String(preset?.name || '').trim();
    const match = name.match(/^(\d+(?:\.\d+)?)-\d+-\d+%$/);
    if (!match) return null;

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isPresetCompatibleWithNozzle(preset, nozzleValue) {
    const layerHeight = parsePresetLayerHeight(preset);
    if (!Number.isFinite(layerHeight)) return true;

    const { settings } = getNozzleSettings(nozzleValue);
    return settings.valid.some((value) => Math.abs(value - layerHeight) < 0.0001);
}

export function filterPresetsForNozzle(presets, nozzleValue) {
    return (Array.isArray(presets) ? presets : []).filter((preset) => isPresetCompatibleWithNozzle(preset, nozzleValue));
}

export { LAYER_HEIGHT_BY_NOZZLE };
