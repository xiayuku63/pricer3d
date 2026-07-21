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
const styledSelectUrl = new URL('../static/js/modules/styled-select.js', import.meta.url);
const styledSelectSource = await readFile(styledSelectUrl, 'utf8');
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

test('styled select wraps the default and batch controls with a blue popup highlight', () => {
    assert.match(styledSelectSource, /DEFAULT_SELECT_IDS = \[/);
    assert.match(styledSelectSource, /initStyledSelectDropdowns\(selectIds = DEFAULT_SELECT_IDS\)/);
    assert.match(styledSelectSource, /export function refreshStyledSelectDropdowns\(selectIds = DEFAULT_SELECT_IDS\)/);
    assert.match(styledSelectSource, /styled-select-item tw-dropdown-option/);
    assert.match(componentsSource, /\.styled-select-item\.tw-dropdown-option-active,[\s\S]*?background-color: #006ad0 !important;/);
    assert.match(componentsSource, /\.styled-select-trigger:focus,[\s\S]*?box-shadow: 0 0 0 3px rgba\(0, 122, 255, 0\.12\)/);
    assert.match(pageShellSource, /data-styled-select-host/);
    assert.match(pageShellSource, /front-default-printer-model/);
    assert.match(pageShellSource, /batch-material/);
    assert.match(componentsSource, /\.styled-select-wrapper \{/);
});

test('default material control refresh also refreshes the styled select wrapper options', async () => {
    const commonSource = await readFile(new URL('../static/js/modules/settings/common.js', import.meta.url), 'utf8');
    assert.match(commonSource, /refreshStyledSelectDropdowns\(\['front-default-brand', 'front-default-material'\]\);/);
});

test('styled select keeps the menu open while its own option list is scrolling', () => {
    assert.match(styledSelectSource, /event\.target instanceof Element && event\.target\.closest\('\.styled-select-list'\)/);
    assert.match(styledSelectSource, /document\.addEventListener\('scroll', \(event\) => \{/);
    assert.match(componentsSource, /\.styled-select-list \{[\s\S]*?overflow-x: hidden !important;[\s\S]*?overflow-y: auto !important;/);
});

test('default material color hides the visible HEX label without changing the dropdown value', () => {
    assert.match(componentsSource, /#uc-default-color-dropdown \.color-dd-trigger-label \{[\s\S]*?display: none;/);
    assert.match(componentsSource, /\.color-dd-item-active \{[\s\S]*?background-color: #006ad0 !important;[\s\S]*?color: #ffffff !important;/);
    assert.match(componentsSource, /\.color-dd-item:hover,[\s\S]*?\.color-dd-item-active:focus-visible[\s\S]*?background-color: #006ad0 !important;/);
});

test('portal color selection persists the default color container value', () => {
    assert.match(appShellSource, /if \(wrapper\.closest\('#uc-default-color-dropdown, #front-default-color-dropdown'\)\)/);
    assert.match(appShellSource, /const defaultColorContainer = wrapper\.closest\('#uc-default-color-dropdown, #front-default-color-dropdown'\);/);
    assert.match(appShellSource, /defaultColorContainer\.setAttribute\('data-selected-color', hex\);/);
});
