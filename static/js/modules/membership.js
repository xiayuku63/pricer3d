// ── Membership / billing module ──
import { authToken, currentUser, setCurrentUser, authFetch, saveUserSession } from './state.js';
import { t } from './i18n.js';
import { openLoginModal, renderAuthUI } from './auth.js';

let dom = {};

export function initMembership(d) { dom = d; }

// ── Helpers ──

function showMsg(text, ok = false) {
    const { membershipMsg } = dom;
    if (!membershipMsg) return;
    membershipMsg.textContent = text;
    membershipMsg.className = ok ? "text-xs text-green-600" : "text-xs text-red-600";
    membershipMsg.classList.remove('hidden');
}

function clearMsg() {
    const { membershipMsg } = dom;
    if (!membershipMsg) return;
    membershipMsg.classList.add('hidden');
    membershipMsg.textContent = '';
}

/** Convert Unix timestamp (seconds) to friendly date string */
function _fmtExpireDate(ts) {
    if (!ts) return null;
    try {
        const d = new Date(Number(ts) * 1000);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${day} ${h}:${min}`;
    } catch { return null; }
}

/** Calculate remaining days from expiry timestamp */
function _daysLeft(ts) {
    if (!ts) return null;
    try {
        const now = Date.now() / 1000;
        const diff = Number(ts) - now;
        return Math.ceil(diff / 86400);
    } catch { return null; }
}

/** Render the current membership status card */
function _renderStatusCard() {
    const { membershipStatusIcon, membershipStatusLevel, membershipStatusExpire, membershipStatusBadge } = dom;
    if (!membershipStatusLevel) return;

    const level = currentUser?.membership_level || 'free';
    const expiresAt = currentUser?.membership_expires_at;
    const isMember = level === 'member';

    // Level text
    membershipStatusLevel.textContent = isMember
        ? t('membership.statusMember')
        : t('membership.statusFree');

    // Expiration
    if (membershipStatusExpire) {
        if (isMember && expiresAt) {
            const friendly = _fmtExpireDate(expiresAt);
            const days = _daysLeft(expiresAt);
            if (days !== null && days > 0) {
                membershipStatusExpire.textContent = t('membership.expireIn', { date: friendly, days: String(days) });
            } else if (days !== null && days <= 0) {
                membershipStatusExpire.textContent = t('membership.expired');
            } else {
                membershipStatusExpire.textContent = friendly || '';
            }
        } else if (isMember && !expiresAt) {
            membershipStatusExpire.textContent = t('membership.permanent');
        } else {
            membershipStatusExpire.textContent = t('membership.upgradeHint');
        }
    }

    // Badge
    if (membershipStatusBadge) {
        if (isMember) {
            membershipStatusBadge.classList.remove('hidden');
            membershipStatusBadge.textContent = t('auth.memberBadge');
            membershipStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200';
        } else {
            membershipStatusBadge.classList.remove('hidden');
            membershipStatusBadge.textContent = t('membership.free');
            membershipStatusBadge.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200';
        }
    }
}

// ── Open / Close ──

export function openMembershipModal() {
    if (!currentUser || !authToken) { openLoginModal(); return; }
    clearMsg();
    if (dom.membershipOrders) dom.membershipOrders.classList.add('hidden');
    if (dom.membershipModal) dom.membershipModal.classList.remove('hidden');
    _renderStatusCard();
    loadMembershipPlans();
}

export function closeMembershipModal() {
    if (dom.membershipModal) dom.membershipModal.classList.add('hidden');
    clearMsg();
}

function showPaymentMsg(text, ok = false) {
    const { paymentMsg } = dom;
    if (!paymentMsg) return;
    paymentMsg.textContent = text;
    paymentMsg.className = ok ? 'text-xs text-green-600' : 'text-xs text-red-600';
    paymentMsg.classList.remove('hidden');
}

function clearPaymentMsg() {
    const { paymentMsg } = dom;
    if (!paymentMsg) return;
    paymentMsg.textContent = '';
    paymentMsg.classList.add('hidden');
}

export function closePaymentModal() {
    if (dom.paymentModal) dom.paymentModal.classList.add('hidden');
    clearPaymentMsg();
}

// ── Refresh status ──

export async function refreshMembershipStatus() {
    if (!authToken) return;
    const btn = dom.membershipRefreshBtn;
    const origText = btn ? btn.textContent : '';
    try {
        if (btn) { btn.disabled = true; btn.textContent = t('membership.refreshing'); }
        const resp = await authFetch('/api/auth/me');
        if (!resp.ok) throw new Error(t('membership.refreshError'));
        setCurrentUser(await resp.json());
        saveUserSession();
        renderAuthUI();
        _renderStatusCard();
        showMsg(t('membership.refreshed'), true);
    } catch (e) { showMsg(e.message || t('membership.refreshError'), false); }
    finally { if (btn) { btn.disabled = false; btn.textContent = origText; } }
}

// ── Load plans ──

async function loadMembershipPlans() {
    const { membershipPlans } = dom;
    if (!membershipPlans) return;
    membershipPlans.innerHTML = '<div class="text-xs text-gray-500 col-span-2">' + t('common.loading') + '</div>';
    try {
        const resp = await fetch('/api/billing/plans');
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('membership.loadError'));
        const items = data.items || [];
        if (!items.length) { membershipPlans.innerHTML = '<div class="text-xs text-gray-500 col-span-2">' + t('membership.noPlans') + '</div>'; return; }

        // Find the "best value" plan (most days)
        const bestCode = items.reduce((a, b) => (b.duration_days > a.duration_days ? b : a), items[0]).code;

        membershipPlans.innerHTML = items.map((p) => {
            const isBest = p.code === bestCode;
            const dailyPrice = p.duration_days > 0 ? (p.price_cny / p.duration_days).toFixed(2) : '-';
            return `
                <div class="relative border ${isBest ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-gray-50'} rounded-lg p-4 flex flex-col gap-2 transition-colors hover:border-amber-300">
                    ${isBest ? '<span class="absolute -top-2 right-3 text-[10px] px-2 py-0.5 bg-amber-500 text-white rounded-full font-medium">' + t('membership.bestValue') + '</span>' : ''}
                    <div class="flex items-baseline justify-between">
                        <span class="text-sm font-semibold text-gray-900">${p.name}</span>
                        <span class="text-[11px] text-gray-400">${p.duration_days}${t('common.days')}</span>
                    </div>
                    <div class="flex items-baseline gap-1">
                        <span class="text-lg font-bold text-indigo-600">¥${Number(p.price_cny || 0).toFixed(0)}</span>
                        <span class="text-[11px] text-gray-400">/ ${p.duration_days}${t('common.days')}</span>
                    </div>
                    <div class="text-[11px] text-gray-400">${t('membership.dailyPrice')}: ¥${dailyPrice}/${t('common.day')}</div>
                    <button type="button" data-plan="${p.code}" class="mt-auto w-full py-2 px-3 rounded-md ${isBest ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'} text-xs font-medium transition-colors">${t('membership.payNow')}</button>
                </div>
            `;
        }).join('');

        membershipPlans.querySelectorAll('[data-plan]').forEach((btn) => {
            btn.addEventListener('click', () => startCheckout(btn.getAttribute('data-plan')));
        });
    } catch (e) {
        membershipPlans.innerHTML = '<div class="text-xs text-red-600 col-span-2">' + t('membership.loadError') + '</div>';
        showMsg(e.message || t('membership.loadError'), false);
    }
}

// ── Checkout ──

async function startCheckout(planCode) {
    if (!currentUser || !authToken) { openLoginModal(); return; }
    clearMsg();
    try {
        const resp = await authFetch('/api/billing/checkout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_code: planCode }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('membership.createOrderFailed'));
        if (data.pay_url) {
            // Keep the payment flow in the current page instead of opening a new tab.
            if (dom.paymentOrderNo) dom.paymentOrderNo.textContent = data.order_no || '-';
            clearPaymentMsg();
            if (dom.paymentPayBtn) {
                dom.paymentPayBtn.disabled = false;
                dom.paymentPayBtn.textContent = '\u786e\u8ba4\u652f\u4ed8';
            }
            if (dom.paymentModal) dom.paymentModal.classList.remove('hidden');
        } else {
            showMsg(t('membership.noPaymentChannel'), false);
        }
    } catch (e) { showMsg(e.message || t('membership.createOrderFailed'), false); }
}

export async function confirmPayment() {
    const orderNo = dom.paymentOrderNo?.textContent?.trim() || '';
    const btn = dom.paymentPayBtn;
    if (!orderNo || orderNo === '-') {
        showPaymentMsg('\u8ba2\u5355\u53f7\u7f3a\u5931', false);
        return;
    }
    if (!authToken) {
        showPaymentMsg('\u672a\u767b\u5f55\uff0c\u8bf7\u5148\u767b\u5f55\u540e\u518d\u652f\u4ed8', false);
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '\u5904\u7406\u4e2d...'; }
    clearPaymentMsg();
    try {
        const resp = await authFetch('/api/billing/mock/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_no: orderNo }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '\u652f\u4ed8\u5931\u8d25');
        showPaymentMsg(`\u652f\u4ed8\u6210\u529f\uff0c\u4f1a\u5458\u5df2\u751f\u6548\u3002\u5230\u671f\u65f6\u95f4\uff1a${data.membership_expires_at || '\u6c38\u4e45'}`, true);
        if (btn) btn.textContent = '\u5df2\u652f\u4ed8';
        await refreshMembershipStatus();
    } catch (e) {
        showPaymentMsg(e.message || '\u786e\u8ba4\u652f\u4ed8', false);
        if (btn) { btn.disabled = false; btn.textContent = '\u786e\u8ba4\u652f\u4ed8'; }
    }
}

// ── Order history ──

export async function toggleMembershipOrders() {
    const { membershipOrders, membershipOrdersTbody } = dom;
    if (!membershipOrders || !membershipOrdersTbody) return;
    if (membershipOrders.classList.contains('hidden')) {
        membershipOrders.classList.remove('hidden');
        membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">' + t('common.loading') + '</td></tr>';
        try {
            const resp = await authFetch('/api/billing/orders?limit=20&offset=0');
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || t('membership.loadError'));
            const items = data.items || [];
            if (!items.length) { membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">' + t('common.noData') + '</td></tr>'; return; }
            const statusMap = {
                created: { text: '待支付', cls: 'text-amber-600 bg-amber-50' },
                paid: { text: '已支付', cls: 'text-green-600 bg-green-50' },
                cancelled: { text: '已取消', cls: 'text-gray-500 bg-gray-50' },
                refunded: { text: '已退款', cls: 'text-red-600 bg-red-50' },
            };
            membershipOrdersTbody.innerHTML = items.map((o) => {
                const st = statusMap[o.status] || { text: o.status, cls: 'text-gray-500' };
                return `
                <tr>
                    <td class="px-2 py-2 font-mono text-[10px]">${o.order_no}</td>
                    <td class="px-2 py-2">${o.plan_code}</td>
                    <td class="px-2 py-2">¥ ${Number(o.amount_cny || 0).toFixed(2)}</td>
                    <td class="px-2 py-2"><span class="text-[10px] px-1.5 py-0.5 rounded ${st.cls}">${st.text}</span></td>
                    <td class="px-2 py-2">${o.created_at || '-'}</td>
                </tr>
                `;
            }).join('');
        } catch (e) {
            membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-red-600">' + t('membership.loadError') + '</td></tr>';
            showMsg(e.message || t('membership.loadError'), false);
        }
    } else { membershipOrders.classList.add('hidden'); }
}
