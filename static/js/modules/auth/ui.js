// ── Auth UI: shared helpers, DOM init, session management, view switching ──
import {
    authToken, setAuthToken, currentUser, setCurrentUser,
    saveUserSession, clearUserSession, loadUserSession, loadSlicerPresetSelection,
    authFetch, quoteOptions,
    pendingQuoteFiles, setPendingQuoteFiles,
    selectedFilesMap, thumbnailMap, currentResults, setCurrentResults,
    saveLastUsername,
} from '../state.js';
import { fetchUserSettings, updateDropdowns } from '../settings.js';
import { fetchPrinterModels } from '../presets.js';
import { loadQuoteHistory } from '../history.js';
import { buildThumbnails } from '../preview.js';
import { quoteSelectedFiles } from '../quote.js';
import { clearClusters } from '../layface.js';
import { t } from '../i18n.js';
import { _wireLoginForm, openLoginModal, closeLoginModal } from './login.js';

// ── DOM refs (queried on init) ──
export let dom = {};

// ── Shared UI helpers ──
export function _clearFieldError(errId) {
    const el = document.getElementById(errId);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
}

export function _showFieldError(errId, msg) {
    const el = document.getElementById(errId);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

export function _showBannerError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

export function _hideBannerError() {
    const el = document.getElementById('login-error');
    if (el) el.classList.add('hidden');
}

export function _showBannerSuccess(msg) {
    const el = document.getElementById('login-success');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

export function _hideBannerSuccess() {
    const el = document.getElementById('login-success');
    if (el) el.classList.add('hidden');
}

export function _switchToView(viewId, title, subtitle) {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('reset-request-view').classList.add('hidden');
    document.getElementById('reset-confirm-view').classList.add('hidden');
    document.getElementById(viewId).classList.remove('hidden');

    const titleEl = document.getElementById('login-view-title');
    const subtitleEl = document.getElementById('login-view-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    _hideBannerError();
    _hideBannerSuccess();
}

export function initAuth(d) {
    dom = d;
    _wireLoginForm();
}

export function showLoginView() {
    _switchToView('login-view', t('auth.loginTitle'), t('auth.subtitle'));
}

// ── UI state ──
export function renderAuthUI() {
    const { openLoginBtn, openMembershipBtn, userMenu, userMenuBtn, openAdminUsersBtn, userDropdown } = dom;
    if (currentUser) {
        if (openLoginBtn) openLoginBtn.classList.add('hidden');
        if (openMembershipBtn) openMembershipBtn.classList.remove('hidden');
        if (userMenu) userMenu.classList.remove('hidden');
        if (userMenuBtn) {
            const isMember = !!currentUser.is_member;
            userMenuBtn.textContent = isMember ? currentUser.username + '（' + t('auth.memberBadge') + '）' : currentUser.username;
        }
        if (openAdminUsersBtn) {
            openAdminUsersBtn.classList.toggle('hidden', !currentUser.is_admin);
        }
    } else {
        if (openLoginBtn) openLoginBtn.classList.remove('hidden');
        if (openMembershipBtn) openMembershipBtn.classList.add('hidden');
        if (userMenu) userMenu.classList.add('hidden');
        if (userDropdown) userDropdown.classList.add('hidden');
        if (openAdminUsersBtn) openAdminUsersBtn.classList.add('hidden');
    }
    // Sync mobile navigation drawer auth state
    if (typeof window.__syncMobileNavAuthState === 'function') {
        try { window.__syncMobileNavAuthState(); } catch(e) {}
    }
}

// ── After successful login ──
export async function handleAuthSuccess(data) {
    try {
    setAuthToken(data.access_token || "");
    setCurrentUser(data.user || null);
    if (!authToken || !currentUser) throw new Error(t('auth.loginResponseInvalid'));

    try {
        const meResp = await authFetch('/api/auth/me');
        if (meResp.ok) setCurrentUser(await meResp.json());
    } catch (e) {}

    saveUserSession();
    // Remember the username for next login auto-fill
    if (data.user?.username) saveLastUsername(data.user.username);
    loadSlicerPresetSelection();
    try { renderAuthUI(); } catch(e) { _showBannerError('renderAuthUI: ' + e.message); return; }
    try {
        await fetchUserSettings();
    } catch(e) {
        console.error('fetchUserSettings ERROR:', e, e.stack);
        _showBannerError('fetchUserSettings: ' + e.message);
        return;
    }
    try {
        loadQuoteHistory(authToken);
    } catch(e) {
        console.error('loadQuoteHistory ERROR:', e.message);
    }
    await fetchPrinterModels();
    closeLoginModal();

    // Notify onboarding to check if guide should start
    window.dispatchEvent(new CustomEvent('pricer3d-auth-success'));

    const { errorContainer, fileNameDisplay } = dom;
    if (errorContainer) errorContainer.classList.add('hidden');

    const filesToQuote = pendingQuoteFiles;
    setPendingQuoteFiles(null);

    if (filesToQuote && filesToQuote.length) {
        const totalFiles = selectedFilesMap.size || filesToQuote.length;
        if (fileNameDisplay) fileNameDisplay.textContent = t('auth.postLoginProgress', {total: totalFiles, new: filesToQuote.length});
        try {
            await buildThumbnails(filesToQuote);
            await quoteSelectedFiles(filesToQuote);
            if (fileNameDisplay) fileNameDisplay.textContent = t('auth.postLoginDone', {total: selectedFilesMap.size, new: filesToQuote.length});
        } catch (err) {
            if (dom.errorMsg) { dom.errorMsg.textContent = err.message; dom.errorContainer.classList.remove('hidden'); }
            if (fileNameDisplay) fileNameDisplay.textContent = t('auth.postLoginFail', {total: selectedFilesMap.size, new: filesToQuote.length});
        }
    }
    } catch(e) {
        _showBannerError('handleAuthSuccess: ' + e.message);
        return;
    }
}

// ── Logout ──
export function handleLogout() {
    const { fileNameDisplay, errorContainer, resultContainer, layFaceBtn, userDropdown } = dom;
    setCurrentUser(null);
    setAuthToken("");
    quoteOptions.slicer_preset_id = null;
    clearUserSession();
    selectedFilesMap.clear();
    thumbnailMap.clear();
    setCurrentResults([]);
    currentResults.length = 0;

    if (dom.fileInput) dom.fileInput.value = '';
    if (fileNameDisplay) {
        fileNameDisplay.textContent = t('auth.noFileSelected');
        fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
    }
    clearClusters();
    if (layFaceBtn) layFaceBtn.textContent = t('orientation.autoOrient');
    if (resultContainer) resultContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    renderAuthUI();
    if (userDropdown) userDropdown.classList.add('hidden');
    location.reload();
}

// ── Init ──
export async function initializeAuth() {
    loadUserSession();

    // Debug mode: ?debug in URL -> auto-login as admin, no registration needed
    try {
        var dbgParams = new URLSearchParams(window.location.search || "");
        if (dbgParams.has('debug') && !authToken) {
            var dbgResp = await fetch('/api/auth/admin-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (dbgResp.ok) {
                var dbgData = await dbgResp.json();
                setAuthToken(dbgData.access_token || '');
                setCurrentUser(dbgData.user || null);
                saveUserSession();
                dbgParams.delete('debug');
                var dbgQuery = dbgParams.toString();
                var dbgNewUrl = window.location.pathname + (dbgQuery ? '?' + dbgQuery : '') + (window.location.hash || '');
                window.history.replaceState({}, '', dbgNewUrl);
            }
        }
    } catch (e) { /* debug login failed, continue as guest */ }

    try {
        const params = new URLSearchParams(window.location.search || "");
        const shouldOpenLogin = params.get('login') === '1' || (params.get('login') || '').toLowerCase() === 'true';
        if (shouldOpenLogin && !authToken) openLoginModal();
        if (params.has('login')) {
            params.delete('login');
            const query = params.toString();
            const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
            window.history.replaceState({}, '', newUrl);
        }
    } catch (e) {}

    if (!authToken) {
        renderAuthUI();
        updateDropdowns();
        await fetchPrinterModels();
    }

    try {
        const response = await authFetch('/api/auth/me');
        if (!response.ok) throw new Error(t('auth.sessionExpired'));
        const user = await response.json();
        setCurrentUser(user);
        saveUserSession();
        loadSlicerPresetSelection();
        await fetchUserSettings();
        // Re-populate printer dropdowns with user's saved defaults
        await fetchPrinterModels();
    } catch (e) {
        setCurrentUser(null);
        setAuthToken("");
        clearUserSession();
        updateDropdowns();
        await fetchPrinterModels();
    }
    renderAuthUI();
}
