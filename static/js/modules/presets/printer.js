// ── Printer presets CRUD ──
import {
    authToken,
    authFetch,
    getEnabledPrinters, setEnabledPrinters, ENABLED_PRINTERS_KEY,
} from '../state.js';
import { openLoginModal } from '../auth.js';
import { t } from '../i18n.js';
import { dom, _printerModels, setMsg } from './ui.js';
import { fetchPrinterModels } from './printers.js';

export async function fetchPrinterPresets() {
    if (!authToken) return;
    const { printerPresetsTbody } = dom;
    if (!printerPresetsTbody) return;
    try {
        const resp = await authFetch('/api/slicer/printer-presets');
        if (!resp.ok) throw new Error(t('common.loadError'));
        const data = await resp.json();
        const items = data.items || [];
        if (!items.length) {
            printerPresetsTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">' + t('slicer.noPresets') + '</td></tr>';
            return;
        }
        printerPresetsTbody.innerHTML = items.map(p => `
            <tr>
                <td class="px-2 py-2 font-mono">${p.id}</td>
                <td class="px-2 py-2">${p.name || '-'}</td>
                <td class="px-2 py-2 text-gray-500">${p.bed_width}×${p.bed_depth}×${p.bed_height}</td>
                <td class="px-2 py-2 text-gray-500">${p.nozzle} mm</td>
                <td class="px-2 py-2 text-center">
                    <button data-pp-delete="${p.id}" class="text-xs text-red-500 hover:text-red-700">${t('common.delete')}</button>
                </td>
            </tr>
        `).join('');
        printerPresetsTbody.querySelectorAll('[data-pp-delete]').forEach(btn => {
            btn.addEventListener('click', () => deletePrinterPreset(Number(btn.getAttribute('data-pp-delete'))));
        });
    } catch (e) { setMsg(e.message || t('common.loadError'), false); }
}

export async function deletePrinterPreset(presetId) {
    if (!authToken) return;
    try {
        const resp = await authFetch(`/api/slicer/printer-presets/${presetId}`, { method: 'DELETE' });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        if (!resp.ok) {
            let data = null;
            try { data = await resp.json(); } catch (e) {}
            throw new Error((data && data.detail) ? String(data.detail) : t('slicer.presetDeleteError'));
        }
        setMsg(t('slicer.deleted'), true);
        await fetchPrinterPresets();
    } catch (e) { setMsg(e.message || t('slicer.presetDeleteError'), false); }
}

// ── Save printer preset (custom user-defined printer) ──
export async function savePrinterPreset() {
    if (!authToken) { openLoginModal(); return; }
    const nameEl = document.getElementById('pp-name');
    const name = (nameEl?.value || '').trim();
    if (!name) return;
    // Gather nozzle sizes from checkboxes if available, else use defaults
    const nozzleCheckboxes = document.querySelectorAll('.custom-pp-nozzle:checked');
    let nozzles;
    if (nozzleCheckboxes.length) {
        nozzles = Array.from(nozzleCheckboxes).map(cb => parseFloat(cb.value)).filter(n => !isNaN(n));
    } else {
        nozzles = [0.2, 0.4, 0.6, 0.8];
    }
    if (!nozzles.length) nozzles = [0.4];
    const payload = {
        name,
        bed_width: Number(document.getElementById('pp-bed-x')?.value) || 256,
        bed_depth: Number(document.getElementById('pp-bed-y')?.value) || 256,
        bed_height: Number(document.getElementById('pp-bed-z')?.value) || 256,
        nozzle: nozzles.includes(0.4) ? 0.4 : nozzles[0],
        nozzles,
    };
    try {
        const resp = await authFetch('/api/printer/presets', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || t('common.loadError'));
        if (nameEl) nameEl.value = '';
        document.getElementById('printer-preset-form')?.classList.add('hidden');
        await fetchPrinterPresets();
        await fetchPrinterModels();
    } catch (e) { console.error(e); }
}

