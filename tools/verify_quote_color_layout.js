const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto('http://127.0.0.1:5001', { waitUntil: 'commit', timeout: 10000 });
  await page.locator('#batch-results-body').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const tbody = document.getElementById('batch-results-body');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr data-row-file="debug-part.stl" class="border-t border-gray-100 table-row-success">
        <td class="px-2 py-1.5"><div>debug-part.stl</div><button type="button" class="mt-0.5 text-[10px] text-indigo-500 underline">详情</button></td>
        <td class="px-2 py-1.5"><button type="button" class="text-[12px] text-indigo-600 border border-indigo-200 rounded px-2 py-0.5">预览</button></td>
        <td class="px-2 py-1.5"><div class="quote-config-grid min-w-[232px]"><div class="quote-config-row"><select data-field="_printer_model" aria-label="打印机" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5"><option>Bambu Lab A1 Mini</option></select><select data-field="_slicer_preset_id" aria-label="预设" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5"><option>0.20-3-20%</option></select></div><div class="quote-config-row"><select data-field="_brand" aria-label="品牌" class="row-edit row-brand-select text-[11px] border border-gray-300 rounded px-1 py-0.5"><option>通用</option></select><select data-field="material" aria-label="材料" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5"><option>PLA</option></select></div><div class="quote-config-row quote-config-row-color" data-field="color"><div class="color-dd-wrapper relative inline-block"><button type="button" class="color-dd-trigger flex items-center gap-1 px-2 py-1 border rounded text-[11px] tw-card tw-text min-w-[36px]"><span class="color-dd-swatch w-3.5 h-3.5 rounded-sm border flex-shrink-0" style="background:#d1d5db;border-color:var(--color-border-input);"></span><svg class="w-3 h-3 tw-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="color-dd-list hidden absolute z-50 left-0 mt-1 tw-bg-surface border rounded-md shadow-lg overflow-y-auto min-w-[140px]" style="border-color:var(--color-border);max-height:360px;"><button type="button" class="color-dd-item flex items-center gap-2 w-full px-3 py-2 text-sm border-b last:border-0 text-left" data-color-hex="#d1d5db"><span class="w-5 h-5 rounded-sm border flex-shrink-0" style="background:#d1d5db;border-color:var(--color-border-input);"></span><span class="flex-1 font-mono text-xs tw-text-secondary">#d1d5db</span></button><button type="button" class="color-dd-item flex items-center gap-2 w-full px-3 py-2 text-sm border-b last:border-0 text-left" data-color-hex="#111827"><span class="w-5 h-5 rounded-sm border flex-shrink-0" style="background:#111827;border-color:var(--color-border-input);"></span><span class="flex-1 font-mono text-xs tw-text-secondary">#111827</span></button><button type="button" class="color-dd-item flex items-center gap-2 w-full px-3 py-2 text-sm border-b last:border-0 text-left" data-color-hex="#ef4444"><span class="w-5 h-5 rounded-sm border flex-shrink-0" style="background:#ef4444;border-color:var(--color-border-input);"></span><span class="flex-1 font-mono text-xs tw-text-secondary">#ef4444</span></button></div><input type="hidden" class="row-color-value" value="#d1d5db"></div></div></div></td>
        <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="1" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>
        <td class="px-2 py-1.5"><div class="text-[10px] leading-tight">74.8g</div><div class="text-xs leading-tight font-medium">74.85g</div></td>
        <td class="px-2 py-1.5"><div class="text-[10px] leading-tight">03h25m48s</div><div class="text-xs leading-tight font-medium">03h25m48s</div></td>
        <td class="px-2 py-1.5"><div class="text-[10px] leading-tight">¥ 67.16</div><div class="text-xs leading-tight font-medium">¥ 67.16</div></td>
        <td data-role="status-cell" class="px-2 py-1.5 whitespace-nowrap font-medium text-[11px] text-green-600"><span class="inline-block w-2 h-2 rounded-full mr-1 align-middle bg-green-500"></span>成功</td>
        <td class="px-2 py-1.5 space-x-1"><button type="button" data-delete-file="debug-part.stl" class="text-xs text-red-500">删除</button></td>
      </tr>`;
  });

  const trigger = page.locator('#batch-results-body tr[data-row-file] .color-dd-trigger').first();
  await trigger.click();
  await page.waitForTimeout(700);

  const triggerBox = await trigger.boundingBox();
  const list = page.locator('.color-dd-list:not(.hidden)').first();
  const listBox = await list.boundingBox().catch(() => null);
  const configBox = await page.locator('#batch-results-body tr[data-row-file] .quote-config-grid').first().boundingBox();

  console.log(JSON.stringify({ triggerBox, listBox, configBox }, null, 2));
  await page.screenshot({ path: 'D:/Projects/pricer3d/desktop_outputs/color-dropdown-verified.png', fullPage: true });
  await browser.close();
})();
