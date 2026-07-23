// ── Shared state & utilities for pricer3d frontend ──
// All modules import from here. No more giant closure scope.

const TOKEN_STORAGE_KEY = "demo_access_token_v1";
const USER_STORAGE_KEY = "demo_user_v1";
const SAVED_USERNAME_KEY = "demo_saved_username_v1";
const SLICER_PRESET_STORAGE_PREFIX = "demo_slicer_preset_id_v1_";
const FRONT_SETTINGS_STORAGE_PREFIX = "demo_front_settings_v1_";
const BATCH_SETTINGS_STORAGE_PREFIX = "demo_batch_settings_v1_";

// ── Auth state ──
export let authToken = '';
export let currentUser = null;
export let currentCaptchaId = '';
export let currentCaptchaUrl = '';
export function setCaptchaId(v) { currentCaptchaId = v; }
export function setCaptchaUrl(v) { currentCaptchaUrl = v; }

// ── Quote options ──
export const quoteOptions = {
    brand: "",
    material: "PLA",
    color: "#ffffff",  // match DEFAULT_COLORS[0].hex — always a valid hex, never empty
    quantity: 1,
    slicer_preset_id: null,
    printer_model: "",
    orientation: { x: 0, y: 0, z: 0 },
};

// ── User default printer / nozzle / preset (persisted to backend) ──
export let defaultPrinterId = null;    // e.g. "bambu_a1"
export let defaultNozzle = null;       // e.g. "0.4"
export let defaultSlicerPresetId = null;  // e.g. 3
export let defaultMaterial = null;     // e.g. "PLA"
export let defaultColor = null;        // e.g. "#000000"
export let defaultBrand = null;        // e.g. "Bambu Lab"
export function setDefaultPrinterId(v) { defaultPrinterId = v; }
export function setDefaultNozzle(v) { defaultNozzle = v; }
export function setDefaultSlicerPresetId(v) { defaultSlicerPresetId = v; }
export function setDefaultMaterial(v) { defaultMaterial = v; }
export function setDefaultColor(v) { defaultColor = v; }
export function setDefaultBrand(v) { defaultBrand = v; }

// ── Collections ──
export const selectedFilesMap = new Map();
export const thumbnailMap = new Map();
export let currentResults = [];
export let currentPreviewFilename = null;
export function setCurrentPreviewFilename(v) { currentPreviewFilename = v; }
export let orientData = null;
export let pendingQuoteFiles = null;
export let slicerPresets = [];

// ── Default materials (only used when not logged in / no user settings) ──
export let MATERIAL_OPTIONS = [
    { name: "PLA", brand: "Generic", density: 1.24, price_per_kg: 59.0, color: { name: '黑色', hex: '#000000' } },
    { name: "PLA+", brand: "Generic", density: 1.24, price_per_kg: 64.0, color: { name: '黑色', hex: '#000000' } },
    { name: "PETG", brand: "Generic", density: 1.27, price_per_kg: 85.0, color: { name: '黑色', hex: '#000000' } },
    { name: "ABS", brand: "Generic", density: 1.04, price_per_kg: 72.0, color: { name: '黑色', hex: '#000000' } },
    { name: "ASA", brand: "Generic", density: 1.07, price_per_kg: 102.0, color: { name: '黑色', hex: '#000000' } },
    { name: "TPU", brand: "Generic", density: 1.21, price_per_kg: 111.0, color: { name: '黑色', hex: '#000000' } },
    { name: "PA", brand: "Generic", density: 1.14, price_per_kg: 170.0, color: { name: '黑色', hex: '#000000' } },
    { name: "PC", brand: "Generic", density: 1.20, price_per_kg: 153.0, color: { name: '黑色', hex: '#000000' } },
];