// ── Enabled printers management (table rows with select + delete) ──
export function renderPrinterVisibilityList() {
    const tbody = document.getElementById('enabled-printers-tbody');
    if (!tbody) return;
    if (!_printerModels.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="px-3 py-3 tw-text-muted">暂无机型数据</td></tr>';
        return;
    }
    const enabled = getEnabledPrinters();
    tbody.innerHTML = '';
    enabled.forEach((printerId, idx) => {
        const printer = _printerModels.find(p => p.id === printerId);
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        // 机型名称（下拉选择）
        const tdName = document.createElement('td');
        tdName.className = 'px-3 py-2';
        const sel = document.createElement('select');
        sel.className = 'w-full rounded-md text-xs px-2 py-1.5 bg-white';
        _printerModels.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            if (p.id === printerId) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
            const current = getEnabledPrinters();
            current[idx] = sel.value;
            setEnabledPrinters(current);
            renderPrinterVisibilityList();
            fetchPrinterModels();
        });
        tdName.appendChild(sel);
        // 打印尺寸
        const tdSize = document.createElement('td');
        tdSize.className = 'px-3 py-2 text-gray-500 font-mono';
        tdSize.textContent = printer ? `${printer.bed_width}×${printer.bed_depth}×${printer.bed_height}` : '-';
        // 删除按钮
        const tdDel = document.createElement('td');
        tdDel.className = 'px-3 py-2 text-center';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'text-xs tw-text-danger hover:tw-text-danger';
        delBtn.textContent = t('common.delete');
        delBtn.addEventListener('click', () => {
            const current = getEnabledPrinters();
            current.splice(idx, 1);
            setEnabledPrinters(current);
            renderPrinterVisibilityList();
            fetchPrinterModels();
        });
        tdDel.appendChild(delBtn);
        tr.appendChild(tdName);
        tr.appendChild(tdSize);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
    });
}

// ── Add enabled printer slot ──
export function addEnabledPrinterSlot() {
    const enabled = getEnabledPrinters();
    // Find first printer not already enabled
    const available = _printerModels.find(p => !enabled.includes(p.id));
    if (available) {
        enabled.push(available.id);
        setEnabledPrinters(enabled);
        renderPrinterVisibilityList();
        fetchPrinterModels();
    }
}

// ── Custom printer form management ──
export function showCustomPrinterForm() {
    const form = document.getElementById('custom-printer-form');
    if (form) form.classList.remove('hidden');
    const nameEl = document.getElementById('custom-pp-name');
    if (nameEl) { nameEl.value = ''; nameEl.focus(); }
}

export function hideCustomPrinterForm() {
    const form = document.getElementById('custom-printer-form');
    if (form) form.classList.add('hidden');
}

export async function saveCustomPrinter() {
    if (!authToken) { openLoginModal(); return; }
    const nameEl = document.getElementById('custom-pp-name');
    const name = (nameEl?.value || '').trim();
    if (!name) {
        _showCustomPpMsg('请输入打印机名称', false);
        return;
    }
    // Gather selected nozzle sizes
    const nozzleCheckboxes = document.querySelectorAll('.custom-pp-nozzle:checked');
    const nozzles = Array.from(nozzleCheckboxes).map(cb => parseFloat(cb.value)).filter(n => !isNaN(n));
    if (!nozzles.length) {
        _showCustomPpMsg('请至少选择一个喷嘴尺寸', false);
        return;
    }
    const payload = {
        name,
        bed_width: Number(document.getElementById('custom-pp-bed-x')?.value) || 256,
        bed_depth: Number(document.getElementById('custom-pp-bed-y')?.value) || 256,
        bed_height: Number(document.getElementById('custom-pp-bed-z')?.value) || 256,
        nozzle: nozzles.includes(0.4) ? 0.4 : nozzles[0],
        nozzles,
    };
    try {
        const resp = await authFetch('/api/printer/presets', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '保存失败');
        _showCustomPpMsg('保存成功', true);
        // Add to enabled printers list
        const presetId = `user_${data.preset?.id}`;
        const enabled = getEnabledPrinters();
        if (!enabled.includes(presetId)) {
            enabled.push(presetId);
            setEnabledPrinters(enabled);
        }
        // Refresh
        hideCustomPrinterForm();
        await fetchPrinterModels();
        renderPrinterVisibilityList();
    } catch (e) {
        _showCustomPpMsg(e.message || '保存失败', false);
    }
}

