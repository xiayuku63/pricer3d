import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../static/js/modules/', import.meta.url);

async function source(name) {
    return readFile(new URL(name, root), 'utf8');
}

test('all supported preview paths report model-loading progress', async () => {
    const mesh = await source('viewer/mesh.js');

    assert.match(mesh, /setModelLoadingProgress/);
    assert.match(mesh, /finishModelLoadingProgress/);
    assert.match(mesh, /getPreview3mf\(file, \(percent, detail\)/);
    assert.match(mesh, /getPreviewStl\(file, \(percent, detail\)/);
    assert.match(mesh, /reader\.onprogress/);
    assert.match(mesh, /ext === '3mf'/);
    assert.match(mesh, /ext !== 'stl'/);
});

test('thumbnail processing reports byte and per-file progress for STL and converted formats', async () => {
    const preview = await source('preview.js');

    assert.match(preview, /function readFileWithProgress/);
    assert.match(preview, /buildStlThumbnail\(file, colorKey = "Blue", orientation = null, onProgress = null\)/);
    assert.match(preview, /buildNonStlThumbnail\(file, colorKey, orientation = null, onProgress = null\)/);
    assert.match(preview, /ensureThumbnailForFile\(file, selectedColor, null, \(filePercent, detail\)/);
    assert.match(preview, /\(index \+ filePercent \/ 100\) \/ files\.length/);
    assert.match(preview, /startModelProgressItems\(files\.map/);
    assert.match(preview, /state: thumbnailReady \? 'complete' : 'error'/);
});

test('converted preview responses expose processing and download progress', async () => {
    const cache = await source('preview-cache.js');

    assert.match(cache, /async function readPreviewResponse/);
    assert.match(cache, /onProgress\?\.\(75, '正在读取预处理结果'\)/);
    assert.match(cache, /onProgress\?\.\(75 \+ downloadPercent, '正在下载预览数据'\)/);
    assert.match(cache, /getPreviewGlb\(file, onProgress = null\)/);
    assert.match(cache, /getPreviewStl\(file, onProgress = null\)/);
    assert.match(cache, /getPreview3mf\(file, onProgress = null\)/);
});

test('quote upload reserves progress for server-side model processing', async () => {
    const upload = await source('upload.js');

    assert.match(upload, /const percent = \(e\.loaded \/ e\.total\) \* 90/);
    assert.match(upload, /xhr\.upload\.addEventListener\('load'/);
    assert.match(upload, /Processing model files/);
    assert.match(upload, /data-model-progress-list/);
});
