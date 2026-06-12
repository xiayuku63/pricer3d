// ── Quote: options, API, results rendering, row editing ──
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

} from './state.js';
import { buildPlaceholderThumbnail, ensureThumbnailForFile, buildThumbnails } from './preview.js';
import { loadQuoteHistory } from './history.js';
import { t, lang } from './i18n.js';
import { uploadWithProgress, showProgress, updateProgress, showProgressSuccess, showProgressError, hideProgress, showToast } from './upload.js';
import {
    _sortState, _paginationState, renderResultsTable,
} from './quote-render.js';
export { renderResultsTable };
let dom = {};
let _openLoginModal = null;  // lazy-init to break circular dep with auth.js
export function setOpenLoginModalRef(fn) { _openLoginModal = fn; }

export function initQuote(d) { dom = d; }

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
            // Apply same width to all cells in this column
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

// ── Material Info Database ──
const MATERIAL_INFO = {
    'PLA': {
        desc: '聚乳酸（PLA）是最常用的FDM 3D打印材料，由玉米淀粉等可再生资源制成，环保可降解。',
        tags: [
            { label: '环保', color: 'green', icon: '♻️' },
            { label: '易打印', color: 'blue', icon: '🖨️' },
            { label: '低成本', color: 'gray', icon: '💰' },
        ],
        properties: { heatResist: 60, strength: 3, flexibility: 2, detail: 4, cost: 5 },
        pros: ['打印温度低（190-220°C），不易翘曲', '表面质量好，细节还原度高', '颜色丰富，价格实惠', '环保可降解'],
        cons: ['耐热性较差（约60°C开始变形)', '韧性一般，不适合高应力零件', '长期暴露紫外线下会变脆'],
        uses: ['原型验证', '展示模型', '教学演示', '手办人偶', '室内装饰品'],
        tips: '建议层高0.1-0.2mm，填充率15-25%。如需更高强度可适当提高填充率或增加壁厚。打印平台温度建议50-60°C。',
        warnings: ['不耐高温，避免装盛热饮或置于车内', '长期户外使用建议改用ASA或PETG'],
    },
    'ABS': {
        desc: '丙烯腈-丁二烯-苯乙烯共聚物（ABS）是工程级热塑性材料，具有良好的韧性和耐热性。',
        tags: [
            { label: '耐热', color: 'red', icon: '🔥' },
            { label: '高强度', color: 'orange', icon: '💪' },
            { label: '工程级', color: 'purple', icon: '⚙️' },
        ],
        properties: { heatResist: 100, strength: 4, flexibility: 3, detail: 3, cost: 3 },
        pros: ['韧性好，耐冲击', '耐热性较高（约100°C)', '可丙酮蒸汽抛光获得光滑表面', '适合功能性零件'],
        cons: ['打印时易翘曲，需要热床（100°C+)', '打印时有刺激性气味', '需要密闭打印仓效果最佳'],
        uses: ['功能原型', '机械零件', '电子设备外壳', '汽车配件', '耐热零件'],
        tips: '建议层高0.15-0.25mm，填充率20-50%。热床温度100-110°C，打印仓温度50°C+。建议使用ABS胶水或Kapton胶带防止翘边。',
        warnings: ['打印时务必保持通风', '翘边严重时考虑使用Brim或Raft'],
    },
    'Resin': {
        desc: '光敏树脂（Resin）通过UV光固化成型，属于SLA/DLP/LCD打印技术，精度极高。',
        tags: [
            { label: '高精度', color: 'indigo', icon: '🔬' },
            { label: '光滑表面', color: 'cyan', icon: '✨' },
            { label: '细节王', color: 'violet', icon: '🎭' },
        ],
        properties: { heatResist: 50, strength: 2, flexibility: 1, detail: 5, cost: 2 },
        pros: ['精度极高（0.01-0.05mm层高)', '表面光滑，几乎无层纹', '细节还原度极高', '可选多种特殊性能树脂'],
        cons: ['材料成本较高', '打印后需要UV后固化', '未固化树脂有毒，需手套操作', '模型较脆，不适合高应力零件'],
        uses: ['珠宝首饰原型', '牙科模型', '手办细节件', '微型建筑模型', '精密零件'],
        tips: '建议层高0.025-0.05mm。打印后需用酒精清洗并UV固化。建议佩戴手套操作未固化树脂。',
        warnings: ['未固化树脂有毒，操作时务必佩戴丁腈手套', '废弃树脂不可倒入下水道，需固化后丢弃'],
    },
    'PETG': {
        desc: 'PETG（聚对苯二甲酸乙二醇酯-1,4-环己烷二甲醇酯）兼具PLA的易打印性和ABS的耐用性，是实用型零件的理想选择。',
        tags: [
            { label: '耐候', color: 'teal', icon: '🌤️' },
            { label: '食品级可选', color: 'green', icon: '🍎' },
            { label: '耐化学', color: 'blue', icon: '🧪' },
        ],
        properties: { heatResist: 80, strength: 4, flexibility: 3, detail: 3, cost: 3 },
        pros: ['韧性好，不易翘曲', '耐化学腐蚀', '耐候性好，可户外使用', '食品安全级可选'],
        cons: ['拉丝现象较严重', '表面不如PLA光滑', '打印速度相对较慢'],
        uses: ['户外用品', '食品容器', '机械零件', '防护外壳', '水族器材'],
        tips: '建议层高0.1-0.2mm，打印温度230-250°C，热床80°C。回抽距离适当增加以减少拉丝。',
        warnings: ['打印时拉丝较多，需调整回抽参数', '首层粘合力强，建议使用PEI或胶棒'],
    },
    'TPU': {
        desc: 'TPU（热塑性聚氨酯）是一种柔性3D打印材料，具有优异的弹性和耐磨性。',
        tags: [
            { label: '柔性', color: 'pink', icon: '🤸' },
            { label: '耐磨', color: 'amber', icon: '🛡️' },
            { label: '弹性体', color: 'rose', icon: '🔄' },
        ],
        properties: { heatResist: 75, strength: 3, flexibility: 5, detail: 2, cost: 3 },
        pros: ['高弹性，可弯曲变形', '耐磨耐撕裂', '减震性能好', '耐油耐低温'],
        cons: ['打印速度慢', '需要直接驱动挤出机效果最佳', '不易打印高精度细节'],
        uses: ['手机壳', '鞋垫', '密封圈', '减震垫', '柔性铰链'],
        tips: '建议层高0.1-0.2mm，打印速度20-30mm/s。务必使用直接驱动挤出机，回抽距离最小化。',
        warnings: ['Bowden管挤出机打印困难', '打印速度不宜过快'],
    },
    'ASA': {
        desc: 'ASA（丙烯腈-苯乙烯-丙烯酸酯）是ABS的户外升级版，具有优异的抗紫外线和耐候性能。',
        tags: [
            { label: '抗UV', color: 'yellow', icon: '☀️' },
            { label: '户外级', color: 'orange', icon: '🏔️' },
            { label: '耐候', color: 'teal', icon: '🌧️' },
        ],
        properties: { heatResist: 100, strength: 4, flexibility: 3, detail: 3, cost: 2 },
        pros: ['优异的抗紫外线性能', '耐候性极佳', '机械性能与ABS相当', '可丙酮抛光'],
        cons: ['打印时有气味', '需要热床和封闭打印仓', '价格较高'],
        uses: ['户外标志', '汽车外饰件', '户外家具配件', '无人机部件', '船舶配件'],
        tips: '建议层高0.15-0.25mm，打印温度240-260°C，热床100-110°C。建议封闭打印仓。',
        warnings: ['打印时保持通风', '翘边风险较高，建议使用Brim'],
    },
    'Nylon': {
        desc: '尼龙（Nylon/PA）是高性能工程塑料，具有极高的强度、韧性和耐磨性。',
        tags: [
            { label: '高强度', color: 'red', icon: '💪' },
            { label: '耐磨', color: 'amber', icon: '🛡️' },
            { label: '工程级', color: 'purple', icon: '⚙️' },
        ],
        properties: { heatResist: 120, strength: 5, flexibility: 4, detail: 3, cost: 1 },
        pros: ['极高的强度和韧性', '优异的耐磨性', '耐高温', '可染色'],
        cons: ['吸湿性强，需干燥保存', '打印难度大', '需要高温喷嘴（250°C+）', '价格较高'],
        uses: ['齿轮', '轴承', '高强度结构件', '功能性原型', '耐磨零件'],
        tips: '建议层高0.1-0.2mm，打印温度250-270°C，热床70-80°C。务必干燥材料，湿度<20%。',
        warnings: ['材料极易吸湿，务必使用干燥箱保存', '打印前需在70°C烘干6-8小时'],
    },
    'PC': {
        desc: '聚碳酸酯（PC）是透明度最高的工程塑料之一，兼具高强度和高耐热性。',
        tags: [
            { label: '透明', color: 'sky', icon: '💎' },
            { label: '高耐热', color: 'red', icon: '🔥' },
            { label: '高强度', color: 'orange', icon: '💪' },
        ],
        properties: { heatResist: 140, strength: 5, flexibility: 3, detail: 3, cost: 1 },
        pros: ['耐热性极高（140°C）', '透明度好', '强度极高', '阻燃性好'],
        cons: ['打印温度极高（280-320°C）', '易翘曲', '需要封闭加热仓', '价格昂贵'],
        uses: ['耐热零件', '透明罩壳', '电子绝缘件', '工程结构件', '光学部件'],
        tips: '建议层高0.1-0.2mm，打印温度280-310°C，热床120-130°C。务必使用封闭加热仓。',
        warnings: ['需要高温喷嘴和封闭仓', '翘边风险极高，建议使用Brim和胶水'],
    },
};

