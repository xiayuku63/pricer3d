// -- Quote rendering & UI helpers --
import { MATERIAL_INFO } from './quote-data.js';
import {
    quoteOptions, currentResults, thumbnailMap,
    MATERIAL_OPTIONS, formatColorLabel, escapeHtml, formatTimeHMS,
    renderColorDropdown, getCachedPrinterModels, slicerPresets,
    getUsedBrandOptions as getBrandOptions, getMaterialsByBrand,
} from './state.js';
import { buildPlaceholderThumbnail } from './preview.js';
import { t } from './i18n.js';

let _dom = {};
export function setRenderDom(d) { _dom = d; }

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
        html += '<span class="text-[10px] font-semibold text-amber-700">会员折扣</span>';
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

// -- Summary recalculation --
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

export function refreshOptionsSummary() {
    const el = document.getElementById('options-summary');
    if (!el) return;
    const colorText = formatColorLabel(quoteOptions.color);
    const pm = document.getElementById("cfg-printer-model-main");
    const pmName = (pm && pm.selectedOptions[0]) ? pm.selectedOptions[0].text : t('quote.printerNotSet');
    el.innerHTML = t('quote.printerModel') + '：' + pmName + ' | ' + t('quote.material') + ' ' + quoteOptions.material + '，' + t('quote.color') + ' ' + colorText + '，' + t('quote.quantity') + ' ' + quoteOptions.quantity;
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
    const brands = getBrandOptions();
    const currentBrand = (MATERIAL_OPTIONS.find(m => m.name === selectedMaterial) || {}).brand || '';
    const effectiveBrand = currentBrand || brands[0] || '';
    const brandOptionsHtml = brands.map(b => `<option value="${b}" ${b === effectiveBrand ? 'selected' : ''}>${b}</option>`).join('');
    // 按品牌过滤材料
    const filteredMaterials = effectiveBrand ? MATERIAL_OPTIONS.filter(m => (m.brand || 'Generic') === effectiveBrand) : MATERIAL_OPTIONS;
    const materialOptionsHtml = filteredMaterials.map((m) => `<option value="${m.name}" ${m.name === selectedMaterial ? 'selected' : ''}>${m.name}</option>`).join('');
    const renderedRowColors = renderColorDropdown(selectedMaterial, selectedColor, true);
    return {
        previewButtonHtml, pmOptions, presetOptions, materialOptionsHtml, brandOptionsHtml,
        renderedRowColors,
        cols: `<td class="px-2 py-1.5">${escapeHtml(item.filename)}${_buildParamBadge(item)}</td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="_printer_model" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[110px]">${pmOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_slicer_preset_id" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[100px]">${presetOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_brand" class="row-edit row-brand-select text-[11px] border border-gray-300 rounded px-1 py-0.5 w-full max-w-[110px]">${brandOptionsHtml}</select></td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${quantityValue}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>`,
    };
}

// Helper: build checklist badge HTML
function _buildChecklistHtml(item) {
    if (!item._checklist_params || !item._checklist_source) return '';
    const src = item._checklist_source;
    const tip = t('quote.usedChecklist') + '：'
        + (src.printer_model ? t('quote.printerModel') + ':' + src.printer_model + ' ' : '')
        + (src.nozzle ? t('quote.nozzleDiameter') + ':' + src.nozzle + 'mm | ' : '')
        + '层高:' + src.layer_height + 'mm 墙层数:' + src.wall_count + ' 填充:' + src.infill + '%';
    return ` <span class="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1 cursor-help" title="${tip}">\u{1F4CB}${t('quote.badgeChecklist')}</span>`;
}

// Helper: build default params badge HTML
function _buildDefaultBadgeHtml() {
    return ` <span class="text-[10px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1 cursor-help" title="${t('quote.usedDefault')}">\u{1F4CB}${t('quote.badgeDefault')}</span>`;
}

// Helper: build checklist/default badge based on item._checklist_params
function _buildParamBadge(item) {
    let badge = '';
    if (item._checklist_params) { badge = _buildChecklistHtml(item); }
    else { badge = _buildDefaultBadgeHtml(); }
    badge += _buildWarningsBadgeHtml(item);
    return badge;
}

