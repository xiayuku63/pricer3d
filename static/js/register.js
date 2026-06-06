// register.js — Multi-step registration with real-time validation,
// password strength meter, and email verification status display.

const TOKEN_STORAGE_KEY = "demo_access_token_v1";
const USER_STORAGE_KEY = "demo_user_v1";

// ── DOM Elements ──
const usernameEl = document.getElementById('reg-username');
const channelEmailBtn = document.getElementById('reg-channel-email');
const channelPhoneBtn = document.getElementById('reg-channel-phone');
const emailSection = document.getElementById('reg-email-section');
const phoneSection = document.getElementById('reg-phone-section');
const emailEl = document.getElementById('reg-email');
const phoneEl = document.getElementById('reg-phone');
const passwordEl = document.getElementById('reg-password');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeOpen = document.getElementById('eye-open');
const eyeClosed = document.getElementById('eye-closed');
const emailCodeEl = document.getElementById('reg-email-code');
const phoneCodeEl = document.getElementById('reg-phone-code');
const usernameCheckEl = document.getElementById('reg-username-check');
const emailCheckEl = document.getElementById('reg-email-check');
const phoneCheckEl = document.getElementById('reg-phone-check');
const captchaImgEl = document.getElementById('reg-captcha-img');
const captchaCodeEl = document.getElementById('reg-captcha-code');
const refreshCaptchaBtn = document.getElementById('reg-captcha-refresh-btn');
const sendEmailBtn = document.getElementById('send-email-code-btn');
const sendPhoneBtn = document.getElementById('send-phone-code-btn');
const submitBtn = document.getElementById('reg-submit-btn');
const acceptLegalEl = document.getElementById('reg-accept-legal');
const msgEl = document.getElementById('reg-msg');
const usernameIconEl = document.getElementById('username-icon');

// Step elements
const step1Panel = document.getElementById('step-1-panel');
const step2Panel = document.getElementById('step-2-panel');
const step3Panel = document.getElementById('step-3-panel');
const step1NextBtn = document.getElementById('step1-next-btn');
const step2NextBtn = document.getElementById('step2-next-btn');
const step2BackBtn = document.getElementById('step2-back-btn');
const step3BackBtn = document.getElementById('step3-back-btn');
const step1Msg = document.getElementById('reg-step1-msg');
const step2Msg = document.getElementById('reg-step2-msg');
const step3Msg = document.getElementById('reg-step3-msg');

// Password strength elements
const strengthContainer = document.getElementById('password-strength-container');
const strengthSegments = [
    document.getElementById('str-seg-1'),
    document.getElementById('str-seg-2'),
    document.getElementById('str-seg-3'),
    document.getElementById('str-seg-4'),
];
const strengthTextEl = document.getElementById('password-strength-text');
const passwordHintEl = document.getElementById('password-hint');

// Step 2 display elements
const verifyTargetDisplay = document.getElementById('verify-target-display');
const emailStatusDisplay = document.getElementById('email-status-display');
const verifyEmailSection = document.getElementById('verify-email-section');
const verifyPhoneSection = document.getElementById('verify-phone-section');
const verifyCodeHint = document.getElementById('verify-code-hint');

// Step 3 summary elements
const summaryUsername = document.getElementById('summary-username');
const summaryChannel = document.getElementById('summary-channel');
const summaryVerified = document.getElementById('summary-verified');

// Step indicator elements
const stepCircles = [
    document.getElementById('step-circle-1'),
    document.getElementById('step-circle-2'),
    document.getElementById('step-circle-3'),
];
const stepLabels = [
    document.getElementById('step-label-1'),
    document.getElementById('step-label-2'),
    document.getElementById('step-label-3'),
];
const stepLines = [
    document.getElementById('step-line-1'),
    document.getElementById('step-line-2'),
];

