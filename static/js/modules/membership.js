// ── Membership / billing module ──
import { authToken, currentUser, setCurrentUser, authFetch, saveUserSession } from './state.js';
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
        if (!resp.ok) throw new Error('刷新失败');
        setCurrentUser(await resp.json());
        saveUserSession();
        renderAuthUI();
        showMsg('会员状态已刷新', true);
    } catch (e) { showMsg(e.message || '刷新失败', false); }
}

async function loadMembershipPlans() {
    const { membershipPlans } = dom;
    if (!membershipPlans) return;
    membershipPlans.innerHTML = '<div class="text-xs text-gray-500">加载中...</div>';
    try {
        const resp = await fetch('/api/billing/plans');
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '加载失败');
        const items = data.items || [];
        if (!items.length) { membershipPlans.innerHTML = '<div class="text-xs text-gray-500">暂无可用套餐</div>'; return; }
        membershipPlans.innerHTML = items.map((p) => `
            <div class="border border-gray-200 rounded-md p-3 bg-gray-50 flex flex-col gap-2">
                <div class="text-sm font-semibold text-gray-900">${p.name}</div>
                <div class="text-xs text-gray-600">¥ ${Number(p.price_cny || 0).toFixed(2)} / ${p.duration_days} 天</div>
                <button type="button" data-plan="${p.code}" class="mt-1 w-full py-2 px-3 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700">立即支付</button>
            </div>
        `).join('');
        membershipPlans.querySelectorAll('[data-plan]').forEach((btn) => {
            btn.addEventListener('click', () => startCheckout(btn.getAttribute('data-plan')));
        });
    } catch (e) {
        membershipPlans.innerHTML = '<div class="text-xs text-red-600">加载失败</div>';
        showMsg(e.message || '加载失败', false);
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
        if (!resp.ok) throw new Error(data.detail || '创建订单失败');
        if (data.pay_url) {
            window.open(data.pay_url, '_blank', 'noopener');
            showMsg(`已打开支付页面：订单 ${data.order_no}。支付完成后点击"刷新会员状态"。`, true);
        } else { showMsg('当前未配置支付渠道', false); }
    } catch (e) { showMsg(e.message || '创建订单失败', false); }
}

export async function toggleMembershipOrders() {
    const { membershipOrders, membershipOrdersTbody } = dom;
    if (!membershipOrders || !membershipOrdersTbody) return;
    if (membershipOrders.classList.contains('hidden')) {
        membershipOrders.classList.remove('hidden');
        membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">加载中...</td></tr>';
        try {
            const resp = await authFetch('/api/billing/orders?limit=20&offset=0');
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || '加载失败');
            const items = data.items || [];
            if (!items.length) { membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">暂无数据</td></tr>'; return; }
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
            membershipOrdersTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-red-600">加载失败</td></tr>';
            showMsg(e.message || '加载失败', false);
        }
    } else { membershipOrders.classList.add('hidden'); }
}
