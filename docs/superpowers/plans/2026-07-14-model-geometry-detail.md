# 模型几何信息详情 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each model's bounding dimensions, surface area, and emphasized volume in the expanded slicer detail on desktop and mobile.

**Architecture:** Keep the existing quote response shape unchanged. Add a small HTML builder in the quote renderer and insert its output inside both existing slicer-detail cards, immediately before the shared G-code parameter grid.

**Tech Stack:** Browser ES modules, Tailwind utility classes, Node.js built-in `node:test`.

---

## File Structure

- Modify: `static/js/modules/quote-render.js` — add and use the shared model geometry detail builder.
- Create: `tests_js/quote-render-geometry.test.mjs` — unit-test the HTML generated for the geometry detail row.

### Task 1: Specify the Geometry Detail Markup With a Failing Test

**Files:**
- Create: `tests_js/quote-render-geometry.test.mjs`

- [ ] **Step 1: Add a test for the full geometry row**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildModelGeometryDetailHtml } from '../static/js/modules/quote-render.js';

test('buildModelGeometryDetailHtml renders all geometry values and emphasizes volume', () => {
    const html = buildModelGeometryDetailHtml({
        dimensions: '120 × 80 × 45 mm',
        surface_area_cm2: 152.3,
        volume_cm3: 86.5,
    });

    assert.match(html, /模型尺寸/);
    assert.match(html, /包裹 120 × 80 × 45 mm/);
    assert.match(html, /表面积 152.3 cm²/);
    assert.match(html, /font-semibold[^>]*>体积 86.5 cm³/);
});
```

- [ ] **Step 2: Run the test and confirm it fails because the helper is not exported**

Run: `node --test tests_js/quote-render-geometry.test.mjs`

Expected: FAIL with an export error for `buildModelGeometryDetailHtml`.

### Task 2: Implement the Shared Geometry Detail Builder

**Files:**
- Modify: `static/js/modules/quote-render.js:1264`
- Test: `tests_js/quote-render-geometry.test.mjs`

- [ ] **Step 1: Add the exported geometry builder before `_buildGcodeDetailHtml`**

```js
export function buildModelGeometryDetailHtml(item) {
    const values = [];
    if (item?.dimensions) values.push('<span>包裹 ' + escapeHtml(String(item.dimensions)) + '</span>');
    if (item?.surface_area_cm2 != null) values.push('<span>表面积 ' + escapeHtml(String(item.surface_area_cm2)) + ' cm²</span>');
    if (item?.volume_cm3 != null) values.push('<span class="font-semibold text-gray-800">体积 ' + escapeHtml(String(item.volume_cm3)) + ' cm³</span>');
    if (!values.length) return '';

    return '<div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-gray-600">'
        + '<span class="font-medium text-gray-500">模型尺寸</span>'
        + values.join('<span class="text-gray-300">|</span>')
        + '</div>';
}
```

- [ ] **Step 2: Run the focused test and confirm it passes**

Run: `node --test tests_js/quote-render-geometry.test.mjs`

Expected: PASS with one passing test.

### Task 3: Cover Missing Geometry Values

**Files:**
- Modify: `tests_js/quote-render-geometry.test.mjs`
- Test: `tests_js/quote-render-geometry.test.mjs`

- [ ] **Step 1: Add a missing-data test**

```js
test('buildModelGeometryDetailHtml omits missing values without rendering invalid text', () => {
    const html = buildModelGeometryDetailHtml({ volume_cm3: 0 });

    assert.match(html, /体积 0 cm³/);
    assert.doesNotMatch(html, /undefined|null/);
    assert.doesNotMatch(html, /表面积/);
    assert.doesNotMatch(html, /包裹/);
});
```

- [ ] **Step 2: Run the focused test suite and confirm both tests pass**

Run: `node --test tests_js/quote-render-geometry.test.mjs`

Expected: PASS with two passing tests.

### Task 4: Use the Shared Builder in Both Slicer Detail Cards

**Files:**
- Modify: `static/js/modules/quote-render.js:1007-1011`
- Modify: `static/js/modules/quote-render.js:1162`
- Test: `tests_js/quote-render-geometry.test.mjs`

- [ ] **Step 1: Insert the builder output before the G-code grid in the desktop card**

```js
gcodeHtml = '<div class="mb-3 p-3 bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-xl shadow-sm">'
    + '<div class="text-[11px] font-semibold text-purple-700 mb-2 flex items-center gap-1.5">...切片参数</div>'
    + buildModelGeometryDetailHtml(item)
    + _buildGcodeDetailHtml(gcodeData, false, item) + '</div>';
```

- [ ] **Step 2: Insert the same builder call before the G-code grid in the mobile card template**

```js
item.cost_breakdown?.gcode_summary
    ? '<div class="...">...切片参数</div>'
        + buildModelGeometryDetailHtml(item)
        + _buildGcodeDetailHtml(item.cost_breakdown.gcode_summary, false, item)
        + '</div>'
    : ''
```

- [ ] **Step 3: Add a source-level regression assertion proving both detail paths call the builder**

```js
import { readFile } from 'node:fs/promises';

test('desktop and mobile slicer detail cards use the shared geometry builder', async () => {
    const source = await readFile(new URL('../static/js/modules/quote-render.js', import.meta.url), 'utf8');
    assert.equal((source.match(/buildModelGeometryDetailHtml\(item\)/g) ?? []).length, 2);
});
```

- [ ] **Step 4: Run the focused test suite and confirm all tests pass**

Run: `node --test tests_js/quote-render-geometry.test.mjs`

Expected: PASS with three passing tests.

### Task 5: Verify the Completed Change

**Files:**
- Modify: `static/js/modules/quote-render.js`
- Create: `tests_js/quote-render-geometry.test.mjs`

- [ ] **Step 1: Run all JavaScript tests**

Run: `node --test tests_js`

Expected: PASS for `app-lifecycle.test.mjs` and `quote-render-geometry.test.mjs`.

- [ ] **Step 2: Check whitespace and inspect the diff**

Run: `git diff --check && git diff -- static/js/modules/quote-render.js tests_js/quote-render-geometry.test.mjs`

Expected: no whitespace errors; only the geometry builder, its two call sites, and focused tests change.

- [ ] **Step 3: Commit the implementation**

```bash
git add static/js/modules/quote-render.js tests_js/quote-render-geometry.test.mjs
git commit -m "feat: show model geometry in slicer details"
```
