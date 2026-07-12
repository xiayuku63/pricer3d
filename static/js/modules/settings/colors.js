// ── Color management (color editor modal) ──
import {
    authToken, currentUser,
    MATERIAL_OPTIONS, setMaterialOptions,
    COLOR_OPTIONS, setColorOptions,
    PRICING_CONFIG, setPricingConfig,
    quoteOptions,
    authFetch, colorToObj, materialColorsArray, escapeHtml,
    renderColorDropdown, getColorsForMaterial,
    hexToRgb, drawColorWheel,
    saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap,
    defaultPrinterId, setDefaultPrinterId,
    defaultNozzle, setDefaultNozzle,
    defaultSlicerPresetId, setDefaultSlicerPresetId,
    defaultMaterial, setDefaultMaterial,
    defaultColor, setDefaultColor,
    defaultBrand, setDefaultBrand,
    getBrandOptions, getMaterialsByBrand, getUsedBrandOptions, MATERIAL_TYPE_PRESETS,
} from '../state.js';
import { t } from '../i18n.js';
import { refreshQuoteColorDropdowns } from './common.js';
import { renderUserCenterUI } from './materials.js';

// ── Color editor ──
let _colorEditMaterialIdx = -1;

export function openColorEditor(materialIdx) {
    _colorEditMaterialIdx = materialIdx;
    const m = MATERIAL_OPTIONS[materialIdx];
    if (!m) return;
    const colors = materialColorsArray(m);
    const title = document.getElementById('color-editor-title');
    if (title) title.textContent = t('settings.editColorsFor', { name: m.name });
    const list = document.getElementById('color-editor-list');
    if (list) {
        list.innerHTML = colors.map(c => `
            <div class="flex items-center gap-2 p-1.5 bg-gray-50 rounded-md">
                <span class="w-6 h-6 rounded-sm border border-gray-400 flex-shrink-0" style="background:${c.hex}"></span>
                <span class="text-xs flex-1 font-mono">${c.hex}</span>
                <button type="button" class="text-red-400 hover:text-red-600 text-xs remove-color-btn" data-color-hex="${c.hex}">×</button>
            </div>
        `).join('');
    }
    // Initialize color wheel with default indigo color
    const defaultHex = '#6366f1';
    _initColorEditorWheel(defaultHex);
    const nameInput = document.getElementById('color-editor-name');
    if (nameInput) nameInput.value = '';
    const modal = document.getElementById('color-editor-modal');
    if (modal) modal.classList.remove('hidden');

    // Bind canvas events (rebind on each open to avoid stale references)
    _bindColorEditorEvents();
}

