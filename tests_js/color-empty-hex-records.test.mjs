import assert from 'node:assert/strict';
import test from 'node:test';

// state.js has no import-time DOM dependencies beyond nothing — safe to load
// directly. (escapeHtml is defined inside the module.)
const stateUrl = new URL('../static/js/modules/state.js', import.meta.url);
const { colorToObj, getColorsForMaterial, renderColorDropdown, setMaterialOptions } = await import(stateUrl);

function installPetgFixtures() {
    setMaterialOptions([
        { name: 'PETG', brand: 'Generic', color: { name: '白色', hex: '#ffffff' } },
        { name: 'PETG', brand: 'Generic', color: { name: '黑色', hex: '#000000' } },
        { name: 'PETG', brand: 'Generic', color: { name: '灰', hex: '#808080' } },
        // Dual-color style records carry no single swatch color.
        { name: 'PETG', brand: 'Generic', color: { name: '黑/灰', hex: '' } },
    ]);
}

test('colorToObj keeps named records with empty hex instead of nulling them', () => {
    assert.deepEqual(colorToObj({ name: '黑/灰', hex: '' }), { name: '黑/灰', hex: '' });
    assert.deepEqual(colorToObj('黑/灰'), { name: '黑/灰', hex: '' });
    assert.equal(colorToObj({ name: '', hex: '' }), null);
});

test('getColorsForMaterial does not drop empty-hex color records', () => {
    installPetgFixtures();
    const colors = getColorsForMaterial('PETG', 'Generic');
    const names = colors.map((c) => c.name);
    assert.ok(names.includes('黑/灰'), `黑/灰 must survive filtering, got: ${names.join(',')}`);
    assert.equal(colors.length, 4);
});

test('renderColorDropdown selects and highlights an empty-hex record by name', () => {
    installPetgFixtures();
    const rendered = renderColorDropdown('PETG', '黑/灰', true, 'Generic');

    // The stored value must round-trip as the name, not a fake gray sentinel.
    assert.equal(rendered.selected, '黑/灰');
    assert.match(rendered.html, /data-selected-color="黑\/灰"/);
    assert.match(rendered.html, /class="row-color-value" value="黑\/灰"/);

    // Exactly the 黑/灰 item is active; 白色 stays inactive.
    const items = rendered.html.match(/<button[^>]*color-dd-item[^>]*>/g) || [];
    assert.equal(items.length, 4);
    const activeItems = items.filter((h) => h.includes('color-dd-item-active'));
    assert.equal(activeItems.length, 1, `expected exactly one active item, got: ${activeItems.join(' | ')}`);
    assert.match(activeItems[0], /data-color-name="黑\/灰"/);
    assert.doesNotMatch(items[0], /color-dd-item-active/);

    // The trigger swatch falls back to neutral gray for hex-less entries.
    assert.match(rendered.html, /background:#d1d5db/);
});

test('legacy English color names still match their configured Chinese record', () => {
    installPetgFixtures();
    // 'white' resolves through the known-color map to #ffffff → matches 白色.
    const rendered = renderColorDropdown('PETG', 'White', true, 'Generic');
    assert.equal(rendered.selected, '#ffffff');
    const items = rendered.html.match(/aria-selected="(true|false)"/g) || [];
    assert.equal(items.filter((s) => s === 'aria-selected="true"').length >= 1, true);
});

test('item labels escape user-configured color names', () => {
    setMaterialOptions([
        { name: 'X', brand: 'B', color: { name: '<img src=x onerror=alert(1)>', hex: '' } },
    ]);
    const rendered = renderColorDropdown('X', '', true, 'B');
    assert.ok(!rendered.html.includes('<img src=x'), 'raw HTML must not leak into attributes');
    assert.match(rendered.html, /&lt;img/);
});
