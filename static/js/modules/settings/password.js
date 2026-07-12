// ── Password change ──
import {
    authToken, currentUser, setCurrentUser, setAuthToken,
    authFetch,
} from '../state.js';
import { t } from '../i18n.js';
import { openLoginModal } from '../auth.js';
import { renderResultsTable, recalcSummaryFromCurrentResults } from '../quote.js';
import { dom } from './common.js';

function showPwdMsg(text, ok) {
    const { ucPasswordMsg } = dom;
    if (!ucPasswordMsg) return;
    ucPasswordMsg.textContent = text;
    ucPasswordMsg.className = ok ? "text-xs text-green-600 block" : "text-xs text-red-600 block";
}

// ── Change password ──
export async function changePassword() {
    const { ucOldPassword, ucNewPassword, ucConfirmPassword, ucPasswordMsg, userCenterModal } = dom;
    const oldPwd = ucOldPassword?.value;
    const newPwd = ucNewPassword?.value;
    const confPwd = ucConfirmPassword?.value;
    if (!oldPwd || !newPwd || !confPwd) { showPwdMsg(t('settings.allPasswordFieldsRequired'), false); return; }
    if (newPwd !== confPwd) { showPwdMsg(t('settings.passwordsMismatch'), false); return; }
    if (newPwd.length < 8) { showPwdMsg(t('settings.passwordTooShort'), false); return; }
    try {
        const res = await authFetch('/api/users/change-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd })
        });
        if (res.status === 401) { if (userCenterModal) userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        let data = {};
        try { data = await res.json(); } catch(e){}
        if (!res.ok) { showPwdMsg((data && (data.message || data.detail)) ? String(data.message || data.detail) : t('settings.changePasswordFailed'), false); return; }
        showPwdMsg(t('settings.changePasswordSuccess'), true);
        setTimeout(async () => {
            if (userCenterModal) userCenterModal.classList.add('hidden');
            setCurrentUser(null);
            setAuthToken("");
            const { renderAuthUI: rau, openLoginModal: olm } = await import('./auth.js');
            rau();
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            olm();
        }, 1500);
    } catch (e) { showPwdMsg(e.message, false); }
}
