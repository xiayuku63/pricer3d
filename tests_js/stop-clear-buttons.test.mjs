import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const shellSrc = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
const mainSrc = await readFile(new URL('../static/js/main.js', import.meta.url), 'utf8');
const apiSrc = await readFile(new URL('../static/js/modules/quote-api.js', import.meta.url), 'utf8');

test('stop/delete-all buttons exist next to the export row', () => {
    assert.match(shellSrc, /id="stop-quote-btn"/);
    assert.match(shellSrc, /id="clear-all-results-btn"/);
    assert.match(shellSrc, /data-i18n="quote\.stopQuote"/);
    assert.match(shellSrc, /data-i18n="quote\.deleteAll"/);
    const exportRow = shellSrc.indexOf('export-csv-btn');
    assert.ok(exportRow !== -1);
    assert.ok(shellSrc.indexOf('stop-quote-btn') > exportRow, 'buttons live in the export action row');
});

test('stop button aborts, marks rows stopped, AND cancels the server batch', () => {
    assert.match(mainSrc, /getElementById\('stop-quote-btn'\), 'click', \(\) => \{ stopActiveQuote\(\); cancelActiveQuoteBatch\(\); \}/);
    assert.match(mainSrc, /cancelActiveQuoteBatch/);
    assert.match(apiSrc, /export function stopActiveQuote\(\)/);
    assert.match(apiSrc, /export function cancelActiveQuoteBatch\(\)/);
    assert.match(apiSrc, /abortActiveRecalc\(\);/);
    assert.match(apiSrc, /\/api\/quote\/cancel/);
    assert.match(apiSrc, /X-Quote-Batch-Id/);
    // in-flight rows (calculating/recalculating, not already success) → failed
    assert.match(apiSrc, /if \(item\.status !== 'success'\) \{\s*item\.status = 'failed';/);
});

test('delete-all clears files, thumbnails and rows', () => {
    assert.match(mainSrc, /getElementById\('clear-all-results-btn'\)/);
    assert.match(apiSrc, /export function clearAllResults\(\)/);
    assert.match(apiSrc, /selectedFilesMap\.clear\(\);/);
    assert.match(apiSrc, /thumbnailMap\.clear\(\);/);
    assert.match(apiSrc, /setCurrentResults\(\[\]\);/);
});
