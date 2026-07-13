const TOKEN_STORAGE_KEY = 'demo_access_token_v1';
const PAGE_SIZE = 20;
const $ = (id) => document.getElementById(id);
const usersTbody = $('users-tbody');
const auditTbody = $('audit-tbody');
const metricsTbody = $('metrics-tbody');
const msg = $('msg');
let authToken = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
let isAdmin = false;
let usersPage = 1;
let usersTotal = 0;

function escapeHtml(value) {
    return String(value ?? '-').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showMsg(text, ok = false) {
    msg.textContent = text;
    msg.className = ok ? 'text-xs tw-text-success' : 'text-xs tw-text-danger';
    msg.classList.remove('hidden');
}

function setLoading(tbody, colspan, text = '加载中...') {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty">${escapeHtml(text)}</td></tr>`;
}

async function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(url, { ...options, headers });
}

async function ensureAdmin() {
    const response = await authFetch('/api/auth/me');
    if (!response.ok) return false;
    const me = await response.json();
    isAdmin = !!me.is_admin;
    return isAdmin;
}

function renderUsers(items) {
    if (!items?.length) {
        setLoading(usersTbody, 8, '没有匹配的用户');
        return;
    }
    usersTbody.innerHTML = items.map((user) => {
        const isMember = (user.membership_level || 'free') === 'member';
        const verified = user.email_verified || user.phone_verified;
        return `<tr>
            <td class="tw-text-muted">${escapeHtml(user.id)}</td>
            <td><strong class="tw-text-strong">${escapeHtml(user.username)}</strong></td>
            <td>${escapeHtml(user.email_masked)}</td>
            <td>${escapeHtml(user.phone_masked)}</td>
            <td><span class="badge ${isMember ? 'badge-blue' : 'badge-gray'}">${isMember ? '会员' : '普通用户'}</span></td>
            <td><span class="badge ${verified ? 'badge-green' : 'badge-gray'}">${user.email_verified ? '邮箱已验证' : user.phone_verified ? '手机已验证' : '未验证'}</span></td>
            <td class="tw-text-muted">${escapeHtml(user.created_at)}</td>
            <td><button type="button" data-member-action="${isMember ? 'free' : 'member'}" data-user-id="${escapeHtml(user.id)}" class="${isMember ? 'tw-btn-ghost' : 'tw-btn-primary'} px-2.5 py-1.5 text-[11px]">${isMember ? '设为普通' : '设为会员'}</button></td>
        </tr>`;
    }).join('');
    usersTbody.querySelectorAll('[data-member-action]').forEach((button) => button.addEventListener('click', () => updateMembership(button.dataset.userId, button.dataset.memberAction)));
}

function renderUsersPagination() {
    const container = $('users-pagination');
    const pages = Math.max(1, Math.ceil(usersTotal / PAGE_SIZE));
    if (!usersTotal) { container.innerHTML = ''; return; }
    container.innerHTML = `<span>第 ${(usersPage - 1) * PAGE_SIZE + 1}-${Math.min(usersPage * PAGE_SIZE, usersTotal)} 条，共 ${usersTotal} 个用户</span><div class="pagination-actions"><button data-user-page="${usersPage - 1}" class="tw-btn-ghost px-2.5 py-1.5 text-xs" ${usersPage <= 1 ? 'disabled' : ''}>上一页</button><span class="px-2 py-1.5 text-xs tw-text-secondary">${usersPage} / ${pages}</span><button data-user-page="${usersPage + 1}" class="tw-btn-ghost px-2.5 py-1.5 text-xs" ${usersPage >= pages ? 'disabled' : ''}>下一页</button></div>`;
    container.querySelectorAll('[data-user-page]').forEach((button) => button.addEventListener('click', () => { usersPage = Number(button.dataset.userPage); loadUsers(); }));
}

