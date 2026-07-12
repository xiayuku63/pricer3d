// ── Auth Login: login form, captcha, modal ──
import {
    authToken, currentUser, setCurrentUser,
    currentCaptchaId, currentCaptchaUrl, setCaptchaId, setCaptchaUrl,
    saveUserSession, getLastUsername,
} from '../state.js';
import { t } from '../i18n.js';
import {
    _clearFieldError, _showFieldError, _showBannerError, _hideBannerError,
    _hideBannerSuccess, showLoginView, handleAuthSuccess,
} from './ui.js';
import { _wireResetEnterKeys, showResetRequestView, _wireResetRequestCaptcha } from './reset.js';

// ── Modal ──
let _loginSubmitting = false;

// ── Wire login form interactivity ──
export function _wireLoginForm(dom) {
    const { loginUsername, loginPassword, loginCaptchaCode, loginCaptchaImg,
            loginAcceptLegal, loginSubmitBtn, loginModal, loginBackdrop } = dom;

    // Click captcha to refresh
    if (loginCaptchaImg) {
        loginCaptchaImg.addEventListener('click', refreshLoginCaptcha);
    }

    // Backdrop click to close
    if (loginBackdrop) {
        loginBackdrop.addEventListener('click', closeLoginModal);
    }

    // Escape key to close
    if (loginModal) {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !loginModal.classList.contains('hidden')) {
                closeLoginModal();
            }
        });
    }

    // Enter key to submit (login view)
    const inputs = [loginUsername, loginPassword, loginCaptchaCode].filter(Boolean);
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('login-view').classList.contains('hidden')) {
                e.preventDefault();
                handleLoginSubmit();
            }
        });
    });

    // Real-time clear field errors on input
    if (loginUsername) loginUsername.addEventListener('input', () => _clearFieldError('login-username-err'));
    if (loginPassword) loginPassword.addEventListener('input', () => _clearFieldError('login-password-err'));
    if (loginCaptchaCode) loginCaptchaCode.addEventListener('input', () => _clearFieldError('login-captcha-err'));

    // Submit button
    if (loginSubmitBtn) loginSubmitBtn.addEventListener('click', handleLoginSubmit);

    // Prevent native form submission (triggers password manager detection)
    const loginForm = document.getElementById('login-view');
    if (loginForm) loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLoginSubmit();
    });

    // ── Forgot password flow ──
    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) forgotLink.addEventListener('click', showResetRequestView);

    const backToLogin1 = document.getElementById('reset-back-to-login');
    if (backToLogin1) backToLogin1.addEventListener('click', showLoginView);

    const backToLogin2 = document.getElementById('reset-confirm-back');
    if (backToLogin2) backToLogin2.addEventListener('click', showLoginView);

    // Reset request captcha & submit buttons
    _wireResetRequestCaptcha();

    // Reset view enter key handlers
    _wireResetEnterKeys();
}

