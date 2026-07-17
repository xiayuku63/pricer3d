import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mobileCss = await readFile(new URL('../static/css/mobile.css', import.meta.url), 'utf8');

test('mobile navigation open state brings the drawer into the viewport', () => {
    assert.match(
        mobileCss,
        /#mobile-nav-drawer\.open\s*\{[^}]*transform:\s*translateX\(0\)/s,
    );
});

test('mobile navigation visible state enables its backdrop', () => {
    assert.match(
        mobileCss,
        /#mobile-nav-backdrop\.visible\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/s,
    );
});
