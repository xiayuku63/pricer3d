import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const quoteUrl = new URL('../static/js/modules/quote.js', import.meta.url);
const quoteExportUrl = new URL('../static/js/modules/quote-export.js', import.meta.url);
const quoteRenderUrl = new URL('../static/js/modules/quote-render.js', import.meta.url);
const quoteRowRenderUrl = new URL('../static/js/modules/quote-row-render.js', import.meta.url);

test('quote exports delegate file generation to the quote export module', async () => {
    const [quoteSource, exportSource] = await Promise.all([
        readFile(quoteUrl, 'utf8'),
        readFile(quoteExportUrl, 'utf8'),
    ]);

    assert.match(quoteSource, /import \{ exportCSV, exportExcel \} from '\.\/quote-export\.js';/);
    assert.doesNotMatch(quoteSource, /new Blob\(/);
    assert.match(exportSource, /export function exportCSV\(\)/);
    assert.match(exportSource, /export function exportExcel\(\)/);
});

test('quote result rendering delegates row helpers to their focused module', async () => {
    const [renderSource, rowRenderSource] = await Promise.all([
        readFile(quoteRenderUrl, 'utf8'),
        readFile(quoteRowRenderUrl, 'utf8'),
    ]);

    assert.match(renderSource, /from '\.\/quote-row-render\.js';/);
    assert.doesNotMatch(renderSource, /function _buildRowDropdownsHtml\(item\)/);
    assert.doesNotMatch(renderSource, /function _buildParamBadge\(item\)/);
    assert.match(rowRenderSource, /export function buildRowDropdownsHtml\(item\)/);
    assert.match(rowRenderSource, /export function buildParamBadge\(item\)/);
});
