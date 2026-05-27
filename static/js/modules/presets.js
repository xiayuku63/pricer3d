// ── Slicer preset management ──
import {
    authToken, currentUser,
    quoteOptions, slicerPresets, setSlicerPresets,
    authFetch, saveSlicerPresetSelection, loadSlicerPresetSelection,
    selectedFilesMap,
} from './state.js';
import { openLoginModal } from './auth.js';
import { reQuoteAllSelectedFiles } from './quote.js';

let dom = {};
let _printerModels = [];  // cached printer list from API

export function initPresets(d) { dom = d; }

function setMsg(text, ok) {
    const { slicerPresetsMsg } = dom;
    if (!slicerPresetsMsg) return;
    slicerPresetsMsg.textContent = text || "";
    slicerPresetsMsg.className = ok ? "text-xs text-green-600" : "text-xs text-red-600";
    slicerPresetsMsg.classList.remove('hidden');
    if (text) setTimeout(() => { slicerPresetsMsg.classList.add('hidden'); slicerPresetsMsg.textContent = ""; }, 2500);
}

export function renderSlicerPresetsUI() {
    const { cfgSlicerPresetId, slicerPresetsTbody, authToken: tok } = dom;
    if (cfgSlicerPresetId) {
        const selected = quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined ? String(quoteOptions.slicer_preset_id) : "";
        cfgSlicerPresetId.innerHTML = [
            '<option value="">不使用预设</option>',
            ...(slicerPresets || []).map((p) => `<option value="${p.id}" ${String(p.id) === selected ? "selected" : ""}>${p.name} (#${p.id})</option>`)
        ].join('');
    }
    if (!slicerPresetsTbody) return;
    const items = slicerPresets || [];
    if (!items.length) {
        slicerPresetsTbody.innerHTML = '<tr><td colspan="5" class="px-2 py-3 text-gray-500">暂无预设</td></tr>';
        return;
    }
    const at = authToken;
    slicerPresetsTbody.innerHTML = items.map((p) => `
        <tr>
            <td class="px-2 py-2 font-mono">${p.id}</td>
            <td class="px-2 py-2">${p.name || '-'}</td>
            <td class="px-2 py-2">${p.ext || '-'}</td>
            <td class="px-2 py-2">${p.created_at || '-'}</td>
            <td class="px-2 py-2 text-right space-x-1">
                <a href="/api/slicer/presets/${p.id}/download?token=${at}" class="text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded px-2 py-0.5 inline-block text-xs" download>下载</a>
                ${p.is_default
                    ? `<button type="button" class="text-gray-400 border border-gray-200 rounded px-2 py-0.5 cursor-not-allowed text-xs" disabled>删除</button>`
                    : `<button type="button" data-slicer-delete="${p.id}" class="text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded px-2 py-0.5 text-xs">删除</button>`
                }
            </td>
        </tr>
    `).join('');
    slicerPresetsTbody.querySelectorAll('[data-slicer-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = Number.parseInt(btn.getAttribute('data-slicer-delete') || "", 10);
            if (!Number.isFinite(id)) return;
            await deleteSlicerPreset(id);
        });
    });
}

export function preloadPrinterSelectors() {
    for (const selId of ["cfg-printer-model-main", "gen-printer-model"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        sel.innerHTML = "";
    }
}

export async function fetchPrinterModels() {
    const resp = await authFetch("/api/slicer/printers");
    if (!resp.ok) return;
    const data = await resp.json();
    _printerModels = data.items || [];

    // Populate "打印机机型" tab selector (with bed dimensions)
    for (const selId of ["cfg-printer-model-main"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        let hasSelection = false;
        sel.innerHTML = "<option value=\"\">请选择打印机...</option>";
        _printerModels.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name + " (\u2009"+p.bed_width+"x"+p.bed_depth+"x"+p.bed_height+" mm)";
            if (sel.value) hasSelection = true;
            sel.appendChild(opt);
        });
        if (!hasSelection && _printerModels.length > 0) sel.value = _printerModels[0].id;
    }

    // Populate preset form printer selector (name only, nozzle is in the name)
    const genSel = document.getElementById("gen-printer-model");
    if (genSel) {
        genSel.innerHTML = "<option value=\"\">请选择打印机...</option>";
        _printerModels.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            genSel.appendChild(opt);
        });
        if (_printerModels.length > 0) genSel.value = _printerModels[0].id;
    }

    // Auto-fill nozzle when printer changes in preset form
    if (genSel && dom.genNozzleSize) {
        genSel.onchange = () => {
            const printer = _printerModels.find(p => p.id === genSel.value);
            if (printer) {
                dom.genNozzleSize.value = String(printer.nozzle);
            }
        };
        // Trigger initial nozzle fill
        const printer = _printerModels.find(p => p.id === genSel.value);
        if (printer) {
            dom.genNozzleSize.value = String(printer.nozzle);
        }
    }
}

