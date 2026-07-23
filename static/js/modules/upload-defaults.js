function _elementValue(root, id) {
    const element = root && typeof root.getElementById === 'function'
        ? root.getElementById(id)
        : null;
    return element && element.value !== undefined ? String(element.value).trim() : '';
}

function _optionLabel(option) {
    return String(option?.textContent || option?.label || option?.value || '').trim();
}

export function getEffectiveSelectValue(root, id) {
    const select = root && typeof root.getElementById === 'function'
        ? root.getElementById(id)
        : null;
    if (!select) return { present: false, value: '' };

    // Styled selects can briefly show the selected label while their hidden
    // native select is being rebuilt. Follow the value the user can see.
    const wrapper = typeof select.closest === 'function'
        ? select.closest('.styled-select-wrapper')
        : null;
    const visibleLabel = String(
        wrapper?.querySelector?.('.styled-select-label')?.textContent || '',
    ).trim();
    if (visibleLabel) {
        const matchingOption = Array.from(select.options || []).find(
            (option) => _optionLabel(option) === visibleLabel,
        );
        if (matchingOption) return { present: true, value: String(matchingOption.value || '').trim() };
    }

    return { present: true, value: String(select.value || '').trim() };
}

function _selectedColor(root) {
    const element = root && typeof root.getElementById === 'function'
        ? root.getElementById('front-default-color-dropdown')
        : null;
    return element && typeof element.getAttribute === 'function'
        ? String(element.getAttribute('data-selected-color') || '').trim()
        : '';
}

function _firstValue(...values) {
    return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function _compoundPrinterId(model, nozzle) {
    const parsedNozzle = Number.parseFloat(nozzle);
    if (!model || !Number.isFinite(parsedNozzle)) return '';
    const suffix = String(Math.round(parsedNozzle * 10)).padStart(2, '0').slice(-2);
    return `${model}_${suffix}`;
}

export function resolveUploadDefaults({ root, snapshot = {}, fallback = {} } = {}) {
    const visiblePreset = getEffectiveSelectValue(root, 'front-default-slicer-preset');
    const printerModel = _firstValue(
        _elementValue(root, 'front-default-printer-model'),
        snapshot.printer_model,
    );
    const nozzle = _firstValue(
        _elementValue(root, 'front-default-nozzle-diameter'),
        snapshot.nozzle_diameter,
    );
    // An empty visible selector explicitly means "no preset". Only consult
    // stored state when the front settings bar has not been rendered yet.
    const presetRaw = visiblePreset.present
        ? visiblePreset.value
        : _firstValue(snapshot.slicer_preset_id, fallback.slicer_preset_id);
    const parsedPreset = presetRaw === undefined || String(presetRaw).trim() === ''
        ? null
        : Number(presetRaw);

    return {
        printer_model: _compoundPrinterId(printerModel, nozzle) || String(fallback.printer_model || '').trim(),
        slicer_preset_id: Number.isFinite(parsedPreset) ? parsedPreset : null,
        brand: String(_firstValue(_elementValue(root, 'front-default-brand'), snapshot.brand, fallback.brand) || '').trim(),
        material: String(_firstValue(_elementValue(root, 'front-default-material'), snapshot.material, fallback.material) || '').trim(),
        color: String(_firstValue(_selectedColor(root), snapshot.color, fallback.color) || '').trim(),
    };
}
