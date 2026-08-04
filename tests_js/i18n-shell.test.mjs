import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const i18n = await readFile(new URL('../static/js/modules/i18n.js', import.meta.url), 'utf8');
const shell = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
const login = await readFile(new URL('../static/partials/login-modal.html', import.meta.url), 'utf8');
const membership = await readFile(new URL('../static/partials/membership-modal.html', import.meta.url), 'utf8');
const en = await readFile(new URL('../static/js/modules/i18n/en.js', import.meta.url), 'utf8');

test('the translator preserves icon markup and localizes text plus accessibility attributes', () => {
    assert.match(i18n, /function _setLocalizedText/);
    assert.match(i18n, /node\.nodeType === Node\.TEXT_NODE/);
    assert.match(i18n, /\[data-i18n-aria-label\]/);
    assert.match(i18n, /\[data-i18n-alt\]/);
    assert.match(i18n, /\[data-i18n-title\]/);
    assert.match(i18n, /document\.title = t\('app\.pageTitle'\)/);
});

test('shared navigation, login, and membership surfaces expose translatable content', () => {
    for (const key of ['nav.title', 'nav.quote', 'nav.history', 'nav.printerParams', 'nav.materials', 'app.description']) {
        assert.match(shell, new RegExp(`data-i18n="${key}"`));
        assert.match(en, new RegExp(`'${key}'`));
    }
    for (const key of ['auth.usernameEmailPhone', 'auth.forgotPasswordQuestion', 'auth.backToLogin']) {
        assert.match(login, new RegExp(`data-i18n="${key}"`));
        assert.match(en, new RegExp(`'${key}'`));
    }
    for (const key of ['membership.benefits', 'membership.exclusiveDiscount', 'membership.refreshStatus']) {
        assert.match(membership, new RegExp(`data-i18n="${key}"`));
        assert.match(en, new RegExp(`'${key}'`));
    }
});
