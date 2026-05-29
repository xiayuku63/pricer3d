// ── Auth module: login/register/captcha/session ──
import {
    authToken, setAuthToken, currentUser, setCurrentUser,
    currentCaptchaId, currentCaptchaUrl, setCaptchaId, setCaptchaUrl,
    saveUserSession, clearUserSession, loadUserSession, loadSlicerPresetSelection,
    authFetch, quoteOptions,
    pendingQuoteFiles, setPendingQuoteFiles,
    selectedFilesMap, thumbnailMap, currentResults, setCurrentResults,
    saveLastUsername, getLastUsername,
} from './state.js';
import { fetchUserSettings, updateDropdowns } from './settings.js';
import { fetchPrinterModels, fetchSlicerPresets } from './presets.js';
import { loadQuoteHistory } from './history.js';
import { buildThumbnails, closePreviewModal } from './preview.js';
import { quoteSelectedFiles } from './quote.js';
import { clearClusters } from './layface.js';

// ── DOM refs (queried on init) ──
let dom = {};

// ── Separate captcha state for reset flow ──
let _resetCaptchaId = '';
let _resetCaptchaUrl = '';
let _resetCodeTimer = null;  // countdown timer for resend button

export function initAuth(d) {
    dom = d;
    _wireLoginForm();
}

// ── Wire login form interactivity ──
function _wireLoginForm() {
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

    // Reset request captcha
    const resetCaptchaImg = document.getElementById('reset-request-captcha-img');
    if (resetCaptchaImg) resetCaptchaImg.addEventListener('click', _refreshResetCaptcha);

    const resetRequestSubmit = document.getElementById('reset-request-submit-btn');
    if (resetRequestSubmit) resetRequestSubmit.addEventListener('click', handleResetRequest);

    // Reset confirm
    const resetConfirmSubmit = document.getElementById('reset-confirm-submit-btn');
    if (resetConfirmSubmit) resetConfirmSubmit.addEventListener('click', handleResetConfirm);

    // Reset view enter key handlers
    _wireResetEnterKeys();
}

