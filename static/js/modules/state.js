// ── Shared state & utilities for pricer3d frontend ──
// All modules import from here. No more giant closure scope.

const TOKEN_STORAGE_KEY = "demo_access_token_v1";
const USER_STORAGE_KEY = "demo_user_v1";
const SLICER_PRESET_STORAGE_PREFIX = "demo_slicer_preset_id_v1_";

// ── Auth state ──
export let authToken = '';
export let currentUser = null;
export let currentCaptchaId = '';
export let currentCaptchaUrl = '';
export function setCaptchaId(v) { currentCaptchaId = v; }
export function setCaptchaUrl(v) { currentCaptchaUrl = v; }

// ── Quote options ──
export const quoteOptions = {
    material: "PLA",
    color: "",
    quantity: 1,
    slicer_preset_id: null,
    orientation: { x: 0, y: 0, z: 0 },
};

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
const DEFAULT_COLORS = [
    { name: '白色', hex: '#ffffff' },
    { name: '黑色', hex: '#000000' },
    { name: '灰色', hex: '#808080' },
    { name: '红色', hex: '#dc2626' },
    { name: '蓝色', hex: '#2563eb' },
    { name: '绿色', hex: '#16a34a' },
    { name: '黄色', hex: '#ca8a04' },
    { name: '橙色', hex: '#ea580c' },
    { name: '紫色', hex: '#9333ea' },
    { name: '粉色', hex: '#db2777' },
];

