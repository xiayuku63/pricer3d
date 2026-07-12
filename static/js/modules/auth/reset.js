// ── Auth Reset: password reset flow ──
import { t } from '../i18n.js';
import {
    _clearFieldError, _showFieldError, _showBannerError, _hideBannerError,
    _showBannerSuccess, _hideBannerSuccess, _switchToView, showLoginView,
} from './ui.js';

// ── Separate captcha state for reset flow ──
let _resetCaptchaId = '';
let _resetCaptchaUrl = '';
let _resetCodeTimer = null;  // countdown timer for resend button

export function showResetRequestView() {
    _switchToView('reset-request-view', t('auth.resetPassword'), t('auth.subtitle'));
    const emailEl = document.getElementById('reset-email');
    if (emailEl) emailEl.value = '';
    const captchaEl = document.getElementById('reset-request-captcha');
    if (captchaEl) captchaEl.value = '';
    _clearFieldError('reset-email-err');
    _clearFieldError('reset-request-captcha-err');
    _refreshResetCaptcha();
    setTimeout(() => { if (emailEl) emailEl.focus(); }, 100);
}

export function showResetConfirmView(email) {
    _switchToView('reset-confirm-view', t('auth.setNewPassword'), t('auth.subtitle'));
    const display = document.getElementById('reset-confirm-email-display');
    if (display) display.textContent = email;
    const codeEl = document.getElementById('reset-code');
    if (codeEl) codeEl.value = '';
    const pwEl = document.getElementById('reset-new-password');
    if (pwEl) pwEl.value = '';
    _clearFieldError('reset-code-err');
    _clearFieldError('reset-new-password-err');
    setTimeout(() => { if (codeEl) codeEl.focus(); }, 100);
}

// ── Reset captcha ──
async function _refreshResetCaptcha() {
    const img = document.getElementById('reset-request-captcha-img');
    const codeEl = document.getElementById('reset-request-captcha');
    try {
        const res = await fetch('/api/auth/captcha', { method: 'GET' });
        const data = await res.json();
        if (!res.ok) throw new Error((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('auth.codeSendError'));
        _resetCaptchaId = data.captcha_id || "";
        _resetCaptchaUrl = data.image_url || "";
        const fallbackDataUrl = data.image_data_url || "";
        if (img) {
            if (_resetCaptchaUrl) img.src = `${_resetCaptchaUrl}?t=${Date.now()}`;
            else if (fallbackDataUrl) img.src = fallbackDataUrl;
            else img.removeAttribute('src');
        }
        if (codeEl) codeEl.value = "";
        _clearFieldError('reset-request-captcha-err');
    } catch (e) {
        _resetCaptchaId = ""; _resetCaptchaUrl = "";
        if (img) img.removeAttribute('src');
        _showBannerError(t('auth.captchaLoadError'));
    }
}

// ── Reset code countdown ──
function _startResetCodeCountdown(btn, seconds) {
    var origText = btn.textContent;
    if (_resetCodeTimer) clearInterval(_resetCodeTimer);
    btn.disabled = true;

    function tick() {
        if (seconds <= 0) {
            clearInterval(_resetCodeTimer);
            _resetCodeTimer = null;
            btn.disabled = false;
            btn.textContent = origText;
            return;
        }
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        btn.textContent = m > 0 ? t('auth.resendInMin', {minutes: m, seconds: s}) : t('auth.resendIn', {seconds: s});
        seconds--;
    }
    tick();
    _resetCodeTimer = setInterval(tick, 1000);
}

// ── Wire reset enter keys ──
export function _wireResetEnterKeys() {
    const resetEmail = document.getElementById('reset-email');
    const resetReqCaptcha = document.getElementById('reset-request-captcha');
    const resetCode = document.getElementById('reset-code');
    const resetNewPw = document.getElementById('reset-new-password');

    [resetEmail, resetReqCaptcha].filter(Boolean).forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('reset-request-view').classList.contains('hidden')) {
                e.preventDefault();
                handleResetRequest();
            }
        });
    });

    [resetCode, resetNewPw].filter(Boolean).forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('reset-confirm-view').classList.contains('hidden')) {
                e.preventDefault();
                handleResetConfirm();
            }
        });
    });
}

