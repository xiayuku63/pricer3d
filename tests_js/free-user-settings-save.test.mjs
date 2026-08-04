import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const profileSource = await readFile(
    new URL('../static/js/modules/settings/profile.js', import.meta.url),
    'utf8',
);

test('free-user settings save skips validation for formula fields that are read-only', () => {
    assert.match(
        profileSource,
        /const isMemberSave = currentUser\?\.membership_level === 'member';[\s\S]*?const formulaOk = !isMemberSave \|\| await validateCurrentFormulas\(\);/,
    );
});
