import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('front default settings bar uses compact desktop widths for each control', async () => {
    const html = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../static/css/tokens/components.css', import.meta.url), 'utf8');

    assert.match(html, /id="quote-default-settings-bar"/);
    assert.match(html, /id="front-default-brand"/);
    assert.match(css, /#front-default-printer-model\s*\{\s*width:\s*155px;/);
    assert.match(css, /#front-default-nozzle-diameter\s*\{\s*width:\s*72px;/);
    assert.match(css, /#front-default-slicer-preset\s*\{\s*width:\s*160px;/);
    assert.match(css, /#front-default-color-dropdown\s*\{\s*width:\s*120px;/);
    assert.match(css, /#front-default-brand\s*\{\s*width:\s*120px;/);
});
