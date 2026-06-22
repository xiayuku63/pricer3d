// ── Quote: row/card editing, material info, comparison, exports ──
// Duplicated code has been moved to split modules:
//   quote-render.js  — table rendering, sort, pagination, cost breakdown
//   quote-api.js     — quote API calls, results management
//   quote-batch.js   — batch edit bar operations
//   quote-data.js    — MATERIAL_INFO database

import {
    authToken, currentUser,
    quoteOptions, selectedFilesMap, thumbnailMap,
    currentResults, setCurrentResults,
    MATERIAL_OPTIONS, PRICING_CONFIG, COLOR_OPTIONS,
    authFetch, formatColorLabel, formatTimeHMS, escapeHtml,
    renderColorDropdown, getColorsForMaterial,
    colorToObj, isColorInAllowedColors, pickAllowedColor,
    getActivePrinterCompoundId,
    getCachedPrinterModels, slicerPresets,
    getUsedBrandOptions as getBrandOptions, getMaterialsByBrand,
} from './state.js';
import { buildPlaceholderThumbnail, ensureThumbnailForFile, buildThumbnails } from './preview.js';
import { loadQuoteHistory } from './history.js';
import { t, lang } from './i18n.js';
import { uploadWithProgress, showProgress, updateProgress, showProgressSuccess, showProgressError, hideProgress, showToast } from './upload.js';

// ── Import from split modules ──
import {
    _sortState, _paginationState, renderResultsTable,
    recalcSummaryFromCurrentResults, refreshOptionsSummary,
    openMaterialCompare,
} from './quote-render.js';
import {
    quoteSingleFileWithOptions, quoteSelectedFiles, quoteSelectedFilesWithProgress,
    mergeResultsByFilename, normalizeResultsWithCurrentOptions, reQuoteAllSelectedFiles,
    abortActiveRecalc,
} from './quote-api.js';
import {
    refreshBatchBrandDropdown, refreshBatchMaterialDropdown,
    refreshBatchColorDropdown, batchApplyToAll,
} from './quote-batch.js';
import { MATERIAL_INFO } from './quote-data.js';
import { updateBedSize, setBedLabel } from './viewer.js';

// ── Re-export all public symbols for backward compatibility ──
export {
    renderResultsTable,
    recalcSummaryFromCurrentResults,
    refreshOptionsSummary,
    openMaterialCompare,
    quoteSingleFileWithOptions,
    quoteSelectedFiles,
    quoteSelectedFilesWithProgress,
    mergeResultsByFilename,
    normalizeResultsWithCurrentOptions,
    reQuoteAllSelectedFiles,
    abortActiveRecalc,
    refreshBatchBrandDropdown,
    refreshBatchMaterialDropdown,
    refreshBatchColorDropdown,
    batchApplyToAll,
};

let dom = {};
let _openLoginModal = null;  // lazy-init to break circular dep with auth.js
export function setOpenLoginModalRef(fn) { _openLoginModal = fn; }

export function initQuote(d) {
    dom = d;
    // Initialize DOM refs in split modules
    // (quote-api.js uses _dom for error display in _quoteSelectedFilesInternal)
    // Note: setApiDom and setBatchDom are called separately from quote-api.js and quote-batch.js
}

// ── Initialize table sort & pagination event listeners ──
export function initTableEnhancements() {
    // Sort: click on thead th[data-sort-key]
    const thead = document.querySelector('thead');
    if (thead) {
        thead.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort-key]');
            if (!th) return;
            const key = th.getAttribute('data-sort-key');
            if (_sortState.key === key) {
                _sortState.direction = _sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                _sortState.key = key;
                _sortState.direction = 'asc';
            }
            _paginationState.page = 1;
            renderResultsTable();
        });
    }

    // Pagination buttons
    const btnFirst = document.getElementById('page-first');
    const btnPrev = document.getElementById('page-prev');
    const btnNext = document.getElementById('page-next');
    const btnLast = document.getElementById('page-last');
    const pageSizeSelect = document.getElementById('page-size-select');

    if (btnFirst) btnFirst.addEventListener('click', () => { _paginationState.page = 1; renderResultsTable(); });
    if (btnPrev) btnPrev.addEventListener('click', () => { if (_paginationState.page > 1) { _paginationState.page--; renderResultsTable(); } });
    if (btnNext) btnNext.addEventListener('click', () => { _paginationState.page++; renderResultsTable(); });
    if (btnLast) btnLast.addEventListener('click', () => {
        const totalPages = Math.ceil(currentResults.length / _paginationState.pageSize);
        _paginationState.page = Math.max(1, totalPages);
        renderResultsTable();
    });
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', () => {
            _paginationState.pageSize = Number(pageSizeSelect.value);
            _paginationState.page = 1;
            renderResultsTable();
        });
    }

    // Column resize handles
    _initColumnResize();
}