/** 材料类型预设（密度 + 参考单价） */
export const MATERIAL_TYPE_PRESETS = {
    'PLA':    { density: 1.24, price_per_kg: 80 },
    'PLA+':   { density: 1.24, price_per_kg: 90 },
    'PETG':   { density: 1.27, price_per_kg: 100 },
    'ABS':    { density: 1.04, price_per_kg: 95 },
    'ASA':    { density: 1.07, price_per_kg: 120 },
    'TPU':    { density: 1.21, price_per_kg: 160 },
    'PA':     { density: 1.14, price_per_kg: 200 },
    'PC':     { density: 1.20, price_per_kg: 180 },
    'PVA':    { density: 1.23, price_per_kg: 300 },
    'PEEK':   { density: 1.31, price_per_kg: 800 },
    'PP':     { density: 0.91, price_per_kg: 120 },
    'PET-CF': { density: 1.30, price_per_kg: 280 },
    'PA-CF':  { density: 1.15, price_per_kg: 350 },
    'PLA-CF': { density: 1.30, price_per_kg: 150 },
    'ASA-CF': { density: 1.15, price_per_kg: 260 },
};

/** 获取所有支持的品牌列表 */
const MAJOR_BRANDS = [
    'Bambu Lab', 'eSUN', 'Polymaker', 'Sunlu', 'Creality', 'Prusament',
    'OVERTURE', 'Hatchbox', 'ELEGOO', 'Anycubic', 'QIDI TECH', 'Flashforge',
    'ColorFabb', 'Fiberlogy', 'FormFutura', 'Raise3D', 'MatterHackers',
    'BASF Forward AM', 'Colorful Cloud', 'Generic', 'Prusa', 'Voron',
];

/** 获取品牌列表（MATERIAL_OPTIONS 中已有的品牌 + MAJOR_BRANDS） */
export function getBrandOptions() {
    const seen = new Set();
    const brands = [];
    // 优先列出 MATERIAL_OPTIONS 中已使用的品牌
    for (const m of MATERIAL_OPTIONS) {
        const b = (m.brand || 'Generic').trim();
        if (b && !seen.has(b)) { seen.add(b); brands.push(b); }
    }
    // 再补充 MAJOR_BRANDS 中未使用的
    for (const b of MAJOR_BRANDS) {
        if (!seen.has(b)) { seen.add(b); brands.push(b); }
    }
    return brands;
}

/** 获取默认品牌选项（仅 MATERIAL_OPTIONS 中已有的品牌） */
export function getUsedBrandOptions() {
    const seen = new Set();
    const brands = [];
    for (const m of MATERIAL_OPTIONS) {
        const b = (m.brand || 'Generic').trim();
        if (b && !seen.has(b)) { seen.add(b); brands.push(b); }
    }
    return brands.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base', numeric: true }));
}

/** 按品牌筛选材料；brand 为空时返回全部 */
export function getMaterialsByBrand(brand) {
    const items = !brand ? MATERIAL_OPTIONS : MATERIAL_OPTIONS.filter(m => (m.brand || 'Generic').trim() === brand);
    const unique = [];
    const seen = new Set();
    for (const item of items) {
        const key = String(item.name || '').trim().toLowerCase();
        if (!seen.has(key)) { seen.add(key); unique.push(item); }
    }
    return unique.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { sensitivity: 'base', numeric: true }));
}
export let PRICING_CONFIG = {
    machine_hourly_rate_cny: 15.0,
    setup_fee_cny: 0.0,
    min_job_fee_cny: 0.0,
    material_waste_percent: 5.0,
    support_percent_of_model: 0.0,
    post_process_fee_per_part_cny: 0.0,
    use_prusaslicer: 1,
    support_mode: 'on',
    support_price_per_g: 0.0,
    time_overhead_min: 5.0,
    time_vol_min_per_cm3: 0.8,
    time_area_min_per_cm2: 0.0,
    time_ref_layer_height_mm: 0.2,
    time_layer_height_exponent: 1.0,
    time_ref_infill_percent: 20.0,
    time_infill_coefficient: 1.0,
    unit_cost_formula: '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) + support_cost_per_part_cny',
    total_cost_formula: 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)',
};

// ── Color wheel utilities (HSL/RGB conversions + canvas drawing) ──