// ── Cost breakdown rendering ──
function _buildCostBreakdownHtml(item) {
    const bd = item.cost_breakdown;
    if (!bd || typeof bd !== 'object') return '';

    const materialCost = Number(bd.material_cost_cny || 0);
    const machineCost = Number(bd.machine_cost_cny || 0);
    const postCost = Number(bd.post_process_cost_per_part_cny || 0);
    const supportCost = Number(bd.support_cost_per_part_cny || 0);
    const setupFee = Number(bd.setup_fee_cny || 0);
    const unitPrice = Number(item.unit_cost_cny || 0);
    const totalPrice = Number(item.cost_cny || 0);
    const quantity = item.quantity || 1;
    const wastePercent = Number(bd.material_waste_percent || 0);

    // Additional detail fields from backend
    const slicerFilamentG = bd.slicer_filament_g_per_part != null ? Number(bd.slicer_filament_g_per_part) : null;
    const slicerTimeS = bd.slicer_estimated_time_s != null ? Number(bd.slicer_estimated_time_s) : null;
    const prusaTimeCorrection = Number(bd.prusa_time_correction || 1.0);
    const supportWeightG = Number(bd.support_weight_g_per_part || 0);
    const supportPricePerG = Number(bd.support_price_per_g || 0);
    const subtotalCny = Number(bd.subtotal_cny || 0);
    const minJobFeeCny = Number(bd.min_job_fee_cny || 0);
    const effectiveWeightG = Number(item.effective_weight_g || 0) / Math.max(1, quantity);

    // Member discount info
    const discountPercent = Number(bd.member_discount_percent || 0);
    const discountCny = Number(bd.member_discount_cny || 0);

    // Calculate proportions for visual bars
    const rawTotal = materialCost + machineCost + postCost + supportCost + setupFee;
    const pct = (val) => rawTotal > 0 ? Math.max(2, (val / rawTotal * 100)) : 0;

    // Helper: format seconds to readable time
    const _fmtTime = (s) => {
        if (!s || s <= 0) return '-';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.round(s % 60);
        if (h > 0) return h + '时' + m + '分' + sec + '秒';
        if (m > 0) return m + '分' + sec + '秒';
        return sec + '秒';
    };

    // ── Section header ──
    let html = '<div class="mt-2 p-3 bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 rounded-xl shadow-sm">';
    html += '<div class="text-[11px] font-semibold text-gray-700 mb-2 flex items-center gap-1.5">';
    html += '<svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
    html += '费用明细';
    if (quantity > 1) html += '<span class="text-[10px] font-normal text-gray-400 ml-1">（单件 × ' + quantity + '）</span>';
    html += '</div>';

    // ── Cost proportion bar ──
    if (rawTotal > 0) {
        html += '<div class="flex h-3 rounded-full overflow-hidden mb-1 bg-gray-200">';
        const barColors = ['bg-indigo-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-400'];
        const barItems = [
            materialCost > 0 ? { label: '材料', val: materialCost, color: barColors[0] } : null,
            machineCost > 0 ? { label: '机器', val: machineCost, color: barColors[1] } : null,
            postCost > 0 ? { label: '后处理', val: postCost, color: barColors[2] } : null,
            supportCost > 0 ? { label: '支撑', val: supportCost, color: barColors[3] } : null,
            setupFee > 0 ? { label: '开机', val: setupFee, color: barColors[4] } : null,
        ].filter(Boolean);
        barItems.forEach((b) => {
            const p = pct(b.val);
            html += '<div class="' + b.color + '" style="width:' + p + '%" title="' + b.label + ' ¥' + b.val.toFixed(2) + ' (' + Math.round(p) + '%)"></div>';
        });
        html += '</div>';
        // Legend below bar
        html += '<div class="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">';
        barItems.forEach((b) => {
            const p = pct(b.val);
            html += '<span class="flex items-center gap-1 text-[9px] text-gray-500">';
            html += '<span class="w-2 h-2 rounded-full inline-block ' + b.color + '"></span>';
            html += b.label + ' ' + Math.round(p) + '%</span>';
        });
        html += '</div>';
    }

    // ══════════════════════════════════════════════
    // ── 1. 材料费明细 ──
    // ══════════════════════════════════════════════
    html += '<div class="mb-2 bg-white/70 rounded-lg border border-indigo-100 overflow-hidden">';
    html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-indigo-50/80">';
    html += '<span class="text-[10px] font-semibold text-indigo-700 flex items-center gap-1">🧱 材料费</span>';
    html += '<span class="text-[11px] font-bold text-indigo-600">¥ ' + materialCost.toFixed(2) + '</span>';
    html += '</div>';
    html += '<div class="px-2.5 py-1.5 space-y-0.5">';
    if (slicerFilamentG != null && slicerFilamentG > 0) {
        const pricePerKg = materialCost > 0 && effectiveWeightG > 0 ? (materialCost / effectiveWeightG * 1000) : 0;
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">切片实际用量</span><span class="text-gray-700 font-medium">' + slicerFilamentG.toFixed(1) + ' g</span></div>';
        if (wastePercent > 0) {
            const wasteG = slicerFilamentG * wastePercent / 100;
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">损耗（' + wastePercent + '%）</span><span class="text-amber-600 font-medium">+ ' + wasteG.toFixed(1) + ' g</span></div>';
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">计费重量</span><span class="text-gray-700 font-medium">' + effectiveWeightG.toFixed(1) + ' g</span></div>';
        }
        if (pricePerKg > 0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">材料单价</span><span class="text-gray-700 font-medium">¥ ' + pricePerKg.toFixed(0) + ' /kg</span></div>';
        }
        html += '<div class="flex justify-between text-[10px] text-indigo-500"><span>计算</span><span>' + effectiveWeightG.toFixed(1) + 'g × ¥' + (pricePerKg / 1000).toFixed(2) + '/g</span></div>';
    } else if (effectiveWeightG > 0) {
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">模型重量</span><span class="text-gray-700 font-medium">' + effectiveWeightG.toFixed(1) + ' g</span></div>';
        if (wastePercent > 0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">含损耗</span><span class="text-amber-600 font-medium">' + wastePercent + '%</span></div>';
        }
    } else {
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">材料费</span><span class="text-gray-700 font-medium">¥ ' + materialCost.toFixed(2) + '</span></div>';
    }
    html += '</div></div>';

    // ══════════════════════════════════════════════
    // ── 2. 机器时间费明细 ──
    // ══════════════════════════════════════════════
    html += '<div class="mb-2 bg-white/70 rounded-lg border border-violet-100 overflow-hidden">';
    html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-violet-50/80">';
    html += '<span class="text-[10px] font-semibold text-violet-700 flex items-center gap-1">⏱️ 机器时间费</span>';
    html += '<span class="text-[11px] font-bold text-violet-600">¥ ' + machineCost.toFixed(2) + '</span>';
    html += '</div>';
    html += '<div class="px-2.5 py-1.5 space-y-0.5">';
    const unitTimeH = Number(item.unit_time_h || (item.estimated_time_h ? item.estimated_time_h / Math.max(1, quantity) : 0));
    const unitTimeS = unitTimeH * 3600;
    if (slicerTimeS != null && slicerTimeS > 0) {
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">切片预估时间</span><span class="text-gray-700 font-medium">' + _fmtTime(slicerTimeS) + '</span></div>';
        if (prusaTimeCorrection !== 1.0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">时间校正系数</span><span class="text-gray-700 font-medium">×' + prusaTimeCorrection.toFixed(2) + '</span></div>';
        }
    }
    if (unitTimeH > 0) {
        const hourlyRate = machineCost > 0 && unitTimeH > 0 ? (machineCost / unitTimeH) : 0;
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">单件打印时间</span><span class="text-gray-700 font-medium">' + _fmtTime(unitTimeS) + '</span></div>';
        if (quantity > 1) {
            const totalTimeH = Number(item.estimated_time_h || 0);
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">总打印时间</span><span class="text-gray-700 font-medium">' + _fmtTime(totalTimeH * 3600) + '</span></div>';
        }
        if (hourlyRate > 0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">机台费率</span><span class="text-gray-700 font-medium">¥ ' + hourlyRate.toFixed(2) + ' /小时</span></div>';
            html += '<div class="flex justify-between text-[10px] text-violet-500"><span>计算</span><span>' + unitTimeH.toFixed(2) + 'h × ¥' + hourlyRate.toFixed(2) + '/h</span></div>';
        }
    } else {
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">机器时间费</span><span class="text-gray-700 font-medium">¥ ' + machineCost.toFixed(2) + '</span></div>';
    }
    html += '</div></div>';

    // ══════════════════════════════════════════════
    // ── 3. 后处理费明细 ──
    // ══════════════════════════════════════════════
    if (postCost > 0) {
        html += '<div class="mb-2 bg-white/70 rounded-lg border border-amber-100 overflow-hidden">';
        html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-amber-50/80">';
        html += '<span class="text-[10px] font-semibold text-amber-700 flex items-center gap-1">✨ 后处理费</span>';
        html += '<span class="text-[11px] font-bold text-amber-600">¥ ' + postCost.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div class="px-2.5 py-1.5 space-y-0.5">';
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">每件后处理费</span><span class="text-gray-700 font-medium">¥ ' + postCost.toFixed(2) + '</span></div>';
        if (quantity > 1) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">后处理合计</span><span class="text-amber-600 font-medium">¥ ' + (postCost * quantity).toFixed(2) + '</span></div>';
        }
        html += '</div></div>';
    }

    // ══════════════════════════════════════════════
    // ── 4. 支撑材料费明细 ──
    // ══════════════════════════════════════════════
    if (supportCost > 0 || supportWeightG > 0) {
        html += '<div class="mb-2 bg-white/70 rounded-lg border border-emerald-100 overflow-hidden">';
        html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-emerald-50/80">';
        html += '<span class="text-[10px] font-semibold text-emerald-700 flex items-center gap-1">🔧 支撑材料费</span>';
        html += '<span class="text-[11px] font-bold text-emerald-600">¥ ' + supportCost.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div class="px-2.5 py-1.5 space-y-0.5">';
        if (supportWeightG > 0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">支撑材料重量</span><span class="text-gray-700 font-medium">' + supportWeightG.toFixed(2) + ' g</span></div>';
        }
        if (supportPricePerG > 0) {
            html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">支撑单价</span><span class="text-gray-700 font-medium">¥ ' + supportPricePerG.toFixed(2) + ' /g</span></div>';
            if (supportWeightG > 0) {
                html += '<div class="flex justify-between text-[10px] text-emerald-500"><span>计算</span><span>' + supportWeightG.toFixed(2) + 'g × ¥' + supportPricePerG.toFixed(2) + '/g</span></div>';
            }
        }
        html += '</div></div>';
    }

    // ══════════════════════════════════════════════
    // ── 5. 开机费 ──
    // ══════════════════════════════════════════════
    if (setupFee > 0) {
        html += '<div class="mb-2 bg-white/70 rounded-lg border border-rose-100 overflow-hidden">';
        html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-rose-50/80">';
        html += '<span class="text-[10px] font-semibold text-rose-700 flex items-center gap-1">🔌 开机费</span>';
        html += '<span class="text-[11px] font-bold text-rose-600">¥ ' + setupFee.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div class="px-2.5 py-1.5">';
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">固定上机费</span><span class="text-gray-700 font-medium">¥ ' + setupFee.toFixed(2) + '</span></div>';
        html += '</div></div>';
    }

    // ══════════════════════════════════════════════
    // ── 会员折扣 ──
    // ══════════════════════════════════════════════
    if (discountPercent > 0) {
        html += '<div class="mb-2 bg-white/70 rounded-lg border border-amber-200 overflow-hidden">';
        html += '<div class="flex items-center justify-between px-2.5 py-1.5 bg-amber-50/80">';
        html += '<span class="text-[10px] font-semibold text-amber-700 flex items-center gap-1">🎫 会员折扣</span>';
        html += '<span class="text-[11px] font-bold text-amber-600">-¥ ' + discountCny.toFixed(2) + '</span>';
        html += '</div>';
        html += '<div class="px-2.5 py-1.5">';
        html += '<div class="flex justify-between text-[10px]"><span class="text-gray-500">折扣比例</span><span class="text-amber-600 font-medium">-' + discountPercent + '%</span></div>';
        html += '</div></div>';
    }

    // ══════════════════════════════════════════════
    // ── 费用汇总（构成分解） ──
    // ══════════════════════════════════════════════
    html += '<div class="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg border border-indigo-200 overflow-hidden">';
    html += '<div class="px-2.5 py-1.5 bg-indigo-100/60">';
    html += '<span class="text-[10px] font-semibold text-indigo-700 flex items-center gap-1">📊 总成本构成</span>';
    html += '</div>';
    html += '<div class="px-2.5 py-2 space-y-1">';

    // Stacked summary row for each component
    const summaryItems = [
        { label: '材料费', value: materialCost, color: 'text-indigo-600', barColor: 'bg-indigo-400' },
        { label: '机器时间费', value: machineCost, color: 'text-violet-600', barColor: 'bg-violet-400' },
    ];
    if (postCost > 0) summaryItems.push({ label: '后处理费', value: postCost, color: 'text-amber-600', barColor: 'bg-amber-400' });
    if (supportCost > 0) summaryItems.push({ label: '支撑材料费', value: supportCost, color: 'text-emerald-600', barColor: 'bg-emerald-400' });
    if (setupFee > 0) summaryItems.push({ label: '开机费', value: setupFee, color: 'text-rose-600', barColor: 'bg-rose-400' });

    summaryItems.forEach((r) => {
        const p = pct(r.value);
        html += '<div class="flex items-center gap-2 text-[10px]">';
        html += '<div class="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div class="' + r.barColor + ' h-full rounded-full" style="width:' + p + '%"></div></div>';
        html += '<span class="text-gray-500 flex-1">' + r.label + '</span>';
        html += '<span class="' + r.color + ' font-medium w-12 text-right">¥ ' + r.value.toFixed(2) + '</span>';
        html += '<span class="text-gray-400 w-10 text-right">' + Math.round(p) + '%</span>';
        html += '</div>';
    });

    // Subtotal line
    if (subtotalCny > 0) {
        html += '<div class="border-t border-indigo-200/50 mt-1 pt-1 flex justify-between text-[10px]">';
        html += '<span class="text-gray-500">小计（单价×数量 + 开机费）</span>';
        html += '<span class="text-gray-700 font-medium">¥ ' + subtotalCny.toFixed(2) + '</span>';
        html += '</div>';
    }

    // Min job fee note
    if (minJobFeeCny > 0 && subtotalCny > 0 && subtotalCny < minJobFeeCny) {
        html += '<div class="flex justify-between text-[10px] text-amber-600">';
        html += '<span>最低起步价</span>';
        html += '<span class="font-medium">¥ ' + minJobFeeCny.toFixed(2) + '</span>';
        html += '</div>';
    }

    // Unit price
    html += '<div class="border-t border-indigo-200 mt-1.5 pt-1.5 flex justify-between items-baseline text-[11px] font-semibold">';
    html += '<span class="text-gray-600">单价</span>';
    html += '<span class="text-indigo-600 text-sm">¥ ' + unitPrice.toFixed(2) + '</span>';
    html += '</div>';

    // Total price (when quantity > 1)
    if (quantity > 1) {
        html += '<div class="flex justify-between items-baseline text-[12px] font-bold mt-0.5">';
        html += '<span class="text-gray-700">总价（×' + quantity + '）</span>';
        html += '<span class="text-indigo-700 text-base">¥ ' + totalPrice.toFixed(2) + '</span>';
        html += '</div>';
    }

    html += '</div></div>';

    html += '</div>';
    return html;
}