// Helper: build warning badge for items with ZIP import validation warnings
function _buildWarningsBadgeHtml(item) {
    if (!item._warnings || !item._warnings.length) return '';
    const count = item._warnings.length;
    const tipLines = item._warnings.map(w => {
        const base = t('quote.paramWarning', { param: w.param, value: w.value, default: w.default_used });
        return w.reason ? `${base} (${w.reason})` : base;
    });
    const tip = tipLines.join('\n');
    return ` <span class="text-[10px] text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 cursor-help" title="${escapeHtml(tip)}">\u26A0\uFE0F${t('quote.warningsSummary', { count })}</span>`;
}


// Helper: build slicing params summary HTML (compact inline)

// ── Table sort & pagination state ──
export let _sortState = { key: '', direction: 'asc' };  // key: column key, direction: 'asc'|'desc'
export let _paginationState = { page: 1, pageSize: 20 };

// Sort comparator factory
function _getSortValue(item, key) {
    switch (key) {
        case 'filename': return (item.filename || '').toLowerCase();
        case 'printer_model': return (item._printer_model || '').toLowerCase();
        case 'material': return (item.material || '').toLowerCase();
        case 'color': return (item.color || '').toLowerCase();
        case 'quantity': return Number(item.quantity) || 0;
        case 'weight': return Number(item.weight_g) || 0;
        case 'time': return Number(item.estimated_time_h) || 0;
        case 'price': return Number(item.cost_cny) || 0;
        case 'status': return item.status === 'success' ? 0 : 1;
        default: return '';
    }
}

function _sortResults(arr) {
    if (!_sortState.key) return arr;
    const sorted = [...arr];
    const dir = _sortState.direction === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
        const va = _getSortValue(a, _sortState.key);
        const vb = _getSortValue(b, _sortState.key);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb, 'zh') * dir;
        return 0;
    });
    return sorted;
}

// Update sort arrow indicators in thead
function _updateSortArrows() {
    document.querySelectorAll('thead th[data-sort-key]').forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
        if (!arrow) return;
        if (th.getAttribute('data-sort-key') === _sortState.key) {
            arrow.textContent = _sortState.direction === 'asc' ? ' ▲' : ' ▼';
            arrow.classList.remove('text-gray-400');
            arrow.classList.add('text-indigo-600');
            th.classList.add('bg-indigo-50');
        } else {
            arrow.textContent = '';
            arrow.classList.remove('text-indigo-600');
            arrow.classList.add('text-gray-400');
            th.classList.remove('bg-indigo-50');
        }
    });
}

// Pagination: get paginated slice
function _paginateResults(arr) {
    const total = arr.length;
    const pageSize = _paginationState.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (_paginationState.page > totalPages) _paginationState.page = totalPages;
    const start = (_paginationState.page - 1) * pageSize;
    return { slice: arr.slice(start, start + pageSize), total, totalPages };
}