// ── State ──
let captchaId = "";
let captchaUrl = "";
let registerChannel = "email";
let usernameExists = false;
let emailExists = false;
let phoneExists = false;
let usernameTimer = null;
let emailTimer = null;
let phoneTimer = null;
let verifyCodeTimer = null;
let currentStep = 1;
let emailVerified = false;
let phoneVerified = false;

// ── SVG Icons ──
const iconCheck = '<svg class="w-[18px] h-[18px] text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>';
const iconX = '<svg class="w-[18px] h-[18px] text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>';
const iconSpinner = '<svg class="w-[18px] h-[18px] text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>';

// ── Utilities ──

function apiErrorMsg(data) {
    return data.message || data.detail || '操作失败';
}

function showMsg(text, type = "error", targetEl = null) {
    const el = targetEl || msgEl;
    el.innerHTML = '';
    // Add icon prefix
    const icon = type === 'ok'
        ? '<svg class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
        : '<svg class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    el.innerHTML = icon + text;
    el.className = type === "ok" ? "text-xs text-green-600 flex items-start gap-0.5" : "text-xs text-red-600 flex items-start gap-0.5";
    el.classList.remove('hidden');
}

function clearMsg(targetEl = null) {
    const el = targetEl || msgEl;
    el.classList.add('hidden');
    el.textContent = "";
}

function clearAllMsgs() {
    clearMsg();
    clearMsg(step1Msg);
    clearMsg(step2Msg);
    clearMsg(step3Msg);
}

function clearDuplicateErrorMsg() {
    const text = (msgEl.textContent || '').trim();
    if (text.includes('已被注册')) {
        clearMsg();
    }
}

function setCheckHint(el, text, type = "neutral") {
    if (!el) return;
    if (!text) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = text;
    if (type === "ok") {
        el.className = "text-xs mt-1 text-green-600";
    } else if (type === "error") {
        el.className = "text-xs mt-1 text-red-600";
    } else if (type === "loading") {
        el.className = "text-xs mt-1 text-gray-400";
    } else {
        el.className = "text-xs mt-1 text-gray-500";
    }
    el.classList.remove('hidden');
}

function setValidationIcon(el, state) {
    if (!el) return;
    if (state === 'ok') {
        el.innerHTML = iconCheck;
        el.classList.add('visible');
    } else if (state === 'error') {
        el.innerHTML = iconX;
        el.classList.add('visible');
    } else if (state === 'loading') {
        el.innerHTML = iconSpinner;
        el.classList.add('visible');
    } else {
        el.innerHTML = '';
        el.classList.remove('visible');
    }
}

// ── Step Navigation ──

function updateStepIndicator(step) {
    for (let i = 0; i < 3; i++) {
        const circle = stepCircles[i];
        const label = stepLabels[i];
        circle.classList.remove('active', 'completed');
        label.classList.remove('active', 'completed');
        if (i + 1 < step) {
            circle.classList.add('completed');
            circle.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>';
            label.classList.add('completed');
        } else if (i + 1 === step) {
            circle.classList.add('active');
            circle.textContent = i + 1;
            label.classList.add('active');
        } else {
            circle.textContent = i + 1;
        }
    }
    for (let i = 0; i < 2; i++) {
        stepLines[i].classList.toggle('completed', i + 1 < step);
    }
}

