// ── Quote history modal ──
import { escapeHtml, formatTimeHMS, quoteOptions } from './state.js';
import { t } from './i18n.js';

let historyTbody, quoteHistoryModal, quoteHistoryBackdrop;
let paginationContainer;

// ── Pagination state ──
const PAGE_SIZE = 20;
let currentPage = 1;
let totalRecords = 0;

function getToken() {
    try {
        const raw = localStorage.getItem('pricer3d_session');
        if (raw) return JSON.parse(raw).token || '';
    } catch (e) {}
    return '';
}

function getTotalPages() {
    return Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
}

export function initQuoteHistory() {
    historyTbody = document.getElementById('history-tbody');
    quoteHistoryModal = document.getElementById('quote-history-modal');
    quoteHistoryBackdrop = document.getElementById('quote-history-backdrop');
    paginationContainer = document.getElementById('history-pagination');
    const historyRefreshBtn = document.getElementById('history-refresh-btn');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const openQuoteHistoryBtn = document.getElementById('open-quote-history-btn');

    if (historyRefreshBtn) {
        historyRefreshBtn.addEventListener('click', () => {
            currentPage = 1;
            loadQuoteHistory(getToken());
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
            const reQuoteBtn = e.target.closest('[data-action="requote"]');
            if (reQuoteBtn) {
                handleReQuote(reQuoteBtn.dataset);
                return;
            }
            const deleteBtn = e.target.closest('[data-action="delete"]');
            if (deleteBtn) {
                handleDelete(deleteBtn.dataset.id);
                return;
            }
        });
    }
}

// ── Re-quote: fill history item params back into the quote form ──
async function handleReQuote(data) {
    const material = data.material || '';
    const color = data.color || '';
    const quantity = parseInt(data.quantity, 10) || 1;

    // Update global quoteOptions
    quoteOptions.material = material || quoteOptions.material;
    quoteOptions.color = color || quoteOptions.color;
    quoteOptions.quantity = quantity || quoteOptions.quantity;

    // Dynamic import to avoid circular dependency with quote.js
    try {
        const quote = await import('./quote.js');
        quote.refreshBatchMaterialDropdown();
        quote.refreshBatchColorDropdown();
        quote.refreshOptionsSummary();
    } catch (e) {
        // Fallback: quote module not yet loaded, options already updated
    }

    // Close history modal
    quoteHistoryModal?.classList.add('hidden');

    // Scroll to upload zone for user to re-upload the file
    const uploadZone = document.getElementById('upload-zone') || document.querySelector('[data-upload-zone]');
    if (uploadZone) {
        uploadZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight effect
        uploadZone.classList.add('ring-2', 'ring-indigo-400', 'ring-offset-2');
        setTimeout(() => uploadZone.classList.remove('ring-2', 'ring-indigo-400', 'ring-offset-2'), 2500);
    }

    // Show inline notification
    showToast(t('history.requoteReady', { material, color, quantity }));
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

        if (!data.items || data.items.length === 0) {
            historyTbody.innerHTML = '<tr><td class="px-3 py-12 text-gray-400 text-center" colspan="10"><div class="text-6xl mb-3">📭</div><p class="text-sm">' + t('history.noRecords') + '</p><p class="text-xs mt-1 text-gray-300">' + t('history.noRecordsSubtext') + '</p></td></tr>';
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        historyTbody.innerHTML = data.items.map(item => {
            const ts = item.created_at ? new Date(item.created_at + 'Z').toLocaleString('zh-CN') : '-';
            const statusBadge = item.status === 'success'
                ? '<span class="text-green-600 font-medium">' + t('history.success') + '</span>'
                : `<span class="text-red-500 font-medium" title="${escapeHtml(item.error_msg || '')}">` + t('history.failed') + '</span>';

            // Re-quote button
            const reQuoteBtn = `<button data-action="requote" data-material="${escapeHtml(item.material || '')}" data-color="${escapeHtml(item.color || '')}" data-quantity="${item.quantity || 1}" class="text-indigo-600 hover:text-indigo-800 hover:underline text-[11px] px-1" title="${t('history.requote')}">${t('history.requote')}</button>`;

            // Delete button
            const deleteBtn = `<button data-action="delete" data-id="${item.id}" class="text-red-400 hover:text-red-600 hover:underline text-[11px] px-1" title="${t('common.delete')}">${t('common.delete')}</button>`;

            return `<tr class="border-t border-gray-100 hover:bg-gray-50">
                <td class="px-3 py-2 text-gray-500">${ts}</td>
                <td class="px-3 py-2 max-w-[120px] truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</td>
                <td class="px-3 py-2">${escapeHtml(item.material)}</td>
                <td class="px-3 py-2">${item.quantity}</td>
                <td class="px-3 py-2">${item.volume_cm3}</td>
                <td class="px-3 py-2">${item.weight_g}</td>
                <td class="px-3 py-2">${formatTimeHMS(item.estimated_time_h)}</td>
                <td class="px-3 py-2 font-medium text-indigo-600">¥${item.cost_cny}</td>
                <td class="px-3 py-2">${statusBadge}</td>
                <td class="px-3 py-2 whitespace-nowrap">${reQuoteBtn}${deleteBtn}</td>
            </tr>`;
        }).join('');

        renderPagination();
    } catch (e) {
        historyTbody.innerHTML = '<tr><td class="px-3 py-4 text-gray-400 text-center" colspan="10">' + t('common.loadError') + '</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
    }
}
