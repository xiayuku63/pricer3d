import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const shellUrl = new URL('../static/js/modules/app-shell.js', import.meta.url);
const orientationUrl = new URL('../static/js/modules/orientation-ui.js', import.meta.url);
const previewUrl = new URL('../static/js/modules/preview.js', import.meta.url);

test('inline color changes recolor the open viewer before thumbnail rendering completes', async () => {
    const source = await readFile(shellUrl, 'utf8');
    const recolorIndex = source.indexOf("if (getCurrentPreviewFilename() === filename)");
    const thumbnailIndex = source.indexOf('await ensureThumbnailForFile(file, hex)', recolorIndex);

    assert.notEqual(recolorIndex, -1);
    assert.notEqual(thumbnailIndex, -1);
    assert.ok(recolorIndex < thumbnailIndex);
    assert.ok(source.indexOf('recolorCurrentMesh(hex);', thumbnailIndex) !== -1);
    assert.doesNotMatch(source.slice(recolorIndex, thumbnailIndex), /previewModal.*classList/);
});

test('preview color updates re-render the active file and invalidate stale STL reads', async () => {
    const [preview, mesh] = await Promise.all([
        readFile(previewUrl, 'utf8'),
        readFile(new URL('../static/js/modules/viewer/mesh.js', import.meta.url), 'utf8'),
    ]);
    assert.match(preview, /export function updatePreviewColor\(filename, color\)/);
    assert.match(preview, /renderSTL\(file, obj\?\.hex \|\| color/);
    assert.match(mesh, /let _renderRequestId = 0/);
    assert.match(mesh, /if \(requestId !== _renderRequestId\) return/);
});

test('opening a file preview applies that result printer bed instead of the batch printer bed', async () => {
    const source = await readFile(previewUrl, 'utf8');
    const previewIndex = source.indexOf('export function previewByFilename');
    const rowIndex = source.indexOf('const rowData = currentResults.find', previewIndex);
    const bedIndex = source.indexOf('setBedLabel(printer.bed_width, printer.bed_depth, printer.bed_height)', rowIndex);
    const openIndex = source.indexOf('openPreviewModal(onFaceClickCb)', previewIndex);

    assert.notEqual(rowIndex, -1);
    assert.notEqual(bedIndex, -1);
    assert.notEqual(openIndex, -1);
    assert.ok(rowIndex < bedIndex);
    assert.ok(bedIndex < openIndex);
    assert.match(source.slice(rowIndex, openIndex), /rowData\?\._printer_model/);
    assert.match(source.slice(rowIndex, openIndex), /updateBedSize\(printer\.bed_width, printer\.bed_depth\)/);
});

test('saving orientation merges the fresh quote result and then attaches orientation state', async () => {
    const source = await readFile(orientationUrl, 'utf8');
    const saveIndex = source.indexOf('export async function saveOrientationAndRequote');
    const mergeIndex = source.indexOf('mergeResultsByFilename([withResultOrientation({', saveIndex);

    assert.notEqual(mergeIndex, -1);
    assert.ok(source.indexOf('...updated,', mergeIndex) < source.indexOf('}, orient)]);', mergeIndex));
    assert.match(source.slice(saveIndex, mergeIndex + 180), /The quote response is authoritative/);
});
