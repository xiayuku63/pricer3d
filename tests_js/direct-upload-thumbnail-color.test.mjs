import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const quoteApiUrl = new URL('../static/js/modules/quote-api.js', import.meta.url);

test('direct upload refreshes thumbnails with the colors returned by the quote API', async () => {
    const source = await readFile(quoteApiUrl, 'utf8');
    const helperIndex = source.indexOf('async function _syncThumbnailsWithQuoteResults');
    assert.notEqual(helperIndex, -1, 'quote API should provide a thumbnail synchronization step');
    assert.match(source.slice(helperIndex), /result\.color/);

    const responseIndex = source.indexOf('const data = result.data;');
    assert.notEqual(responseIndex, -1, 'progress upload response should be handled');
    const mergeIndex = source.indexOf('mergeResultsByFilename(results);', responseIndex);
    const syncIndex = source.indexOf('await _syncThumbnailsWithQuoteResults(selectedFiles, results);', responseIndex);
    const renderIndex = source.indexOf('renderResultsTable()', responseIndex);
    assert.ok(mergeIndex > responseIndex);
    assert.ok(mergeIndex < syncIndex);
    assert.ok(syncIndex < renderIndex, 'thumbnail synchronization must happen before rendering results');
});