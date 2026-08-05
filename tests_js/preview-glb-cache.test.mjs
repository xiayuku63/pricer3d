import assert from "node:assert/strict";
import test from "node:test";

import { getCoplanarClusters, getPreview3mf, getPreviewGlb, getPreviewStl } from "../static/js/modules/preview-cache.js";

test("deduplicates concurrent GLB requests for one uploaded model", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
        calls += 1;
        assert.equal(options.method, "POST");
        return { ok: true, blob: async () => new Blob(["glb"]) };
    };

    try {
        const file = new Blob(["model"]);
        file.name = "part.stp";
        file.lastModified = 123;
        const first = getPreviewGlb(file);
        const second = getPreviewGlb(file);
        assert.strictEqual(first, second);
        const [firstBlob, secondBlob] = await Promise.all([first, second]);
        assert.equal(calls, 1);
        assert.equal(await firstBlob.text(), "glb");
        assert.equal(await secondBlob.text(), "glb");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("deduplicates normalized STL requests for the main non-STL viewer", async () => {
    const originalFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url, options) => {
        urls.push(url);
        assert.equal(options.method, "POST");
        return { ok: true, blob: async () => new Blob(["solid normalized"]) };
    };

    try {
        const file = new Blob(["step-model"]);
        file.name = "screen-bracket.stp";
        file.lastModified = 456;
        const first = getPreviewStl(file);
        const second = getPreviewStl(file);
        assert.strictEqual(first, second);
        const [firstBlob, secondBlob] = await Promise.all([first, second]);
        assert.deepEqual(urls, ["/api/preview/stl"]);
        assert.equal(await firstBlob.text(), "solid normalized");
        assert.equal(await secondBlob.text(), "solid normalized");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("deduplicates multi-entity 3MF scene requests", async () => {
    const originalFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url, options) => {
        urls.push(url);
        assert.equal(options.method, "POST");
        return { ok: true, blob: async () => new Blob(["3mf-glb"]) };
    };

    try {
        const file = new Blob(["multi-entity"]);
        file.name = "multi.3mf";
        file.lastModified = 789;
        const first = getPreview3mf(file);
        const second = getPreview3mf(file);
        assert.strictEqual(first, second);
        const [firstBlob, secondBlob] = await Promise.all([first, second]);
        assert.deepEqual(urls, ["/api/preview/3mf-scene"]);
        assert.equal(await firstBlob.text(), "3mf-glb");
        assert.equal(await secondBlob.text(), "3mf-glb");
    } finally {
        globalThis.fetch = originalFetch;
    }
});


test("deduplicates manual-placement candidate requests", async () => {
    let calls = 0;
    const request = async (url, options) => {
        calls += 1;
        assert.equal(url, "/api/orientation/coplanar");
        assert.equal(options.method, "POST");
        assert.ok(options.body instanceof FormData);
        return {
            ok: true,
            status: 200,
            json: async () => ({ clusters: [{ area: 100 }] }),
        };
    };

    const file = new Blob(["manual-placement"]);
    file.name = "manual-part.stl";
    file.lastModified = 101112;
    const first = getCoplanarClusters(file, request);
    const second = getCoplanarClusters(file, request);
    assert.strictEqual(first, second);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(a.data, { clusters: [{ area: 100 }] });
    assert.strictEqual(a, b);
});


test("does not retain failed manual-placement responses", async () => {
    let calls = 0;
    const request = async () => {
        calls += 1;
        return {
            ok: calls > 1,
            status: calls > 1 ? 200 : 500,
            json: async () => (calls > 1 ? { clusters: [] } : { detail: "failed" }),
        };
    };

    const file = new Blob(["manual-placement-retry"]);
    file.name = "manual-retry.stl";
    file.lastModified = 131415;
    const failed = await getCoplanarClusters(file, request);
    assert.equal(failed.resp.ok, false);
    const retried = await getCoplanarClusters(file, request);
    assert.equal(retried.resp.ok, true);
    assert.equal(calls, 2);
});
