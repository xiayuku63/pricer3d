import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const themeSource = await readFile(new URL('../static/js/modules/theme.js', import.meta.url), 'utf8');
const headSource = await readFile(new URL('../static/partials/head.html', import.meta.url), 'utf8');
const shellSource = await readFile(new URL('../static/partials/page-shell.html', import.meta.url), 'utf8');
const tokenSource = await readFile(new URL('../static/css/design-tokens.css', import.meta.url), 'utf8');

test('theme is applied before styles render and follows the OS when unset', () => {
    assert.match(headSource, /prefers-color-scheme: dark/);
    assert.match(headSource, /document\.documentElement\.classList\.toggle\('dark'/);
    assert.match(themeSource, /saved === 'dark' \|\| saved === 'light'/);
    assert.match(themeSource, /matchMedia\?\.\(DARK_QUERY\)\.matches/);
});

test('desktop and mobile theme controls stay synchronized and accessible', () => {
    assert.match(shellSource, /id="mobile-theme-toggle-btn"/);
    assert.match(themeSource, /document\.getElementById\('theme-toggle-btn'\)/);
    assert.match(themeSource, /document\.getElementById\('mobile-theme-toggle-btn'\)/);
    assert.match(themeSource, /setAttribute\('aria-pressed'/);
    assert.match(themeSource, /style\.colorScheme/);
});

test('language dropdown binds one outside-click listener and exposes listbox semantics', () => {
    assert.match(themeSource, /_langOutsideClickBound/);
    assert.match(themeSource, /aria-haspopup="listbox"/);
    assert.match(themeSource, /role="option"/);
});


test('dark mode replaces light-only Apple glass surfaces', () => {
    assert.match(tokenSource, /\.dark \.apple-shell::before/);
    assert.match(tokenSource, /\.dark \.apple-metric/);
    assert.match(tokenSource, /\.dark \.apple-toolbar/);
    assert.match(tokenSource, /\.dark \.apple-upload-zone/);
});
