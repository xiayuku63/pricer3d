import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadQuoteRenderModule() {
    const source = await readFile(new URL('../static/js/modules/quote-render.js', import.meta.url), 'utf8');
    const browserModuleSource = 'const escapeHtml = (value) => String(value).replace(/[&<>"\']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "\'": "&#39;" })[character]);\n'
        + source.replace(/^import[\s\S]*?from '.*?';\r?\n/gm, '');
    const previousDocument = globalThis.document;

    globalThis.document = {
        addEventListener() {},
    };

    try {
        return await import(`data:text/javascript,${encodeURIComponent(browserModuleSource)}`);
    } finally {
        globalThis.document = previousDocument;
    }
}

test('buildModelGeometryDetailHtml renders all geometry values and emphasizes volume', async () => {
    const { buildModelGeometryDetailHtml } = await loadQuoteRenderModule();
    const html = buildModelGeometryDetailHtml({
        dimensions: '120 × 80 × 45 mm',
        surface_area_cm2: 152.3,
        volume_cm3: 86.5,
    });

    assert.match(html, /模型尺寸/);
    assert.match(html, /包裹 120 × 80 × 45 mm/);
    assert.match(html, /表面积 152.3 cm²/);
    assert.match(html, /font-semibold[^>]*>体积 86.5 cm³/);
});

test('buildModelGeometryDetailHtml omits missing values without rendering invalid text', async () => {
    const { buildModelGeometryDetailHtml } = await loadQuoteRenderModule();
    const html = buildModelGeometryDetailHtml({ volume_cm3: 0 });

    assert.match(html, /体积 0 cm³/);
    assert.doesNotMatch(html, /undefined|null/);
    assert.doesNotMatch(html, /表面积/);
    assert.doesNotMatch(html, /包裹/);
});

test('desktop and mobile slicer detail cards use the shared geometry builder', async () => {
    const source = await readFile(new URL('../static/js/modules/quote-render.js', import.meta.url), 'utf8');

    assert.equal((source.match(/\+\s*buildModelGeometryDetailHtml\(item\)/g) ?? []).length, 2);
});
