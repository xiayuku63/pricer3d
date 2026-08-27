import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// quote-api.js pulls in preview.js -> three (browser vendor build), which is
// not importable under node --test; the repo convention for such modules is
// source-shape assertions.

const apiSrc = await readFile(new URL('../static/js/modules/quote-api.js', import.meta.url), 'utf8');
const uploadSrc = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

test('quote-api exposes clearResultsForFiles dropping stale rows via state', () => {
    assert.match(apiSrc, /export function clearResultsForFiles\(files\)/);
    assert.match(apiSrc, /setCurrentResults\(currentResults\.filter\(\(item\) => !\(item && names\.has\(item\.filename\)\)\)\)/,
        'must filter currentResults by the re-uploaded filenames');
});

test('every upload registration point clears stale rows for its files', () => {
    // ZIP result files + direct upload + second direct path
    const calls = uploadSrc.match(/clearResultsForFiles\(/g) || [];
    assert.ok(calls.length >= 3, `3 registration points expected, found ${calls.length}`);
    assert.match(uploadSrc, /clearResultsForFiles\(zipModelFiles\)/);
    assert.match(uploadSrc, /clearResultsForFiles\(modelFiles\);/);
});

test('clear happens before thumbnails/quote consume the file list', () => {
    const zipIdx = uploadSrc.indexOf('clearResultsForFiles(zipModelFiles)');
    const colorIdx = uploadSrc.indexOf('const colorByFilename = {}');
    const directIdx = uploadSrc.indexOf('clearResultsForFiles(modelFiles);');
    const thumbIdx = uploadSrc.indexOf('buildThumbnails(modelFiles, initialColors');
    assert.ok(zipIdx !== -1 && colorIdx > zipIdx, 'ZIP branch: clear before reading result colors');
    assert.ok(directIdx !== -1 && thumbIdx > directIdx, 'direct branch: clear before building thumbnails');
});
