import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

class MemoryStorage {
    constructor() { this._m = new Map(); }
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
    setItem(k, v) { this._m.set(k, String(v)); }
    removeItem(k) { this._m.delete(k); }
    clear() { this._m.clear(); }
}
// i18n.js reads localStorage at module-eval time — shim before import.
globalThis.localStorage = globalThis.localStorage || new MemoryStorage();

const stateUrl = new URL('../static/js/modules/state.js', import.meta.url);
const { setMaterialOptions, getMaterialsByBrand } = await import(stateUrl);

test('getMaterialsByBrand merges same-type color records into one option', () => {
    setMaterialOptions([
        { name: 'PETG', brand: 'Eryone', density: 1.27, price_per_kg: 90, color: { name: 'black', hex: '#000000' } },
        { name: 'PETG', brand: 'Eryone', density: 1.27, price_per_kg: 90, color: { name: 'white', hex: '#ffffff' } },
        { name: 'PETG-CF', brand: 'Eryone', density: 1.24, price_per_kg: 120, color: { name: 'black', hex: '#000000' } },
        { name: 'PLA', brand: 'Generic', density: 1.24, price_per_kg: 80, color: { name: 'white', hex: '#ffffff' } },
    ]);

    const eryone = getMaterialsByBrand('Eryone');
    assert.deepEqual(eryone.map((m) => m.name), ['PETG', 'PETG-CF'],
        'same-name color variants must collapse to a single type entry');

    const generic = getMaterialsByBrand('Generic');
    assert.deepEqual(generic.map((m) => m.name), ['PLA']);
});

test('quote result rows build the type dropdown from the deduped list', async () => {
    const src = await readFile(new URL('../static/js/modules/quote-render.js', import.meta.url), 'utf8');
    assert.match(src, /getMaterialsByBrand\(effectiveBrand3\)/);
    assert.match(src, /getMaterialsByBrand\(effectiveBrand\)/);
    assert.match(src, /getMaterialsByBrand\(mobileEffectiveBrand\)/);
    assert.ok(!src.includes('MATERIAL_OPTIONS.filter(m => (m.brand'),
        'row rendering must not list one option per color record');
});
