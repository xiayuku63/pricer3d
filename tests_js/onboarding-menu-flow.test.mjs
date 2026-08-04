import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stepsSource = await readFile(new URL('../static/js/modules/onboarding/steps.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../static/js/modules/onboarding/ui.js', import.meta.url), 'utf8');

// This is a source-level contract test because the onboarding modules depend on
// the browser DOM. The real browser flow is also verified with Playwright.
test('onboarding requires opening the user menu before showing User Center', () => {
    assert.match(stepsSource, /canAdvance:\s*\(\) => \{[\s\S]*?user-dropdown[\s\S]*?classList\.contains\('hidden'\)/);
    assert.doesNotMatch(
        stepsSource,
        /s\('#open-user-center-btn',[\s\S]*?action:\s*\(\) => \{[\s\S]*?user-dropdown[\s\S]*?remove\('hidden'\)/,
    );
});

test('onboarding keeps the real dropdown target above the overlay and advances after the real click', () => {
    assert.match(stepsSource, /elevatedTarget:\s*'#user-dropdown'/);
    assert.match(stepsSource, /advanceOnTargetClick:\s*true/);
    assert.match(stepsSource, /_realTarget:\s*'#gen-printer-model'/);
    assert.match(uiSource, /event\.stopPropagation\(\)/);
    assert.match(uiSource, /onb-elevated-target/);
});