// ── Material property bar color map ──
const _propBarColors = {
    heatResist: { bg: 'bg-red-100', bar: 'bg-red-500', label: '耐热' },
    strength: { bg: 'bg-orange-100', bar: 'bg-orange-500', label: '强度' },
    flexibility: { bg: 'bg-pink-100', bar: 'bg-pink-500', label: '柔韧' },
    detail: { bg: 'bg-indigo-100', bar: 'bg-indigo-500', label: '细节' },
    cost: { bg: 'bg-green-100', bar: 'bg-green-500', label: '性价比' },
};

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

// ── Material info rendering ──
function _buildMaterialInfoHtml(materialName) {
    const info = MATERIAL_INFO[materialName];
    if (!info) return '';

    let html = '<div class="mt-2 p-3 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl shadow-sm">';
    html += '<div class="text-[11px] font-semibold text-blue-700 mb-2 flex items-center gap-1.5">';
    html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    html += materialName + ' 材料说明</div>';

    // ── Material tags ──
    if (info.tags && info.tags.length > 0) {
        html += '<div class="flex flex-wrap gap-1 mb-2">';
        info.tags.forEach(tag => {
            const cls = _tagColorClasses(tag.color);
            html += '<span class="inline-flex items-center gap-0.5 border rounded-full px-2 py-0.5 text-[9px] font-medium ' + cls + '">' + tag.icon + ' ' + tag.label + '</span>';
        });
        html += '</div>';
    }

    html += '<p class="text-[10px] text-gray-600 mb-2.5 leading-relaxed bg-white/60 rounded-lg px-2.5 py-1.5 border border-blue-100">' + info.desc + '</p>';

    // ── Property bars ──
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
    // Pros
    html += '<div class="bg-white/50 rounded-lg p-2 border border-green-100"><span class="font-semibold text-green-700 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>优点</span><ul class="space-y-0.5">';
    info.pros.forEach(p => { html += '<li class="text-gray-600 leading-snug">· ' + p + '</li>'; });
    html += '</ul></div>';
    // Cons
    html += '<div class="bg-white/50 rounded-lg p-2 border border-red-100"><span class="font-semibold text-red-600 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>缺点</span><ul class="space-y-0.5">';
    info.cons.forEach(c => { html += '<li class="text-gray-600 leading-snug">· ' + c + '</li>'; });
    html += '</ul></div>';
    html += '</div>';

    // Use cases
    html += '<div class="mt-2 bg-white/50 rounded-lg p-2 border border-blue-100">';
    html += '<span class="text-[10px] font-semibold text-blue-600 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>适用场景</span>';
    html += '<div class="flex flex-wrap gap-1">';
    info.uses.forEach(u => { html += '<span class="inline-block bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 text-[9px]">' + u + '</span>'; });
    html += '</div></div>';

    // Warnings
    if (info.warnings && info.warnings.length > 0) {
        html += '<div class="mt-2 bg-amber-50 rounded-lg p-2 border border-amber-200">';
        html += '<span class="text-[10px] font-semibold text-amber-700 flex items-center gap-1 mb-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>注意事项</span>';
        html += '<ul class="space-y-0.5">';
        info.warnings.forEach(w => { html += '<li class="text-[9px] text-amber-700 leading-snug">⚠ ' + w + '</li>'; });
        html += '</ul></div>';
    }

    // Compare button
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

    // Get all available materials for comparison
    const allMaterials = Object.keys(MATERIAL_INFO);

    let html = '<div id="material-compare-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">';
    html += '<div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">';
    // Header
    html += '<div class="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between">';
    html += '<div class="flex items-center gap-2">';
    html += '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
    html += '<span class="text-lg font-bold">材料对比</span>';
    html += '</div>';
    html += '<button type="button" data-close-compare class="text-white/80 hover:text-white transition-colors"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>';
    html += '</div>';

    // Comparison table
    html += '<div class="p-4">';
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-[11px] border-collapse">';

    // Header row
    html += '<thead><tr class="border-b-2 border-gray-200">';
    html += '<th class="text-left py-2 px-3 text-gray-500 font-medium bg-gray-50 rounded-tl-lg">特性</th>';
    allMaterials.forEach(mat => {
        const isBase = mat === baseMaterial;
        html += '<th class="text-center py-2 px-3 ' + (isBase ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-700 font-medium') + '">' + mat + (isBase ? ' <span class="text-[9px] bg-blue-200 text-blue-800 rounded px-1">当前</span>' : '') + '</th>';
    });
    html += '</tr></thead>';

    // Body rows
    html += '<tbody>';

    // Description row
    html += '<tr class="border-b border-gray-100">';
    html += '<td class="py-2 px-3 text-gray-500 font-medium bg-gray-50">简介</td>';
    allMaterials.forEach(mat => {
        const info = MATERIAL_INFO[mat];
        const isBase = mat === baseMaterial;
        html += '<td class="py-2 px-3 text-[10px] text-gray-600 ' + (isBase ? 'bg-blue-50/50' : '') + '">' + (info ? info.desc.substring(0, 60) + '...' : '-') + '</td>';
    });
    html += '</tr>';

    // Tags row
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

    // Properties rows
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

    // Pros row
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

    // Cons row
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

    // Use cases row
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

    // Legend
    html += '<div class="mt-4 pt-3 border-t border-gray-200 flex flex-wrap gap-3 justify-center text-[9px] text-gray-400">';
    html += '<span>评分说明：1=最低 5=最高</span>';
    html += '<span>·</span>';
    html += '<span>耐热温度为近似值</span>';
    html += '</div>';

    html += '</div></div></div>';
    return html;
}

// ── Material comparison modal open/close ──
export function openMaterialCompare(materialName) {
    // Remove any existing modal
    closeMaterialCompare();
    const modalHtml = _buildMaterialComparisonHtml(materialName);
    if (!modalHtml) return;
    const container = document.createElement('div');
    container.id = 'material-compare-root';
    container.innerHTML = modalHtml;
    document.body.appendChild(container);

    // Close handlers
    container.querySelector('[data-close-compare]')?.addEventListener('click', closeMaterialCompare);
    container.addEventListener('click', (e) => {
        if (e.target === container.firstElementChild) closeMaterialCompare();
    });
    document.addEventListener('keydown', _escHandler);
}

export function closeMaterialCompare() {
    const root = document.getElementById('material-compare-root');
    if (root) root.remove();
    document.removeEventListener('keydown', _escHandler);
}

function _escHandler(e) {
    if (e.key === 'Escape') closeMaterialCompare();
}

// ── Print suggestions rendering ──
function _buildPrintSuggestionHtml(item) {
    const info = MATERIAL_INFO[item.material];
    if (!info) return '';

    let html = '<div class="mt-2 p-3 bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl shadow-sm">';
    html += '<div class="text-[11px] font-semibold text-green-700 mb-2 flex items-center gap-1.5">';
    html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>';
    html += '打印建议</div>';

    // Show actual slicing params if available
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

    // Printing tips card
    html += '<div class="bg-white/60 rounded-lg p-2 border border-green-100 mb-2">';
    html += '<div class="text-[10px] font-semibold text-green-700 mb-1 flex items-center gap-1">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>';
    html += '打印参数建议</div>';
    html += '<p class="text-[10px] text-gray-600 leading-relaxed">' + info.tips + '</p>';
    html += '</div>';

    // Post-processing suggestions
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
    } else if (item.material === 'Resin') {
        html += '<ul class="text-[10px] text-gray-600 space-y-0.5">';
        html += '<li>· 打印后需用95%酒精清洗3-5分钟</li>';
        html += '<li>· UV固化10-15分钟</li>';
        html += '<li>· 可打磨后喷涂光油增加光泽</li>';
        html += '</ul>';
    } else {
        html += '<p class="text-[10px] text-gray-600">建议根据实际需要进行打磨、喷漆等后处理。</p>';
    }
    html += '</div>';

    // Re-quote button for this file
    html += '<div class="mt-2 flex justify-end">';
    html += '<button type="button" data-requote-file="' + escapeHtml(item.filename) + '" class="text-[10px] text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300 rounded-lg px-3 py-1 flex items-center gap-1 transition-colors">';
    html += '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
    html += '重新报价此文件</button>';
    html += '</div>';

    html += '</div>';
    return html;
}

