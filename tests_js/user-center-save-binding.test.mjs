import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appEventsUrl = new URL('../static/js/modules/app-events.js', import.meta.url);

test('user center save button is bound to saveUserSettings with its own button and message elements', async () => {
    const source = await readFile(appEventsUrl, 'utf8');
    assert.match(source, /bind\(dom\.userCenterSaveBtn, 'click', \(\) => saveUserSettings\(\{/);
    assert.match(source, /saveBtn: dom\.userCenterSaveBtn,/);
    assert.match(source, /messageEl: dom\.userCenterMsg,/);
    assert.match(source, /source: 'user-center',/);
});
