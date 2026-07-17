import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('upload progress is moved below the drop zone for cached page fragments', async () => {
    const html = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
    const source = await readFile(new URL('../static/js/modules/upload.js', import.meta.url), 'utf8');

    assert.ok(html.indexOf('id="upload-progress-inline-anchor"') > html.indexOf('id="file-name"'));
    assert.match(source, /_progressAnchor\.parentElement\.insertBefore\(_progressContainer, _progressAnchor\.nextSibling\)/);
});