// ── Options ──
export function refreshOptionsSummary() {
    const { optionsSummary } = dom;
    if (!optionsSummary) return;
    const colorText = formatColorLabel(quoteOptions.color);
    const pm = document.getElementById("cfg-printer-model-main");
    const pmName = (pm && pm.selectedOptions[0]) ? pm.selectedOptions[0].text : t('quote.printerNotSet');
    optionsSummary.innerHTML = t('quote.printerModel') + '：' + pmName + ' | ' + t('quote.material') + ' ' + quoteOptions.material + '，' + t('quote.color') + ' ' + colorText + '，' + t('quote.quantity') + ' ' + quoteOptions.quantity;
}

export function recalcSummaryFromCurrentResults() {
    const successItems = currentResults.filter((i) => i.status === "success" && !i._recalculating);
    const failedItems = currentResults.filter((i) => i.status === "failed");
    const sumFiles = document.getElementById('sum-total-files');
    const sumStatus = document.getElementById('sum-status');
    const sumCost = document.getElementById('sum-total-cost');
    const sumTime = document.getElementById('sum-total-time');
    if (sumFiles) sumFiles.textContent = currentResults.length;
    if (sumStatus) sumStatus.textContent = `${successItems.length} / ${failedItems.length}`;
    if (sumCost) sumCost.textContent = '¥ ' + successItems.reduce((s, i) => s + (i.cost_cny || 0), 0).toFixed(2);
    if (sumTime) sumTime.textContent = formatTimeHMS(successItems.reduce((s, i) => s + (i.estimated_time_h || 0), 0));
}

