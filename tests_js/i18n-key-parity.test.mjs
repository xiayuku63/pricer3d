import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const zh = (await import('../static/js/modules/i18n/zh.js')).default;
const en = (await import('../static/js/modules/i18n/en.js')).default;

test('zh and en language packs define exactly the same key set', () => {
    const zhKeys = new Set(Object.keys(zh));
    const enKeys = new Set(Object.keys(en));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    assert.deepEqual(missingInZh, [], `keys missing in zh pack: ${missingInZh.join(', ')}`);
    assert.deepEqual(missingInEn, [], `keys missing in en pack: ${missingInEn.join(', ')}`);
});

test('every t("...") key referenced by frontend modules exists in the zh pack', async () => {
    const { readdir } = await import('node:fs/promises');
    const packKeys = new Set(Object.keys(zh));
    const missing = [];

    async function scan(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = `${dir}/${entry.name}`;
            if (entry.isDirectory()) { await scan(full); continue; }
            if (!entry.name.endsWith('.js') || entry.name === 'i18n.js') continue;
            const src = await readFile(new URL(`../${full}`, import.meta.url), 'utf8');
            for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.\-]+)['"]/g)) {
                if (!packKeys.has(m[1])) missing.push(`${m[1]} (${entry.name})`);
            }
        }
    }
    await scan('static/js/modules');
    assert.deepEqual(missing, [], `t() keys with no zh definition: ${missing.join(', ')}`);
});
