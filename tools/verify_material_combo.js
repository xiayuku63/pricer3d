/* Real-browser verification for the material combo dropdown fix.
 * Run: node tools/verify_material_combo.js [base_url]
 * Asserts the open dropdown is portaled to <body> and fully inside the
 * viewport (the bug: it was clipped to ~3 rows by the table's
 * overflow-x-auto wrapper).
 */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE = process.argv[2] || 'http://127.0.0.1:5000';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (err) => { console.error('PAGE ERROR:', err.message); });

    // 1. The SPA's ?debug flow logs itself in as admin (ENABLE_DEV_ADMIN_LOGIN=1).
    await page.goto(BASE + '/?debug', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#user-menu-btn', { state: 'visible', timeout: 20000 });
    // Dismiss the (worktree) onboarding welcome overlay if it appeared.
    const skipBtn = page.locator('#onb-welcome-skip');
    if (await skipBtn.count() && await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
    }

    // 2. Open the user-center modal (avatar menu → 用户中心).
    await page.click('#user-menu-btn');
    await page.waitForSelector('#open-user-center-btn:visible', { timeout: 10000 });
    await page.click('#open-user-center-btn');
    await page.waitForSelector('#materials-tbody tr', { timeout: 10000 });
    await page.waitForTimeout(300);

    // 3. Focus the first material-type combo input.
    const typeInput = page.locator('#materials-tbody .combo-i[data-field="name"]').first();
    await typeInput.click();
    await page.waitForTimeout(200);

    // 4. Measure the open dropdown.
    const result = await page.evaluate(() => {
        const dd = document.querySelector('body > .combo-d:not(.hidden)');
        if (!dd) return { error: 'no portaled dropdown under body' };
        const r = dd.getBoundingClientRect();
        const visibleOpts = [...dd.querySelectorAll('.combo-opt')].filter(
            (o) => o.offsetParent !== null && !o.classList.contains('hidden')
        ).length;
        return {
            parentIsBody: dd.parentElement === document.body,
            rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) },
            width: Math.round(r.width),
            height: Math.round(r.height),
            visibleOptions: visibleOpts,
            viewport: { w: window.innerWidth, h: window.innerHeight },
        };
    });
    console.log('open dropdown:', JSON.stringify(result, null, 2));

    let ok = true;
    const assert = (cond, msg) => { if (!cond) { ok = false; console.error('FAIL:', msg); } };
    assert(!result.error, result.error || '');
    assert(result.parentIsBody, 'dropdown must be portaled to body');
    assert(result.visibleOptions >= 8, `expected >=8 visible options on open, got ${result.visibleOptions}`);
    assert(result.rect.top >= 0 && result.rect.bottom <= result.viewport.h, 'vertical overflow');
    assert(result.rect.left >= 0 && result.rect.right <= result.viewport.w, 'horizontal overflow');

    // 5. Type-to-filter still works with the portaled dropdown.
    await typeInput.fill('PL');
    await page.waitForTimeout(150);
    const filtered = await page.evaluate(() => {
        const dd = document.querySelector('body > .combo-d:not(.hidden)');
        if (!dd) return -1;
        return [...dd.querySelectorAll('.combo-opt')].filter((o) => !o.classList.contains('hidden')).length;
    });
    console.log('filtered options for "PL":', filtered);
    assert(filtered >= 1 && filtered <= 4, `filter should narrow options, got ${filtered}`);

    // 6. Click an option → value applied & dropdown closes.
    await page.locator('body > .combo-d:not(.hidden) .combo-opt:not(.hidden)').first().click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
        anyOpen: !!document.querySelector('.combo-d:not(.hidden)'),
        firstRowName: document.querySelector('#materials-tbody .combo-i[data-field="name"]')?.value,
    }));
    console.log('after select:', JSON.stringify(after));
    assert(!after.anyOpen, 'dropdown should close after selection');
    assert(after.firstRowName && after.firstRowName.startsWith('PL'), `selected value should start with PL, got ${after.firstRowName}`);

    await page.screenshot({ path: 'tools/verify_material_combo.png', fullPage: false });

    await browser.close();
    if (!ok) { console.error('RESULT: FAIL'); process.exit(1); }
    console.log('RESULT: PASS');
})().catch((err) => { console.error(err); process.exit(1); });