// Update pagination controls
function _updatePaginationControls(total, totalPages) {
    const container = document.getElementById('table-pagination');
    if (!container) return;
    if (total <= 10) { container.classList.add('hidden'); return; }  // hide if few rows
    container.classList.remove('hidden');

    const pageInfo = document.getElementById('page-info');
    const start = (_paginationState.page - 1) * _paginationState.pageSize + 1;
    const end = Math.min(_paginationState.page * _paginationState.pageSize, total);
    if (pageInfo) pageInfo.textContent = `${start}-${end} / 共 ${total} 条`;

    const btnFirst = document.getElementById('page-first');
    const btnPrev = document.getElementById('page-prev');
    const btnNext = document.getElementById('page-next');
    const btnLast = document.getElementById('page-last');
    [btnFirst, btnPrev].forEach(b => { if (b) b.disabled = _paginationState.page <= 1; });
    [btnNext, btnLast].forEach(b => { if (b) b.disabled = _paginationState.page >= totalPages; });
    // Page number buttons
    const btnContainer = document.getElementById('page-buttons');
    if (btnContainer) {
        btnContainer.innerHTML = '';
        const maxVisible = 5;
        let startPage = Math.max(1, _paginationState.page - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
        for (let p = startPage; p <= endPage; p++) {
            const btn = document.createElement('button');
            btn.textContent = p;
            btn.className = p === _paginationState.page
                ? 'px-2 py-0.5 border border-indigo-500 bg-indigo-500 text-white rounded text-[11px] font-medium'
                : 'px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-[11px]';
            btn.addEventListener('click', () => { _paginationState.page = p; renderResultsTable(); });
            btnContainer.appendChild(btn);
        }
    }
}

export function renderResultsTable() {
    const tbody = document.getElementById('batch-results-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!currentResults.length) {
        tbody.innerHTML = '<tr class="border-t border-gray-100"><td class="px-2 py-2 text-gray-500" colspan="13">' + t('common.noData') + '</td></tr>';
        _updatePaginationControls(0, 0);
        _updateSortArrows();
        return;
    }
    // Sort then paginate
    const sorted = _sortResults(currentResults);
    const { slice: pageItems, total, totalPages } = _paginateResults(sorted);
    _updatePaginationControls(total, totalPages);
    _updateSortArrows();

    pageItems.forEach((item, pageIdx) => {
        const tr = document.createElement('tr');
        const isEven = pageIdx % 2 === 0;
        const zebraClass = isEven ? 'bg-white' : 'bg-gray-50/50';
        const statusClass = item.status === 'failed' ? 'table-row-failed border-l-4 border-l-red-400' : (item._recalculating ? 'table-row-pending' : 'table-row-success border-l-4 border-l-green-400');
        tr.className = `border-t border-gray-100 ${zebraClass} ${statusClass} hover:bg-indigo-50/40 transition-colors`;
        tr.setAttribute('data-row-file', item.filename);
        const ext = item.filename && item.filename.includes('.') ? item.filename.split('.').pop().toLowerCase() : '-';

        if (item.status === 'success') {
            const breakdown = item?.cost_breakdown && typeof item.cost_breakdown === 'object' ? item.cost_breakdown : null;
            const gcode = breakdown?.gcode_summary;

            const geometryText = `<div class="whitespace-nowrap">体积: ${item.volume_cm3} cm³</div><div class="whitespace-nowrap">表面积: ${item.surface_area_cm2} cm²</div><div class="whitespace-nowrap">尺寸: ${item.dimensions}</div>`;
            const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
            const recalculating = !!item._recalculating;
            const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
            const previewButtonHtml = isRealThumbnail
                ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors"><img src="${thumbnail}" alt="静态图" class="w-32 h-20 object-cover bg-white" /></button>`
                : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5">预览</button>`;

            const brands = getBrandOptions();
            const currentBrand = (MATERIAL_OPTIONS.find(m => m.name === item.material) || {}).brand || '';
            const effectiveBrand = currentBrand || brands[0] || '';
            const brandOptionsHtml = brands.map(b => `<option value="${b}" ${b === effectiveBrand ? 'selected' : ''}>${b}</option>`).join('');
            const filteredMaterials = effectiveBrand ? MATERIAL_OPTIONS.filter(m => (m.brand || 'Generic') === effectiveBrand) : MATERIAL_OPTIONS;
            const materialOptionsHtml = filteredMaterials.map((m) => `<option value="${m.name}" ${m.name === item.material ? 'selected' : ''}>${m.name}</option>`).join('');
            const renderedRowColors = renderColorDropdown(item.material, item.color, true);

            // Per-file printer + preset dropdowns
            const printerModels = getCachedPrinterModels();
            const selectedPrinterId = (item._printer_model || '').replace(/_\d{2}$/, '');
            const pmOptions = printerModels.map(p =>
                `<option value="${p.id}" ${p.id === selectedPrinterId ? 'selected' : ''}>${p.name}</option>`
            ).join('');
            const presets = slicerPresets || [];
            const presetOptions = ['<option value="">' + t('quote.presetNone') + '</option>',
                ...presets.map(p => `<option value="${p.id}" ${String(p.id) === String(item._slicer_preset_id || '') ? 'selected' : ''}>${p.name || '#' + p.id}</option>`)
            ].join('');

            tr.innerHTML = `
                <td class="px-2 py-1.5"><div>${escapeHtml(item.filename)}${_buildParamBadge(item)}</div><button type="button" data-toggle-detail="${escapeHtml(item.filename)}" class="mt-0.5 text-[10px] text-indigo-500 hover:text-indigo-700 underline flex items-center gap-0.5"><svg class="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>详情</button></td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="_printer_model" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[110px]">${pmOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_slicer_preset_id" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[100px]">${presetOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_brand" class="row-edit row-brand-select text-[11px] border border-gray-300 rounded px-1 py-0.5 w-full max-w-[110px]">${brandOptionsHtml}</select></td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${item.quantity}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>
                <td class="px-2 py-1.5 text-[10px] leading-tight">${geometryText}</td>
                <td class="px-2 py-1.5">
                    <div class="text-[10px] leading-tight">${recalculating ? '-' : (item.weight_g / Math.max(1, item.quantity)).toFixed(1)}g</div>
                    <div class="text-xs leading-tight font-medium">${recalculating ? '-' : item.weight_g + 'g'}</div>
                </td>
                <td class="px-2 py-1.5\\">
                    <div class="text-[10px] leading-tight">${recalculating ? '-' : formatTimeHMS(item.unit_time_h || (item.estimated_time_h / Math.max(1, item.quantity)))}</div>
                    <div class="text-xs leading-tight font-medium">${recalculating ? '-' : formatTimeHMS(item.estimated_time_h)}</div>
                </td>
                <td class="px-2 py-1.5">
                    <div class="text-[10px] leading-tight">${recalculating ? '-' : ('¥ ' + Number(item.unit_cost_cny || 0).toFixed(2))}</div>
                    <div class="text-xs leading-tight font-medium">${recalculating ? '-' : ('¥ ' + Number(item.cost_cny || 0).toFixed(2))}</div>
                </td>
                <td data-role="status-cell" class="px-2 py-1.5 min-w-[80px] text-green-600 font-medium text-[11px]">${t('common.success')}</td>
                <td class="px-2 py-1.5 space-x-1"><button type="button" data-delete-file="${item.filename}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button></td>
            `;
        } else {
            const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
            const recalculating = !!item._recalculating;
            const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
            const previewButtonHtml = isRealThumbnail
                ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors"><img src="${thumbnail}" alt="静态图" class="w-32 h-20 object-cover bg-white" /></button>`
                : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5">预览</button>`;
            const selectedMaterial = item.material || quoteOptions.material;
            const selectedColor = item.color || quoteOptions.color;
            const brands3 = getBrandOptions();
            const currentBrand3 = (MATERIAL_OPTIONS.find(m => m.name === selectedMaterial) || {}).brand || '';
            const effectiveBrand3 = currentBrand3 || brands3[0] || '';
            const brandOptionsHtml = brands3.map(b => `<option value="${b}" ${b === effectiveBrand3 ? 'selected' : ''}>${b}</option>`).join('');
            const filteredMaterials3 = effectiveBrand3 ? MATERIAL_OPTIONS.filter(m => (m.brand || 'Generic') === effectiveBrand3) : MATERIAL_OPTIONS;
            const materialOptionsHtml = filteredMaterials3.map((m) => `<option value="${m.name}" ${m.name === selectedMaterial ? 'selected' : ''}>${m.name}</option>`).join('');
            const renderedRowColors = renderColorDropdown(selectedMaterial, selectedColor, true);
            const quantityValue = item.quantity || quoteOptions.quantity || 1;
            // Per-file printer + preset
            const printerModels = getCachedPrinterModels();
            const selectedPrinterId = (item._printer_model || '').replace(/_\d{2}$/, '');
            const pmOptions = printerModels.map(p =>
                `<option value="${p.id}" ${p.id === selectedPrinterId ? 'selected' : ''}>${p.name}</option>`
            ).join('');
            const presets = slicerPresets || [];
            const presetOptions = ['<option value="">' + t('quote.presetNone') + '</option>',
                ...presets.map(p => `<option value="${p.id}" ${String(p.id) === String(item._slicer_preset_id || '') ? 'selected' : ''}>${p.name || '#' + p.id}</option>`)
            ].join('');
            tr.innerHTML = `
                <td class="px-2 py-1.5">${escapeHtml(item.filename)}${_buildParamBadge(item)}</td>
                <td class="px-2 py-1.5">${previewButtonHtml}</td>
                <td class="px-2 py-1.5"><select data-field="_printer_model" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[110px]">${pmOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_slicer_preset_id" class="row-edit text-[10px] border border-gray-300 rounded px-1 py-0.5 max-w-[100px]">${presetOptions}</select></td>
                <td class="px-2 py-1.5"><select data-field="_brand" class="row-edit row-brand-select text-[11px] border border-gray-300 rounded px-1 py-0.5 w-full max-w-[110px]">${brandOptionsHtml}</select></td>
                <td class="px-2 py-1.5"><select data-field="material" class="row-edit text-[11px] border border-gray-300 rounded px-1 py-0.5">${materialOptionsHtml}</select></td>
                <td class="px-2 py-1.5" data-field="color">${renderedRowColors.html}</td>
                <td class="px-2 py-1.5"><input data-field="quantity" type="number" min="1" value="${quantityValue}" class="row-edit w-14 text-[11px] border border-gray-300 rounded px-1 py-0.5" /></td>
                <td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td><td class="px-2 py-1.5">-</td>
                <td data-role="status-cell" class="px-2 py-1.5 min-w-[80px]">
                    <span class="status-fail-badge relative cursor-default text-red-600 font-medium text-[11px]">${t('common.failed')}
                        <span class="status-fail-tooltip hidden absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-2 text-[11px] font-normal text-left text-white bg-gray-800 rounded-lg shadow-lg whitespace-normal break-words leading-relaxed">${escapeHtml(item.error || t('common.error'))}</span>
                    </span>
                </td>
                <td class="px-2 py-1.5 space-x-1"><button type="button" data-delete-file="${item.filename}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button></td>
            `;
        }
        tbody.appendChild(tr);
        // ── 合并详情展开行（切片数据 + 费用明细 + 材料说明 + 打印建议）── 
        if (!item._recalculating && item.status === 'success') {
            const detailTr = document.createElement('tr');
            detailTr.className = 'border-t border-gray-50';
            detailTr.setAttribute('data-detail-row', item.filename);
            const td = document.createElement('td');
            td.setAttribute('colspan', '13');
            td.className = 'px-3 py-2 bg-white overflow-hidden';

            const detailDiv = document.createElement('div');
            detailDiv.className = 'hidden mt-2';
            detailDiv.setAttribute('data-detail-content', item.filename);

            // G-code 详情（卡片风格）
            const gcodeData = item.cost_breakdown?.gcode_summary;
            let gcodeHtml = '';
            if (gcodeData) {
                gcodeHtml = '<div class="mb-3 p-3 bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-xl shadow-sm">' +
                    '<div class="text-[11px] font-semibold text-purple-700 mb-2 flex items-center gap-1.5">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>' +
                    '切片参数</div>' +
                    _buildGcodeDetailHtml(gcodeData, false, item) + '</div>';
            }

            // 速度参数（卡片风格）
            let speedHtml = '';
            if (item._printer_speed_params) {
                const sp = item._printer_speed_params;
                speedHtml = '<div class="mb-3 p-3 bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-xl shadow-sm">' +
                    '<div class="text-[11px] font-semibold text-amber-700 mb-2 flex items-center gap-1.5">' +
                    '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>' +
                    '打印机速度参数（硬件绑定）</div>' +
                    '<div class="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-gray-600">' +
                    '<div>最大速度: <span class="font-medium text-gray-800">' + (sp.max_speed || '-') + ' mm/s</span></div>' +
                    '<div>最大加速度: <span class="font-medium text-gray-800">' + (sp.max_acceleration || '-') + ' mm/s²</span></div>' +
                    '<div>Jerk限制: <span class="font-medium text-gray-800">' + (sp.jerk_limit || '-') + ' mm/s</span></div>' +
                    '</div></div>';
            }

            // 费用明细 + 材料说明 + 打印建议
            detailDiv.innerHTML = gcodeHtml + speedHtml +
                '<div class="grid grid-cols-1 lg:grid-cols-3 gap-2">' +
                _buildCostBreakdownHtml(item) +
                _buildMaterialInfoHtml(item.material) +
                _buildPrintSuggestionHtml(item) +
                '</div>';

            td.appendChild(detailDiv);
            detailTr.appendChild(td);
            tbody.appendChild(detailTr);
        } else {
            // 失败/重算中的行：加一个空占位行，保持与成功行一致的间距
            const spacerTr = document.createElement('tr');
            spacerTr.className = 'border-t border-gray-50';
            spacerTr.setAttribute('data-detail-row', item.filename);
            const spacerTd = document.createElement('td');
            spacerTd.setAttribute('colspan', '13');
            spacerTd.className = 'py-2 bg-white';
            spacerTr.appendChild(spacerTd);
            tbody.appendChild(spacerTr);
        }
    });

    // ── 同步渲染移动端卡片视图 ──
    renderResultsCards();
}

// ── 移动端卡片布局渲染 ──
function renderResultsCards() {
    const container = document.getElementById('batch-results-cards');
    if (!container) return;
    container.innerHTML = '';

    if (!currentResults.length) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">' + t('common.noData') + '</p>';
        return;
    }

    currentResults.forEach((item) => {
        const ext = item.filename && item.filename.includes('.') ? item.filename.split('.').pop().toLowerCase() : '-';
        const thumbnail = thumbnailMap.get(item.filename) || buildPlaceholderThumbnail(ext);
        const isRealThumbnail = thumbnail && thumbnail.startsWith('data:image/png');
        const previewHtml = isRealThumbnail
            ? `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="block rounded border border-gray-200 overflow-hidden hover:border-indigo-300 transition-colors w-full"><img src="${thumbnail}" alt="预览" class="w-full h-28 object-cover bg-white" /></button>`
            : `<button type="button" data-preview-file="${item.filename}" data-preview-ext="${ext}" class="w-full text-[12px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-3 py-2">预览模型</button>`;

        const printerModels = getCachedPrinterModels();
        const selectedPrinterId = (item._printer_model || '').replace(/_\d{2}$/, '');
        const pmOptions = printerModels.map(p =>
            `<option value="${p.id}" ${p.id === selectedPrinterId ? 'selected' : ''}>${p.name}</option>`
        ).join('');
        const presets = slicerPresets || [];
        const presetOptions = ['<option value="">' + t('quote.presetNone') + '</option>',
            ...presets.map(p => `<option value="${p.id}" ${String(p.id) === String(item._slicer_preset_id || '') ? 'selected' : ''}>${p.name || '#' + p.id}</option>`)
        ].join('');
        const mobileBrands = getBrandOptions();
        const mobileCurrentBrand = (MATERIAL_OPTIONS.find(m => m.name === (item.material || quoteOptions.material)) || {}).brand || '';
        const mobileEffectiveBrand = mobileCurrentBrand || mobileBrands[0] || '';
        const mobileBrandOptionsHtml = mobileBrands.map(b => `<option value="${b}" ${b === mobileEffectiveBrand ? 'selected' : ''}>${b}</option>`).join('');
        const filteredMobileMaterials = mobileEffectiveBrand ? MATERIAL_OPTIONS.filter(m => (m.brand || 'Generic') === mobileEffectiveBrand) : MATERIAL_OPTIONS;
        const materialOptionsHtml = filteredMobileMaterials.map((m) => `<option value="${m.name}" ${m.name === (item.material || quoteOptions.material) ? 'selected' : ''}>${m.name}</option>`).join('');
        const quantityValue = item.quantity || quoteOptions.quantity || 1;

        if (item.status === 'success' && !item._recalculating) {
            const card = document.createElement('div');
            card.className = 'bg-white border border-gray-200 rounded-lg p-4 shadow-sm';
            card.setAttribute('data-card-file', item.filename);
            card.innerHTML = `
                <div class="flex gap-3">
                    <div class="w-28 flex-shrink-0">${previewHtml}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[12px] font-medium text-gray-900 truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}${_buildParamBadge(item)}</p>
                        <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <div><span class="text-gray-400">重量</span> <span class="font-medium">${(item.weight_g / Math.max(1, item.quantity)).toFixed(1)}g / ${item.weight_g}g</span></div>
                            <div><span class="text-gray-400">时间</span> <span class="font-medium">${formatTimeHMS(item.unit_time_h || (item.estimated_time_h / Math.max(1, item.quantity)))} / ${formatTimeHMS(item.estimated_time_h)}</span></div>
                            <div><span class="text-gray-400">体积</span> <span class="font-medium">${item.volume_cm3} cm³</span></div>
                            <div><span class="text-gray-400">尺寸</span> <span class="font-medium">${item.dimensions}</span></div>
                        </div>
                        <div class="mt-2 flex items-baseline gap-1">
                            <span class="text-base font-semibold text-indigo-600">¥ ${Number(item.cost_cny || 0).toFixed(2)}</span>
                            <span class="text-[10px] text-gray-400">（单价 ¥ ${Number(item.unit_cost_cny || 0).toFixed(2)}）</span>
                        </div>
                    </div>
                </div>
                <!-- 可编辑参数区 -->
                <div class="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
                    <div>
                        <label class="text-[10px] text-gray-400 block">${t('quote.printerModel')}</label>
                        <select data-field="_printer_model" class="card-edit w-full text-[10px] border border-gray-300 rounded px-1.5 py-1 bg-white">${pmOptions}</select>
                    </div>
                    <div>
                        <label class="text-[10px] text-gray-400 block">${t('quote.preset')}</label>
                        <select data-field="_slicer_preset_id" class="card-edit w-full text-[10px] border border-gray-300 rounded px-1.5 py-1 bg-white">${presetOptions}</select>
                    </div>
                    <div>
                        <label class="text-[10px] text-gray-400 block">${t('quote.brand')}</label>
                        <select data-field="_brand" class="card-edit row-brand-select w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white">${mobileBrandOptionsHtml}</select>
                    </div>
                    <div>
                        <label class="text-[10px] text-gray-400 block">${t('quote.material')}</label>
                        <select data-field="material" class="card-edit w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white">${materialOptionsHtml}</select>
                    </div>
                    <div>
                        <label class="text-[10px] text-gray-400 block">${t('quote.quantity')}</label>
                        <input data-field="quantity" type="number" min="1" value="${quantityValue}" class="card-edit w-full text-[11px] border border-gray-300 rounded px-1.5 py-1" />
                    </div>
                </div>
                <div class="mt-3 flex items-center justify-between">
                    <span class="text-[11px] text-green-600">${t('common.success')}</span>
                    <div class="flex items-center gap-2">
                        <button type="button" data-toggle-detail="${escapeHtml(item.filename)}" class="text-[10px] text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 rounded px-2 py-0.5 flex items-center gap-1 transition-colors">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                            详情
                        </button>
                        <button type="button" data-delete-file="${item.filename}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button>
                    </div>
                </div>
                <div class="hidden mt-2" data-detail-content="${escapeHtml(item.filename)}">

                    ${item.cost_breakdown?.gcode_summary ? '<div class="mb-3 p-3 bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-xl shadow-sm"><div class="text-[11px] font-semibold text-purple-700 mb-2 flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>切片参数</div>' + _buildGcodeDetailHtml(item.cost_breakdown.gcode_summary, false, item) + '</div>' : ''}
                    ${item._printer_speed_params ? '<div class="mb-3 p-3 bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-xl shadow-sm"><div class="text-[11px] font-semibold text-amber-700 mb-2 flex items-center gap-1.5"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>打印机速度参数（硬件绑定）</div><div class="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-gray-600"><div>最大速度: <span class="font-medium text-gray-800">' + item._printer_speed_params.max_speed + ' mm/s</span></div><div>最大加速度: <span class="font-medium text-gray-800">' + item._printer_speed_params.max_acceleration + ' mm/s²</span></div><div>Jerk限制: <span class="font-medium text-gray-800">' + item._printer_speed_params.jerk_limit + ' mm/s</span></div></div></div>' : ''}
                    <div class="grid grid-cols-1 gap-2">
                        ${_buildCostBreakdownHtml(item)}
                        ${_buildMaterialInfoHtml(item.material || quoteOptions.material)}
                        ${_buildPrintSuggestionHtml({ ...item, material: item.material || quoteOptions.material })}
                    </div>
                </div>
            `;
            container.appendChild(card);
        } else if (item._recalculating) {
            const card = document.createElement('div');
            card.className = 'bg-white border border-amber-200 rounded-lg p-4 shadow-sm';
            card.setAttribute('data-card-file', item.filename);
            card.innerHTML = `
                <div class="flex gap-3">
                    <div class="w-28 flex-shrink-0">${previewHtml}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[12px] font-medium text-gray-900 truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}${_buildParamBadge(item)}</p>
                        <p class="mt-3 text-[12px] text-amber-600">${t('quote.recalculating')}</p>
                    </div>
                </div>
            `;
            container.appendChild(card);
        } else {
            const card = document.createElement('div');
            card.className = 'bg-white border border-red-200 rounded-lg p-4 shadow-sm';
            card.setAttribute('data-card-file', item.filename);
            card.innerHTML = `
                <div class="flex gap-3">
                    <div class="w-28 flex-shrink-0">${previewHtml}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[12px] font-medium text-gray-900 truncate" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}${_buildParamBadge(item)}</p>
                        <div class="mt-2 grid grid-cols-2 gap-2">
                            <div>
                                <label class="text-[10px] text-gray-400 block">${t('quote.brand')}</label>
                                <select data-field="_brand" class="card-edit row-brand-select w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white">${mobileBrandOptionsHtml}</select>
                            </div>
                            <div>
                                <label class="text-[10px] text-gray-400 block">${t('quote.material')}</label>
                                <select data-field="material" class="card-edit w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 bg-white">${materialOptionsHtml}</select>
                            </div>
                            <div>
                                <label class="text-[10px] text-gray-400 block">${t('quote.quantity')}</label>
                                <input data-field="quantity" type="number" min="1" value="${quantityValue}" class="card-edit w-full text-[11px] border border-gray-300 rounded px-1.5 py-1" />
                            </div>
                        </div>
                        <div class="mt-2">
                            <span class="status-fail-badge relative cursor-default text-[11px] text-red-600 font-medium">${t('common.failed')}
                                <span class="status-fail-tooltip hidden absolute z-50 top-full left-0 mt-2 w-64 p-2 text-[11px] font-normal text-left text-white bg-gray-800 rounded-lg shadow-lg whitespace-normal break-words leading-relaxed">${escapeHtml(item.error || t('common.error'))}</span>
                            </span>
                        </div>
                    </div>
                </div>
                <div class="mt-2 flex justify-end">
                    <button type="button" data-delete-file="${item.filename}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button>
                </div>
            `;
            container.appendChild(card);
        }
    });
}

