import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('user center default slicer preset control uses a compact desktop width', async () => {
    const html = await readFile(new URL('../static/partials/user-center-modal.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(html, /id="uc-default-preset-dropdown"[^>]*uc-default-preset-dropdown/);
    assert.match(css, /#uc-default-preset-dropdown\s*\{\s*width:\s*360px;/);
    assert.match(css, /@media \(max-width: 639px\)[\s\S]*#uc-default-preset-dropdown\s*\{\s*width:\s*100%;/);
});