function goToStep(step) {
    currentStep = step;
    step1Panel.classList.toggle('hidden', step !== 1);
    step2Panel.classList.toggle('hidden', step !== 2);
    step3Panel.classList.toggle('hidden', step !== 3);
    updateStepIndicator(step);

    if (step === 2) {
        // Update verification target display
        if (registerChannel === 'email') {
            verifyTargetDisplay.textContent = emailEl.value.trim();
            verifyEmailSection.classList.remove('hidden');
            verifyPhoneSection.classList.add('hidden');
            updateEmailStatusBadge('idle');
        } else {
            verifyTargetDisplay.textContent = phoneEl.value.trim();
            verifyEmailSection.classList.add('hidden');
            verifyPhoneSection.classList.remove('hidden');
        }
    }

    if (step === 3) {
        // Update summary
        summaryUsername.textContent = usernameEl.value.trim();
        if (registerChannel === 'email') {
            summaryChannel.textContent = '📧 ' + emailEl.value.trim();
        } else {
            summaryChannel.textContent = '📱 ' + phoneEl.value.trim();
        }
        // Load fresh captcha for step 3
        refreshCaptcha();
    }

    // Scroll to top of form
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Email Status Badge ──

function updateEmailStatusBadge(status) {
    let html = '';
    if (status === 'sending') {
        html = '<span class="email-status-badge email-status-sent">⏳ 发送中...</span>';
    } else if (status === 'sent') {
        html = '<span class="email-status-badge email-status-sent">✉️ 已发送</span>';
    } else if (status === 'verified') {
        html = '<span class="email-status-badge email-status-verified">✓ 已验证</span>';
    } else if (status === 'expired') {
        html = '<span class="email-status-badge email-status-expired">⏰ 已过期</span>';
    } else if (status === 'error') {
        html = '<span class="email-status-badge email-status-expired">✗ 发送失败</span>';
    }
    emailStatusDisplay.innerHTML = html;
}

// ── Password Strength ──

function calculatePasswordStrength(pw) {
    let score = 0;
    if (!pw) return { score: 0, label: '', color: '' };

    // Length
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;

    // Character variety
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    // Map score to level (0-4)
    let level, label, color;
    if (score <= 1) {
        level = 1; label = '弱'; color = 'weak';
    } else if (score <= 2) {
        level = 2; label = '一般'; color = 'medium';
    } else if (score <= 3) {
        level = 3; label = '良好'; color = 'medium';
    } else {
        level = 4; label = '强'; color = 'strong';
    }

    return { score: level, label, color };
}

function updatePasswordStrength(pw) {
    if (!pw) {
        strengthContainer.classList.add('hidden');
        return;
    }
    strengthContainer.classList.remove('hidden');
    const { score, label, color } = calculatePasswordStrength(pw);

    for (let i = 0; i < 4; i++) {
        strengthSegments[i].className = 'strength-segment';
        if (i < score) {
            strengthSegments[i].classList.add('filled-' + color);
        }
    }

    const colorMap = { weak: 'text-red-500', medium: 'text-amber-500', strong: 'text-green-500' };
    strengthTextEl.className = 'text-xs font-medium ' + (colorMap[color] || '');
    strengthTextEl.textContent = '密码强度：' + label;

    // Hints
    let hints = [];
    if (pw.length < 8) hints.push('至少8位');
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) hints.push('大小写混合');
    if (!/\d/.test(pw)) hints.push('含数字');
    if (!/[^A-Za-z0-9]/.test(pw)) hints.push('含特殊字符');
    passwordHintEl.textContent = hints.length > 0 ? '建议：' + hints.join('、') : '✓ 密码强度足够';
}

// ── API ──

async function checkExists(field, value) {
    const v = (value || '').trim();
    if (!v) return { valid: false, exists: false, empty: true };
    try {
        const res = await fetch('/api/auth/register/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field, value: v }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.detail || '检查失败');
        return data;
    } catch (e) {
        return { valid: false, exists: false, message: e.message || '检查失败', failed: true };
    }
}

// ── Username Validation ──

function validateUsernameFormat(username) {
    if (!username) return { valid: false, message: '' };
    if (username.length < 3) return { valid: false, message: '用户名至少需要3个字符' };
    if (username.length > 50) return { valid: false, message: '用户名不能超过50个字符' };
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) return { valid: false, message: '用户名只能包含字母、数字、点、下划线和横线' };
    if (/^[._-]/.test(username)) return { valid: false, message: '用户名不能以特殊字符开头' };
    return { valid: true, message: '' };
}

