import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class MemoryStorage {
    constructor(sharedValues = new Map()) {
        this.values = sharedValues;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

async function loadStateModule() {
    const source = await readFile(new URL('../static/js/modules/state.js', import.meta.url), 'utf8');
    return import(`data:text/javascript,${encodeURIComponent(source)}#${Date.now()}-${Math.random()}`);
}

test('refresh keeps the current tab account when another tab changes the persisted login', async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousSessionStorage = globalThis.sessionStorage;
    const sharedLocalValues = new Map();
    const tabSessionValues = new Map();
    globalThis.localStorage = new MemoryStorage(sharedLocalValues);
    globalThis.sessionStorage = new MemoryStorage(tabSessionValues);

    try {
        const state = await loadStateModule();
        state.setAuthToken('admin-token');
        state.setCurrentUser({ id: 1, username: 'admin' });
        state.saveUserSession();

        sharedLocalValues.set('demo_access_token_v1', 'xiayuku-token');
        sharedLocalValues.set('demo_user_v1', JSON.stringify({ id: 2, username: 'xiayuku63' }));
        sharedLocalValues.set('demo_auth_session_v2', JSON.stringify({
            token: 'xiayuku-token',
            user: { id: 2, username: 'xiayuku63' },
        }));

        state.setAuthToken('');
        state.setCurrentUser(null);
        state.loadUserSession();

        assert.equal(state.authToken, 'admin-token');
        assert.equal(state.currentUser?.username, 'admin');
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.sessionStorage = previousSessionStorage;
    }
});

test('a new tab does not inherit another tab account', async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousSessionStorage = globalThis.sessionStorage;
    const sharedLocalValues = new Map([
        ['demo_auth_session_v2', JSON.stringify({
            token: 'member-token',
            user: { id: 7, username: 'member7' },
        })],
    ]);
    const tabSessionValues = new Map();
    globalThis.localStorage = new MemoryStorage(sharedLocalValues);
    globalThis.sessionStorage = new MemoryStorage(tabSessionValues);

    try {
        const state = await loadStateModule();
        state.loadUserSession();

        assert.equal(state.authToken, '');
        assert.equal(state.currentUser, null);
        assert.equal(tabSessionValues.has('demo_auth_session_v2'), false);
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.sessionStorage = previousSessionStorage;
    }
});

test('legacy shared login storage is ignored by a new tab', async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousSessionStorage = globalThis.sessionStorage;
    const sharedLocalValues = new Map([
        ['demo_access_token_v1', 'legacy-token'],
        ['demo_user_v1', JSON.stringify({ id: 8, username: 'legacy8' })],
    ]);
    const tabSessionValues = new Map();
    globalThis.localStorage = new MemoryStorage(sharedLocalValues);
    globalThis.sessionStorage = new MemoryStorage(tabSessionValues);

    try {
        const state = await loadStateModule();
        state.loadUserSession();

        assert.equal(state.authToken, '');
        assert.equal(state.currentUser, null);
        assert.equal(tabSessionValues.has('demo_auth_session_v2'), false);
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.sessionStorage = previousSessionStorage;
    }
});

test('logout clears tab, persisted, and legacy auth storage', async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousSessionStorage = globalThis.sessionStorage;
    const sharedLocalValues = new Map();
    const tabSessionValues = new Map();
    globalThis.localStorage = new MemoryStorage(sharedLocalValues);
    globalThis.sessionStorage = new MemoryStorage(tabSessionValues);

    try {
        const state = await loadStateModule();
        state.setAuthToken('logout-token');
        state.setCurrentUser({ id: 9, username: 'logout9' });
        state.saveUserSession();
        state.clearUserSession();

        assert.equal(tabSessionValues.has('demo_auth_session_v2'), false);
        assert.equal(sharedLocalValues.has('demo_auth_session_v2'), false);
        assert.equal(sharedLocalValues.has('demo_access_token_v1'), false);
        assert.equal(sharedLocalValues.has('demo_user_v1'), false);
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.sessionStorage = previousSessionStorage;
    }
});