function _hslToRgb(h, s, l) {
    // h: 0-360, s: 0-100, l: 0-100
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1/3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1/3) * 255)
    ];
}

function _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function _getSwatchBorderColor(hex) {
    return 'rgba(0,0,0,0.72)';
}

function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
        const d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (mx === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
}

export function getMonochromeShades(hue, saturation, count) {
    const shades = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const l = 10 + t * 82;           // 10% → 92% lightness
        const s = saturation * (1 - t * 0.5); // sat gradually drops toward light end
        const [r, g, b] = _hslToRgb(hue, s, l);
        shades.push(_rgbToHex(r, g, b));
    }
    return shades;
}

/**
 * Draw an HSL color wheel on a canvas element with a selection dot.
 * @param {HTMLCanvasElement} canvas
 * @param {number} [selHue=0] - selected hue 0-360
 * @param {number} [selSat=100] - selected saturation 0-100
 */
export function drawColorWheel(canvas, selHue, selSat) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, radius = Math.min(cx, cy) - 2;
    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = x - cx, dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const idx = (y * w + x) * 4;
            if (dist > radius) {
                d[idx] = d[idx + 1] = d[idx + 2] = d[idx + 3] = 0;
                continue;
            }
            // Anti-alias the edge: fade alpha near boundary
            let alpha = 255;
            if (dist > radius - 1.5) {
                alpha = Math.round(Math.max(0, Math.min(255, (radius - dist) * 170)));
            }
            let angle = Math.atan2(dy, dx);
            if (angle < 0) angle += Math.PI * 2;
            const hue = (angle / (Math.PI * 2)) * 360;
            const sat = Math.min((dist / radius) * 100, 100);
            const [r, g, b] = _hslToRgb(hue, sat, 50);
            d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = alpha;
        }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw a smooth circular border (anti-aliased via canvas path)
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Selection dot (hue=0 at 3-o'clock, matching pixel rendering)
    if (selHue !== undefined && selSat !== undefined) {
        const angleRad = (selHue / 360) * Math.PI * 2;
        const satDist = (selSat / 100) * radius;
        const dotX = cx + Math.cos(angleRad) * satDist;
        const dotY = cy + Math.sin(angleRad) * satDist;
        ctx.beginPath(); ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'white'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    }
}

/**
 * Get hue/saturation from a click/touch position on a color wheel canvas.
 * @returns {{hue:number, sat:number}|null}
 */
export function getColorWheelHueSat(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 2;
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) return null;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI * 2;
    return { hue: (angle / (Math.PI * 2)) * 360, sat: (dist / radius) * 100 };
}

/**
 * Build a color wheel panel (preview + canvas + monochrome swatches).
 * @param {string} hex - current selected hex color
 * @returns {string} panel HTML
 */
function _buildColorWheelPanel(hex) {
    const [r, g, b] = hexToRgb(hex);
    const [hue, sat] = _rgbToHsl(r, g, b);
    const shades = getMonochromeShades(hue, sat, 10);
    const swatches = shades.map(sh =>
        `<button type="button" class="cw-swatch w-7 h-7 rounded-md border hover:border-indigo-400 hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-shrink-0" style="background:${sh};border-color:var(--color-border-input);" data-color-hex="${sh}" title="${sh}"></button>`
    ).join('');

    return '<div class="cw-panel-inner tw-bg-surface" style="width:240px;">'
        + '<div class="flex items-center gap-3 mb-3">'
        + '<span class="cw-preview-swatch w-10 h-10 rounded-lg border flex-shrink-0 shadow-sm" style="background:' + hex + ';border-color:var(--color-border);"></span>'
        + '<span class="cw-preview-hex font-mono text-sm font-semibold tw-text-secondary select-all">' + hex + '</span>'
        + '</div>'
        + '<div class="flex justify-center mb-3">'
        + '<canvas class="cw-canvas" width="200" height="200" style="cursor:crosshair;border-radius:50%;display:block;"></canvas>'
        + '</div>'
        + '<div class="color-picker-mono flex gap-1.5 justify-center flex-wrap px-1">'
        + swatches
        + '</div>'
        + '</div>';
}

