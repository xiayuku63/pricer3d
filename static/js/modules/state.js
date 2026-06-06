// ── Shared state & utilities for pricer3d frontend ──
// All modules import from here. No more giant closure scope.

const TOKEN_STORAGE_KEY = "demo_access_token_v1";
const USER_STORAGE_KEY = "demo_user_v1";
const SAVED_USERNAME_KEY = "demo_saved_username_v1";
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
    printer_model: "",
    orientation: { x: 0, y: 0, z: 0 },
};

// ── User default printer / nozzle / preset (persisted to backend) ──
export let defaultPrinterId = null;    // e.g. "bambu_a1"
export let defaultNozzle = null;       // e.g. "0.4"
export let defaultSlicerPresetId = null;  // e.g. 3
export function setDefaultPrinterId(v) { defaultPrinterId = v; }
export function setDefaultNozzle(v) { defaultNozzle = v; }
export function setDefaultSlicerPresetId(v) { defaultSlicerPresetId = v; }

// ── User preferences (default material, color, favorites, formula templates) ──
export let userPreferences = {
    default_material: null,
    default_color: null,
    favorite_materials: [],
    favorite_colors: [],
    formula_templates: [],
    material_usage: {},   // { "PLA": 12, "ABS": 5, ... }
    color_usage: {},      // { "#ffffff": 8, "#000000": 15, ... }
    default_quantity: 1,
    history_page_size: 20,
    history_sort: 'newest',
    history_retention_days: 0,
    history_visible_columns: ['material', 'quantity'],
};
export function setUserPreferences(v) {
    if (v && typeof v === 'object') {
        userPreferences = {
            default_material: v.default_material || null,
            default_color: v.default_color || null,
            favorite_materials: Array.isArray(v.favorite_materials) ? v.favorite_materials : [],
            favorite_colors: Array.isArray(v.favorite_colors) ? v.favorite_colors : [],
            formula_templates: Array.isArray(v.formula_templates) ? v.formula_templates : [],
            material_usage: (v.material_usage && typeof v.material_usage === 'object') ? v.material_usage : {},
            color_usage: (v.color_usage && typeof v.color_usage === 'object') ? v.color_usage : {},
            default_quantity: Number(v.default_quantity) || 1,
            history_page_size: Number(v.history_page_size) || 20,
            history_sort: v.history_sort || 'newest',
            history_retention_days: Number(v.history_retention_days) || 0,
            history_visible_columns: Array.isArray(v.history_visible_columns) ? v.history_visible_columns : ['material', 'quantity'],
        };
    }
}

// ── Preference localStorage persistence ──
const PREFS_STORAGE_KEY = 'pricer3d_user_prefs_v1';

export function loadPreferencesFromStorage() {
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            setUserPreferences(parsed);
        }
    } catch (e) { /* ignore */ }
}

export function savePreferencesToStorage() {
    try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(userPreferences));
    } catch (e) { /* ignore */ }
}

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
    { name: "PETG", brand: "通用", density: 1.27, price_per_kg: 230.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
    { name: "ABS", brand: "通用", density: 1.04, price_per_kg: 250.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
    { name: "TPU", brand: "通用", density: 1.21, price_per_kg: 350.0, colors: DEFAULT_COLORS.map(c=>({...c})) },
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
    if (!hex) return escapeHtml(obj.name || String(colorKey || ''));
    return `<span class="inline-flex items-center gap-1.5"><span class="w-3.5 h-3.5 rounded-sm border border-gray-400 inline-block" style="background:${hex}"></span><span class="font-mono text-[11px]">${hex}</span></span>`;
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
    if (!obj || !obj.hex) return false;
    const targetHex = obj.hex.toLowerCase();
    return allowedColors.some(c => {
        const a = colorToObj(c);
        return a && a.hex && a.hex.toLowerCase() === targetHex;
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

export function renderColorDropdown(name, selectedColor, compact) {
    const allowedColors = getColorsForMaterial(name);
    const normColors = allowedColors.map(c => colorToObj(c)).filter(Boolean);
    if (!normColors.length) return { html: '', selected: '' };

    // Match by hex (color display is hex-only now)
    const selObj = colorToObj(selectedColor);
    let match = null;
    if (selObj && selObj.hex) {
        match = normColors.find(c => c.hex === selObj.hex);
    }
    const safe = match || normColors[0];
    const safeHex = safe.hex || '#d1d5db';

    const listItems = normColors.map(c => {
        const hex = c.hex || '#d1d5db';
        const isFav = userPreferences.favorite_colors.some(fc => fc.toLowerCase() === hex.toLowerCase());
        const favClass = isFav ? 'text-yellow-500' : 'text-gray-300';
        return '<button type="button" class="color-dd-item flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 text-left'
            + (c.hex === safeHex ? ' bg-indigo-50' : '')
            + '" data-color-hex="' + hex + '">'
            + '<span class="w-5 h-5 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + hex + '"></span>'
            + '<span class="flex-1 font-mono text-xs">' + hex + '</span>'
            + '<button type="button" class="color-fav-toggle ' + favClass + ' hover:text-yellow-500 text-sm flex-shrink-0" data-color-hex="' + hex + '" title="收藏">★</button>'
            + '</button>';
    }).join('');

    if (compact) {
        const html = '<div class="color-dd-wrapper relative inline-block">'
            + '<button type="button" class="color-dd-trigger flex items-center gap-1 px-1.5 py-0.5 border border-gray-400 rounded text-[11px] bg-white hover:border-gray-400 min-w-[36px]">'
            + '<span class="color-dd-swatch w-3.5 h-3.5 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + safeHex + '"></span>'
            + '<svg class="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
            + '</button>'
            + '<div class="color-dd-list hidden absolute z-30 left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto min-w-[140px]">'
            + listItems
            + '</div>'
            + '<input type="hidden" class="row-color-value" value="' + safeHex + '">'
            + '</div>';
        return { html, selected: safeHex };
    }

    const html = '<div class="color-dd-wrapper relative">'
        + '<button type="button" class="color-dd-trigger flex items-center gap-2 w-full px-3 py-2 border border-gray-400 rounded-md text-sm bg-white hover:border-gray-400">'
        + '<span class="color-dd-swatch w-5 h-5 rounded-sm border border-gray-400 flex-shrink-0" style="background:' + safeHex + '"></span>'
        + '<span class="color-dd-label flex-1 text-left font-mono text-xs">' + safeHex + '</span>'
        + '<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
        + '</button>'
        + '<div class="color-dd-list hidden absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">'
        + listItems
        + '</div>'
        + '<input type="hidden" class="row-color-value" value="' + safeHex + '">'
        + '</div>';
    return { html, selected: safeHex };
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
    const hidden = getHiddenPrinters();
    if (!hidden.length) return _cachedPrinterModels;
    return _cachedPrinterModels.filter(function(p) { return !hidden.includes(p.id); });
}

// ── Hidden printers (user-disabled printer models) ──
export const HIDDEN_PRINTERS_KEY = 'pricer3d_hidden_printers_v1';
export function getHiddenPrinters() {
    try { return JSON.parse(localStorage.getItem(HIDDEN_PRINTERS_KEY) || '[]'); }
    catch (e) { return []; }
}
export function setHiddenPrinters(ids) {
    localStorage.setItem(HIDDEN_PRINTERS_KEY, JSON.stringify(ids));
}
