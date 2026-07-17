import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class FakeEventTarget {
    #listeners = new Map();

    addEventListener(type, listener) {
        const listeners = this.#listeners.get(type) ?? [];
        listeners.push(listener);
        this.#listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
        for (const listener of this.#listeners.get(type) ?? []) {
            listener(event);
        }
        return event;
    }
}

function createLifecycleHarness() {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeEventTarget();
    const modal = {
        classList: {
            hidden: true,
            remove(name) { if (name === 'hidden') this.hidden = false; },
            add(name) { if (name === 'hidden') this.hidden = true; },
        },
        querySelector() { return new FakeEventTarget(); },
    };
    const cancelButton = {};
    const confirmButton = {};

    windowTarget.location = {
        reloadCalls: 0,
        reload() { this.reloadCalls += 1; },
    };
    documentTarget.getElementById = (id) => ({
        'leave-confirm-modal': modal,
        'leave-confirm-cancel': cancelButton,
        'leave-confirm-ok': confirmButton,
    })[id] ?? null;

    return {
        windowTarget,
        documentTarget,
        modal,
        confirmButton,
        dispatchBeforeUnload() {
            const event = {
                prevented: false,
                preventDefault() { this.prevented = true; },
            };
            return windowTarget.dispatch('beforeunload', event);
        },
    };
}

async function loadAppLifecycle() {
    const source = await readFile(new URL('../static/js/modules/app-shell.js', import.meta.url), 'utf8');
    return import(`data:text/javascript,${encodeURIComponent(source)}`);
}

async function withLifecycle(callback) {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const harness = createLifecycleHarness();
    globalThis.window = harness.windowTarget;
    globalThis.document = harness.documentTarget;

    try {
        const { initAppLifecycle } = await loadAppLifecycle();
        initAppLifecycle({
            mobileNav: {},
            loadAppVersion() {},
            preloadPrinterSelectors() {},
            updateViewerSize() {},
            getSelectedFilesCount: () => 1,
        });
        await callback(harness);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
}

test('beforeunload still protects selected models until the user confirms leaving', async () => {
    await withLifecycle(({ dispatchBeforeUnload }) => {
        const event = dispatchBeforeUnload();

        assert.equal(event.prevented, true);
        assert.equal(event.returnValue, '');
    });
});

test('confirming the app leave dialog suppresses the following browser beforeunload prompt', async () => {
    await withLifecycle(({ documentTarget, modal, confirmButton, windowTarget, dispatchBeforeUnload }) => {
        documentTarget.dispatch('keydown', {
            key: 'F5',
            preventDefault() {},
        });

        assert.equal(modal.classList.hidden, false);
        confirmButton.onclick();

        assert.equal(windowTarget.location.reloadCalls, 1);
        assert.equal(dispatchBeforeUnload().prevented, false);
    });
});