// ── Utility: color (no palette lookups — uses hex from data directly) ──
export function colorToObj(c) {
    if (!c) return null;
    // Object with hex → use directly
    if (typeof c === 'object' && c.hex) return { name: c.name || c.hex, hex: c.hex };
    // String: hex → use as both name and hex; bare name → name only, no swatch
    if (typeof c === 'string') {
        const t = c.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(t)) return { name: t, hex: t };
        const knownColor = {
            '白色': '#ffffff', '白': '#ffffff', 'white': '#ffffff',
            '黑色': '#000000', '黑': '#000000', 'black': '#000000',
            '灰色': '#808080', '灰': '#808080', 'gray': '#808080', 'grey': '#808080',
            '红色': '#dc2626', '红': '#dc2626', 'red': '#dc2626',
            '蓝色': '#2563eb', '蓝': '#2563eb', 'blue': '#2563eb',
            '绿色': '#16a34a', '绿': '#16a34a', 'green': '#16a34a',
            '黄色': '#ca8a04', '黄': '#ca8a04', 'yellow': '#ca8a04',
            '橙色': '#ea580c', '橙': '#ea580c', 'orange': '#ea580c',
            '紫色': '#9333ea', '紫': '#9333ea', 'purple': '#9333ea',
            '粉色': '#db2777', '粉': '#db2777', 'pink': '#db2777',
        }[t.toLowerCase()];
        if (knownColor) return { name: t, hex: knownColor };
        const materialColor = MATERIAL_OPTIONS
            .map((material) => material?.color)
            .filter((color) => color && typeof color === 'object' && color.hex)
            .find((color) => String(color.name || '').trim().toLowerCase() === t.toLowerCase());
        if (materialColor?.hex) return materialColor;
        if (t) return { name: t, hex: '' };
    }
    return null;
}

export function formatColorLabel(colorKey) {
    const obj = colorToObj(colorKey);
    if (!obj) return String(colorKey || '');
    const hex = obj.hex;
    if (!hex) return escapeHtml(obj.name || String(colorKey || ''));
    return `<span class="inline-flex items-center gap-1.5"><span class="w-3.5 h-3.5 rounded-sm border border-gray-400 inline-block" style="background:${hex}"></span><span class="font-mono text-[11px]">${hex}</span></span>`;
}

export function normalizeColorToken(token) {
    const trimmed = String(token || '').trim();
    if (!trimmed) return '';
    return trimmed;
}

