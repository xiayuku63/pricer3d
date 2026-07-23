import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const styleUrl = new URL('../static/js/modules/viewer/render-style.js', import.meta.url);
const sceneUrl = new URL('../static/js/modules/viewer/scene.js', import.meta.url);
const meshUrl = new URL('../static/js/modules/viewer/mesh.js', import.meta.url);
const previewUrl = new URL('../static/js/modules/preview.js', import.meta.url);
const quoteRenderUrl = new URL('../static/js/modules/quote-render.js', import.meta.url);
const tableCssUrl = new URL('../static/css/table-enhancements.css', import.meta.url);
const styledSelectUrl = new URL('../static/js/modules/styled-select.js', import.meta.url);

test('main preview and thumbnails share color-managed rendering configuration', async () => {
    const [style, scene, mesh, preview] = await Promise.all([
        readFile(styleUrl, 'utf8'),
        readFile(sceneUrl, 'utf8'),
        readFile(meshUrl, 'utf8'),
        readFile(previewUrl, 'utf8'),
    ]);

    assert.match(style, /outputColorSpace = THREE\.SRGBColorSpace/);
    assert.match(style, /emissiveIntensity: luminance > 0\.82 \? 0\.28 : 0\.08/);
    assert.match(style, /renderer\.shadowMap\.enabled = true/);
    assert.match(style, /light\.castShadow = true/);
    assert.match(scene, /configurePreviewRenderer\(renderer\)/);
    assert.match(scene, /new THREE\.Color\(0xf1f5f9\)/);
    assert.match(scene, /_bedPlane\.receiveShadow = true/);
    assert.match(scene, /addPreviewLighting\(scene\)/);
    assert.match(mesh, /createPreviewMaterial\(/);
    assert.match(mesh, /currentMesh\.castShadow = true/);
    assert.match(mesh, /new THREE\.EdgesGeometry\(geometry, 25\)/);
    assert.match(preview, /configurePreviewRenderer\(thumbRenderer\)/);
    assert.doesNotMatch(preview, /new THREE\.ShadowMaterial/);
    assert.match(preview, /addPreviewLighting\(scene\)/);
    assert.match(preview, /createPreviewMaterial\(colorHex\)/);
});

test('result-row color control shares the material row without matching the printer row widths', async () => {
    const [quoteRender, tableCss] = await Promise.all([
        readFile(quoteRenderUrl, 'utf8'),
        readFile(tableCssUrl, 'utf8'),
    ]);

    assert.match(tableCss, /quote-config-row-material \{\s+grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) 88px/);
    assert.match(tableCss, /quote-config-row-color \{\s+grid-template-columns: minmax\(0, 88px\)/);
    assert.match(quoteRender, /quote-config-row-material[\s\S]*data-field="color"/);
});

test('model configuration selects reuse the default styled select and popup behavior', async () => {
    const [styledSelect, quoteRender, tableCss] = await Promise.all([
        readFile(styledSelectUrl, 'utf8'),
        readFile(quoteRenderUrl, 'utf8'),
        readFile(tableCssUrl, 'utf8'),
    ]);

    assert.match(styledSelect, /export function enhanceStyledSelectsIn\(root/);
    assert.match(styledSelect, /#batch-results-body, #batch-results-cards/);
    assert.match(styledSelect, /styled-select-wrapper styled-select-host/);
    assert.match(styledSelect, /styled-select-row/);
    assert.match(quoteRender, /enhanceStyledSelectsIn\(document\.getElementById\('batch-results-body'\)\)/);
    assert.match(quoteRender, /enhanceStyledSelectsIn\(document\.getElementById\('batch-results-cards'\)\)/);
    assert.match(tableCss, /\.styled-select-row \{\s+width: 100% !important;/);
    assert.match(tableCss, /\.styled-select-trigger \{\s+min-height: 28px;/);
});