async function checkUsernameExists() {
    const username = usernameEl.value.trim();
    const fmt = validateUsernameFormat(username);

    if (!username) {
        usernameExists = false;
        setValidationIcon(usernameIconEl, null);
        clearDuplicateErrorMsg();
        return setCheckHint(usernameCheckEl, '');
    }

    if (!fmt.valid) {
        usernameExists = false;
        setValidationIcon(usernameIconEl, 'error');
        return setCheckHint(usernameCheckEl, fmt.message, 'error');
    }

    setValidationIcon(usernameIconEl, 'loading');
    setCheckHint(usernameCheckEl, '检查中...', 'loading');

    const data = await checkExists('username', username);
    if (data.empty || data.failed) {
        usernameExists = false;
        setValidationIcon(usernameIconEl, null);
        return setCheckHint(usernameCheckEl, '');
    }
    if (!data.valid) {
        usernameExists = false;
        setValidationIcon(usernameIconEl, 'error');
        return setCheckHint(usernameCheckEl, data.message || '用户名格式不正确', 'error');
    }
    usernameExists = !!data.exists;
    if (usernameExists) {
        setValidationIcon(usernameIconEl, 'error');
        return setCheckHint(usernameCheckEl, '该用户名已被注册', 'error');
    }
    setValidationIcon(usernameIconEl, 'ok');
    clearDuplicateErrorMsg();
    return setCheckHint(usernameCheckEl, '✓ 用户名可用', 'ok');
}

// ── Email Validation ──

function validateEmailFormat(email) {
    if (!email) return { valid: false, message: '' };
    // Basic email regex
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) return { valid: false, message: '请输入有效的邮箱地址' };
    if (email.length > 254) return { valid: false, message: '邮箱地址过长' };
    return { valid: true, message: '' };
}

async function checkEmailExists() {
    const email = emailEl.value.trim();
    const fmt = validateEmailFormat(email);

    if (!email) {
        emailExists = false;
        clearDuplicateErrorMsg();
        return setCheckHint(emailCheckEl, '');
    }

    if (!fmt.valid) {
        emailExists = false;
        return setCheckHint(emailCheckEl, fmt.message, 'error');
    }

    setCheckHint(emailCheckEl, '检查中...', 'loading');
    const data = await checkExists('email', email);
    if (data.empty || data.failed) {
        emailExists = false;
        return setCheckHint(emailCheckEl, '');
    }
    if (!data.valid) {
        emailExists = false;
        return setCheckHint(emailCheckEl, data.message || '邮箱格式不正确', 'error');
    }
    emailExists = !!data.exists;
    if (emailExists) return setCheckHint(emailCheckEl, '该邮箱已被注册', 'error');
    clearDuplicateErrorMsg();
    return setCheckHint(emailCheckEl, '✓ 邮箱可用', 'ok');
}

// ── Phone Validation ──

function validatePhoneFormat(phone) {
    if (!phone) return { valid: false, message: '' };
    const cleaned = phone.replace(/[\s\-()]/g, '');
    if (!/^\+?\d{7,15}$/.test(cleaned)) return { valid: false, message: '请输入有效的手机号' };
    return { valid: true, message: '' };
}

async function checkPhoneExists() {
    const phone = phoneEl.value.trim();
    const fmt = validatePhoneFormat(phone);

    if (!phone) {
        phoneExists = false;
        clearDuplicateErrorMsg();
        return setCheckHint(phoneCheckEl, '');
    }

    if (!fmt.valid) {
        phoneExists = false;
        return setCheckHint(phoneCheckEl, fmt.message, 'error');
    }

    setCheckHint(phoneCheckEl, '检查中...', 'loading');
    const data = await checkExists('phone', phone);
    if (data.empty || data.failed) {
        phoneExists = false;
        return setCheckHint(phoneCheckEl, '');
    }
    if (!data.valid) {
        phoneExists = false;
        return setCheckHint(phoneCheckEl, data.message || '手机号格式不正确', 'error');
    }
    phoneExists = !!data.exists;
    if (phoneExists) return setCheckHint(phoneCheckEl, '该手机号已被注册', 'error');
    clearDuplicateErrorMsg();
    return setCheckHint(phoneCheckEl, '✓ 手机号可用', 'ok');
}

