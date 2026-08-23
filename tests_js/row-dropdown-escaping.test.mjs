import assert from 'node:assert/strict';
import test from 'node:test';

// i18n.js reads localStorage at module-eval time — shim before import.
// (navigator.language exists natively in Node >= 21.)
class MemoryStorage {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
globalThis.localStorage = globalThis.localStorage || new MemoryStorage();

// Quote row dropdowns interpolate user-configured names (printer models,
// slicer presets) into HTML — they must go through escapeHtml.
const rowRenderUrl = new URL('../static/js/modules/quote-row-render.js', import.meta.url);
const { buildRowDropdownsHtml } = await import(rowRenderUrl);
const stateUrl = new URL('../static/js/modules/state.js', import.meta.url);
const { setSlicerPresets, setCachedPrinterModels } = await import(stateUrl);

test('buildRowDropdownsHtml escapes malicious preset and printer names', () => {
    // Printer id must be in the default enabled list to survive filtering;
    // the NAME is the free-text part that must be escaped.
    setCachedPrinterModels([
        { id: 'bambu_a1', name: '<script>pm()</script>', nozzle: 0.4 },
    ]);
    // Preset names are parsed for a layer height — keep digits out so the
    // nozzle filter doesn't drop it before the escaping assertion runs.
    setSlicerPresets([
        { id: 1, name: '<img src=x onerror=steal()>' },
    ]);

    const { pmOptions, presetOptions } = buildRowDropdownsHtml({ _printer_model: 'bambu_a1', _slicer_preset_id: 1 });

    assert.ok(!pmOptions.includes('<script>'), 'printer name must be escaped');
    assert.ok(pmOptions.includes('&lt;script&gt;'));

    assert.ok(!presetOptions.includes('<img'), 'preset name must be escaped');
    assert.ok(presetOptions.includes('&lt;img'));
});