export let MATERIAL_OPTIONS = [
    { name: "PLA", brand: "通用", density: 1.24, price_per_kg: 200.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
    { name: "ABS", brand: "通用", density: 1.04, price_per_kg: 250.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
    { name: "Resin", brand: "通用", density: 1.11, price_per_kg: 800.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
];
export let COLOR_OPTIONS = DEFAULT_COLORS.map(c => ({...c}));

export let PRICING_CONFIG = {
    machine_hourly_rate_cny: 15.0,
    setup_fee_cny: 0.0,
    min_job_fee_cny: 0.0,
    material_waste_percent: 5.0,
    support_percent_of_model: 0.0,
    post_process_fee_per_part_cny: 0.0,
    difficulty_coefficient: 0.25,
    difficulty_ratio_low: 0.8,
    difficulty_ratio_high: 4.0,
    use_prusaslicer: 1,
    support_mode: 'diff',
    support_price_per_g: 0.0,
    time_overhead_min: 5.0,
    time_vol_min_per_cm3: 0.8,
    time_area_min_per_cm2: 0.0,
    time_ref_layer_height_mm: 0.2,
    time_layer_height_exponent: 1.0,
    time_ref_infill_percent: 20.0,
    time_infill_coefficient: 1.0,
    unit_cost_formula: '((effective_weight_g * (price_per_kg / 1000.0)) + (unit_time_h * machine_hourly_rate_cny) + post_process_fee_per_part_cny) * difficulty_multiplier + support_cost_per_part_cny',
    total_cost_formula: 'max((unit_cost_cny * quantity) + setup_fee_cny, min_job_fee_cny)',
};

// ── Utility: color (no palette lookups — uses hex from data directly) ──
export function colorToObj(c) {
    if (!c) return null;
    // Object with hex → use directly
    if (typeof c === 'object' && c.hex) return { name: c.name || c.hex, hex: c.hex };
    // String: hex → use as both name and hex; bare name → name only, no swatch
    if (typeof c === 'string') {
        const t = c.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(t)) return { name: t, hex: t };
        if (t) return { name: t, hex: '' };
    }
    return null;
}

export function formatColorLabel(colorKey) {
    const obj = colorToObj(colorKey);
    if (!obj) return String(colorKey || '');
    const hex = obj.hex;
    const name = (!hex || obj.name === hex) ? (obj.name || '自定义色') : obj.name;
    if (!hex) return escapeHtml(name);
    return `<span class="inline-flex items-center gap-1.5"><span class="w-3.5 h-3.5 rounded-sm border border-gray-300 inline-block" style="background:${hex}"></span>${escapeHtml(name)}</span>`;
}

export function normalizeColorToken(token) {
    const trimmed = String(token || '').trim();
    if (!trimmed) return '';
    return trimmed;
}

export function materialColorsArray(m) {
    if (!m) return [];
    const raw = Array.isArray(m.colors) ? m.colors : [];
    return raw.map(c => colorToObj(c)).filter(Boolean);
}

export function materialColorNames(m) {
    return materialColorsArray(m).map(c => c ? c.name : '').join(', ');
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

// ── Material helpers ──
export function getMaterialByName(name) {
    return MATERIAL_OPTIONS.find((m) => m && m.name === name) || null;
}

export function getColorsForMaterial(name) {
    const material = getMaterialByName(name);
    const colors = material && Array.isArray(material.colors) ? material.colors : [];
    return colors.length ? colors : [{ name: '黑色', hex: '#000000' }];
}

export function isColorInAllowedColors(color, allowedColors) {
    if (!color || !allowedColors || !allowedColors.length) return false;
    const obj = colorToObj(color);
    if (!obj) return false;
    const targetName = obj.name;
    const targetHex = (obj.hex || '').toLowerCase();
    return allowedColors.some(c => {
        const a = colorToObj(c);
        if (!a) return false;
        // Match by name first, then by hex
        if (a.name === targetName) return true;
        if (targetHex && a.hex && a.hex.toLowerCase() === targetHex) return true;
        return false;
    });
}

export function pickAllowedColor(allowedColors, preferredColor, defaultColor) {
    if (allowedColors && allowedColors.length && isColorInAllowedColors(preferredColor, allowedColors)) {
        // If preferred is already a hex string, return it as-is
        const prefStr = typeof preferredColor === 'string' ? preferredColor.trim() : '';
        if (prefStr && /^#[0-9a-fA-F]{6}$/.test(prefStr)) {
            return prefStr;
        }
        // Name or object — look up the hex from allowedColors
        const prefObj = colorToObj(preferredColor);
        const targetName = prefObj?.name || prefStr;
        if (targetName) {
            const match = allowedColors.map(c => colorToObj(c)).find(c => c && c.hex && c.name === targetName);
            if (match) return match.hex;
        }
        // Fall back: return name if we can't find hex
        return prefStr || (prefObj?.name || String(preferredColor));
    }
    const first = allowedColors && allowedColors.length ? colorToObj(allowedColors[0]) : null;
    if (first && first.hex) return first.hex;
    if (first && first.name) return first.name;
    return typeof defaultColor === 'string' ? defaultColor : '';
}

export function renderColorDropdown(name, selectedColor, compact) {
    const allowedColors = getColorsForMaterial(name);
    const normColors = allowedColors.map(c => colorToObj(c)).filter(Boolean);
    if (!normColors.length) return { html: '', selected: '' };

    // Match by name first, then by hex
    const selObj = colorToObj(selectedColor);
    let match = null;
    if (selObj) {
        match = normColors.find(c => c.name === selObj.name) ||
                (selObj.hex ? normColors.find(c => c.hex === selObj.hex) : null);
    }
    const safe = match || normColors[0];
    const safeLabel = (!safe.hex || safe.name === safe.hex) ? (safe.name || '自定义') : safe.name;

    const listItems = normColors.map(c => {
        const label = (!c.hex || c.name === c.hex) ? (c.name || '自定义') : c.name;
        const hexBg = c.hex || '#d1d5db';  // fallback gray if no hex
        return '<button type="button" class="color-dd-item flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 text-left'
            + (c.name === safe.name ? ' bg-indigo-50' : '')
            + '" data-color-hex="' + (c.hex || c.name) + '" data-color-name="' + escapeHtml(c.name) + '">'
            + '<span class="w-5 h-5 rounded-sm border border-gray-300 flex-shrink-0" style="background:' + hexBg + '"></span>'
            + '<span class="flex-1">' + escapeHtml(label) + '</span>'
            + (c.hex ? '<span class="text-[10px] text-gray-400 font-mono">' + c.hex + '</span>' : '')
            + '</button>';
    }).join('');

    const swatchHex = safe.hex || '#d1d5db';

    if (compact) {
        const html = '<div class="color-dd-wrapper relative inline-block">'
            + '<button type="button" class="color-dd-trigger flex items-center gap-1 px-1.5 py-0.5 border border-gray-300 rounded text-[11px] bg-white hover:border-gray-400 min-w-[36px]">'
            + '<span class="color-dd-swatch w-3.5 h-3.5 rounded-sm flex-shrink-0" style="background:' + swatchHex + '"></span>'
            + '<svg class="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
            + '</button>'
            + '<div class="color-dd-list hidden absolute z-30 left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto min-w-[160px]">'
            + listItems
            + '</div>'
            + '<input type="hidden" class="row-color-value" value="' + (safe.hex || safe.name) + '">'
            + '</div>';
        return { html, selected: safe.hex || safe.name };
    }

    const html = '<div class="color-dd-wrapper relative">'
        + '<button type="button" class="color-dd-trigger flex items-center gap-2 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white hover:border-gray-400">'
        + '<span class="color-dd-swatch w-5 h-5 rounded-sm border border-gray-300 flex-shrink-0" style="background:' + swatchHex + '"></span>'
        + '<span class="color-dd-label flex-1 text-left">' + escapeHtml(safeLabel) + '</span>'
        + '<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
        + '</button>'
        + '<div class="color-dd-list hidden absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">'
        + listItems
        + '</div>'
        + '<input type="hidden" class="row-color-value" value="' + (safe.hex || safe.name) + '">'
        + '</div>';
    return { html, selected: safe.hex || safe.name };
}

// ── Mutators (used by settings) ──
export function setMaterialOptions(v) { MATERIAL_OPTIONS = v; }
export function setColorOptions(v) { COLOR_OPTIONS = v; }
export function setPricingConfig(v) { PRICING_CONFIG = v; }
export function setCurrentUser(v) { currentUser = v; }
export function setAuthToken(v) { authToken = v; }
export function setCurrentResults(v) { currentResults = v; }
export function setSlicerPresets(v) { slicerPresets = v; }
export function setPendingQuoteFiles(v) { pendingQuoteFiles = v; }