export async function fetchSlicerPresets() {
    if (!authToken) return;
    if (dom.userCenterModal && dom.userCenterModal.classList.contains('hidden')) return; // skip if not visible
    try {
        const resp = await authFetch('/api/slicer/presets');
        if (resp.status === 401) {
            if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden');
            openLoginModal();
            return;
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : '加载失败');
        setSlicerPresets(Array.isArray(data.items) ? data.items : []);
        if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined) {
            const exists = slicerPresets.some((p) => Number(p.id) === Number(quoteOptions.slicer_preset_id));
            if (!exists) { quoteOptions.slicer_preset_id = null; saveSlicerPresetSelection(); }
        }
        renderSlicerPresetsUI();
    } catch (e) { setMsg(e.message || '加载失败', false); }
}

export async function uploadSlicerPreset() {
    const { slicerPresetFileInput, genPresetName } = dom;
    if (!authToken) { openLoginModal(); return; }
    const file = slicerPresetFileInput && slicerPresetFileInput.files && slicerPresetFileInput.files[0] ? slicerPresetFileInput.files[0] : null;
    if (!file) { setMsg('请选择 .ini 文件', false); return; }
    const name = genPresetName ? String(genPresetName.value || "").trim() : "";
    const formData = new FormData();
    formData.append("file", file);
    if (name) formData.append("name", name);
    try {
        const resp = await authFetch('/api/slicer/presets', { method: 'POST', body: formData });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : '上传失败');
        setMsg('上传成功', true);
        if (genPresetName) genPresetName.value = "";
        if (slicerPresetFileInput) slicerPresetFileInput.value = "";
        const preset = data && data.preset ? data.preset : null;
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (preset && preset.id) {
            quoteOptions.slicer_preset_id = Number(preset.id);
            saveSlicerPresetSelection();
            renderSlicerPresetsUI();
            if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles('切片预设已更新，重算报价');
        }
    } catch (e) { setMsg(e.message || '上传失败', false); }
}

export async function generateSlicerPreset() {
    const { genPresetName, genPrinterModel, genNozzleSize, genInfill, genWallCount } = dom;
    if (!authToken) { openLoginModal(); return; }
    const name = genPresetName ? String(genPresetName.value || "").trim() : "";
    if (!name) { setMsg('请输入预设名称', false); return; }
    const existingNames = Array.from(document.querySelectorAll("#slicer-presets-tbody tr td:nth-child(2)")).map(td => td.textContent.trim());
    if (existingNames.includes(name)) { setMsg('名称「' + name + '」已存在，请修改后保存', false); return; }

    // Get printer from the preset form's own selector
    const printerId = genPrinterModel?.value;
    if (!printerId) { setMsg('请先选择打印机型号', false); return; }
    const printer = _printerModels.find(p => p.id === printerId);
    if (!printer) { setMsg('未找到打印机数据，请刷新后重试', false); return; }

    const bed_width = printer.bed_width;
    const bed_depth = printer.bed_depth;
    const bed_height = printer.bed_height;
    const nozzle_size = Number(genNozzleSize?.value) || printer.nozzle || 0.4;
    const infill = Number(genInfill?.value) || 15;
    const wall_count = Number(genWallCount?.value) || 3;
    const payload = { name, bed_width, bed_depth, bed_height, nozzle_size, infill, wall_count };
    try {
        const resp = await authFetch('/api/slicer/presets/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        const data = await resp.json();
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : '生成失败');
        setMsg('生成成功', true);
        if (genPresetName) genPresetName.value = "";
        const preset = data && data.preset ? data.preset : null;
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (preset && preset.id) {
            quoteOptions.slicer_preset_id = Number(preset.id);
            saveSlicerPresetSelection();
            renderSlicerPresetsUI();
            if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles('切片预设已生成，重算报价');
        }
    } catch (e) { setMsg(e.message || '生成失败', false); }
}

export async function deleteSlicerPreset(presetId) {
    if (!authToken) return;
    try {
        const resp = await authFetch(`/api/slicer/presets/${presetId}`, { method: 'DELETE' });
        if (resp.status === 401) { if (dom.userCenterModal) dom.userCenterModal.classList.add('hidden'); openLoginModal(); return; }
        let data = null;
        try { data = await resp.json(); } catch (e) {}
        if (!resp.ok) throw new Error((data && data.detail) ? String(data.detail) : '删除失败');
        if (quoteOptions.slicer_preset_id !== null && quoteOptions.slicer_preset_id !== undefined && Number(quoteOptions.slicer_preset_id) === Number(presetId)) {
            quoteOptions.slicer_preset_id = null; saveSlicerPresetSelection();
        }
        setMsg('已删除', true);
        await fetchSlicerPresets();
        fetchPrinterModels();
        if (selectedFilesMap.size > 0) await reQuoteAllSelectedFiles('切片预设已删除，重算报价');
    } catch (e) { setMsg(e.message || '删除失败', false); }
}
