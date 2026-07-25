import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadPortalHelper() {
    const source = await readFile(new URL('../static/js/modules/app-shell.js', import.meta.url), 'utf8');
    const standaloneSource = source.replace(/^import .*;\r?\n/gm, '');
    return import(`data:text/javascript,${encodeURIComponent(standaloneSource)}`);
}

function withModalDocument(modalId) {
    const modal = { parentElement: { id: 'page-card' } };
    const body = {
        appendChild(node) {
            node.parentElement = this;
            return node;
        },
    };
    return {
        modal,
        document: {
            body,
            getElementById(id) {
                return id === modalId ? modal : null;
            },
        },
    };
}

test('user center modal is portaled to document.body so fixed positioning uses the viewport', async () => {
    const { modal, document } = withModalDocument('user-center-modal');
    const previousDocument = globalThis.document;
    globalThis.document = document;

    try {
        const { portalUserCenterModal } = await loadPortalHelper();
        portalUserCenterModal();
        assert.equal(modal.parentElement, document.body);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('preview modal is portaled to document.body so fixed positioning uses the viewport', async () => {
    const { modal, document } = withModalDocument('preview-modal');
    const previousDocument = globalThis.document;
    globalThis.document = document;

    try {
        const { portalPreviewModal } = await loadPortalHelper();
        portalPreviewModal();
        assert.equal(modal.parentElement, document.body);
    } finally {
        globalThis.document = previousDocument;
    }
});
