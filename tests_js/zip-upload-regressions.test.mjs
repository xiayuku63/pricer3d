import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ZIP quote submits the active slicing controls', async () => {
    const source = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

    assert.match(source, /sliceFormData\.append\('layer_height', zipLayerEl\.value\)/);
    assert.match(source, /sliceFormData\.append\('wall_count', zipWallEl\.value\)/);
    assert.match(source, /sliceFormData\.append\('infill', zipInfillEl\.value\)/);
});

test('ZIP results fetch a model for thumbnails even when slicing has no saved result path', async () => {
    const source = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

    assert.match(source, /const modelPath = r\.checklist_file_path \|\| r\.model_file_path/);
    assert.match(source, /encodeURIComponent\(modelPath\)/);
});