// ── Captcha ──

async function refreshCaptcha() {
    clearMsg(step2Msg);
    try {
        const res = await fetch('/api/auth/captcha');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.detail || '验证码获取失败');
        captchaId = data.captcha_id || "";
        captchaUrl = data.image_url || "";
        if (captchaUrl) captchaImgEl.src = `${captchaUrl}?t=${Date.now()}`;
        captchaCodeEl.value = "";
    } catch (e) {
        captchaId = "";
        captchaUrl = "";
        captchaImgEl.removeAttribute('src');
        showMsg('验证码加载失败，请刷新或检查后端服务', 'error', step2Msg);
    }
}

// ── Password Toggle ──

togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordEl.type === 'password';
    passwordEl.type = isPassword ? 'text' : 'password';
    eyeOpen.classList.toggle('hidden', !isPassword);
    eyeClosed.classList.toggle('hidden', isPassword);
});

// ── Channel Selection ──

function passwordStrongEnough(pw) {
    return pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

function setRegisterChannel(ch) {
    registerChannel = ch === "phone" ? "phone" : "email";
    const emailActive = registerChannel === "email";
    emailSection.classList.toggle('hidden', !emailActive);
    phoneSection.classList.toggle('hidden', emailActive);
    channelEmailBtn.className = emailActive
        ? "w-full px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm"
        : "w-full px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 text-sm hover:bg-gray-50";
    channelPhoneBtn.className = !emailActive
        ? "w-full px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm"
        : "w-full px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 text-sm hover:bg-gray-50";

    // Update button text based on channel
    const spanEl = step1NextBtn.querySelector('span');
    if (emailActive) {
        spanEl.textContent = '下一步：验证邮箱';
    } else {
        spanEl.textContent = '下一步：验证手机';
    }

    clearMsg(step1Msg);
}

channelEmailBtn.addEventListener('click', () => setRegisterChannel('email'));
channelPhoneBtn.addEventListener('click', () => setRegisterChannel('phone'));

// ── Verification Code Sending ──

async function sendVerifyCode(channel, target) {
    clearMsg(step2Msg);
    updateEmailStatusBadge('sending');
    try {
        const res = await fetch('/api/auth/verify/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, target })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.detail || '发送失败');

        updateEmailStatusBadge('sent');

        if (data.dev_code) {
            let msg = `验证码已发送（开发模式）：${data.dev_code}`;
            if (data.email_warning) {
                msg += ` ⚠️ ${data.email_warning}`;
            }
            showMsg(msg, 'ok', step2Msg);
        } else {
            showMsg('验证码已发送，请查收', 'ok', step2Msg);
        }

        // Update hint
        verifyCodeHint.textContent = `验证码已发送至 ${target}，有效期10分钟`;
        verifyCodeHint.classList.remove('text-gray-400');
        verifyCodeHint.classList.add('text-green-600');

        // Start countdown
        var seconds = (data.expires_in && data.expires_in > 0) ? data.expires_in : 600;
        startVerifyCodeCountdown(channel, seconds);
    } catch (e) {
        updateEmailStatusBadge('error');
        showMsg(e.message || '发送失败', 'error', step2Msg);
    }
}

function startVerifyCodeCountdown(channel, seconds) {
    var btn = channel === 'email' ? sendEmailBtn : sendPhoneBtn;
    var origText = '重新发送';
    if (verifyCodeTimer) clearInterval(verifyCodeTimer);
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');

    function tick() {
        if (seconds <= 0) {
            clearInterval(verifyCodeTimer);
            verifyCodeTimer = null;
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.textContent = origText;
            return;
        }
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        btn.textContent = m > 0 ? m + '分' + String(s).padStart(2, '0') + '秒' : s + '秒后重发';
        seconds--;
    }
    tick();
    verifyCodeTimer = setInterval(tick, 1000);
}

sendEmailBtn.addEventListener('click', () => {
    const email = (emailEl.value || '').trim();
    if (!email) {
        showMsg('请输入邮箱', 'error', step2Msg);
        return;
    }
    sendVerifyCode('email', email);
});

sendPhoneBtn.addEventListener('click', () => {
    const phone = (phoneEl.value || '').trim();
    if (!phone) {
        showMsg('请输入手机号', 'error', step2Msg);
        return;
    }
    sendVerifyCode('phone', phone);
});

// ── Real-time Input Validation ──

usernameEl.addEventListener('blur', checkUsernameExists);
emailEl.addEventListener('blur', checkEmailExists);
phoneEl.addEventListener('blur', checkPhoneExists);

usernameEl.addEventListener('input', () => {
    clearDuplicateErrorMsg();
    // Immediate format validation
    const fmt = validateUsernameFormat(usernameEl.value.trim());
    if (usernameEl.value.trim() && !fmt.valid) {
        setValidationIcon(usernameIconEl, 'error');
        setCheckHint(usernameCheckEl, fmt.message, 'error');
    } else {
        setValidationIcon(usernameIconEl, null);
        setCheckHint(usernameCheckEl, '');
    }
    // Debounced server check
    if (usernameTimer) clearTimeout(usernameTimer);
    if (usernameEl.value.trim().length >= 3) {
        usernameTimer = setTimeout(checkUsernameExists, 500);
    }
});

emailEl.addEventListener('input', () => {
    clearDuplicateErrorMsg();
    const fmt = validateEmailFormat(emailEl.value.trim());
    if (emailEl.value.trim() && !fmt.valid) {
        setCheckHint(emailCheckEl, fmt.message, 'error');
    } else {
        setCheckHint(emailCheckEl, '');
    }
    if (emailTimer) clearTimeout(emailTimer);
    if (fmt.valid) {
        emailTimer = setTimeout(checkEmailExists, 500);
    }
});

phoneEl.addEventListener('input', () => {
    clearDuplicateErrorMsg();
    const fmt = validatePhoneFormat(phoneEl.value.trim());
    if (phoneEl.value.trim() && !fmt.valid) {
        setCheckHint(phoneCheckEl, fmt.message, 'error');
    } else {
        setCheckHint(phoneCheckEl, '');
    }
    if (phoneTimer) clearTimeout(phoneTimer);
    if (fmt.valid) {
        phoneTimer = setTimeout(checkPhoneExists, 500);
    }
});

passwordEl.addEventListener('input', () => {
    updatePasswordStrength(passwordEl.value);
});

refreshCaptchaBtn.addEventListener('click', refreshCaptcha);

// ── Step 1: Next ──

step1NextBtn.addEventListener('click', async () => {
    clearMsg(step1Msg);
    const username = (usernameEl.value || '').trim();
    const password = passwordEl.value || '';
    const email = (emailEl.value || '').trim();
    const phone = (phoneEl.value || '').trim();
    const acceptLegal = !!(acceptLegalEl && acceptLegalEl.checked);

    // Validate username
    if (!username) return showMsg('请输入用户名', 'error', step1Msg);
    const usernameFmt = validateUsernameFormat(username);
    if (!usernameFmt.valid) return showMsg(usernameFmt.message, 'error', step1Msg);

    // Validate password
    if (!password) return showMsg('请输入密码', 'error', step1Msg);
    if (!passwordStrongEnough(password)) return showMsg('密码至少8位且必须包含字母和数字', 'error', step1Msg);

    // Validate contact
    if (registerChannel === 'email') {
        if (!email) return showMsg('请输入邮箱', 'error', step1Msg);
        const emailFmt = validateEmailFormat(email);
        if (!emailFmt.valid) return showMsg(emailFmt.message, 'error', step1Msg);
    } else {
        if (!phone) return showMsg('请输入手机号', 'error', step1Msg);
        const phoneFmt = validatePhoneFormat(phone);
        if (!phoneFmt.valid) return showMsg(phoneFmt.message, 'error', step1Msg);
    }

    // Legal check
    if (!acceptLegal) return showMsg('请先阅读并同意《用户协议》和《隐私政策》', 'error', step1Msg);

    // Check uniqueness
    showMsg('正在检查信息...', 'ok', step1Msg);
    await checkUsernameExists();
    if (usernameExists) return showMsg('用户名已被注册，请更换后重试', 'error', step1Msg);

    if (registerChannel === 'email') {
        await checkEmailExists();
        if (emailExists) return showMsg('邮箱已被注册，请直接登录或更换邮箱', 'error', step1Msg);
    } else {
        await checkPhoneExists();
        if (phoneExists) return showMsg('手机号已被注册，请直接登录或更换手机号', 'error', step1Msg);
    }

    clearMsg(step1Msg);
    goToStep(2);
});

// ── Step 2: Next (Verify Code) ──

step2NextBtn.addEventListener('click', async () => {
    clearMsg(step2Msg);

    if (registerChannel === 'email') {
        const emailCode = (emailCodeEl.value || '').trim();
        if (!emailCode) return showMsg('请输入邮箱验证码', 'error', step2Msg);
        if (emailCode.length !== 6) return showMsg('验证码为6位数字', 'error', step2Msg);
    } else {
        const phoneCode = (phoneCodeEl.value || '').trim();
        if (!phoneCode) return showMsg('请输入短信验证码', 'error', step2Msg);
        if (phoneCode.length !== 6) return showMsg('验证码为6位数字', 'error', step2Msg);
    }

    if (registerChannel === 'email') {
        emailVerified = true;
        updateEmailStatusBadge('verified');
    } else {
        phoneVerified = true;
    }

    clearMsg(step2Msg);
    goToStep(3);
});

// ── Step 2: Back ──

step2BackBtn.addEventListener('click', () => {
    goToStep(1);
});

// ── Step 3: Back ──

step3BackBtn.addEventListener('click', () => {
    goToStep(2);
});

// ── Step 3: Submit Registration ──

submitBtn.addEventListener('click', async () => {
    clearMsg(step3Msg);
    const username = (usernameEl.value || '').trim();
    const email = (emailEl.value || '').trim();
    const phone = (phoneEl.value || '').trim();
    const password = passwordEl.value || '';
    const emailCode = (emailCodeEl.value || '').trim();
    const phoneCode = (phoneCodeEl.value || '').trim();
    const captchaCode = (captchaCodeEl.value || '').trim();
    const acceptLegal = !!(acceptLegalEl && acceptLegalEl.checked);

    // Validate captcha
    if (!captchaId || !captchaCode) {
        await refreshCaptcha();
        return showMsg('请完成图形验证码', 'error', step3Msg);
    }

    // Disable button, show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg> 正在注册...';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                register_channel: registerChannel,
                email: registerChannel === 'email' ? email : null,
                phone: registerChannel === 'phone' ? phone : null,
                email_code: registerChannel === 'email' ? emailCode : null,
                phone_code: registerChannel === 'phone' ? phoneCode : null,
                captcha_id: captchaId,
                captcha_code: captchaCode,
                accept_terms: acceptLegal,
                accept_privacy: acceptLegal
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.detail || '注册失败');

        // Success!
        localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token || "");
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user || {}));

        // Show success state
        step3Panel.innerHTML = `
            <div class="text-center py-8 space-y-4">
                <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-50 mb-2">
                    <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <h3 class="text-xl font-bold text-gray-900">注册成功！ 🎉</h3>
                <p class="text-sm text-gray-500">欢迎加入，${username}</p>
                <p class="text-xs text-gray-400">正在跳转到首页...</p>
            </div>
        `;

        setTimeout(() => {
            window.location.href = '/';
        }, 1500);

    } catch (e) {
        showMsg(e.message || '注册失败', 'error', step3Msg);
        await refreshCaptcha();
        // Re-enable button
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> 完成注册';
    }
});

// ── Init ──
setRegisterChannel('email');
goToStep(1);
