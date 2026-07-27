import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const meshUrl = new URL("../static/js/modules/viewer/mesh.js", import.meta.url);
const cameraUrl = new URL("../static/js/modules/viewer/camera.js", import.meta.url);

test("STP and other non-STL main previews reuse the native STL geometry path", async () => {
    const mesh = await readFile(meshUrl, "utf8");

    assert.match(mesh, /getPreviewStl/);
    assert.match(mesh, /renderViaNormalizedStl/);
    assert.doesNotMatch(mesh, /renderViaGLB|getPreviewGlb/);
    assert.match(mesh, /if \(ext === '3mf'\)/);
    assert.match(mesh, /stlLoader\.parse\(arrayBuffer\)/);
    assert.match(mesh, /currentMeshCenterOffset = centerOffset/);
    assert.match(mesh, /geometry\.translate\(0, 0, -geometry\.boundingBox\.min\.z\)/);
    assert.match(mesh, /setFromObject\(currentMesh, true\)/);
    assert.doesNotMatch(mesh, /setFromObject\(currentMesh\)(?!,)/);
});

test("fitting the camera above the bed restores a non-degenerate Y-up vector", async () => {
    const camera = await readFile(cameraUrl, "utf8");
    const fitFn = camera.slice(camera.indexOf("export function fitCameraToMesh"), camera.indexOf("export function lookAtView"));
    assert.match(fitFn, /setFromObject\(meshObject, true\)/);
    assert.match(fitFn, /camera\.up\.set\(0, 1, 0\)/);
    assert.ok(fitFn.indexOf("camera.up.set(0, 1, 0)") < fitFn.indexOf("camera.position.set"));
});