function _initColumnResize() {
    const table = document.querySelector('table.min-w-full');
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, idx) => {
        // Skip last column (actions)
        if (idx === ths.length - 1) return;
        const handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        th.style.position = 'relative';
        th.appendChild(handle);

        let startX, startWidth;
        const onMouseMove = (e) => {
            const diff = e.clientX - startX;
            const newWidth = Math.max(50, startWidth + diff);
            th.style.width = newWidth + 'px';
            th.style.minWidth = newWidth + 'px';
            const cells = table.querySelectorAll(`tbody td:nth-child(${idx + 1})`);
            cells.forEach(cell => {
                cell.style.width = newWidth + 'px';
                cell.style.minWidth = newWidth + 'px';
            });
        };
        const onMouseUp = () => {
            handle.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = th.offsetWidth;
            handle.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

// ── Tag color utility ──
function _tagColorClasses(color) {
    const map = {
        green: 'bg-green-100 text-green-700 border-green-200',
        blue: 'bg-blue-100 text-blue-700 border-blue-200',
        red: 'bg-red-100 text-red-700 border-red-200',
        orange: 'bg-orange-100 text-orange-700 border-orange-200',
        purple: 'bg-purple-100 text-purple-700 border-purple-200',
        indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        cyan: 'bg-cyan-100 text-cyan-700 border-cyan-200',
        violet: 'bg-violet-100 text-violet-700 border-violet-200',
        teal: 'bg-teal-100 text-teal-700 border-teal-200',
        pink: 'bg-pink-100 text-pink-700 border-pink-200',
        amber: 'bg-amber-100 text-amber-700 border-amber-200',
        rose: 'bg-rose-100 text-rose-700 border-rose-200',
        yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
        gray: 'bg-gray-100 text-gray-700 border-gray-200',
        sky: 'bg-sky-100 text-sky-700 border-sky-200',
    };
    return map[color] || map.gray;
}

// ── Material property bar color map ──
const _propBarColors = {
    heatResist: { bg: 'bg-red-100', bar: 'bg-red-500', label: '耐热' },
    strength: { bg: 'bg-orange-100', bar: 'bg-orange-500', label: '强度' },
    flexibility: { bg: 'bg-pink-100', bar: 'bg-pink-500', label: '柔韧' },
    detail: { bg: 'bg-indigo-100', bar: 'bg-indigo-500', label: '细节' },
    cost: { bg: 'bg-green-100', bar: 'bg-green-500', label: '性价比' },
};

// ── Material info rendering ──
function _buildMaterialInfoHtml(materialName) {
    const info = MATERIAL_INFO[materialName];
    if (!info) return '';

    let html = '<div class="mt-2 p-3 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl shadow-sm">';
    html += '<div class="text-[11px] font-semibold text-blue-700 mb-2 flex items-center gap-1.5">';
    html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    html += materialName + ' 材料说明</div>';

    if (info.tags && info.tags.length > 0) {
        html += '<div class="flex flex-wrap gap-1 mb-2">';
        info.tags.forEach(tag => {
            const cls = _tagColorClasses(tag.color);
            html += '<span class="inline-flex items-center gap-0.5 border rounded-full px-2 py-0.5 text-[9px] font-medium ' + cls + '">' + tag.icon + ' ' + tag.label + '</span>';
        });
        html += '</div>';
    }

    html += '<p class="text-[10px] text-gray-600 mb-2.5 leading-relaxed bg-white/60 rounded-lg px-2.5 py-1.5 border border-blue-100">' + info.desc + '</p>';

    if (info.properties) {
        html += '<div class="mb-2 bg-white/60 rounded-lg p-2 border border-blue-100">';
        html += '<div class="text-[10px] font-semibold text-blue-700 mb-1.5 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>材料特性评分</div>';
        html += '<div class="space-y-1">';
        Object.entries(info.properties).forEach(([key, val]) => {
            const cfg = _propBarColors[key];
            if (!cfg) return;
            const pct = Math.max(5, (val / 5) * 100);
            html += '<div class="flex items-center gap-1.5">';
            html += '<span class="text-[9px] text-gray-500 w-8 text-right">' + cfg.label + '</span>';
            html += '<div class="flex-1 h-2 rounded-full ' + cfg.bg + ' overflow-hidden"><div class="h-full rounded-full ' + cfg.bar + '" style="width:' + pct + '%"></div></div>';
            html += '<span class="text-[9px] text-gray-600 w-4">' + val + '</span>';
            html += '</div>';
        });
        html += '</div>';
        if (info.properties.heatResist) {
            html += '<div class="mt-1 text-[9px] text-gray-400">耐热温度：约 ' + info.properties.heatResist + '°C</div>';
        }
        html += '</div>';
    }

    html += '<div class="grid grid-cols-2 gap-2 text-[10px]">';
    html += '<div class="bg-white/50 rounded-lg p-2 border border-green-100"><span class="font-semibold text-green-700 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>优点</span><ul class="space-y-0.5">';
    info.pros.forEach(p => { html += '<li class="text-gray-600 leading-snug">· ' + p + '</li>'; });
    html += '</ul></div>';
    html += '<div class="bg-white/50 rounded-lg p-2 border border-red-100"><span class="font-semibold text-red-600 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>缺点</span><ul class="space-y-0.5">';
    info.cons.forEach(c => { html += '<li class="text-gray-600 leading-snug">· ' + c + '</li>'; });
    html += '</ul></div>';
    html += '</div>';

    html += '<div class="mt-2 bg-white/50 rounded-lg p-2 border border-blue-100">';
    html += '<span class="text-[10px] font-semibold text-blue-600 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>适用场景</span>';
    html += '<div class="flex flex-wrap gap-1">';
    info.uses.forEach(u => { html += '<span class="inline-block bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 text-[9px]">' + u + '</span>'; });
    html += '</div></div>';

    if (info.warnings && info.warnings.length > 0) {
        html += '<div class="mt-2 bg-amber-50 rounded-lg p-2 border border-amber-200">';
        html += '<span class="text-[10px] font-semibold text-amber-700 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>注意事项</span>';
        html += '<ul class="space-y-0.5">';
        info.warnings.forEach(w => { html += '<li class="text-[9px] text-amber-700 leading-snug">⚠ ' + w + '</li>'; });
        html += '</ul></div>';
    }

    html += '<div class="mt-2 flex justify-end">';
    html += '<button type="button" data-compare-material="' + materialName + '" class="text-[10px] text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 rounded-lg px-3 py-1 flex items-center gap-1 transition-colors">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
    html += '对比其他材料</button>';
    html += '</div>';

    html += '</div>';
    return html;
}

// ── Material comparison modal ──
function _buildMaterialComparisonHtml(baseMaterial) {
    const baseInfo = MATERIAL_INFO[baseMaterial];
    if (!baseInfo) return '';

    const allMaterials = Object.keys(MATERIAL_INFO);

    let html = '<div id="material-compare-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">';
    html += '<div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">';
    html += '<div class="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between">';
    html += '<div class="flex items-center gap-2">';
    html += '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
    html += '<span class="text-lg font-bold">材料对比</span>';
    html += '</div>';
    html += '<button type="button" data-close-compare class="text-white/80 hover:text-white transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>';
    html += '</div>';

    html += '<div class="p-4">';
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-[11px] border-collapse">';

    html += '<thead><tr class="border-b-2 border-gray-200">';
    html += '<th class="text-left py-2 px-3 text-gray-500 font-medium bg-gray-50 rounded-tl-lg">特性</th>';
    allMaterials.forEach(mat => {
        const isBase = mat === baseMaterial;
        html += '<th class="text-center py-2 px-3 ' + (isBase ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-700 font-medium') + '">' + mat + (isBase ? ' <span class="text-[9px] bg-blue-200 text-blue-800 rounded px-1">当前</span>' : '') + '</th>';
    });
    html += '</tr></thead>';

    html += '<tbody>';

    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50">简介</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        html += '<td class="py-2 px-3 text-[10px] text-gray-600 ' + (isBase ? 'bg-blue-50/50' : '') + '">' + (info ? info.desc.substring(0, 60) + '...' : '-') + '</td>';
    });
    html += '</tr>';

    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50">标签</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        let tagsHtml = '';
        if (info && info.tags) {
            tagsHtml = '<div class="flex flex-wrap gap-0.5 justify-center">';
            info.tags.forEach(tag => {
                tagsHtml += '<span class="text-[8px] border rounded-full px-1.5 py-0.5 ' + _tagColorClasses(tag.color) + '">' + tag.icon + tag.label + '</span>';
            });
            tagsHtml += '</div>';
        }
        html += '<td class="py-2 px-3 ' + (isBase ? 'bg-blue-50/50' : '') + '">' + tagsHtml + '</td>';
    });
    html += '</tr>';

    const propLabels = { heatResist: '耐热温度', strength: '强度', flexibility: '柔韧性', detail: '细节精度', cost: '性价比' };
    Object.entries(propLabels).forEach(([key, label]) => {
        html += '<tr class="border-b border-gray-100">';
        html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50">' + label + '</td>';
        allMaterials.forEach(mat => {
            const info = MATERIAL_INFO[mat];
            const isBase = mat === baseMaterial;
            const val = info && info.properties ? info.properties[key] : 0;
            const cfg = _propBarColors[key];
            const pct = Math.max(5, (val / 5) * 100);
            let cellHtml = '<div class="flex items-center gap-1 justify-center">';
            cellHtml += '<div class="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full ' + (cfg ? cfg.bar : 'bg-gray-400') + '" style="width:' + pct + '%"></div></div>';
            cellHtml += '<span class="text-[9px] font-medium">' + val + '/5</span>';
            cellHtml += '</div>';
            if (key === 'heatResist' && info && info.properties) {
                cellHtml += '<div class="text-[8px] text-gray-400 text-center mt-0.5">~' + info.properties.heatResist + '°C</div>';
            }
            html += '<td class="py-2 px-3 ' + (isBase ? 'bg-blue-50/50' : '') + '">' + cellHtml + '</td>';
        });
        html += '</tr>';
    });

    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50 align-top">优点</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        let prosHtml = '<ul class="space-y-0.5 text-[9px] text-green-700">';
        if (info) info.pros.forEach(p => { prosHtml += '<li>✓ ' + p + '</li>'; });
        prosHtml += '</ul>';
        html += '<td class="py-2 px-3 align-top ' + (isBase ? 'bg-blue-50/50' : '') + '">' + prosHtml + '</td>';
    });
    html += '</tr>';

    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50 align-top">缺点</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        let consHtml = '<ul class="space-y-0.5 text-[9px] text-red-600">';
        if (info) info.cons.forEach(c => { consHtml += '<li>✗ ' + c + '</li>'; });
        consHtml += '</ul>';
        html += '<td class="py-2 px-3 align-top ' + (isBase ? 'bg-blue-50/50' : '') + '">' + consHtml + '</td>';
    });
    html += '</tr>';

    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50 align-top">适用场景</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        let usesHtml = '<div class="flex flex-wrap gap-0.5 justify-center">';
        if (info) info.uses.forEach(u => { usesHtml += '<span class="inline-block bg-blue-50 text-blue-600 rounded-full px-1.5 py-0.5 text-[8px]">' + u + '</span>'; });
        usesHtml += '</div>';
        html += '<td class="py-2 px-3 align-top ' + (isBase ? 'bg-blue-50/50' : '') + '">' + usesHtml + '</td>';
    });
    html += '</tr>';

    html += '</tbody></table>';
    html += '</div>';

    html += '<div class="mt-4 pt-3 border-t border-gray-200 flex flex-wrap gap-3 justify-center text-[9px] text-gray-400">';
    html += '<span>评分说明：1=最低 5=最高</span>';
    html += '<span>·</span>';
    html += '<span>耐热温度为近似值</span>';
    html += '</div>';

    html += '</div></div></div>';
    return html;
}

