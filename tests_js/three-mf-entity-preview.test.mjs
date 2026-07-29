import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const meshUrl = new URL("../static/js/modules/viewer/mesh.js", import.meta.url);
const previewUrl = new URL("../static/js/modules/preview.js", import.meta.url);
const modalUrl = new URL("../static/partials/preview-modal.html", import.meta.url);


test("3MF main preview keeps separate meshes and exposes per-entity color operations", async () => {
    const mesh = await readFile(meshUrl, "utf8");

    assert.match(mesh, /getPreview3mf/);
    assert.match(mesh, /renderVia3mfScene/);
    assert.match(mesh, /ext === '3mf'/);
    assert.match(mesh, /export function getCurrentMeshEntities/);
    assert.match(mesh, /export function setCurrentMeshEntityColor/);
    assert.match(mesh, /userData\.entity_id/);
    assert.match(mesh, /userData\.source_color/);
});


test("preview modal renders an entity color editor after a multi-entity 3MF loads", async () => {
    const [preview, modal] = await Promise.all([
        readFile(previewUrl, "utf8"),
        readFile(modalUrl, "utf8"),
    ]);

    assert.match(modal, /id="entity-colors-section"/);
    assert.match(modal, /id="entity-colors-list"/);
    assert.match(modal, /id="entity-color-add-input" type="color"/);
    assert.match(preview, /renderEntityColorControls/);
    assert.match(preview, /setCurrentMeshEntityColor/);
    assert.match(preview, /getPreview3mf\(file, conversionProgress\)/);
    assert.match(preview, /getPreviewGlb\(file, conversionProgress\)/);
    assert.match(preview, /data-entity-color-trigger/);
    assert.match(preview, /data-entity-color-option/);
    assert.match(preview, /data-entity-color-add/);
    assert.match(preview, /entityColorPalettesByFile/);
});


test("entity colors use a reusable palette and add-color flow instead of one native input per row", async () => {
    const preview = await readFile(previewUrl, "utf8");

    assert.match(preview, /function getEntityColorPalette/);
    assert.match(preview, /function addEntityPaletteColor/);
    assert.match(preview, /addInput\.addEventListener\('change'/);
    assert.doesNotMatch(preview, /colorInput\.type = 'color'/);
});