function _bindColorEditorEvents() {
    const canvas = document.getElementById('color-editor-canvas');
    if (!canvas) return;
    // Remove old listeners by clone & replace to prevent duplicate bindings
    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);

    // Redraw wheel on the new canvas (the clone lost the drawn content)
    const curHex = document.getElementById('color-editor-hex')?.textContent || '#6366f1';
    const [r, g, b] = hexToRgb(curHex);
    let hue = 0, sat = 100;
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
    if (mx !== mn) {
        const d = mx - mn;
        sat = (d / (1 - Math.abs(mx + mn - 1))) * 100;
        let h = 0;
        if (mx === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (mx === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
        hue = h * 360;
    }
    _colorEditorWheelState = { hue, sat };
    drawColorWheel(newCanvas, hue, sat);

    let ceDrag = false;
    newCanvas.addEventListener('mousedown', (e) => {
        ceDrag = true;
        _colorEditorPickHueSat(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
        if (!ceDrag) return;
        _colorEditorPickHueSat(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', () => { ceDrag = false; });

    // Monochrome swatch clicks
    const monoRow = document.getElementById('color-editor-mono');
    if (monoRow) {
        monoRow.addEventListener('click', (e) => {
            const swatch = e.target.closest('.ce-swatch');
            if (!swatch) return;
            const hex = swatch.getAttribute('data-color-hex');
            if (!hex) return;
            document.getElementById('color-editor-swatch').style.background = hex;
            document.getElementById('color-editor-hex').textContent = hex;
            monoRow.querySelectorAll('.ce-swatch').forEach(s => s.classList.remove('ring-2', 'ring-indigo-500'));
            swatch.classList.add('ring-2', 'ring-indigo-500');
        });
    }
}

// ── Color editor wheel helpers ──
let _colorEditorWheelState = { hue: 0, sat: 100 };

function _initColorEditorWheel(hex) {
    const canvas = document.getElementById('color-editor-canvas');
    if (!canvas) return;
    const [r, g, b] = hexToRgb(hex);
    let hue = 0, sat = 100;
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
    if (mx !== mn) {
        const d = mx - mn;
        sat = (d / (1 - Math.abs(mx + mn - 1))) * 100;
        let h = 0;
        if (mx === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (mx === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
        hue = h * 360;
    }
    _colorEditorWheelState = { hue, sat };
    drawColorWheel(canvas, hue, sat);
    _colorEditorUpdatePreview(hex);
    _colorEditorUpdateMonochrome(hue, sat, hex);
}

function _colorEditorUpdatePreview(hex) {
    const swatch = document.getElementById('color-editor-swatch');
    if (swatch) swatch.style.background = hex;
    const hexLabel = document.getElementById('color-editor-hex');
    if (hexLabel) hexLabel.textContent = hex;
}

function _colorEditorUpdateMonochrome(hue, sat, pickHex) {
    const monoRow = document.getElementById('color-editor-mono');
    if (!monoRow) return;
    const count = 10;
    const shades = [];
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const l = 10 + t * 82;
        const s2 = sat * (1 - t * 0.5);
        const [r2, g2, b2] = (() => {
            const h2 = hue / 360; const s3 = s2 / 100; const l2 = l / 100;
            if (s3 === 0) { const v = Math.round(l2 * 255); return [v, v, v]; }
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l2 < 0.5 ? l2 * (1 + s3) : l2 + s3 - l2 * s3;
            const p2 = 2 * l2 - q;
            return [
                Math.round(hue2rgb(p2, q, h2 + 1/3) * 255),
                Math.round(hue2rgb(p2, q, h2) * 255),
                Math.round(hue2rgb(p2, q, h2 - 1/3) * 255)
            ];
        })();
        const sh = '#' + [r2, g2, b2].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
        shades.push(sh);
    }
    monoRow.innerHTML = shades.map(sh =>
        `<button type="button" class="ce-swatch w-7 h-7 rounded-md border border-gray-300 hover:border-indigo-400 hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-shrink-0${sh === pickHex ? ' ring-2 ring-indigo-500' : ''}" style="background:${sh}" data-color-hex="${sh}" title="${sh}"></button>`
    ).join('');
}

function _colorEditorPickHueSat(clientX, clientY) {
    const canvas = document.getElementById('color-editor-canvas');
    if (!canvas) return;
    const result = (() => {
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
    })();
    if (!result) return;
    const { hue, sat } = result;
    _colorEditorWheelState = { hue, sat };
    drawColorWheel(canvas, hue, sat);
    // Compute hex
    const [r, g, b] = (() => {
        const h = hue / 360; const s = sat / 100;
        if (s === 0) { const v = Math.round(128); return [v, v, v]; }
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const l = 50 / 100;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [
            Math.round(hue2rgb(p, q, h + 1/3) * 255),
            Math.round(hue2rgb(p, q, h) * 255),
            Math.round(hue2rgb(p, q, h - 1/3) * 255)
        ];
    })();
    const hex = '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
    _colorEditorUpdatePreview(hex);
    _colorEditorUpdateMonochrome(hue, sat, hex);
}

export function closeColorEditor() {
    const modal = document.getElementById('color-editor-modal');
    if (modal) modal.classList.add('hidden');
    _colorEditMaterialIdx = -1;
}

export function addColorToMaterial() {
    const m = MATERIAL_OPTIONS[_colorEditMaterialIdx];
    if (!m) return;
    const hex = document.getElementById('color-editor-hex')?.textContent;
    if (!hex) return;
    if (!m.colors || !Array.isArray(m.colors)) m.colors = [];
    const existing = materialColorsArray(m);
    if (existing.some(c => c.hex === hex)) {
        const toast = document.getElementById('color-editor-toast');
        if (toast) { toast.textContent = t('material.colorExists'); toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 2000); }
        return;
    }
    m.colors.push({ name: hex, hex });
    if (!COLOR_OPTIONS.some(c => c.hex === hex)) COLOR_OPTIONS.push({ name: hex, hex });
    refreshQuoteColorDropdowns();
    renderUserCenterUI();
    openColorEditor(_colorEditMaterialIdx);
}

export function removeColorFromMaterial(hex) {
    const m = MATERIAL_OPTIONS[_colorEditMaterialIdx];
    if (!m || !Array.isArray(m.colors)) return;
    m.colors = m.colors.filter(c => colorToObj(c)?.hex !== hex);
    renderUserCenterUI();
    openColorEditor(_colorEditMaterialIdx);
}
