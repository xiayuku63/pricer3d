// ── Quote history modal ──
import { escapeHtml, formatTimeHMS, authToken } from './state.js';
import { t } from './i18n.js';

let historyTbody, quoteHistoryModal, quoteHistoryBackdrop;
let paginationContainer;
let historySearchInput, historyStatusFilter, historySummary;
let currentItems = [];

// ── Pagination state ──
const PAGE_SIZE = 20;
let currentPage = 1;
let totalRecords = 0;

function getToken() {
    return authToken || '';
}

function getTotalPages() {
    return Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
}

export function initQuoteHistory() {
    historyTbody = document.getElementById('history-tbody');
    quoteHistoryModal = document.getElementById('quote-history-modal');
    quoteHistoryBackdrop = document.getElementById('quote-history-backdrop');
    paginationContainer = document.getElementById('history-pagination');
    historySearchInput = document.getElementById('history-search-input');
    historyStatusFilter = document.getElementById('history-status-filter');
    historySummary = document.getElementById('history-summary');
    const historyRefreshBtn = document.getElementById('history-refresh-btn');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const openQuoteHistoryBtn = document.getElementById('open-quote-history-btn');

    const applyFilters = () => renderHistoryRows(currentItems);
    if (historySearchInput) historySearchInput.addEventListener('input', applyFilters);
    if (historyStatusFilter) historyStatusFilter.addEventListener('change', applyFilters);

    if (historyRefreshBtn) {
        historyRefreshBtn.addEventListener('click', () => {
            currentPage = 1;
            loadQuoteHistory(getToken());
        });
    }

    const historyClearBtn = document.getElementById('history-clear-btn');
    if (historyClearBtn) {
        historyClearBtn.addEventListener('click', async () => {
            if (!confirm(t('history.confirmClear') || '确定清理全部报价历史记录？此操作不可恢复。')) return;
            try {
                const resp = await fetch('/api/quote/history', {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${getToken()}` },
                });
                if (!resp.ok) throw new Error('清理失败');
                // Reset state and reload — don't depend on response being JSON
                currentPage = 1;
                totalRecords = 0;
                await loadQuoteHistory(getToken());
            } catch (e) {
                alert(e.message || '清理失败');
            }
        });
    }

    if (openQuoteHistoryBtn) {
        openQuoteHistoryBtn.addEventListener('click', () => {
            document.getElementById('user-dropdown')?.classList.add('hidden');
            quoteHistoryModal?.classList.remove('hidden');
            currentPage = 1;
            loadQuoteHistory(getToken());
        });
    }

    const close = () => quoteHistoryModal?.classList.add('hidden');
    if (historyCloseBtn) historyCloseBtn.addEventListener('click', close);
    if (quoteHistoryBackdrop) quoteHistoryBackdrop.addEventListener('click', close);

    // Event delegation for pagination, re-quote, and delete buttons
    if (paginationContainer) {
        paginationContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-page]');
            if (!btn) return;
            const page = parseInt(btn.dataset.page, 10);
            if (page >= 1 && page <= getTotalPages()) {
                currentPage = page;
                loadQuoteHistory(getToken());
            }
        });
    }

    if (historyTbody) {
        historyTbody.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (deleteBtn) {
                handleDelete(deleteBtn.dataset.id);
                return;
            }
        });
    }
}

// ── Delete a single history record ──
async function handleDelete(id) {
    if (!id) return;
    if (!confirm(t('history.confirmDelete'))) return;

    const token = getToken();
    if (!token) return;

    try {
        const resp = await fetch(`/api/quote/history/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (resp.ok) {
            showToast(t('history.deleteSuccess'), 'success');
            // Reload current page (adjust if last item on page)
            const totalPages = getTotalPages();
            if (currentPage > totalPages) currentPage = totalPages;
            loadQuoteHistory(token);
        } else if (resp.status === 404) {
            // Endpoint not implemented yet — show friendly message
            showToast(t('history.deleteNotAvailable'), 'info');
        } else {
            showToast(t('history.deleteFailed'), 'error');
        }
    } catch (e) {
        // Network error or endpoint doesn't exist
        showToast(t('history.deleteNotAvailable'), 'info');
    }
}

// ── Pagination controls ──
function renderPagination() {
    if (!paginationContainer) return;
    const totalPages = getTotalPages();

    if (totalRecords === 0) {
        paginationContainer.innerHTML = '';
        return;
    }

    const offset = (currentPage - 1) * PAGE_SIZE;
    const from = offset + 1;
    const to = Math.min(offset + PAGE_SIZE, totalRecords);

    let pageButtons = '';

    // Previous button
    pageButtons += `<button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}
        class="px-2.5 py-1 text-xs border rounded-md ${currentPage <= 1 ? 'text-gray-300 border-gray-200 cursor-not-allowed' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}">${t('history.prevPage')}</button>`;

    // Page number buttons (show max 5 pages around current)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
        pageButtons += `<button data-page="1" class="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">1</button>`;
        if (startPage > 2) pageButtons += `<span class="px-1 text-gray-400 text-xs">…</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
        if (p === currentPage) {
            pageButtons += `<button data-page="${p}" class="px-2.5 py-1 text-xs border border-indigo-500 rounded-md bg-indigo-50 text-indigo-600 font-medium">${p}</button>`;
        } else {
            pageButtons += `<button data-page="${p}" class="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">${p}</button>`;
        }
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pageButtons += `<span class="px-1 text-gray-400 text-xs">…</span>`;
        pageButtons += `<button data-page="${totalPages}" class="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50">${totalPages}</button>`;
    }

    // Next button
    pageButtons += `<button data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}
        class="px-2.5 py-1 text-xs border rounded-md ${currentPage >= totalPages ? 'text-gray-300 border-gray-200 cursor-not-allowed' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}">${t('history.nextPage')}</button>`;

    paginationContainer.innerHTML = `
        <div class="flex items-center justify-between w-full">
            <span class="text-xs text-gray-500">${t('history.pageInfo', { from, to, total: totalRecords })}</span>
            <div class="flex items-center gap-1">${pageButtons}</div>
        </div>
    `;
}

function renderHistoryRows(items) {
    if (!historyTbody) return;
    const keyword = (historySearchInput?.value || '').trim().toLowerCase();
    const status = historyStatusFilter?.value || 'all';
    const filteredItems = (items || []).filter((item) => {
        const searchable = `${item.filename || ''} ${item.material || ''} ${item.printer_model || ''}`.toLowerCase();
        return (!keyword || searchable.includes(keyword)) && (status === 'all' || item.status === status);
    });
    const successCount = (items || []).filter((item) => item.status === 'success').length;
    const failedCount = (items || []).length - successCount;
    const totalCost = (items || []).reduce((sum, item) => sum + (Number(item.cost_cny) || 0), 0);
    if (historySummary) historySummary.textContent = `本页 ${items?.length || 0} 条 · 成功 ${successCount} · 失败 ${failedCount} · ¥${totalCost.toFixed(2)}`;
    if (!filteredItems.length) {
        historyTbody.innerHTML = `<tr><td class="px-3 py-10 text-gray-400 text-center" colspan="15"><p class="text-sm">${items?.length ? '没有符合筛选条件的记录' : t('history.noRecords')}</p><p class="text-xs mt-1 text-gray-300">${items?.length ? '请调整搜索词或状态筛选' : t('history.noRecordsSubtext')}</p></td></tr>`;
        return;
    }
    historyTbody.innerHTML = filteredItems.map(item => {
        const ts = item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-';
        const statusBadge = item.status === 'success'
            ? '<span class="tw-badge-success">● ' + t('history.success') + '</span>'
            : `<span class="tw-badge-failed" title="${escapeHtml(item.error_msg || '')}">● ${t('history.failed')}</span>`;
        const deleteBtn = `<button data-action="delete" data-id="${item.id}" class="text-xs tw-text-danger hover:underline" title="${t('common.delete')}">${t('common.delete')}</button>`;
        return `<tr class="border-t border-gray-100 hover:bg-gray-50">
            <td class="px-3 py-2 text-gray-500 whitespace-nowrap">${ts}</td>
            <td class="px-3 py-2 max-w-[150px] truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</td>
            <td class="px-3 py-2">${escapeHtml(item.printer_model || '-')}</td>
            <td class="px-3 py-2">${item.nozzle_diameter || '-'}</td>
            <td class="px-3 py-2">${item.layer_height || '-'}</td>
            <td class="px-3 py-2">${item.wall_count || '-'}</td>
            <td class="px-3 py-2">${item.infill ? item.infill + '%' : '-'}</td>
            <td class="px-3 py-2">${escapeHtml(item.material)}</td>
            <td class="px-3 py-2">${item.quantity}</td>
            <td class="px-3 py-2">${item.volume_cm3}</td>
            <td class="px-3 py-2">${item.weight_g}</td>
            <td class="px-3 py-2">${formatTimeHMS(item.estimated_time_h)}</td>
            <td class="px-3 py-2 font-medium tw-text-primary">¥${item.cost_cny}</td>
            <td class="px-3 py-2">${statusBadge}</td>
            <td class="px-3 py-2 whitespace-nowrap">${deleteBtn}</td>
        </tr>`;
    }).join('');
}

// ── Toast notification (lightweight) ──
function showToast(message, type = 'info') {
    let container = document.getElementById('history-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'history-toast-container';
        container.className = 'fixed top-4 right-4 z-[60] flex flex-col gap-2';
        document.body.appendChild(container);
    }
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-500',
        info: 'bg-gray-700',
    };
    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.info} text-white text-xs px-4 py-2 rounded-md shadow-lg opacity-0 transition-opacity duration-300`;
    toast.textContent = message;
    container.appendChild(toast);
    // Fade in
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

export async function loadQuoteHistory(token) {
    if (!token || !historyTbody) return;
    const offset = (currentPage - 1) * PAGE_SIZE;
    try {
        const resp = await fetch(`/api/quote/history?limit=${PAGE_SIZE}&offset=${offset}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();

        totalRecords = data.total || 0;

        currentItems = data.items || [];
        renderHistoryRows(currentItems);
        renderPagination();
    } catch (e) {
        historyTbody.innerHTML = '<tr><td class="px-3 py-4 text-gray-400 text-center" colspan="15">' + t('common.loadError') + '</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
    }
}