// ── 失败原因 tooltip：鼠标悬停显示/隐藏（事件委托，只绑定一次）──
// 使用 position:fixed + body 直接挂载，避免被表格行遮挡
(function _setupFailTooltipDelegation() {
    if (_setupFailTooltipDelegation._bound) return;
    _setupFailTooltipDelegation._bound = true;
    let _tipEl = null;
    let _tipText = '';
    const _createTip = () => {
        const el = document.createElement('div');
        el.id = 'fail-tooltip-float';
        el.style.cssText = 'position:fixed;z-index:99999;max-width:280px;padding:8px 12px;font-size:11px;font-weight:400;line-height:1.5;text-align:left;color:#fff;background:#1f2937;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.3);white-space:normal;word-break:break-word;pointer-events:none;';
        document.body.appendChild(el);
        return el;
    };
    const showTip = (badge, e) => {
        const src = badge.querySelector('.status-fail-tooltip');
        if (!src) return;
        const text = src.textContent;
        if (!text) return;
        if (!_tipEl) _tipEl = _createTip();
        if (_tipText !== text) { _tipEl.textContent = text; _tipText = text; }
        const r = badge.getBoundingClientRect();
        _tipEl.style.display = 'block';
        _tipEl.style.left = Math.min(r.left, window.innerWidth - 290) + 'px';
        _tipEl.style.top = (r.bottom + 4) + 'px';
    };
    const hideTip = () => {
        if (_tipEl) _tipEl.style.display = 'none';
    };
    document.addEventListener('mouseover', (e) => {
        const badge = e.target.closest('.status-fail-badge');
        if (badge) showTip(badge, e);
    });
    document.addEventListener('mouseout', (e) => {
        const badge = e.target.closest('.status-fail-badge');
        if (badge && !badge.contains(e.relatedTarget)) hideTip();
    });
})();

