// ── Membership / billing module ──
import { authToken, currentUser, setCurrentUser, authFetch, saveUserSession } from './state.js';
import { t } from './i18n.js';
import { openLoginModal, renderAuthUI } from './auth.js';

let dom = {};

export function initMembership(d) { dom = d; }

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

export function openMembershipModal() {
    if (!currentUser || !authToken) { openLoginModal(); return; }
    clearMsg();
    if (dom.membershipOrders) dom.membershipOrders.classList.add('hidden');
    if (dom.membershipModal) dom.membershipModal.classList.remove('hidden');
    loadMembershipPlans();
}

export function closeMembershipModal() {
    if (dom.membershipModal) dom.membershipModal.classList.add('hidden');
    clearMsg();
}

export async function refreshMembershipStatus() {
    if (!authToken) return;
    try {
        const resp = await authFetch('/api/auth/me');
        if (!resp.ok) throw new Error(t('membership.refreshError'));
        setCurrentUser(await resp.json());
        saveUserSession();
        renderAuthUI();
        showMsg(t('membership.refreshed'), true);
    } catch (e) { showMsg(e.message || t('membership.refreshError'), false); }
}

async function loadMembershipPlans() {
    const { membershipPlans } = dom;
    if (!membershipPlans) return;
    membershipPlans.innerHTML = '<div class="text-xs text-gray-500">' + t('common.loading') + '</div>';
    try {
        const resp = await fetch('/api/billing/plans');
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('membership.loadError'));
        const items = data.items || [];
        if (!items.length) { membershipPlans.innerHTML = '<div class="text-xs text-gray-500">' + t('membership.noPlans') + '</div>'; return; }
        membershipPlans.innerHTML = items.map((p) => `
            <div class="border border-gray-200 rounded-md p-3 bg-gray-50 flex flex-col gap-2">
                <div class="text-sm font-semibold text-gray-900">${p.name}</div>
                <div class="text-xs text-gray-600">¥ ${Number(p.price_cny || 0).toFixed(2)} / ${p.duration_days}${t('common.days')}</div>
                <button type="button" data-plan="${p.code}" class="mt-1 w-full py-2 px-3 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700">${t('membership.payNow')}</button>
            </div>
        `).join('');
        membershipPlans.querySelectorAll('[data-plan]').forEach((btn) => {
            btn.addEventListener('click', () => startCheckout(btn.getAttribute('data-plan')));
        });
    } catch (e) {
        membershipPlans.innerHTML = '<div class="text-xs text-red-600">' + t('membership.loadError') + '</div>';
        showMsg(e.message || t('membership.loadError'), false);
    }
}

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
            window.open(data.pay_url, '_blank', 'noopener');
            showMsg(t('membership.orderCreated', { orderNo: data.order_no }), true);
        } else { showMsg(t('membership.noPaymentChannel'), false); }
    } catch (e) { showMsg(e.message || t('membership.createOrderFailed'), false); }
}

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
            membershipOrdersTbody.innerHTML = items.map((o) => `
                <tr>
                    <td class="px-2 py-2 font-mono">${o.order_no}</td>
                    <td class="px-2 py-2">${o.plan_code}</td>
                    <td class="px-2 py-2">¥ ${Number(o.amount_cny || 0).toFixed(2)}</td>
                    <td class="px-2 py-2">${o.status}</td>
                    <td class="px-2 py-2">${o.created_at || '-'}</td>
                </tr>
            `).join('');
        } catch (e) {
            membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-red-600">' + t('membership.loadError') + '</td></tr>';
            showMsg(e.message || t('membership.loadError'), false);
        }
    } else { membershipOrders.classList.add('hidden'); }
}