// ── Captcha ──
export async function refreshLoginCaptcha() {
    const el = document.getElementById('login-captcha-img');
    const codeEl = document.getElementById('login-captcha-code');
    try {
        const res = await fetch('/api/auth/captcha', { method: 'GET' });
        const data = await res.json();
        if (!res.ok) throw new Error((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('auth.codeSendError'));
        setCaptchaId(data.captcha_id || "");
        setCaptchaUrl(data.image_url || "");
        const fallbackDataUrl = data.image_data_url || "";
        if (el) {
            if (currentCaptchaUrl) el.src = `${currentCaptchaUrl}?t=${Date.now()}`;
            else if (fallbackDataUrl) el.src = fallbackDataUrl;
            else el.removeAttribute('src');
        }
        if (codeEl) codeEl.value = "";
        _clearFieldError('login-captcha-err');
    } catch (e) {
        setCaptchaId(""); setCaptchaUrl("");
        if (el) el.removeAttribute('src');
        _showBannerError(t('auth.captchaLoadError'));
    }
}

// ── Modal ──
export function openLoginModal(dom) {
    const { loginError, loginPassword, loginCaptchaCode, loginAcceptLegal }
        = _getDomRefs('login-error', 'login-password', 'login-captcha-code', 'login-accept-legal');
    const loginModal = dom?.loginModal || document.getElementById('login-modal');
    _loginSubmitting = false;
    if (loginError) { loginError.classList.add('hidden'); loginError.textContent = ''; }
    if (loginPassword) loginPassword.value = '';
    if (loginCaptchaCode) loginCaptchaCode.value = '';
    if (loginAcceptLegal) loginAcceptLegal.checked = false;
    _clearFieldError('login-username-err');
    _clearFieldError('login-password-err');
    _clearFieldError('login-captcha-err');
    const btn = document.getElementById('login-submit-btn');
    if (btn) { btn.disabled = false; btn.textContent = t('auth.login'); }
    showLoginView();
    _hideBannerSuccess();
    if (loginModal) loginModal.classList.remove('hidden');
    // Auto-fill last used username
    const usernameEl = document.getElementById('login-username');
    const saved = getLastUsername();
    if (usernameEl && saved && !usernameEl.value) usernameEl.value = saved;
    if (usernameEl) setTimeout(() => { usernameEl.focus(); usernameEl.select(); }, 100);
    refreshLoginCaptcha();
}

export function closeLoginModal(dom) {
    const el = document.getElementById('login-modal');
    if (el) el.classList.add('hidden');
    _loginSubmitting = false;
}

// ── DOM helpers: get refs by id to avoid circular dep on ui.js dom ──
function _getDomRefs(...ids) {
    const refs = {};
    for (const id of ids) {
        refs[id.replace(/-./g, s => s[1].toUpperCase())] = document.getElementById(id);
    }
    return refs;
}

// ── Validation: Login ──
function validateLoginForm() {
    const { loginUsername, loginPassword, loginCaptchaCode, loginAcceptLegal }
        = _getDomRefs('login-username', 'login-password', 'login-captcha-code', 'login-accept-legal');
    let valid = true;

    const identifier = (loginUsername?.value || '').trim();
    if (!identifier) {
        _showFieldError('login-username-err', t('auth.enterUsername'));
        valid = false;
    }

    const password = loginPassword?.value || '';
    if (!password) {
        _showFieldError('login-password-err', t('auth.enterPassword'));
        valid = false;
    } else if (password.length < 6) {
        _showFieldError('login-password-err', t('auth.passwordMinLength'));
        valid = false;
    }

    const captchaCode = (loginCaptchaCode?.value || '').trim();
    if (!captchaCode) {
        _showFieldError('login-captcha-err', t('auth.enterCaptcha'));
        valid = false;
    }

    if (!(loginAcceptLegal && loginAcceptLegal.checked)) {
        _showBannerError(t('auth.agreeTermsRequired'));
        valid = false;
    }

    if (!currentCaptchaId) {
        _showFieldError('login-captcha-err', t('auth.captchaExpired'));
        refreshLoginCaptcha();
        valid = false;
    }

    return valid;
}

// ── Login submit ──
export async function handleLoginSubmit() {
    if (_loginSubmitting) return;
    _hideBannerError();
    if (!validateLoginForm()) return;

    const { loginUsername, loginPassword, loginCaptchaCode, loginSubmitBtn }
        = _getDomRefs('login-username', 'login-password', 'login-captcha-code', 'login-submit-btn');
    const identifier = (loginUsername?.value || '').trim();
    const password = loginPassword?.value || '';
    const captchaCode = (loginCaptchaCode?.value || '').trim();

    _loginSubmitting = true;
    if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = t('common.loading');
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier, password,
                captcha_id: currentCaptchaId, captcha_code: captchaCode,
                accept_terms: true, accept_privacy: true,
                remember_me: document.getElementById('login-remember-me')?.checked ?? true,
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('auth.loginFailed'));
        await handleAuthSuccess(data);
        // Tell browser password manager to save credentials
        try {
            if (window.PasswordCredential && navigator.credentials) {
                const cred = new PasswordCredential({
                    id: identifier,
                    password: password,
                    name: (data.user && data.user.username) || identifier,
                });
                await navigator.credentials.store(cred);
            }
        } catch (_) { /* password manager not available */ }
    } catch (err) {
        _showBannerError(err.message || t('auth.loginFailed'));
        await refreshLoginCaptcha();
    } finally {
        _loginSubmitting = false;
        if (loginSubmitBtn) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = t('auth.login');
        }
    }
}