// ── Material comparison modal open/close (quote-render.js has its own version, this is kept for internal use) ──
// openMaterialCompare and closeMaterialCompare are now in quote-render.js

// ── Print suggestions rendering ──
function _buildPrintSuggestionHtml(item) {
    const info = MATERIAL_INFO[item.material];
    if (!info) return '';

    let html = '<div class="mt-2 p-3 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl shadow-sm">';
    html += '<div class="text-[11px] font-semibold text-green-700 mb-2 flex items-center gap-1.5">';
    html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>';
    html += '打印建议</div>';

    const bd = item.cost_breakdown;
    const gcode = bd && bd.gcode_summary;
    if (gcode && gcode.core_params) {
        const cp = gcode.core_params;
        html += '<div class="mb-2 bg-white/60 rounded-lg p-2 border border-green-100">';
        html += '<div class="text-[10px] font-semibold text-green-700 mb-1 flex items-center gap-1">';
        html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';
        html += '当前切片参数</div>';
        html += '<div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">';
        const paramItems = [];
        if (cp.layer_height) paramItems.push(['层高', cp.layer_height + 'mm']);
        if (cp.perimeters) paramItems.push(['壁厚', cp.perimeters + '层']);
        if (cp.fill_density) paramItems.push(['填充率', cp.fill_density + '%']);
        if (cp.nozzle_diameter) paramItems.push(['喷嘴', cp.nozzle_diameter + 'mm']);
        if (cp.support_material) paramItems.push(['支撑', cp.support_material === '1' ? '开启' : '关闭']);
        if (gcode.layer_count) paramItems.push(['总层数', gcode.layer_count]);
        paramItems.forEach(([k, v]) => {
            html += '<div class="flex justify-between"><span class="text-gray-500">' + k + '</span><span class="text-gray-700 font-medium">' + v + '</span></div>';
        });
        html += '</div></div>';
    }

    html += '<div class="bg-white/60 rounded-lg p-2 border border-green-100 mb-2">';
    html += '<div class="text-[10px] font-semibold text-green-700 mb-1 flex items-center gap-1">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>';
    html += '打印参数建议</div>';
    html += '<p class="text-[10px] text-gray-600 leading-relaxed">' + info.tips + '</p>';
    html += '</div>';

    html += '<div class="bg-white/60 rounded-lg p-2 border border-green-100">';
    html += '<div class="text-[10px] font-semibold text-green-700 mb-1 flex items-center gap-1">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>';
    html += '后处理建议</div>';
    if (item.material === 'PLA') {
        html += '<ul class="text-[10px] text-gray-600 space-y-0.5">';
        html += '<li>· 可打磨后喷漆，砂纸逐级打磨（120→400→800目）</li>';
        html += '<li>· 支撑去除后可用小刀修整表面</li>';
        html += '<li>· 如需光滑表面，可使用腻子填补层纹后打磨</li>';
        html += '</ul>';
    } else if (item.material === 'ABS') {
        html += '<ul class="text-[10px] text-gray-600 space-y-0.5">';
        html += '<li>· 可用丙酮蒸汽抛光获得光滑表面</li>';
        html += '<li>· 也可打磨后喷漆处理</li>';
        html += '<li>· ABS胶水可用于粘接零件</li>';
        html += '</ul>';
    } else {
        html += '<p class="text-[10px] text-gray-600">建议根据实际需要进行打磨、喷漆等后处理。</p>';
    }
    html += '</div>';

    html += '<div class="mt-2 flex justify-end">';
    html += '<button type="button" data-requote-file="' + escapeHtml(item.filename) + '" class="text-[10px] text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300 rounded-lg px-3 py-1 flex items-center gap-1 transition-colors">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
    html += '重新报价此文件</button>';
    html += '</div>';

    html += '</div>';
    return html;
}

