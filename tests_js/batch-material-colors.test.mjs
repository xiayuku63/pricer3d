import assert from 'node:assert/strict';
import test from 'node:test';

const stateUrl = new URL('../static/js/modules/state.js', import.meta.url);
const { MATERIAL_OPTIONS, getColorsForMaterial, isColorInAllowedColors, pickAllowedColor, renderColorDropdown, setMaterialOptions } = await import(stateUrl);

test('batch color lookup can select the configured material record by brand', () => {
    const previousMaterials = MATERIAL_OPTIONS.slice();
    setMaterialOptions([
        {
            name: 'PLA',
            brand: 'Generic',
            density: 1.24,
            price_per_kg: 80,
            color: { name: 'white', hex: '#ffffff' },
        },
        {
            name: 'PLA',
            brand: 'eSUN',
            density: 1.24,
            price_per_kg: 90,
            color: { name: 'blue', hex: '#123456' },
        },
    ]);

    try {
        assert.deepEqual(getColorsForMaterial('PLA', 'eSUN'), [{ name: 'blue', hex: '#123456' }]);

        const rendered = renderColorDropdown('PLA', '#123456', true, 'eSUN');
        assert.equal(rendered.selected, '#123456');
        assert.match(rendered.html, /data-selected-color="#123456"/);
        assert.doesNotMatch(rendered.html, /data-selected-color="#ffffff"/);
        assert.doesNotMatch(rendered.html, /color-dd-label/);
        assert.match(rendered.html, /aria-label="#123456"/);
    } finally {
        setMaterialOptions(previousMaterials);
    }
});

test('material state updates preserve the shared array reference used by settings events', () => {
    const sharedMaterials = MATERIAL_OPTIONS;
    const updatedMaterials = [{
        name: 'PLA',
        brand: 'Generic',
        density: 1.24,
        price_per_kg: 80,
        color: { name: 'custom blue', hex: '#123456' },
    }];

    setMaterialOptions(updatedMaterials);

    try {
        assert.strictEqual(MATERIAL_OPTIONS, sharedMaterials);
        assert.strictEqual(sharedMaterials[0].color.hex, '#123456');
    } finally {
        setMaterialOptions([]);
    }
});

test('batch color lookup exposes colors from duplicate single-color material records', () => {
    const previousMaterials = MATERIAL_OPTIONS.slice();
    setMaterialOptions([
        { name: 'PLA', brand: 'Eryone', color: { name: 'white', hex: '#ffffff' } },
        { name: 'PLA', brand: 'Eryone', color: { name: 'blue', hex: '#123456' } },
        { name: 'PLA', brand: 'Eryone', color: { name: 'blue duplicate', hex: '#123456' } },
    ]);

    try {
        assert.deepEqual(getColorsForMaterial('PLA', 'Eryone'), [
            { name: 'white', hex: '#ffffff' },
            { name: 'blue', hex: '#123456' },
        ]);
        const rendered = renderColorDropdown('PLA', '#123456', true, 'Eryone');
        assert.equal((rendered.html.match(/class="color-dd-item /g) || []).length, 2);
        assert.match(rendered.html, /data-color-hex="#ffffff"/);
        assert.match(rendered.html, /data-color-hex="#123456"/);
        assert.match(rendered.html, /color-dd-item-active/);
    } finally {
        setMaterialOptions(previousMaterials);
    }
});

test('batch color control renders one option for one single-color material record', () => {
    const previousMaterials = MATERIAL_OPTIONS.slice();
    setMaterialOptions([{ name: 'PLA', brand: 'Eryone', color: { name: 'custom blue', hex: '#123456' } }]);

    try {
        const rendered = renderColorDropdown('PLA', '#123456', true, 'Eryone');
        assert.equal((rendered.html.match(/class="color-dd-trigger /g) || []).length, 1);
        assert.match(rendered.html, /data-selected-color="#123456"/);
        assert.equal((rendered.html.match(/class="color-dd-item /g) || []).length, 1);
        assert.doesNotMatch(rendered.html, /color-dd-extra|color-dd-toggle-more/);
    } finally {
        setMaterialOptions(previousMaterials);
    }
});

test('color dropdown swatches use a consistent black border', () => {
    const previousMaterials = MATERIAL_OPTIONS.slice();
    setMaterialOptions([
        { name: 'PLA', brand: 'Contrast', color: { name: 'black', hex: '#000000' } },
        { name: 'PLA', brand: 'Contrast', color: { name: 'white', hex: '#ffffff' } },
    ]);

    try {
        const rendered = renderColorDropdown('PLA', '#000000', true, 'Contrast');
        assert.equal((rendered.html.match(/border-color:rgba\(0,0,0,0\.72\);/g) || []).length, 3);
    } finally {
        setMaterialOptions(previousMaterials);
    }
});

test('color dropdown highlights the matched color instead of the first option', () => {
    const previousMaterials = MATERIAL_OPTIONS.slice();
    setMaterialOptions([
        { name: 'PLA', brand: 'Selection', color: { name: 'violet', hex: '#7C42BD' } },
        { name: 'PLA', brand: 'Selection', color: { name: 'green', hex: '#25DA52' } },
    ]);

    try {
        const rendered = renderColorDropdown('PLA', '#25da52', true, 'Selection');
        const firstItem = rendered.html.match(/<button type="button" class="([^"]*color-dd-item[^\"]*)"[^>]*data-color-hex="#7C42BD"/i);
        const secondItem = rendered.html.match(/<button type="button" class="([^"]*color-dd-item[^\"]*)"[^>]*data-color-hex="#25DA52"/i);
        assert.ok(firstItem && secondItem);
        assert.doesNotMatch(firstItem[1], /color-dd-item-active/);
        assert.match(secondItem[1], /color-dd-item-active/);
    } finally {
        setMaterialOptions(previousMaterials);
    }
});

test('named current colors remain selected instead of falling back to the first color', () => {
    const allowedColors = [
        { name: 'violet', hex: '#7C42BD' },
        { name: 'green', hex: '#25DA52' },
    ];

    assert.equal(isColorInAllowedColors('green', allowedColors), true);
    assert.equal(pickAllowedColor(allowedColors, 'green', '#7C42BD'), 'green');
});