export function escapeHtml(value) {
    const s = String(value ?? "");
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatTimeHMS(hours) {
    if (!hours || isNaN(hours)) return '00h00m00s';
    const totalSeconds = Math.round(hours * 3600);
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}h${m}m${s}s`;
}

export function getRenderColorHex(colorKey) {
    const obj = colorToObj(colorKey);
    if (obj && obj.hex) {
        const hex6 = obj.hex.replace('#', '');
        if (/^[0-9a-fA-F]{6}$/.test(hex6)) return Number.parseInt(hex6, 16);
    }
    const raw = String(colorKey || 'custom');
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return { hue, fallback: true };
}

// ── Session persistence ──
export function loadUserSession() {
    try {
        authToken = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
        const rawUser = localStorage.getItem(USER_STORAGE_KEY);
        if (!rawUser) { currentUser = null; return; }
        const parsedUser = JSON.parse(rawUser);
        if (parsedUser && parsedUser.username) currentUser = parsedUser;
    } catch (e) { currentUser = null; authToken = ""; }
}

export function saveUserSession() {
    if (!currentUser || !authToken) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, authToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
}

export function clearUserSession() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
}

export function saveLastUsername(identifier) {
    try { localStorage.setItem(SAVED_USERNAME_KEY, (identifier || '').trim()); } catch (e) {}
}
export function getLastUsername() {
    try { return localStorage.getItem(SAVED_USERNAME_KEY) || ''; } catch (e) { return ''; }
}

// ── API helpers ──
export async function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
        currentUser = null;
        authToken = "";
        clearUserSession();
    }
    return response;
}

// ── Slicer preset localStorage ──
export function getSlicerPresetStorageKey() {
    const uid = currentUser && currentUser.id ? String(currentUser.id) : "guest";
    return `${SLICER_PRESET_STORAGE_PREFIX}${uid}`;
}

export function loadSlicerPresetSelection() {
    try {
        const raw = localStorage.getItem(getSlicerPresetStorageKey());
        if (!raw) { quoteOptions.slicer_preset_id = null; return; }
        const parsed = Number.parseInt(raw, 10);
        quoteOptions.slicer_preset_id = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    } catch (e) { quoteOptions.slicer_preset_id = null; }
}

export function saveSlicerPresetSelection() {
    try {
        const key = getSlicerPresetStorageKey();
        if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined) {
            localStorage.setItem(key, String(quoteOptions.slicer_preset_id));
        } else {
            localStorage.removeItem(key);
        }
    } catch (e) {}
}

function _getScopedStorageKey(prefix) {
    const uid = currentUser && currentUser.id ? String(currentUser.id) : "guest";
    return `${prefix}${uid}`;
}

function _loadJsonStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        return null;
    }
}

function _saveJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
}

export function loadFrontSettingsSnapshot() {
    return _loadJsonStorage(_getScopedStorageKey(FRONT_SETTINGS_STORAGE_PREFIX));
}

export function saveFrontSettingsSnapshot(snapshot) {
    _saveJsonStorage(_getScopedStorageKey(FRONT_SETTINGS_STORAGE_PREFIX), snapshot);
}

export function loadBatchSettingsSnapshot() {
    return _loadJsonStorage(_getScopedStorageKey(BATCH_SETTINGS_STORAGE_PREFIX));
}

export function saveBatchSettingsSnapshot(snapshot) {
    _saveJsonStorage(_getScopedStorageKey(BATCH_SETTINGS_STORAGE_PREFIX), snapshot);
}

// ── Material helpers ──
export function getMaterialByName(name, brand) {
    if (brand) {
        const branded = MATERIAL_OPTIONS.find((m) => m && m.name === name && (m.brand || 'Generic') === brand);
        if (branded) return branded;
    }
    return MATERIAL_OPTIONS.find((m) => m && m.name === name) || null;
}

export function getColorsForMaterial(name, brand) {
    const matches = MATERIAL_OPTIONS.filter((m) => m && m.name === name && (!brand || (m.brand || 'Generic') === brand));
    const colors = [];
    const seen = new Set();
    for (const material of matches) {
        const color = colorToObj(material.color);
        if (!color) continue;
        const key = (color.hex || color.name || '').toLowerCase();
        if (!seen.has(key)) { seen.add(key); colors.push(color); }
    }
    return colors.length ? colors : [{ name: '黑色', hex: '#000000' }];
}

export function isColorInAllowedColors(color, allowedColors) {
    if (!color || !allowedColors || !allowedColors.length) return false;
    const obj = colorToObj(color);
    if (!obj) return false;
    const targetHex = String(obj.hex || '').trim().toLowerCase();
    const targetName = String(obj.name || '').trim().toLowerCase();
    return allowedColors.some(c => {
        const a = colorToObj(c);
        if (!a) return false;
        const allowedHex = String(a.hex || '').trim().toLowerCase();
        const allowedName = String(a.name || '').trim().toLowerCase();
        return (targetHex && allowedHex === targetHex) || (targetName && allowedName === targetName);
    });
}

export function pickAllowedColor(allowedColors, preferredColor, defaultColor) {
    if (allowedColors && allowedColors.length && isColorInAllowedColors(preferredColor, allowedColors)) {
        const obj = colorToObj(preferredColor);
        if (obj && obj.hex) return obj.hex;
        return String(preferredColor);
    }
    const first = allowedColors && allowedColors.length ? colorToObj(allowedColors[0]) : null;
    if (first && first.hex) return first.hex;
    return typeof defaultColor === 'string' ? defaultColor : '';
}

export function renderColorDropdown(name, selectedColor, compact, brand) {
    const allowedColors = getColorsForMaterial(name, brand);
    const normColors = allowedColors.map(c => colorToObj(c)).filter(Boolean);
    if (!normColors.length) return { html: '', selected: '' };

    // Match by normalized hex or color name so refreshes do not silently select the first item.
    const selObj = colorToObj(selectedColor);
    let match = null;
    if (selObj) {
        const selectedHex = String(selObj.hex || '').trim().toLowerCase();
        const selectedName = String(selObj.name || '').trim().toLowerCase();
        match = normColors.find(c => {
            const colorHex = String(c.hex || '').trim().toLowerCase();
            const colorName = String(c.name || '').trim().toLowerCase();
            return (selectedHex && colorHex === selectedHex) || (selectedName && colorName === selectedName);
        });
    }
    const safe = match || normColors[0];
    const safeHex = safe.hex || '#d1d5db';
    const safeBorder = _getSwatchBorderColor(safeHex);
    const swatchSize = compact ? 'w-3.5 h-3.5' : 'w-5 h-5';
    const wrapperClass = compact ? 'color-dd-wrapper color-dd-wrapper-compact' : 'color-dd-wrapper color-dd-wrapper-default';
    const triggerClass = compact
        ? 'color-dd-trigger color-dd-trigger-compact tw-popup-trigger text-[11px]'
        : 'color-dd-trigger color-dd-trigger-default tw-popup-trigger text-sm';
    const items = normColors.map((color) => {
        const hex = color.hex || '#d1d5db';
        const swatchBorder = _getSwatchBorderColor(hex);
        const isSelected = hex.toLowerCase() === safeHex.toLowerCase();
        const activeClass = isSelected ? ' color-dd-item-active' : '';
        return '<button type="button" class="color-dd-item color-dd-item-swatch-only tw-dropdown-option flex items-center justify-center w-full px-2 py-2' + activeClass + '" data-color-hex="' + hex + '" role="option" aria-selected="' + (isSelected ? 'true' : 'false') + '" aria-label="' + hex + '" title="' + hex + '">'
            + '<span class="color-dd-item-swatch ' + swatchSize + ' rounded-sm border flex-shrink-0" style="background:' + hex + ';border-color:' + swatchBorder + ';"></span>'
            + '</button>';
    }).join('');
    const html = '<div class="' + wrapperClass + '" data-selected-color="' + safeHex + '">'
        + '<button type="button" class="' + triggerClass + '" data-color-trigger="1" aria-haspopup="listbox" aria-expanded="false" aria-label="' + safeHex + '" title="' + safeHex + '">'
        + '<span class="color-dd-swatch ' + swatchSize + ' rounded-sm border flex-shrink-0" style="background:' + safeHex + ';border-color:' + safeBorder + ';"></span>'
        + (compact ? '' : '<span class="color-dd-trigger-label flex-1 text-left font-mono text-xs tw-text-secondary">' + safeHex + '</span>')
        + '<svg class="color-dd-chevron w-4 h-4 tw-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
        + '</button>'
        + '<div class="color-dd-list color-dd-list-swatch-only tw-dropdown-panel hidden" role="listbox">'
        + items
        + '</div>'
        + '<input type="hidden" class="row-color-value" value="' + safeHex + '"></div>';
    return { html, selected: safeHex };
}

// ── Mutators (used by settings) ──
export function setMaterialOptions(v) {
    // Keep the array identity stable because init-time event modules retain a
    // reference to MATERIAL_OPTIONS while user settings are loaded later.
    MATERIAL_OPTIONS.splice(0, MATERIAL_OPTIONS.length, ...(Array.isArray(v) ? v : []));
}
export function setPricingConfig(v) { PRICING_CONFIG = v; }
export function setCurrentUser(v) { currentUser = v; }
export function setAuthToken(v) { authToken = v; }
export function setCurrentResults(v) { currentResults = v; }
export function setSlicerPresets(v) { slicerPresets = v; }
export function setPendingQuoteFiles(v) { pendingQuoteFiles = v; }

export function getPrinterBaseId(printerRef) {
    return String(printerRef || '').replace(/_\d{2}$/, '');
}

export function getPrinterNozzleFromRef(printerRef) {
    const match = String(printerRef || '').match(/_(\d{2})$/);
    return match ? Number.parseInt(match[1], 10) / 10 : null;
}

export function buildPrinterCompoundId(printerId, nozzle) {
    const parsed = Number.parseFloat(nozzle);
    if (!printerId || !Number.isFinite(parsed)) return String(printerId || '');
    return `${getPrinterBaseId(printerId)}_${String(Math.round(parsed * 10)).padStart(2, '0').slice(-2)}`;
}

export function getResultNozzleDiameter(item, printer) {
    const direct = Number.parseFloat(item?._nozzle_diameter);
    if (Number.isFinite(direct)) return direct;
    const compound = getPrinterNozzleFromRef(item?._printer_model);
    if (Number.isFinite(compound)) return compound;
    const core = item?.cost_breakdown?.gcode_summary?.core_params || {};
    const sliced = Number.parseFloat(core.nozzle_diameter);
    if (Number.isFinite(sliced)) return sliced;
    const fallback = Number.parseFloat(printer?.nozzle);
    return Number.isFinite(fallback) ? fallback : 0.4;
}

// ── Active printer compound ID (model + nozzle → e.g. "bambu_a1_04") ──
export function getActivePrinterCompoundId() {
    const batchModel = document.getElementById("batch-printer-model");
    const batchNozzle = document.getElementById("batch-nozzle-diameter");
    if (batchModel && batchModel.value && batchNozzle && batchNozzle.value) {
        const n = String(Math.round(parseFloat(batchNozzle.value) * 10)).padStart(2, '0').slice(-2);
        return `${batchModel.value}_${n}`;
    }
    const cfgModel = document.getElementById("cfg-printer-model-main");
    const cfgNozzle = document.getElementById("cfg-nozzle-diameter");
    if (cfgModel && cfgModel.value && cfgNozzle && cfgNozzle.value) {
        const n = String(Math.round(parseFloat(cfgNozzle.value) * 10)).padStart(2, '0').slice(-2);
        return `${cfgModel.value}_${n}`;
    }
    return "";
}

// ── Printer model cache (for per-file dropdowns in results table) ──
let _cachedPrinterModels = [];
export function setCachedPrinterModels(v) { _cachedPrinterModels = v || []; }
export function getCachedPrinterModels() {
    if (!_cachedPrinterModels.length) return [];
    const enabled = getEnabledPrinters();
    if (!enabled.length) return _cachedPrinterModels;
    return _cachedPrinterModels.filter(function(p) { return enabled.includes(p.id); });
}

// ── Enabled printers (user-selected printer models) ──
export const ENABLED_PRINTERS_KEY = 'pricer3d_enabled_printers_v1';
const DEFAULT_ENABLED_PRINTERS = ['bambu_a1', 'bambu_a1_mini', 'bambu_p1s', 'bambu_x1c'];
export function getEnabledPrinters() {
    try {
        const saved = localStorage.getItem(ENABLED_PRINTERS_KEY);
        if (saved) return JSON.parse(saved);
        return DEFAULT_ENABLED_PRINTERS;
    } catch (e) { return DEFAULT_ENABLED_PRINTERS; }
}
export function setEnabledPrinters(ids) {
    localStorage.setItem(ENABLED_PRINTERS_KEY, JSON.stringify(ids));
}

// ── Hidden printers (legacy, kept for migration) ──
export const HIDDEN_PRINTERS_KEY = 'pricer3d_hidden_printers_v1';
export function getHiddenPrinters() {
    try { return JSON.parse(localStorage.getItem(HIDDEN_PRINTERS_KEY) || '[]'); }
    catch (e) { return []; }
}
export function setHiddenPrinters(ids) {
    localStorage.setItem(HIDDEN_PRINTERS_KEY, JSON.stringify(ids));
}
