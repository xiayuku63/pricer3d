import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Starting a new quote run (upload pool or recalc) must CANCEL the previous
// batch server-side — the fetch abort alone never reaches the Windows
// backend, leaving in-flight slices burning CPU and writing history.
const src = await readFile(new URL('../static/js/modules/quote-api.js', import.meta.url), 'utf8');

test('a replacing quote run cancels the previous batch before spawning a new one', () => {
    assert.match(src, /async function _replaceQuoteBatch\(\)/);
    assert.match(src, /\/api\/quote\/cancel/);

    const poolStart = src.indexOf('export async function quoteSelectedFilesSequentially');
    const poolBlock = src.slice(poolStart, src.indexOf('const signal', poolStart));
    assert.match(poolBlock, /await _replaceQuoteBatch\(\);/, 'upload pool must cancel the old batch first');

    const requoteStart = src.indexOf('export async function reQuoteAllSelectedFiles');
    const requoteBlock = src.slice(requoteStart, src.indexOf('const controller = _newAbortController()', requoteStart));
    assert.match(requoteBlock, /await _replaceQuoteBatch\(\);/, 'recalc must cancel the old batch first');
});

test('the stop button keeps its explicit cancel path', () => {
    assert.match(src, /export function cancelActiveQuoteBatch\(\)/);
});