// ── Quote API ──

function _getActivePrinterModel() {
    return getActivePrinterCompoundId();
}

function _getActiveSlicerPresetId() {
    // Prefer the model-page batch selector; fall back to quoteOptions
    const batch = document.getElementById('batch-slicer-preset');
    if (batch && batch.value) return Number(batch.value);
    return (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined)
        ? quoteOptions.slicer_preset_id : null;
}

export async function quoteSingleFileWithOptions(file, options) {
    const formData = new FormData();
    formData.append("files", file);
    // Use per-file printer if provided, else global
    const printerModel = options._printer_model || _getActivePrinterModel();
    if (printerModel) formData.append("printer_model", printerModel);
    formData.append("material", options.material);
    formData.append("color", options.color);
    formData.append("quantity", String(options.quantity));
    // Use per-file preset if provided, else global
    const presetId = options._slicer_preset_id !== undefined ? options._slicer_preset_id : _getActiveSlicerPresetId();
    if (presetId !== null && presetId !== undefined) {
        formData.append("slicer_preset_id", String(presetId));
    }
    // 始终发送切片参数（用户面板设置），后端按优先级处理：
    // 用户预设 → 预设内容优先；系统预设/无预设 → 表单参数覆盖
    const lhEl = document.getElementById("gen-layer-height");
    const wcEl = document.getElementById("gen-wall-count");
    const ifEl = document.getElementById("gen-infill");
    if (lhEl && lhEl.value) formData.append("layer_height", lhEl.value);
    if (wcEl && wcEl.value) formData.append("wall_count", wcEl.value);
    if (ifEl && ifEl.value) formData.append("infill", ifEl.value);
    formData.append("use_prusaslicer", "true");
    const response = await authFetch('/api/quote', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || t('quote.requestFailed'));
    return data.results && data.results.length > 0 ? data.results[0] : { filename: file.name, status: "failed", error: "空响应" };
}

