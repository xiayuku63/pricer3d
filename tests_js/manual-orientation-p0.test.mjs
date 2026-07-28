import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    commitOrientationDraft,
    createOrientationDraft,
    discardOrientationDraft,
    updateOrientationDraft,
} from '../static/js/modules/orientation-state.js';

const layfaceUrl = new URL('../static/js/modules/layface.js', import.meta.url);
const orientationUiUrl = new URL('../static/js/modules/orientation-ui.js', import.meta.url);
const previewUrl = new URL('../static/js/modules/preview.js', import.meta.url);

test('manual orientation remains a draft until quote save succeeds', () => {
    const initial = createOrientationDraft({ x: 0, y: 0, z: 0 });
    const edited = updateOrientationDraft(initial, { x: 12.5, y: -34.25, z: 90 });

    assert.deepEqual(edited.saved, { x: 0, y: 0, z: 0 });
    assert.deepEqual(edited.draft, { x: 12.5, y: -34.25, z: 90 });
    assert.equal(edited.dirty, true);
    assert.deepEqual(discardOrientationDraft(edited), { x: 0, y: 0, z: 0 });

    const committed = commitOrientationDraft(edited);
    assert.deepEqual(committed.saved, edited.draft);
    assert.deepEqual(committed.draft, edited.draft);
    assert.equal(committed.dirty, false);
});

test('manual placement keeps authoritative quote state unchanged until commit', async () => {
    const source = await readFile(orientationUiUrl, 'utf8');
    const syncStart = source.indexOf('export function syncOrientationFromMesh');
    const syncEnd = source.indexOf('// ── Center ──', syncStart);
    const syncBody = source.slice(syncStart, syncEnd);

    assert.doesNotMatch(syncBody, /currentResults\[idx\] =/);
    assert.doesNotMatch(syncBody, /quoteOptions\.orientation\s*=/);
    const resetStart = source.indexOf('export function resetOrientationHandler');
    const resetEnd = source.indexOf('export async function toggleLayFace', resetStart);
    const resetBody = source.slice(resetStart, resetEnd);
    const preview = await readFile(previewUrl, 'utf8');

    assert.doesNotMatch(resetBody, /currentResults\[idx\] =/);
    assert.doesNotMatch(resetBody, /quoteOptions\.orientation\s*=/);
    assert.match(source, /commitCurrentOrientationDraft/);
    assert.match(preview, /discardCurrentOrientationDraft\(\)/);
});

test('3MF occlusion checks real descendant meshes instead of the group root', async () => {
    const source = await readFile(layfaceUrl, 'utf8');
    const intersectionStart = source.indexOf('export function intersectClusters');
    const intersectionBody = source.slice(intersectionStart, source.indexOf('export function isClusterMode', intersectionStart));

    assert.match(source, /function _collectOccluderMeshes/);
    assert.match(source, /occluder\.traverse/);
    assert.match(intersectionBody, /intersectObjects\(occluderMeshes, false\)/);
    assert.doesNotMatch(intersectionBody, /intersectObject\(occluder, false\)/);
});
