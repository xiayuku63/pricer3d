import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Changing a row's material kicks off a multi-second recalc; any full-table
// re-render during that window must repaint the row with the NEW edited
// values, not the previous ones. The optimistic update therefore has to
// cover brand/material/quantity alongside color in BOTH edit paths.
const src = await readFile(new URL('../static/js/modules/quote.js', import.meta.url), 'utf8');

test('desktop row edit syncs all edited fields optimistically before recalc', () => {
    const start = src.indexOf('(color alone let mid-recalc re-renders');
    assert.notEqual(start, -1);
    const block = src.slice(src.lastIndexOf('if (idx >= 0)', start), src.indexOf('}', src.indexOf('_recalculating', start)));
    assert.match(block, /brand,/);
    assert.match(block, /material,/);
    assert.match(block, /quantity,/);
    assert.match(block, /color,/);
    assert.match(block, /status: 'success'/);
});

test('mobile card edit syncs all edited fields optimistically before recalc', () => {
    const start = src.indexOf('Sync every user-edited field, not just color');
    assert.notEqual(start, -1);
    const block = src.slice(start, src.indexOf('renderResultsTable', start));
    assert.match(block, /brand,/);
    assert.match(block, /material,/);
    assert.match(block, /quantity,/);
});