function _wireResetEnterKeys() {
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

function _clearFieldError(errId) {
    const el = document.getElementById(errId);
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
}

function _showFieldError(errId, msg) {
    const el = document.getElementById(errId);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

// ── View switching ──
function _switchToView(viewId, title, subtitle) {
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

export function showLoginView() {
    _switchToView('login-view', '登录 Pricer3D', '3D 打印自动报价系统');
}

export function showResetRequestView() {
    _switchToView('reset-request-view', '重置密码', '3D 打印自动报价系统');
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
    _switchToView('reset-confirm-view', '设置新密码', '3D 打印自动报价系统');
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

// ── Captcha ──
export async function refreshLoginCaptcha() {
    const { loginCaptchaImg, loginCaptchaCode } = dom;
    try {
        const res = await fetch('/api/auth/captcha', { method: 'GET' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '验证码获取失败');
        setCaptchaId(data.captcha_id || "");
        setCaptchaUrl(data.image_url || "");
        const fallbackDataUrl = data.image_data_url || "";
        if (loginCaptchaImg) {
            if (currentCaptchaUrl) loginCaptchaImg.src = `${currentCaptchaUrl}?t=${Date.now()}`;
            else if (fallbackDataUrl) loginCaptchaImg.src = fallbackDataUrl;
            else loginCaptchaImg.removeAttribute('src');
        }
        if (loginCaptchaCode) loginCaptchaCode.value = "";
        _clearFieldError('login-captcha-err');
    } catch (e) {
        setCaptchaId(""); setCaptchaUrl("");
        if (loginCaptchaImg) loginCaptchaImg.removeAttribute('src');
        _showBannerError('验证码加载失败，请点击验证码图片重试');
    }
}

async function _refreshResetCaptcha() {
    const img = document.getElementById('reset-request-captcha-img');
    const codeEl = document.getElementById('reset-request-captcha');
    try {
        const res = await fetch('/api/auth/captcha', { method: 'GET' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '验证码获取失败');
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
        _showBannerError('验证码加载失败，请点击刷新');
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
        btn.textContent = m > 0 ? m + '分' + s + '秒后重发' : s + '秒后重发';
        seconds--;
    }
    tick();
    _resetCodeTimer = setInterval(tick, 1000);
}

// ── Modal ──
let _loginSubmitting = false;

export function openLoginModal() {
    const { loginError, loginModal, loginPassword, loginCaptchaCode, loginAcceptLegal } = dom;
    _loginSubmitting = false;
    if (loginError) { loginError.classList.add('hidden'); loginError.textContent = ''; }
    if (loginPassword) loginPassword.value = '';
    if (loginCaptchaCode) loginCaptchaCode.value = '';
    if (loginAcceptLegal) loginAcceptLegal.checked = false;
    _clearFieldError('login-username-err');
    _clearFieldError('login-password-err');
    _clearFieldError('login-captcha-err');
    const btn = document.getElementById('login-submit-btn');
    if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
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

export function closeLoginModal() {
    if (dom.loginModal) dom.loginModal.classList.add('hidden');
    _loginSubmitting = false;
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
            userMenuBtn.textContent = isMember ? `${currentUser.username}（会员）` : `${currentUser.username}`;
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
}

// ── Validation: Login ──
function validateLoginForm() {
    const { loginUsername, loginPassword, loginCaptchaCode, loginAcceptLegal } = dom;
    let valid = true;

    const identifier = (loginUsername?.value || '').trim();
    if (!identifier) {
        _showFieldError('login-username-err', '请输入账号');
        valid = false;
    }

    const password = loginPassword?.value || '';
    if (!password) {
        _showFieldError('login-password-err', '请输入密码');
        valid = false;
    } else if (password.length < 6) {
        _showFieldError('login-password-err', '密码至少 6 位');
        valid = false;
    }

    const captchaCode = (loginCaptchaCode?.value || '').trim();
    if (!captchaCode) {
        _showFieldError('login-captcha-err', '请输入验证码');
        valid = false;
    }

    if (!(loginAcceptLegal && loginAcceptLegal.checked)) {
        _showBannerError('请先阅读并同意《用户协议》和《隐私政策》');
        valid = false;
    }

    if (!currentCaptchaId) {
        _showFieldError('login-captcha-err', '验证码已失效，已自动刷新');
        refreshLoginCaptcha();
        valid = false;
    }

    return valid;
}

// ── Error / Success display ──
function _showBannerError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}
function _hideBannerError() {
    const el = document.getElementById('login-error');
    if (el) el.classList.add('hidden');
}
function _showBannerSuccess(msg) {
    const el = document.getElementById('login-success');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}
function _hideBannerSuccess() {
    const el = document.getElementById('login-success');
    if (el) el.classList.add('hidden');
}

// ── Login submit ──
export async function handleLoginSubmit() {
    if (_loginSubmitting) return;
    _hideBannerError();
    if (!validateLoginForm()) return;

    const { loginUsername, loginPassword, loginCaptchaCode, loginSubmitBtn } = dom;
    const identifier = (loginUsername?.value || '').trim();
    const password = loginPassword?.value || '';
    const captchaCode = (loginCaptchaCode?.value || '').trim();

    _loginSubmitting = true;
    if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = '登录中...';
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
        if (!response.ok) throw new Error(data.detail || '登录失败');
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
        _showBannerError(err.message || '登录失败，请重试');
        await refreshLoginCaptcha();
    } finally {
        _loginSubmitting = false;
        if (loginSubmitBtn) {
            loginSubmitBtn.disabled = false;
            loginSubmitBtn.textContent = '登 录';
        }
    }
}

// ── Forgot Password: Step 1 — request reset code ──
async function handleResetRequest() {
    _hideBannerError();
    _hideBannerSuccess();

    const emailEl = document.getElementById('reset-email');
    const captchaEl = document.getElementById('reset-request-captcha');
    const submitBtn = document.getElementById('reset-request-submit-btn');

    const email = (emailEl?.value || '').trim();
    const captcha = (captchaEl?.value || '').trim();

    let valid = true;
    if (!email) { _showFieldError('reset-email-err', '请输入邮箱'); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _showFieldError('reset-email-err', '邮箱格式不正确'); valid = false; }
    if (!captcha) { _showFieldError('reset-request-captcha-err', '请输入验证码'); valid = false; }
    if (!_resetCaptchaId) { _showFieldError('reset-request-captcha-err', '验证码已失效，已自动刷新'); _refreshResetCaptcha(); valid = false; }
    if (!valid) return;

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '发送中...'; }

    try {
        const response = await fetch('/api/auth/password/reset/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email, captcha_id: _resetCaptchaId, captcha_code: captcha,
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '请求失败');

        // Check for dev code (when email sending isn't configured)
        if (data.dev_code) {
            showResetConfirmView(email);
            _showBannerSuccess(`验证码：${data.dev_code}（开发模式，邮件未发送）`);
        } else {
            showResetConfirmView(email);
            _showBannerSuccess('验证码已发送至您的邮箱，请查收');
        }
        // Start countdown on the send button
        var seconds = (data.expires_in && data.expires_in > 0) ? data.expires_in : 600;
        _startResetCodeCountdown(submitBtn, seconds);
    } catch (err) {
        _showBannerError(err.message || '请求失败，请重试');
        _refreshResetCaptcha();
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '发送验证码'; }
    }
}

// ── Forgot Password: Step 2 — confirm reset ──
async function handleResetConfirm() {
    _hideBannerError();
    _hideBannerSuccess();

    const codeEl = document.getElementById('reset-code');
    const pwEl = document.getElementById('reset-new-password');
    const submitBtn = document.getElementById('reset-confirm-submit-btn');

    const code = (codeEl?.value || '').trim();
    const newPassword = pwEl?.value || '';

    let valid = true;
    if (!code) { _showFieldError('reset-code-err', '请输入验证码'); valid = false; }
    if (!newPassword) { _showFieldError('reset-new-password-err', '请输入新密码'); valid = false; }
    else if (newPassword.length < 6 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        _showFieldError('reset-new-password-err', '密码至少 6 位且包含字母和数字');
        valid = false;
    }
    if (!valid) return;

    const email = document.getElementById('reset-confirm-email-display')?.textContent || '';

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '重置中...'; }

    try {
        const response = await fetch('/api/auth/password/reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, new_password: newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '重置失败');

        showLoginView();
        _showBannerSuccess('密码重置成功，请使用新密码登录');
        const pwInput = document.getElementById('login-password');
        if (pwInput) { pwInput.value = ''; pwInput.focus(); }
    } catch (err) {
        _showBannerError(err.message || '重置失败，请重试');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '确认重置密码'; }
    }
}

// ── After successful login ──
export async function handleAuthSuccess(data) {
    setAuthToken(data.access_token || "");
    setCurrentUser(data.user || null);
    if (!authToken || !currentUser) throw new Error('登录响应无效，请重试');

    try {
        const meResp = await authFetch('/api/auth/me');
        if (meResp.ok) setCurrentUser(await meResp.json());
    } catch (e) {}

    saveUserSession();
    // Remember the username for next login auto-fill
    if (data.user?.username) saveLastUsername(data.user.username);
    loadSlicerPresetSelection();
    renderAuthUI();
    await fetchUserSettings();
    loadQuoteHistory(authToken);
    fetchPrinterModels();
    closeLoginModal();

    const { errorContainer, fileNameDisplay } = dom;
    if (errorContainer) errorContainer.classList.add('hidden');

    const filesToQuote = pendingQuoteFiles;
    setPendingQuoteFiles(null);

    if (filesToQuote && filesToQuote.length) {
        const totalFiles = selectedFilesMap.size || filesToQuote.length;
        if (fileNameDisplay) fileNameDisplay.textContent = `当前列表共 ${totalFiles} 个文件，正在为新增 ${filesToQuote.length} 个文件生成静态图与自动报价...`;
        try {
            await buildThumbnails(filesToQuote);
            await quoteSelectedFiles(filesToQuote);
            if (fileNameDisplay) fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${filesToQuote.length} 个文件报价完成`;
        } catch (err) {
            if (dom.errorMsg) { dom.errorMsg.textContent = err.message; dom.errorContainer.classList.remove('hidden'); }
            if (fileNameDisplay) fileNameDisplay.textContent = `当前列表共 ${selectedFilesMap.size} 个文件，新增 ${filesToQuote.length} 个文件自动报价失败`;
        }
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
        fileNameDisplay.textContent = '未选择文件（最多20个，单文件需小于100MB）';
        fileNameDisplay.classList.remove('text-indigo-600', 'font-medium');
    }
    clearClusters();
    if (layFaceBtn) layFaceBtn.textContent = '🎯 智能摆放 (Lay on Face)';
    if (resultContainer) resultContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    renderAuthUI();
    if (userDropdown) userDropdown.classList.add('hidden');
    location.reload();
}

// ── Init ──
export async function initializeAuth() {
    loadUserSession();
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
    }

    try {
        const response = await authFetch('/api/auth/me');
        if (!response.ok) throw new Error('会话已失效');
        const user = await response.json();
        setCurrentUser(user);
        saveUserSession();
        loadSlicerPresetSelection();
        await fetchUserSettings();
        // Re-populate printer dropdowns with user's saved defaults
        fetchPrinterModels();
    } catch (e) {
        setCurrentUser(null);
        setAuthToken("");
        clearUserSession();
        updateDropdowns();
    }
    renderAuthUI();
}
