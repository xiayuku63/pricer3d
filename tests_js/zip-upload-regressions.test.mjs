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

test('ZIP thumbnails use the final result color shared with the preview', async () => {
    const source = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

    assert.match(source, /colorByFilename\[r\.filename\] = r\.color/);
    assert.doesNotMatch(source, /colorByFilename\[r\.filename\] = r\._checklist_source\.color/);
});

test('Chinese checklist color names resolve to stable render colors', async () => {
    const { colorToObj } = await import('../static/js/modules/state.js');

    assert.deepEqual(colorToObj('黑色'), { name: '黑色', hex: '#000000' });
    assert.deepEqual(colorToObj('白色'), { name: '白色', hex: '#ffffff' });
});

test('ZIP imports add auto-created checklist materials to the live material library', async () => {
    const source = await readFile(new URL('../static/js/modules/zip-upload.js', import.meta.url), 'utf8');

    assert.match(source, /zipData\.created_materials/);
    assert.match(source, /MATERIAL_OPTIONS\.push\(material\)/);
});
