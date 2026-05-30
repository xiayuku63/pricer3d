// ── Quote history modal ──
import { escapeHtml, formatTimeHMS } from './state.js';
import { t } from './i18n.js';

let historyTbody, quoteHistoryModal, quoteHistoryBackdrop;

export function initQuoteHistory() {
    historyTbody = document.getElementById('history-tbody');
    quoteHistoryModal = document.getElementById('quote-history-modal');
    quoteHistoryBackdrop = document.getElementById('quote-history-backdrop');
    const historyRefreshBtn = document.getElementById('history-refresh-btn');
    const historyCloseBtn = document.getElementById('history-close-btn');
    const openQuoteHistoryBtn = document.getElementById('open-quote-history-btn');

    const getToken = () => {
        try {
            const raw = localStorage.getItem('pricer3d_session');
            if (raw) return JSON.parse(raw).token || '';
        } catch (e) {}
        return '';
    };

    if (historyRefreshBtn) {
        historyRefreshBtn.addEventListener('click', () => loadQuoteHistory(getToken()));
    }

    if (openQuoteHistoryBtn) {
        openQuoteHistoryBtn.addEventListener('click', () => {
            document.getElementById('user-dropdown')?.classList.add('hidden');
            quoteHistoryModal?.classList.remove('hidden');
            loadQuoteHistory(getToken());
        });
    }

    const close = () => quoteHistoryModal?.classList.add('hidden');
    if (historyCloseBtn) historyCloseBtn.addEventListener('click', close);
    if (quoteHistoryBackdrop) quoteHistoryBackdrop.addEventListener('click', close);
}

export async function loadQuoteHistory(token) {
    if (!token || !historyTbody) return;
    try {
        const resp = await fetch('/api/quote/history?limit=50', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.items || data.items.length === 0) {
            historyTbody.innerHTML = '<tr><td class="px-3 py-12 text-gray-400 text-center" colspan="9"><div class="text-6xl mb-3">📭</div><p class="text-sm">' + t('history.noRecords') + '</p><p class="text-xs mt-1 text-gray-300">' + t('history.noRecordsSubtext') + '</p></td></tr>';
            return;
        }
        historyTbody.innerHTML = data.items.map(item => {
            const ts = item.created_at ? new Date(item.created_at + 'Z').toLocaleString('zh-CN') : '-';
            const statusBadge = item.status === 'success'
                ? '<span class="text-green-600 font-medium">' + t('history.success') + '</span>'
                : `<span class="text-red-500 font-medium" title="${escapeHtml(item.error_msg || '')}">` + t('history.failed') + '</span>';
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
            </tr>`;
        }).join('');
    } catch (e) {
        historyTbody.innerHTML = '<tr><td class="px-3 py-4 text-gray-400 text-center" colspan="9">' + t('common.loadError') + '</td></tr>';
    }
}