function _showCustomPpMsg(text, ok) {
    const msg = document.getElementById('custom-pp-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? 'text-xs text-green-600' : 'text-xs text-red-600';
    msg.classList.remove('hidden');
    if (text) setTimeout(() => { msg.classList.add('hidden'); msg.textContent = ''; }, 2500);
}

export function restoreDefaultPrinters() {
    if (!confirm(t('printer.confirmRestore') || '确定恢复默认机型？自定义启用机型将丢失。')) return;
    localStorage.removeItem(ENABLED_PRINTERS_KEY);
    renderPrinterVisibilityList();
    fetchPrinterModels();
}

// ── Update printer detail panel ──
export function updatePrinterDetailPanel(printer) {
    const panel = document.getElementById('printer-detail-panel');
    if (!panel) return;
    if (!printer) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    const pdNozzle = document.getElementById('pd-nozzle');
    const pdBedSize = document.getElementById('pd-bed-size');
    const pdVolume = document.getElementById('pd-volume');
    const pdNozzles = document.getElementById('pd-nozzles');
    if (pdNozzle) pdNozzle.textContent = (printer.nozzle || 0.4) + ' mm';
    if (pdBedSize) pdBedSize.textContent = printer.bed_width + '×' + printer.bed_depth + '×' + printer.bed_height + ' mm';
    const volL = ((printer.bed_width * printer.bed_depth * printer.bed_height) / 1000000).toFixed(1);
    if (pdVolume) pdVolume.textContent = volL + ' L';
    if (pdNozzles) pdNozzles.textContent = (printer.nozzles || []).map(n => n + ' mm').join(', ');
}

// ── Export / Import printer configuration ──
function _setPrinterConfigMsg(text, ok) {
    const msg = document.getElementById('printer-config-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok ? 'text-xs text-green-600 mt-1' : 'text-xs text-red-600 mt-1';
    msg.classList.remove('hidden');
    if (text) setTimeout(() => msg.classList.add('hidden'), 3000);
}

export async function exportPrinterConfig() {
    if (!authToken) { openLoginModal(); return; }
    try {
        const resp = await authFetch('/api/user/settings/export');
        if (resp.status === 401) { openLoginModal(); return; }
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.detail || '导出失败');
        }
        const data = await resp.json();
        // Extract printer-related config
        const printerConfig = {
            version: 1,
            exported_at: new Date().toISOString(),
            default_printer_id: data.default_printer_id,
            default_nozzle: data.default_nozzle,
            default_slicer_preset_id: data.default_slicer_preset_id,
            pricing_config: data.pricing_config,
            materials: data.materials,
        };
        const blob = new Blob([JSON.stringify(printerConfig, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pricer3d_printer_config_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _setPrinterConfigMsg('配置已导出', true);
    } catch (e) {
        _setPrinterConfigMsg(e.message || '导出失败', false);
    }
}

export async function importPrinterConfig(file) {
    if (!authToken) { openLoginModal(); return; }
    if (!file) { _setPrinterConfigMsg('请选择配置文件', false); return; }
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version) { _setPrinterConfigMsg('无效的配置文件', false); return; }
        const resp = await authFetch('/api/user/settings/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (resp.status === 401) { openLoginModal(); return; }
        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            throw new Error(errData.detail || '导入失败');
        }
        _setPrinterConfigMsg('配置已导入，正在刷新...', true);
        // Reload settings and printer models
        setTimeout(async () => {
            const { fetchUserSettings } = await import('../settings.js');
            await fetchUserSettings();
            await fetchPrinterModels();
            await fetchPrinterPresets();
        }, 500);
    } catch (e) {
        _setPrinterConfigMsg(e.message || '导入失败', false);
    }
}