// ── Reset request captcha wiring (called from login.js _wireLoginForm) ──
export function _wireResetRequestCaptcha() {
    const resetCaptchaImg = document.getElementById('reset-request-captcha-img');
    if (resetCaptchaImg) resetCaptchaImg.addEventListener('click', _refreshResetCaptcha);

    const resetRequestSubmit = document.getElementById('reset-request-submit-btn');
    if (resetRequestSubmit) resetRequestSubmit.addEventListener('click', handleResetRequest);

    const resetConfirmSubmit = document.getElementById('reset-confirm-submit-btn');
    if (resetConfirmSubmit) resetConfirmSubmit.addEventListener('click', handleResetConfirm);
}

// ── Forgot Password: Step 1 — request reset code ──
export async function handleResetRequest() {
    _hideBannerError();
    _hideBannerSuccess();

    const emailEl = document.getElementById('reset-email');
    const captchaEl = document.getElementById('reset-request-captcha');
    const submitBtn = document.getElementById('reset-request-submit-btn');

    const email = (emailEl?.value || '').trim();
    const captcha = (captchaEl?.value || '').trim();

    let valid = true;
    if (!email) { _showFieldError('reset-email-err', t('auth.enterEmail')); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _showFieldError('reset-email-err', t('auth.invalidEmail')); valid = false; }
    if (!captcha) { _showFieldError('reset-request-captcha-err', t('auth.enterCaptcha')); valid = false; }
    if (!_resetCaptchaId) { _showFieldError('reset-request-captcha-err', t('auth.captchaExpired')); _refreshResetCaptcha(); valid = false; }
    if (!valid) return;

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = t('common.loading'); }

    try {
        const response = await fetch('/api/auth/password/reset/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email, captcha_id: _resetCaptchaId, captcha_code: captcha,
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('auth.requestFailed'));

        // Check for dev code (when email sending isn't configured)
        if (data.dev_code) {
            showResetConfirmView(email);
            _showBannerSuccess(t('auth.devCodeNotice', {code: data.dev_code}));
        } else {
            showResetConfirmView(email);
            _showBannerSuccess(t('auth.codeSent'));
        }
        // Start countdown on the send button
        var seconds = (data.expires_in && data.expires_in > 0) ? data.expires_in : 600;
        _startResetCodeCountdown(submitBtn, seconds);
    } catch (err) {
        _showBannerError(err.message || t('auth.requestFailed'));
        _refreshResetCaptcha();
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = t('auth.sendCode'); }
    }
}

// ── Forgot Password: Step 2 — confirm reset ──
export async function handleResetConfirm() {
    _hideBannerError();
    _hideBannerSuccess();

    const codeEl = document.getElementById('reset-code');
    const pwEl = document.getElementById('reset-new-password');
    const submitBtn = document.getElementById('reset-confirm-submit-btn');

    const code = (codeEl?.value || '').trim();
    const newPassword = pwEl?.value || '';

    let valid = true;
    if (!code) { _showFieldError('reset-code-err', t('auth.enterCaptcha')); valid = false; }
    if (!newPassword) { _showFieldError('reset-new-password-err', t('auth.enterNewPassword')); valid = false; }
    else if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        _showFieldError('reset-new-password-err', t('auth.passwordRequirements'));
        valid = false;
    }
    if (!valid) return;

    const email = document.getElementById('reset-confirm-email-display')?.textContent || '';

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = t('common.loading'); }

    try {
        const response = await fetch('/api/auth/password/reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, new_password: newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('auth.resetFailed'));

        showLoginView();
        _showBannerSuccess(t('auth.resetSuccess'));
        const pwInput = document.getElementById('login-password');
        if (pwInput) { pwInput.value = ''; pwInput.focus(); }
    } catch (err) {
        _showBannerError(err.message || t('auth.resetFailed'));
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = t('auth.confirmResetPassword'); }
    }
}