// ── Results table ──

// Helper: build preview button HTML for a result row
function _buildPreviewHtml(item, ext) {
    const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
    const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
    return isRealThumbnail
        ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors"><img src="${thumbnail}" alt="静态图" class="w-32 h-20 object-cover bg-white" /></button>`
        : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5">预览</button>`;
}

// Helper: build per-file printer + preset dropdowns HTML
function _buildRowDropdownsHtml(item) {
    const printerModels = getCachedPrinterModels();
    const selectedPrinterId = (item._printer_model || '').replace(/_\d{2}$/, '');
    const pmOptions = printerModels.map(p =>
        `<option value="${p.id}" ${p.id === selectedPrinterId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    const presets = slicerPresets || [];
    const presetOptions = ['<option value="">' + t('quote.presetNone') + '</option>',
        ...presets.map(p => `<option value="${p.id}" ${String(p.id) === String(item._slicer_preset_id || '') ? 'selected' : ''}>${p.name || '#' + p.id}</option>`)
    ].join('');
    return { pmOptions, presetOptions };
}

// Helper: build the common first 7 columns (filename, preview, printer, preset, material, color, quantity)
function _buildCommonRowHtml(item, ext, selectedMaterial, selectedColor, quantityValue) {
    const previewButtonHtml = _buildPreviewHtml(item, ext);
    const { pmOptions, presetOptions } = _buildRowDropdownsHtml(item);
    const materialOptionsHtml = MATERIAL_OPTIONS.map((m) => `<option value="${m.name}" ${m.name === selectedMaterial ? 'selected' : ''}>${m.name}</option>`).join('');
    const renderedRowColors = renderColorDropdown(selectedMaterial, selectedColor, true);
    return {
        previewButtonHtml, pmOptions, presetOptions, materialOptionsHtml,
        renderedRowColors,
        cols: `<td class="px-2 py-1.5">${item.filename}</td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="_printer_model" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[110px]">${pmOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_slicer_preset_id" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[100px]">${presetOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${quantityValue}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>`,
    };
}