export async function quoteSelectedFiles(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, false);
}

export async function quoteSelectedFilesWithProgress(selectedFiles) {
    return _quoteSelectedFilesInternal(selectedFiles, true);
}

async function _quoteSelectedFilesInternal(selectedFiles, useProgress) {
    // 上传前检查打印机/喷嘴/切片配置是否已设置
    var printerEl = document.getElementById('batch-printer-model');
    var nozzleEl = document.getElementById('batch-nozzle-diameter');
    var presetEl = document.getElementById('batch-slicer-preset');
    var missing = [];
    if (!printerEl || !printerEl.value) missing.push(t('quote.printerModel'));
    if (!nozzleEl || !nozzleEl.value) missing.push(t('quote.nozzleDiameter'));
    if (!presetEl || !presetEl.value) missing.push(t('quote.preset'));
    if (missing.length > 0) {
        var warningMsg = t('quote.missingConfig', {items: missing.join('、')});
        if (dom.errorMsg) { dom.errorMsg.textContent = warningMsg; }
        if (dom.errorContainer) dom.errorContainer.classList.remove('hidden');
    }

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    const printerModel = _getActivePrinterModel();
    if (printerModel) formData.append("printer_model", printerModel);
    formData.append("material", quoteOptions.material);
    formData.append("color", quoteOptions.color);
    formData.append("quantity", String(quoteOptions.quantity));
    const presetId = _getActiveSlicerPresetId();
    if (presetId !== null && presetId !== undefined) {
        formData.append("slicer_preset_id", String(presetId));
    }
    // 发送切片参数（从切片配置面板读取用户设置）
    const lhEl2 = document.getElementById("gen-layer-height");
    const wcEl2 = document.getElementById("gen-wall-count");
    const ifEl2 = document.getElementById("gen-infill");
    if (lhEl2 && lhEl2.value) formData.append("layer_height", lhEl2.value);
    if (wcEl2 && wcEl2.value) formData.append("wall_count", wcEl2.value);
    if (ifEl2 && ifEl2.value) formData.append("infill", ifEl2.value);
    formData.append("use_prusaslicer", "true");
    if (useProgress) {
        showProgress(`批量报价 (${selectedFiles.length} 个文件)...`);
        try {
            const result = await uploadWithProgress('/api/quote', formData, authToken);
            if (!result.ok) throw new Error(result.error || t('quote.requestFailed'));
            const data = result.data;
            mergeResultsByFilename(data.results || []);
            renderResultsTable();
            recalcSummaryFromCurrentResults();
            showProgressSuccess(`报价完成，共处理 ${(data.results || []).length} 个文件`);
            hideProgress();
            showToast(`报价完成：${(data.results || []).length} 个文件已处理`, 'success');
            setTimeout(() => loadQuoteHistory(authToken), 500);
        } catch (err) {
            showProgressError(err.message || '报价失败');
            hideProgress();
            throw err;
        }
    } else {
        const response = await authFetch('/api/quote', { method: 'POST', body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || t('quote.requestFailed'));
        mergeResultsByFilename(data.results || []);
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        setTimeout(() => loadQuoteHistory(authToken), 500);
    }
}



// ── Results management ──
export function mergeResultsByFilename(incomingResults) {
    const idxByFilename = new Map();
    currentResults.forEach((item, idx) => { if (item && item.filename) idxByFilename.set(item.filename, idx); });
    (incomingResults || []).forEach((item) => {
        if (!item || !item.filename) return;
        const existingIdx = idxByFilename.get(item.filename);
        if (existingIdx === undefined) { currentResults.push(item); return; }
        // Preserve per-file printer + preset from existing item
        const existing = currentResults[existingIdx];
        currentResults[existingIdx] = {
            ...item,
            _printer_model: existing._printer_model || item._printer_model,
            _slicer_preset_id: existing._slicer_preset_id !== undefined ? existing._slicer_preset_id : item._slicer_preset_id,
            _checklist_params: item._checklist_params !== undefined ? item._checklist_params : existing._checklist_params,
            _checklist_source: item._checklist_source || existing._checklist_source,
        };
    });
}

export function normalizeResultsWithCurrentOptions() {
    const materialNames = new Set(MATERIAL_OPTIONS.map((m) => m && m.name).filter(Boolean));
    setCurrentResults(currentResults.map((item) => {
        if (!item || !item.filename) return item;
        const next = { ...item };
        const selectedMaterial = materialNames.has(next.material) ? next.material : quoteOptions.material;
        next.material = selectedMaterial;
        const allowedColors = getColorsForMaterial(selectedMaterial);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        const q = Number.parseInt(next.quantity, 10);
        next.quantity = Number.isFinite(q) && q >= 1 ? q : (quoteOptions.quantity || 1);
        return next;
    }));
}

export async function reQuoteAllSelectedFiles(reasonLabel) {
    const { fileNameDisplay, errorContainer, errorMsg } = dom;
    if (!authToken) return;
    const files = Array.from(selectedFilesMap.values());
    if (!files.length) return;
    if (errorMsg) errorMsg.textContent = '';
    if (errorContainer) errorContainer.classList.add('hidden');

    currentResults.splice(0, currentResults.length, ...currentResults.map((item) => {
        if (!item || !item.filename) return item;
        const next = { ...item };
        const materialNames = new Set(MATERIAL_OPTIONS.map((m) => m && m.name).filter(Boolean));
        next.material = materialNames.has(next.material) ? next.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(next.material);
        next.color = pickAllowedColor(allowedColors, next.color, quoteOptions.color);
        next._recalculating = true;
        return next;
    }));
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    if (fileNameDisplay) fileNameDisplay.classList.add('text-indigo-600', 'font-medium');
    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const existing = currentResults.find((r) => r && r.filename === file.name) || null;
        const material = existing && existing.material ? existing.material : quoteOptions.material;
        const allowedColors = getColorsForMaterial(material);
        const color = pickAllowedColor(allowedColors, existing && existing.color, quoteOptions.color);
        const quantityRaw = existing && existing.quantity ? existing.quantity : quoteOptions.quantity;
        const quantity = Math.max(1, Number.parseInt(quantityRaw, 10) || 1);
        // Per-file printer + preset
        const pm = (existing && existing._printer_model) ? existing._printer_model : '';
        const sp = (existing && existing._slicer_preset_id !== undefined) ? existing._slicer_preset_id : null;
        if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}：${i + 1}/${files.length}（${file.name}）`;
        try {
            await ensureThumbnailForFile(file, color);
            const opts = { material, color, quantity, _printer_model: pm };
            if (sp !== null) opts._slicer_preset_id = sp;
            const updated = await quoteSingleFileWithOptions(file, opts);
            mergeResultsByFilename([updated]);
        } catch (err) {
            mergeResultsByFilename([{ filename: file.name, status: 'failed', error: err.message || '重算失败', material, color, quantity }]);
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    }
    if (fileNameDisplay) fileNameDisplay.textContent = `${reasonLabel}完成（共 ${files.length} 个文件）`;
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


// ── Table sort & pagination delegated to quote-render.js ──
// _sortState, _paginationState, sort/pagination helpers are all imported from quote-render.js


// ── 卡片编辑事件处理（与表格行编辑共用逻辑） ──
export function handleCardEditChange(event) {
    const target = event.target;
    if (!target.classList.contains('card-edit')) return;
    const card = target.closest('[data-card-file]');
    if (!card) return;
    const filename = card.getAttribute('data-card-file');
    if (_rowEditTimers.has(filename)) { clearTimeout(_rowEditTimers.get(filename)); }
    if (_rowEditSignals.has(filename)) { _rowEditSignals.get(filename).cancelled = true; }
    _rowEditTimers.set(filename, setTimeout(async () => {
        _rowEditTimers.delete(filename);
        const signal = { cancelled: false };
        _rowEditSignals.set(filename, signal);
        await _handleCardEdit(card, filename, signal);
        if (_rowEditSignals.get(filename) === signal) _rowEditSignals.delete(filename);
    }, 400));
}

async function _handleCardEdit(card, filename, signal) {
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
        currentResults[idx] = { ...currentResults[idx], _recalculating: true };
    }
    renderResultsTable();

    try {
        const currentColor = idx >= 0 ? (currentResults[idx].color || quoteOptions.color) : quoteOptions.color;
        await ensureThumbnailForFile(file, currentColor);
        if (signal.cancelled) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        const opts = { material, color: currentColor, quantity, _printer_model: pm };
        if (sp !== null) opts._slicer_preset_id = sp;
        const updated = await quoteSingleFileWithOptions(file, opts);
        if (signal.cancelled) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        if (idx >= 0) {
            currentResults[idx] = {
                ...updated,
                _printer_model: pm || prevItem?._printer_model,
            };
            if (sp !== null) currentResults[idx]._slicer_preset_id = sp;
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    } catch (err) {
        if (signal.cancelled) return;
        if (prevItem && idx >= 0) currentResults[idx] = prevItem;
        renderResultsTable();
        recalcSummaryFromCurrentResults();
        if (errorMsg) { errorMsg.textContent = err.message; errorContainer.classList.remove('hidden'); }
    }
}

// ── 导出功能 ──
export function exportCSV() {
    if (!currentResults.length) return;
    const headers = ['文件名', '打印机', '材料', '颜色', '数量', '体积(cm³)', '表面积(cm²)', '尺寸', '重量(g)', '打印时间(h)', '单价(CNY)', '总价(CNY)', '状态'];
    const rows = currentResults.map(item => [
        item.filename,
        item._printer_model || '',
        item.material || '',
        item.color || '',
        item.quantity || 1,
        item.volume_cm3 || '',
        item.surface_area_cm2 || '',
        item.dimensions || '',
        item.weight_g || '',
        item.estimated_time_h || '',
        item.unit_cost_cny || '',
        item.cost_cny || '',
        item.status === 'success' ? '成功' : (item.error || '失败'),
    ]);
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
    const headers = ['文件名', '打印机', '材料', '颜色', '数量', '体积(cm³)', '表面积(cm²)', '尺寸', '重量(g)', '打印时间(h)', '单价(CNY)', '总价(CNY)', '状态'];
    const rows = currentResults.map(item => [
        item.filename,
        item._printer_model || '',
        item.material || '',
        item.color || '',
        item.quantity || 1,
        item.volume_cm3 || '',
        item.surface_area_cm2 || '',
        item.dimensions || '',
        item.weight_g || '',
        item.estimated_time_h || '',
        item.unit_cost_cny || '',
        item.cost_cny || '',
        item.status === 'success' ? '成功' : (item.error || '失败'),
    ]);

    // 构建简单的 XML Spreadsheet (Excel 2003 XML) 无需第三方库
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
    xml += '<Worksheet ss:Name="报价结果"><Table>\n';
    // Header row
    xml += '<Row>';
    headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${h}</Data></Cell>`; });
    xml += '</Row>\n';
    // Data rows
    rows.forEach(row => {
        xml += '<Row>';
        row.forEach(cell => {
            const type = (typeof cell === 'number' || (typeof cell === 'string' && /^[\d.]+$/.test(cell) && cell !== '')) ? 'Number' : 'String';
            xml += `<Cell><Data ss:Type="${type}">${escapeHtml(String(cell))}</Data></Cell>`;
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

// ── G-code 详情构建 ──
// ── Batch edit bar ──
export function refreshBatchMaterialDropdown() {
    const sel = document.getElementById('batch-material');
    if (!sel) return;
    sel.innerHTML = MATERIAL_OPTIONS.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    sel.value = quoteOptions.material;
    refreshBatchColorDropdown();
}

export function refreshBatchColorDropdown() {
    const container = document.getElementById('batch-color-dropdown');
    const materialSelect = document.getElementById('batch-material');
    if (!container || !materialSelect) return;
    const material = materialSelect.value;
    const colorInput = container.querySelector('.row-color-value');
    const currentColor = colorInput ? colorInput.value : quoteOptions.color;
    const rendered = renderColorDropdown(material, currentColor, true);
    container.innerHTML = rendered.html;
}

export async function batchApplyToAll() {
    const { errorContainer, errorMsg } = dom;
    const materialSelect = document.getElementById('batch-material');
    const colorContainer = document.getElementById('batch-color-dropdown');
    const quantityInput = document.getElementById('batch-quantity');
    const msgEl = document.getElementById('batch-msg');
    if (!materialSelect || !colorContainer || !quantityInput) return;

    const material = materialSelect.value;
    const colorInput = colorContainer.querySelector('.row-color-value');
    const color = colorInput ? colorInput.value : '';
    const quantity = Number.parseInt(quantityInput.value, 10);

    if (!Number.isFinite(quantity) || quantity < 1) {
        if (errorMsg) { errorMsg.textContent = t('quote.countMustBePositive'); errorContainer.classList.remove('hidden'); }
        return;
    }

    if (!currentResults.length) {
        if (errorMsg) { errorMsg.textContent = '没有可批量设置的文件，请先上传文件并报价'; errorContainer.classList.remove('hidden'); }
        return;
    }

    if (errorContainer) errorContainer.classList.add('hidden');

    // 1) 先更新模型数据（包括 per-file printer + preset）
    setCurrentResults(currentResults.map(item => {
        if (!item || !item.filename) return item;
        return { ...item, material, color, quantity,
            _printer_model: getActivePrinterCompoundId(),
            _slicer_preset_id: quoteOptions.slicer_preset_id,
            _recalculating: true };
    }));

    // 2) 更新报价选项
    quoteOptions.material = material;
    quoteOptions.color = color;
    quoteOptions.quantity = quantity;
    refreshOptionsSummary();

    // 3) 立即刷新表格，让用户看到修改后的参数
    renderResultsTable();
    recalcSummaryFromCurrentResults();

    // 4) 后台重新计算精确报价
    if (msgEl) { msgEl.textContent = '重算中...'; msgEl.classList.remove('hidden'); }
    try {
        await reQuoteAllSelectedFiles('批量设置');
        if (msgEl) { msgEl.textContent = `已应用：${material} / ${color} / ×${quantity}`; }
    } catch (err) {
        if (msgEl) { msgEl.textContent = '部分重算失败'; }
    }
}

// ── Row editing ──
const _rowEditTimers = new Map();
const _rowEditSignals = new Map();

export function handleRowEditChange(event) {
    const target = event.target;
    if (!target.classList.contains('row-edit')) return;
    const row = target.closest('tr[data-row-file]');
    if (!row) return;
    const filename = row.getAttribute('data-row-file');
    if (_rowEditTimers.has(filename)) { clearTimeout(_rowEditTimers.get(filename)); }
    if (_rowEditSignals.has(filename)) { _rowEditSignals.get(filename).cancelled = true; }
    _rowEditTimers.set(filename, setTimeout(async () => {
        _rowEditTimers.delete(filename);
        const signal = { cancelled: false };
        _rowEditSignals.set(filename, signal);
        await _handleRowEdit(event, signal);
        if (_rowEditSignals.get(filename) === signal) _rowEditSignals.delete(filename);
    }, 400));
}

async function _handleRowEdit(event, signal) {
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
    // Read per-file printer + preset
    const pmSel = row.querySelector('[data-field="_printer_model"]');
    const spSel = row.querySelector('[data-field="_slicer_preset_id"]');
    const pm = pmSel ? pmSel.value : '';
    const sp = spSel ? (spSel.value ? Number(spSel.value) : null) : null;
    if (errorContainer) errorContainer.classList.add('hidden');
    row.querySelector('[data-role="status-cell"]').textContent = '成功';
    row.querySelector('[data-role="status-cell"]').className = 'px-2 py-1.5 text-green-600';

    // Mark row as pending in currentResults so total price updates immediately
    const idx = currentResults.findIndex((i) => i.filename === filename);
    const prevItem = idx >= 0 ? { ...currentResults[idx] } : null;
    if (idx >= 0) {
        currentResults[idx] = { ...currentResults[idx], status: 'pending', cost_cny: 0 };
    }
    recalcSummaryFromCurrentResults();

    try {
        await ensureThumbnailForFile(file, color);
        if (signal.cancelled) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        // Only pass _slicer_preset_id when explicitly set (non-null); omit when null
        // so quoteSingleFileWithOptions falls back to batch preset.
        const opts = { material, color, quantity, _printer_model: pm };
        if (sp !== null) opts._slicer_preset_id = sp;
        const updated = await quoteSingleFileWithOptions(file, opts);
        if (signal.cancelled) {
            if (prevItem && idx >= 0) currentResults[idx] = prevItem;
            return;
        }
        if (idx >= 0) {
            currentResults[idx] = {
                ...updated,
                _printer_model: pm || prevItem._printer_model,
            };
            if (sp !== null) {
                currentResults[idx]._slicer_preset_id = sp;
            }
        }
        renderResultsTable();
        recalcSummaryFromCurrentResults();
    } catch (err) {
        if (signal.cancelled) return;
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