async function loadUsers() {
    setLoading(usersTbody, 8);
    try {
        if (!isAdmin && !(await ensureAdmin())) throw new Error('当前账号不是管理员');
        const q = $('search-input').value.trim();
        const response = await authFetch(`/api/admin/users?limit=${PAGE_SIZE}&offset=${(usersPage - 1) * PAGE_SIZE}&q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '加载失败');
        usersTotal = data.total || 0;
        $('user-count').textContent = usersTotal ? `(${usersTotal})` : '';
        renderUsers(data.items || []);
        renderUsersPagination();
        showMsg('用户列表已更新', true);
    } catch (error) { setLoading(usersTbody, 8, error.message || '加载失败'); showMsg(error.message || '加载失败'); }
}

async function updateMembership(userId, membershipLevel) {
    try {
        const response = await authFetch(`/api/admin/users/${encodeURIComponent(userId)}/membership`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membership_level: membershipLevel }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '设置失败');
        showMsg('用户权益已更新', true);
        await loadUsers();
    } catch (error) { showMsg(error.message || '设置失败'); }
}

async function loadAudit() {
    setLoading(auditTbody, 7);
    try {
        if (!isAdmin && !(await ensureAdmin())) throw new Error('当前账号不是管理员');
        const q = $('audit-q').value.trim();
        const response = await authFetch(`/api/admin/audit?limit=120&offset=0&q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '加载失败');
        auditTbody.innerHTML = data.items?.length ? data.items.map((event) => `<tr><td>${escapeHtml(event.created_at)}</td><td><span class="badge badge-blue">${escapeHtml(event.action)}</span></td><td>${escapeHtml(event.username)}</td><td>${escapeHtml(event.ip)}</td><td>${escapeHtml([event.method, event.path].filter(Boolean).join(' '))}</td><td class="font-mono">${escapeHtml(event.request_id)}</td><td class="max-w-[420px] truncate" title="${escapeHtml(event.detail ? JSON.stringify(event.detail) : '')}">${escapeHtml(event.detail ? JSON.stringify(event.detail) : '-')}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">没有匹配记录</td></tr>';
        showMsg(`已加载 ${data.total || 0} 条审计记录`, true);
    } catch (error) { setLoading(auditTbody, 7, error.message || '加载失败'); showMsg(error.message || '加载失败'); }
}

async function loadMetrics() {
    setLoading(metricsTbody, 4);
    try {
        if (!isAdmin && !(await ensureAdmin())) throw new Error('当前账号不是管理员');
        const response = await authFetch('/api/admin/metrics');
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '加载失败');
        $('m-uptime').textContent = `${Math.round(data.uptime_seconds || 0)}s`;
        $('m-req').textContent = data.events_tracked || 0;
        $('m-avg').textContent = `${data.avg_latency_ms || 0}ms`;
        $('m-p95').textContent = `${data.p95_latency_ms || 0}ms`;
        metricsTbody.innerHTML = data.top_paths?.length ? data.top_paths.map((item) => `<tr><td class="font-mono">${escapeHtml(item.path)}</td><td>${item.count}</td><td>${item.errors_5xx}</td><td>${item.avg_latency_ms}ms</td></tr>`).join('') : '<tr><td colspan="4" class="empty">暂无数据</td></tr>';
        showMsg('监控数据已刷新', true);
    } catch (error) { setLoading(metricsTbody, 4, error.message || '加载失败'); showMsg(error.message || '加载失败'); }
}

async function runCleanup() {
    try {
        const response = await authFetch('/api/admin/maintenance/cleanup', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '执行失败');
        showMsg(`清理完成：${JSON.stringify(data.deleted || {})}`, true);
        loadMetrics();
    } catch (error) { showMsg(error.message || '执行失败'); }
}

function setActiveTab(name) {
    ['users', 'audit', 'metrics'].forEach((tab) => { $(`tab-${tab}`).classList.toggle('hidden', tab !== name); });
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
    location.hash = `#${name}`;
    if (name === 'users') loadUsers();
    if (name === 'audit') loadAudit();
    if (name === 'metrics') loadMetrics();
}

$('search-btn').addEventListener('click', () => { usersPage = 1; loadUsers(); });
$('users-refresh-btn').addEventListener('click', loadUsers);
$('search-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { usersPage = 1; loadUsers(); } });
$('audit-search-btn').addEventListener('click', loadAudit);
$('audit-q').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadAudit(); });
$('metrics-refresh-btn').addEventListener('click', loadMetrics);
$('cleanup-btn').addEventListener('click', runCleanup);
document.querySelectorAll('.tab-btn').forEach((button) => button.addEventListener('click', () => setActiveTab(button.dataset.tab)));

const initialTab = (location.hash || '#users').slice(1);
setActiveTab(['users', 'audit', 'metrics'].includes(initialTab) ? initialTab : 'users');
