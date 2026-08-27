import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Regression guard for the "row material dropdown won't open" bug: the
// portaled list was positioned from an in-flow measurement near the viewport
// bottom edge and collapsed to a 2px sliver below the fold. The positioning
// routine must measure hidden, flip with viewport clamps, and re-settle
// after layout.
const styledSelectUrl = new URL('../static/js/modules/styled-select.js', import.meta.url);
const src = await readFile(styledSelectUrl, 'utf8');

test('styled select list measures hidden before deciding placement', () => {
    assert.match(src, /list\.style\.visibility = 'hidden'/);
});

test('placement flips above only with clamped geometry, never raw bottom offsets', () => {
    // Old failure mode used style.bottom relative to a moving scroll root.
    assert.doesNotMatch(src, /list\.style\.bottom = `\$\{window\.innerHTML/gm);
    assert.match(src, /spaceBelow >= Math\.min\(listHeight, 64\) \|\| spaceBelow >= spaceAbove/);
    assert.match(src, /top = Math\.max\(8, rect\.top - listHeight - gap\)/);
    assert.match(src, /Math\.max\(120, Math\.min\(listHeight, spaceBelow\)\)/);
});

test('open flow repositions after the portal has been laid out', () => {
    assert.match(src, /requestAnimationFrame\(\(\) => \{\s*\n\s*if \(!instance\.list\.classList\.contains\('hidden'\)\) _positionList\(instance\);/);
});

test('kept: portal list escapes clipping containers and stays above page content', () => {
    assert.match(src, /document\.body\.appendChild\(list\)/);
    assert.match(src, /zIndex = '100'/);
});
