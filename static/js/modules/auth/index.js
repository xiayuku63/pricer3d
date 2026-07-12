// ── Auth module: re-exports from sub-modules ──
export { _wireLoginForm, refreshLoginCaptcha, openLoginModal, closeLoginModal, handleLoginSubmit, handleLoginSubmit as login } from './login.js';
export { register, checkRegisterExists, sendVerifyCode, confirmVerifyCode } from './register.js';
export {
    showResetRequestView,
    showResetConfirmView,
    handleResetRequest,
    handleResetRequest as passwordResetRequest,
    handleResetConfirm,
    handleResetConfirm as passwordResetConfirm,
    _wireResetEnterKeys,
    _wireResetRequestCaptcha,
} from './reset.js';
export {
    initAuth,
    handleAuthSuccess,
    handleAuthSuccess as onLoginSuccess,
    handleLogout,
    handleLogout as logOut,
    initializeAuth,
    initializeAuth as tryAutoLogin,
    renderAuthUI,
    showLoginView,
    _clearFieldError,
    _showFieldError,
    _showBannerError,
    _hideBannerError,
    _showBannerSuccess,
    _hideBannerSuccess,
    _switchToView,
    dom,
} from './ui.js';