// ── G-code 详情构建 ──
function _buildGcodeDetailHtml(gcode, wrapInTd = true, item) {
    const cp = gcode.core_params || {};
    const bd = item && item.cost_breakdown;
    const fmtTime = (s) => { if (!s||s<=0) return null; const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60); return h>0?h+"时"+m+"分"+sec+"秒":m>0?m+"分"+sec+"秒":sec+"秒"; };
    const gridCls = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-0.5 text-[10px]';
    let html = wrapInTd ? '<td colspan="13" class="px-3 py-1.5"><div class="' + gridCls + '">' : '<div class="' + gridCls + '">';
    const add = (label, value, unit) => {
        if (value != null && value !== '') {
            html += '<div class="flex items-baseline gap-1"><span class="text-gray-400 shrink-0">' + label + '</span><span class="font-medium text-gray-700">' + value + (unit||'') + '</span></div>';
        }
    };
    add('层高', cp.layer_height, 'mm');
    add('首层高', cp.first_layer_height, 'mm');
    add('喷嘴', cp.nozzle_diameter, 'mm');
    add('壁层', cp.perimeters);
    add('填充', cp.fill_density, '%');
    add('支撑', cp.support_material === '1' ? '开' : '关');
    add('总层数', gcode.layer_count);
    if (gcode.filament_mm != null) add('线长', (gcode.filament_mm / 1000).toFixed(2), 'm');
    if (gcode.filament_g != null && gcode.filament_g > 0) add('耗材', gcode.filament_g.toFixed(1), 'g');
    if (gcode.time_display) add('时间', gcode.time_display);
    if (bd) {
        if (bd.prusaslicer_used) add('引擎', 'PrusaSlicer');
        const st = fmtTime(bd.slicer_estimated_time_s);
        if (st) add('切片耗时', st);
        if (bd.slicer_preset_used) add('预设', bd.slicer_preset_used);
    }
    html += wrapInTd ? '</div></td>' : '</div>';
    return html;
}
