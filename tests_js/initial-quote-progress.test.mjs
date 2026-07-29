import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
    return readFile(new URL(path, import.meta.url), 'utf8');
}

test('thumbnail completion inserts a calculating result row before quoting starts', async () => {
    const [preview, upload] = await Promise.all([
        source('../static/js/modules/preview.js'),
        source('../static/js/modules/zip-upload.js'),
    ]);

    assert.match(preview, /onFileReady\?\.\(\{ file, index, total: files\.length, thumbnailReady \}\)/);
    assert.match(upload, /buildThumbnails\(modelFiles, initialColors, null, \(\{ file \}\) => markFileAsCalculating\(file, initialColors\[file\.name\]\)\)/);
    assert.match(upload, /quoteSelectedFilesSequentiallyWithProgress\(modelFiles\)/);
});

test('initial quote files transition one by one from calculating to API result', async () => {
    const api = await source('../static/js/modules/quote-api.js');

    assert.match(api, /status: 'pending'/);
    assert.match(api, /_calculating: true/);
    assert.match(api, /export function markFileAsCalculating/);
    assert.match(api, /for \(let index = 0; index < files\.length; index \+= 1\)/);
    assert.match(api, /await quoteSingleFileWithOptions\(file, _pendingQuoteOptions\(file\), signal\)/);
    assert.match(api, /mergeResultsByFilename\(\[updated\]\)/);
    assert.match(api, /renderResultsTable\(\);\s*recalcSummaryFromCurrentResults\(\)/);
});

test('calculating status controls both row text and amber left indicator', async () => {
    const [render, css, zh] = await Promise.all([
        source('../static/js/modules/quote-render.js'),
        source('../static/css/table-enhancements.css'),
        source('../static/js/modules/i18n/zh.js'),
    ]);

    assert.match(render, /item\?\._calculating \|\| item\?\._recalculating/);
    assert.match(render, /item\?\._calculating \? t\('quote\.calculating'\) : t\('quote\.recalculating'\)/);
    assert.match(render, /_isCalculating\(item\) \? 'table-row-pending'/);
    assert.match(css, /\.table-row-pending td:first-child::before/);
    assert.match(zh, /'quote\.calculating': '计算中'/);
});

test('post-login uploads use the same thumbnail-first sequential quote flow', async () => {
    const auth = await source('../static/js/modules/auth/ui.js');

    assert.match(auth, /buildThumbnails\(filesToQuote, initialColors, null, \(\{ file \}\) => markFileAsCalculating\(file, initialColors\[file\.name\]\)\)/);
    assert.match(auth, /quoteSelectedFilesSequentially\(filesToQuote\)/);
});


test('initial thumbnail colors come from the same effective defaults as calculating rows', async () => {
    const [api, upload, auth] = await Promise.all([
        source('../static/js/modules/quote-api.js'),
        source('../static/js/modules/zip-upload.js'),
        source('../static/js/modules/auth/ui.js'),
    ]);

    assert.match(api, /export function getInitialQuoteColorMap/);
    assert.match(upload, /const initialColors = getInitialQuoteColorMap\(modelFiles\)/);
    assert.match(upload, /buildThumbnails\(modelFiles, initialColors/);
    assert.match(auth, /const initialColors = getInitialQuoteColorMap\(filesToQuote\)/);
    assert.doesNotMatch(upload, /buildThumbnails\(modelFiles, \{\}/);
});
