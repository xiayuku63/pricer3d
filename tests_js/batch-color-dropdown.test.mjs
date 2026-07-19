import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appShellUrl = new URL('../static/js/modules/app-shell.js', import.meta.url);
const appShellSource = await readFile(appShellUrl, 'utf8');
const themeUrl = new URL('../static/js/modules/theme.js', import.meta.url);
const themeSource = await readFile(themeUrl, 'utf8');
const pageShellUrl = new URL('../static/partials/page-shell.html', import.meta.url);
const pageShellSource = await readFile(pageShellUrl, 'utf8');
const componentsUrl = new URL('../static/css/tokens/components.css', import.meta.url);
const componentsSource = await readFile(componentsUrl, 'utf8');
const tableEnhancementsUrl = new URL('../static/css/table-enhancements.css', import.meta.url);
const readTableEnhancementsSource = await readFile(tableEnhancementsUrl, 'utf8');

test('batch color dropdown keeps delegated selection events for duplicate material colors', () => {
    assert.match(appShellSource, /export function initColorDropdownUI/);
    assert.match(appShellSource, /const item = event\.target\.closest\('\.color-dd-item'\)/);
    assert.match(appShellSource, /const rowCtx = wrapper\.closest\('tr\[data-row-file\], \[data-card-file\]'\)/);
    assert.doesNotMatch(appShellSource, /color-dd-toggle-more/);
});

test('portal-positioned color dropdown clears stretch styles before sizing the popup', () => {
    assert.match(appShellSource, /panel\.style\.maxWidth = '';/);
    assert.match(appShellSource, /const compact = wrapper\.classList\.contains\('color-dd-wrapper-compact'\);/);
    assert.match(appShellSource, /list\.style\.right = '';/);
    assert.match(appShellSource, /list\.style\.width = 'max-content';/);
    assert.match(appShellSource, /const listWidth = Math\.min\(Math\.max\(listRect\.width, minWidth\), viewportMaxWidth\);/);
});

test('custom popup menus share the unified dropdown option styling', () => {
    assert.match(themeSource, /lang-option tw-dropdown-option/);
    assert.match(themeSource, /tw-dropdown-option-active font-medium/);
    assert.match(pageShellSource, /id="open-user-center-btn"[\s\S]*?tw-dropdown-option/);
    assert.match(pageShellSource, /id="logout-btn"[\s\S]*?tw-text-danger tw-dropdown-option/);
    assert.doesNotMatch(appShellSource, /item\.classList\.toggle\('tw-dropdown-option-active', selected\);/);
});

test('color popup uses native-like focus, white menu background, gray selection, and square corners', () => {
    assert.match(componentsSource, /\.color-dd-trigger:focus[\s\S]*?box-shadow: 0 0 0 3px rgba\(0, 122, 255, 0\.12\)/);
    assert.match(componentsSource, /\.color-dd-list \{[\s\S]*?background-color: var\(--color-surface-solid\) !important;[\s\S]*?border-radius: 0 !important;/);
    assert.match(componentsSource, /\.color-dd-list \.color-dd-item\.color-dd-item-active \{[\s\S]*?background-color: #808080 !important;[\s\S]*?color: #ffffff !important;/);
    assert.match(componentsSource, /\.color-dd-item-swatch \{[\s\S]*?border-color: var\(--color-border-input\);/);
    assert.match(componentsSource, /\.color-dd-list \.color-dd-item\.color-dd-item-active \.color-dd-item-swatch \{[\s\S]*?box-shadow: none;/);
    assert.match(componentsSource, /\.color-dd-list \.color-dd-item:hover,[\s\S]*?background-color: #808080 !important;[\s\S]*?color: #ffffff !important;/);
    assert.match(appShellSource, /list\.classList\.add\('color-dd-has-preview'\)/);
    assert.match(appShellSource, /item\.classList\.add\('color-dd-item-preview'\)/);
    assert.match(componentsSource, /\.color-dd-list\.color-dd-has-preview \.color-dd-item\.color-dd-item-active:not\(\.color-dd-item-preview\)/);
});

test('native selects and the color trigger share the blue focus ring', () => {
    assert.match(componentsSource, /select:focus,[\s\S]*?select:focus-visible,[\s\S]*?\.color-dd-trigger:focus-visible/);
    assert.match(componentsSource, /select:focus[\s\S]*?box-shadow: 0 0 0 3px rgba\(0, 122, 255, 0\.12\)/);
    assert.match(componentsSource, /select:focus[\s\S]*?border-color: rgba\(0, 122, 255, 0\.42\) !important/);
    assert.match(componentsSource, /\.color-dd-trigger:focus[\s\S]*?box-shadow: 0 0 0 3px rgba\(0, 122, 255, 0\.12\)/);
    assert.match(readTableEnhancementsSource, /\.row-edit:focus[\s\S]*?box-shadow: 0 0 0 3px rgba\(0, 122, 255, 0\.12\)[\s\S]*?!important/);
});

test('default material color hides the visible HEX label without changing the dropdown value', () => {
    assert.match(componentsSource, /#uc-default-color-dropdown \.color-dd-trigger-label \{[\s\S]*?display: none;/);
});

test('portal color selection persists the default color container value', () => {
    assert.match(appShellSource, /if \(wrapper\.closest\('#uc-default-color-dropdown, #front-default-color-dropdown'\)\)/);
    assert.match(appShellSource, /const defaultColorContainer = wrapper\.closest\('#uc-default-color-dropdown, #front-default-color-dropdown'\);/);
    assert.match(appShellSource, /defaultColorContainer\.setAttribute\('data-selected-color', hex\);/);
});
