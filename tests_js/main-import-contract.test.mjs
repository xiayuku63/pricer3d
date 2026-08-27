import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// A missing re-export here kills the whole module graph (main.js fails to
// load and EVERY button on the page goes dead) — so pin the contract.
test('quote.js re-exports every symbol main.js imports from it', async () => {
    const [mainSrc, quoteSrc] = await Promise.all([
        readFile(new URL('../static/js/main.js', import.meta.url), 'utf8'),
        readFile(new URL('../static/js/modules/quote.js', import.meta.url), 'utf8'),
    ]);

    const block = mainSrc.match(/import \{([^}]+)\} from '\.\/modules\/quote\.js'/);
    assert.ok(block, 'main.js quote import block found');
    const imported = block[1].split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean);
    assert.ok(imported.length >= 10, 'sanity: expected the full list to be pinned');

    // quote.js's own export block
    const exportBlock = quoteSrc.match(/export \{([^}]+)\}(?!\s*from)/);
    assert.ok(exportBlock, 'quote.js export block found');
    const exported = new Set(
        exportBlock[1].split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean),
    );

    // Single-line exports like `export function foo(` also count.
    for (const line of quoteSrc.split('\n')) {
        const m = line.match(/^export (?:async )?function (\w+)/);
        if (m) exported.add(m[1]);
    }

    const missing = imported.filter((name) => !exported.has(name));
    assert.deepEqual(missing, [], `missing re-exports break every page button: ${missing.join(', ')}`);
});