// ── 卡片编辑事件处理（与表格行编辑共用逻辑） ──
export function handleCardEditChange(event) {
    const target = event.target;
    if (!target.classList.contains('card-edit')) return;
    const card = target.closest('[data-card-file]');
    if (!card) return;
    const filename = card.getAttribute('data-card-file');
    if (_rowEditTimers.has(filename)) { clearTimeout(_rowEditTimers.get(filename)); }
    // Abort any in-flight request for this file
    const oldCtrl = _rowEditAbortControllers.get(filename);
    if (oldCtrl) { oldCtrl.abort(); _rowEditAbortControllers.delete(filename); }
    _rowEditTimers.set(filename, setTimeout(async () => {
        _rowEditTimers.delete(filename);
        const controller = new AbortController();
        _rowEditAbortControllers.set(filename, controller);
        await _handleCardEdit(card, filename, controller.signal);
        if (_rowEditAbortControllers.get(filename) === controller) _rowEditAbortControllers.delete(filename);
    }, 400));
}

async function _handleCardEdit(card, filename, abortSignal) {
    const { errorContainer, errorMsg } = dom;
    if (!authToken) {
        if (errorMsg) { errorMsg.textContent = '请先登录后再修改报价参数'; errorContainer.classList.remove('hidden'); }
        _openLoginModal?.(); return;
    }
    const file = selectedFilesMap.get(filename);
    if (!file) return;
    const material = card.querySelector('[data-field="material"]').value;
    const quantity = Number.parseInt(card.querySelector('[data-field="quantity"]').value, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
        if (errorMsg) { errorMsg.textContent = t('quote.countMustBePositive'); errorContainer.classList.remove('hidden'); }
        return;
    }
    const pmSel = card.querySelector('[data-field="_printer_model"]');
    const spSel = card.querySelector('[data-field="_slicer_preset_id"]');
    const pm = pmSel ? pmSel.value : '';
    const sp = spSel ? (spSel.value ? Number(spSel.value) : null) : null;
    if (errorContainer) errorContainer.classList.add('hidden');

    const idx = currentResults.findIndex((i) => i.filename === filename);
    const prevItem = idx >= 0 ? { ...currentResults[idx] } : null;
    if (idx >= 0) {
        // Immediately update color in currentResults so preview sees the correct color
        currentResults[idx] = { ...currentResults[idx], color: currentColor, _recalculating: true };
    }
    renderResultsTable();

    try {
        const currentColor = idx >= 0 ? (currentResults[idx].color || quoteOptions.color) : quoteOptions.color;
        await ensureThumbnailForFile(file, currentColor);
        if (abortSignal.aborted) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        const opts = { material, color: currentColor, quantity, _printer_model: pm };
        if (sp !== null) opts._slicer_preset_id = sp;
        const updated = await quoteSingleFileWithOptions(file, opts, abortSignal);
        if (abortSignal.aborted) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        if (idx >= 0) {
            // Preserve the card-selected color; do NOT let the API response overwrite it
            currentResults[idx] = {
                ...updated,
                color: currentColor,
                _printer_model: pm || prevItem?._printer_model,
            };
            if (sp !== null) currentResults[idx]._slicer_preset_id = sp;
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    } catch (err) {
        // AbortError: 静默处理
        if (err.name === 'AbortError' || abortSignal.aborted) return;
        if (prevItem && idx >= 0) currentResults[idx] = prevItem;
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        if (errorMsg) { errorMsg.textContent = err.message; errorContainer.classList.remove('hidden'); }
    }
}

// ── 导出功能 ──
function _cleanPrinter(name) {
    return (name || '').replace(/_\d{2}$/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w+/g, w => {
            if (/^[A-Za-z]{1,2}\d+[A-Za-z]*$/.test(w)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        });
}

export function exportCSV() {
    if (!currentResults.length) return;
    const headers = ['文件名', '材料品牌', '打印机', '材料', '颜色', '数量', '层高(mm)', '填充率(%)', '体积(cm³)', '重量(g)', '打印时间(h)', '单价(CNY)', '总价(CNY)', '状态'];
    const rows = currentResults.map(item => {
        const brand = (MATERIAL_OPTIONS.find(m => m.name === item.material) || {}).brand || '';
        const printer = _cleanPrinter(item._printer_model || '');
        const bd = item.cost_breakdown || {};
        const gcode = bd.gcode_summary || {};
        const cp = gcode.core_params || {};
        return [
            item.filename, brand, printer, item.material || '', item.color || '',
            item.quantity || 1, cp.layer_height || '', cp.fill_density || '',
            item.volume_cm3 || '', item.weight_g || '', item.estimated_time_h || '',
            item.unit_cost_cny || '', item.cost_cny || '',
            item.status === 'success' ? '成功' : (item.error || '失败'),
        ];
    });
    const csvContent = [headers, ...rows].map(row =>
        row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
    ).join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `报价结果_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export function exportExcel() {
    if (!currentResults.length) return;
    const headers = ['文件名', '材料品牌', '打印机', '材料', '颜色', '数量', '层高(mm)', '填充率(%)', '体积(cm³)', '重量(g)', '打印时间(h)', '单价(CNY)', '总价(CNY)', '状态'];
    const rows = currentResults.map(item => {
        const brand = (MATERIAL_OPTIONS.find(m => m.name === item.material) || {}).brand || '';
        const printer = _cleanPrinter(item._printer_model || '');
        const bd = item.cost_breakdown || {};
        const gcode = bd.gcode_summary || {};
        const cp = gcode.core_params || {};
        return [
            item.filename, brand, printer, item.material || '', item.color || '',
            item.quantity || 1, cp.layer_height || '', cp.fill_density || '',
            item.volume_cm3 || '', item.weight_g || '', item.estimated_time_h || '',
            item.unit_cost_cny || '', item.cost_cny || '',
            item.status === 'success' ? '成功' : (item.error || '失败'),
        ];
    });

    const colorColIdx = 4;
    let styles = {};
    let styleCounter = 0;
    rows.forEach(row => {
        const hex = String(row[colorColIdx] || '').trim();
        if (hex && /^#?[0-9a-fA-F]{6}$/.test(hex)) {
            const clean = hex.startsWith('#') ? hex : '#' + hex;
            if (!styles[clean]) {
                const sid = 'color' + (++styleCounter);
                styles[clean] = sid;
            }
        }
    });

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';

    xml += '<Styles>\n';
    xml += '<Style ss:ID="header"><Font ss:Bold="1" ss:Size="11" ss:Color="#ffffff"/><Interior ss:Color="#1e293b" ss:Pattern="Solid"/></Style>\n';
    Object.entries(styles).forEach(([hex, sid]) => {
        const c = hex.replace('#', '').toUpperCase();
        xml += `<Style ss:ID="${sid}"><Interior ss:Color="#${c}" ss:Pattern="Solid"/><Font ss:Size="9"/></Style>\n`;
    });
    xml += '</Styles>\n';

    xml += '<Worksheet ss:Name="报价结果"><Table>\n';
    xml += '<Row>';
    headers.forEach(h => { xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${h}</Data></Cell>`; });
    xml += '</Row>\n';
    rows.forEach(row => {
        xml += '<Row>';
        row.forEach((cell, ci) => {
            const type = (typeof cell === 'number' || (typeof cell === 'string' && /^[\d.]+$/.test(cell) && cell !== '')) ? 'Number' : 'String';
            if (ci === colorColIdx) {
                const hex = String(cell || '').trim();
                const clean = hex.startsWith('#') ? hex : (hex ? '#' + hex : '');
                const sid = styles[clean];
                if (sid) {
                    xml += `<Cell ss:StyleID="${sid}"><Data ss:Type="String">${escapeHtml(String(cell))}</Data></Cell>`;
                } else {
                    xml += `<Cell><Data ss:Type="${type}">${escapeHtml(String(cell))}</Data></Cell>`;
                }
            } else {
                xml += `<Cell><Data ss:Type="${type}">${escapeHtml(String(cell))}</Data></Cell>`;
            }
        });
        xml += '</Row>\n';
    });
    xml += '</Table></Worksheet></Workbook>';

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `报价结果_${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Row editing ──
const _rowEditTimers = new Map();
const _rowEditAbortControllers = new Map();

export function handleRowEditChange(event) {
    const target = event.target;
    if (!target.classList.contains('row-edit')) return;
    const row = target.closest('tr[data-row-file]');
    if (!row) return;
    const filename = row.getAttribute('data-row-file');
    if (_rowEditTimers.has(filename)) { clearTimeout(_rowEditTimers.get(filename)); }
    // Abort any in-flight request for this file
    const oldCtrl = _rowEditAbortControllers.get(filename);
    if (oldCtrl) { oldCtrl.abort(); _rowEditAbortControllers.delete(filename); }
    _rowEditTimers.set(filename, setTimeout(async () => {
        _rowEditTimers.delete(filename);
        const controller = new AbortController();
        _rowEditAbortControllers.set(filename, controller);
        await _handleRowEdit(event, controller.signal);
        if (_rowEditAbortControllers.get(filename) === controller) _rowEditAbortControllers.delete(filename);
    }, 400));
}

async function _handleRowEdit(event, abortSignal) {
    const { errorContainer, errorMsg } = dom;
    const target = event.target;
    if (!authToken) {
        if (errorMsg) { errorMsg.textContent = '请先登录后再修改报价参数'; errorContainer.classList.remove('hidden'); }
        _openLoginModal?.(); return;
    }
    const row = target.closest('tr[data-row-file]');
    if (!row) return;
    const filename = row.getAttribute('data-row-file');
    const file = selectedFilesMap.get(filename);
    if (!file) return;

    // ── Brand → Material 联动 ──
    const brandSelect = row.querySelector('[data-field="_brand"]');
    if (target === brandSelect && brandSelect) {
        const brand = brandSelect.value;
        const materials = getMaterialsByBrand(brand);
        const materialSelect = row.querySelector('[data-field="material"]');
        if (materialSelect) {
            const prevMaterial = materialSelect.value;
            materialSelect.innerHTML = materials.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
            if (materials.find(m => m.name === prevMaterial)) {
                materialSelect.value = prevMaterial;
            } else if (materials.length > 0) {
                materialSelect.value = materials[0].name;
            }
            const colorCell = row.querySelector('[data-field="color"]');
            const newMaterial = materialSelect.value;
            const currentColorInput = colorCell ? colorCell.querySelector('.row-color-value') : null;
            const currentColor = currentColorInput ? currentColorInput.value : '';
            const rendered = renderColorDropdown(newMaterial, currentColor, true);
            if (colorCell) colorCell.innerHTML = rendered.html;
        }
        if (!materialSelect || !materialSelect.classList.contains('row-edit')) return;
    }

    const materialSelect = row.querySelector('[data-field="material"]');
    const colorCell = row.querySelector('[data-field="color"]');
    const colorValueInput = colorCell ? colorCell.querySelector('.row-color-value') : null;
    const material = materialSelect.value;
    const currentColor = colorValueInput ? colorValueInput.value : '';
    const rendered = renderColorDropdown(material, currentColor, true);
    if (target === materialSelect && colorCell) {
        colorCell.innerHTML = rendered.html;
    }
    const newColorValueInput = colorCell ? colorCell.querySelector('.row-color-value') : null;
    const color = newColorValueInput ? newColorValueInput.value : rendered.selected;
    const quantity = Number.parseInt(row.querySelector('[data-field="quantity"]').value, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
        if (errorMsg) { errorMsg.textContent = t('quote.countMustBePositive'); errorContainer.classList.remove('hidden'); }
        return;
    }
    const pmSel = row.querySelector('[data-field="_printer_model"]');
    const spSel = row.querySelector('[data-field="_slicer_preset_id"]');
    const pm = pmSel ? pmSel.value : '';
    // ── 当打印机型号变更时，更新 3D 预览底板 ──
    if (target.getAttribute('data-field') === '_printer_model') {
        const printerModels = getCachedPrinterModels();
        const printer = printerModels.find(function(p) { return p.id === pm; });
        if (printer && printer.bed_width && printer.bed_depth) {
            setBedLabel(printer.bed_width, printer.bed_depth, printer.bed_height);
            updateBedSize(printer.bed_width, printer.bed_depth);
        }
    }
    const sp = spSel ? (spSel.value ? Number(spSel.value) : null) : null;
    if (errorContainer) errorContainer.classList.add('hidden');
    row.querySelector('[data-role="status-cell"]').innerHTML = '<span class="inline-block w-2 h-2 rounded-full mr-1 align-middle bg-amber-500"></span>' + t('quote.recalculating');
    row.querySelector('[data-role="status-cell"]').className = 'px-2 py-1.5 text-amber-600';

    const idx = currentResults.findIndex((i) => i.filename === filename);
    const prevItem = idx >= 0 ? { ...currentResults[idx] } : null;
    if (idx >= 0) {
        // Immediately update color in currentResults so previewByFilename sees the new color
        currentResults[idx] = { ...currentResults[idx], color, status: 'success', _recalculating: true, cost_cny: 0 };
    }
    recalcSummaryFromCurrentResults();

    try {
        await ensureThumbnailForFile(file, color);
        if (abortSignal.aborted) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        const opts = { material, color, quantity, _printer_model: pm };
        if (sp !== null) opts._slicer_preset_id = sp;
        const updated = await quoteSingleFileWithOptions(file, opts, abortSignal);
        if (abortSignal.aborted) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        if (idx >= 0) {
            // Preserve the dropdown-selected color; do NOT let the API response overwrite it
            const dropdownColor = color;  // captured from the .row-color-value at line ~786
            currentResults[idx] = {
                ...updated,
                color: dropdownColor,
                _printer_model: pm || prevItem._printer_model,
            };
            if (sp !== null) {
                currentResults[idx]._slicer_preset_id = sp;
            }
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    } catch (err) {
        // AbortError: 静默处理
        if (err.name === 'AbortError' || abortSignal.aborted) return;
        if (prevItem && idx >= 0) {
            currentResults[idx] = prevItem;
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        if (errorMsg) { errorMsg.textContent = err.message; errorContainer.classList.remove('hidden'); }
        row.querySelector('[data-role="status-cell"]').innerHTML = '<span title="' + escapeHtml(err.message) + '">失败</span>';
        row.querySelector('[data-role="status-cell"]').className = 'px-2 py-1.5 text-red-600';
    }
}
