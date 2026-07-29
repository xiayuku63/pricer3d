// ── Model progress UI ──
// Shared progress reporting for thumbnail generation and the interactive 3D preview.

let uploadProgressRefs = null;
const previewHideTimers = new WeakMap();

function getUploadProgressRefs() {
    if (uploadProgressRefs?.container?.isConnected) return uploadProgressRefs;
    uploadProgressRefs = {
        container: document.getElementById('upload-progress-container'),
        bar: document.getElementById('upload-progress-bar'),
        label: document.getElementById('upload-progress-label'),
        percent: document.getElementById('upload-progress-percent'),
        detail: document.getElementById('upload-progress-detail'),
    };
    return uploadProgressRefs;
}

function clampPercent(percent) {
    return Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
}

let modelProgressItems = new Map();

function clearModelProgressItems() {
    const refs = getUploadProgressRefs();
    modelProgressItems = new Map();
    refs.container?.querySelector('[data-model-progress-list]')?.remove();
}

function ensureModelProgressList() {
    const refs = getUploadProgressRefs();
    if (!refs.container || !refs.detail) return null;
    let list = refs.container.querySelector('[data-model-progress-list]');
    if (list) return list;
    list = document.createElement('div');
    list.dataset.modelProgressList = '';
    list.className = 'mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1.5';
    list.style.borderColor = 'var(--color-border, #e5e7eb)';
    refs.detail.insertAdjacentElement('afterend', list);
    return list;
}

function modelItemText(state, percent, detail) {
    const labels = {
        pending: '待处理',
        processing: '处理中',
        complete: '已完成',
        error: '失败',
    };
    const label = labels[state] || labels.pending;
    if (state === 'processing') return `${label} ${clampPercent(percent)}%${detail ? ` - ${detail}` : ''}`;
    return `${label}${detail ? ` - ${detail}` : ''}`;
}

/** Start an ordered, per-file status list for one batch of model work. */
export function startModelProgressItems(items) {
    clearModelProgressItems();
    const list = ensureModelProgressList();
    if (!list) return;

    Array.from(items || []).forEach((item, index) => {
        const id = String(item?.id ?? index);
        const filename = String(item?.filename || item?.name || item || 'model');
        const row = document.createElement('div');
        row.dataset.modelProgressItem = id;
        row.className = 'rounded px-2 py-1.5';
        row.style.backgroundColor = 'var(--color-surface-subtle, #f8fafc)';

        const header = document.createElement('div');
        header.className = 'flex min-w-0 items-center gap-2';
        const order = document.createElement('span');
        order.className = 'flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-semibold';
        order.dataset.modelProgressOrder = '';
        order.textContent = String(index + 1);
        order.style.backgroundColor = 'var(--color-border, #e5e7eb)';
        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate tw-text-secondary';
        name.textContent = filename;
        const status = document.createElement('span');
        status.className = 'flex-none text-[10px] tw-text-muted';
        status.dataset.modelProgressStatus = '';
        status.textContent = modelItemText('pending', 0);
        header.append(order, name, status);

        const track = document.createElement('div');
        track.className = 'mt-1 h-1 overflow-hidden rounded-full';
        track.style.backgroundColor = 'var(--color-border, #e5e7eb)';
        const bar = document.createElement('div');
        bar.dataset.modelProgressItemBar = '';
        bar.className = 'h-full rounded-full transition-all duration-200 ease-out';
        bar.style.width = '0%';
        bar.style.backgroundColor = 'var(--color-primary, #4f46e5)';
        track.append(bar);
        row.append(header, track);
        list.append(row);
        modelProgressItems.set(id, { row, state: 'pending' });
    });
}

/** Update one model row without hiding the status of completed earlier files. */
export function updateModelProgressItem(id, { state = 'processing', percent = 0, detail = '' } = {}) {
    const item = modelProgressItems.get(String(id));
    if (!item) return;
    const value = state === 'complete' ? 100 : clampPercent(percent);
    const status = item.row.querySelector('[data-model-progress-status]');
    const bar = item.row.querySelector('[data-model-progress-item-bar]');
    const order = item.row.querySelector('[data-model-progress-order]');
    status.textContent = modelItemText(state, value, detail);
    bar.style.width = `${value}%`;
    if (state === 'complete') {
        bar.style.backgroundColor = 'var(--color-success, #22c55e)';
        order.textContent = '✓';
        order.style.backgroundColor = 'var(--color-success, #22c55e)';
        order.style.color = '#fff';
    } else if (state === 'error') {
        bar.style.backgroundColor = 'var(--color-danger, #ef4444)';
        order.textContent = '✗';
        order.style.backgroundColor = 'var(--color-danger, #ef4444)';
        order.style.color = '#fff';
    } else if (state === 'processing') {
        bar.style.backgroundColor = 'var(--color-primary, #4f46e5)';
        order.style.backgroundColor = 'var(--color-primary, #4f46e5)';
        order.style.color = '#fff';
    }
    item.state = state;
}

/** Show the shared upload-area progress bar for local model processing. */
export function showModelProgress(label, detail = '') {
    const refs = getUploadProgressRefs();
    if (!refs.container || !refs.bar || !refs.label || !refs.percent || !refs.detail) return;
    refs.container.classList.remove('hidden');
    refs.bar.className = 'bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out';
    refs.bar.style.width = '0%';
    refs.label.textContent = label || '正在处理模型...';
    refs.percent.className = 'text-xs font-medium text-indigo-600';
    refs.percent.textContent = '0%';
    refs.detail.textContent = detail;
    clearModelProgressItems();
}

/** Update the shared upload-area progress bar for local model processing. */
export function updateModelProgress(percent, detail = '') {
    const refs = getUploadProgressRefs();
    if (!refs.container || !refs.bar || !refs.percent || !refs.detail) return;
    const value = clampPercent(percent);
    refs.container.classList.remove('hidden');
    refs.bar.style.width = `${value}%`;
    refs.percent.textContent = `${value}%`;
    if (detail) refs.detail.textContent = detail;
}

export function completeModelProgress(label = '模型处理完成') {
    const refs = getUploadProgressRefs();
    if (!refs.container || !refs.bar || !refs.label || !refs.percent) return;
    refs.container.classList.remove('hidden');
    refs.bar.className = 'bg-green-500 h-2 rounded-full transition-all duration-300 ease-out';
    refs.bar.style.width = '100%';
    refs.label.textContent = label;
    refs.percent.className = 'text-xs font-medium text-green-600';
    refs.percent.textContent = '✓';
}

function ensurePreviewProgressContent(placeholder) {
    let panel = placeholder.querySelector('[data-model-progress-panel]');
    if (panel) return panel;

    placeholder.replaceChildren();
    panel = document.createElement('div');
    panel.dataset.modelProgressPanel = '';
    panel.className = 'w-64 max-w-[80%] rounded-lg border px-4 py-3 shadow-sm';
    panel.style.backgroundColor = 'var(--color-surface, #fff)';
    panel.style.borderColor = 'var(--color-border, #e5e7eb)';

    const heading = document.createElement('div');
    heading.className = 'flex items-center justify-between gap-3 text-xs font-medium';
    const label = document.createElement('span');
    label.dataset.modelProgressLabel = '';
    const percent = document.createElement('span');
    percent.dataset.modelProgressPercent = '';
    percent.className = 'font-semibold';
    heading.append(label, percent);

    const track = document.createElement('div');
    track.className = 'mt-2 h-1.5 overflow-hidden rounded-full';
    track.style.backgroundColor = 'var(--color-border, #e5e7eb)';
    const bar = document.createElement('div');
    bar.dataset.modelProgressBar = '';
    bar.className = 'h-full rounded-full transition-all duration-200 ease-out';
    bar.style.backgroundColor = 'var(--color-primary, #4f46e5)';
    track.append(bar);

    const detail = document.createElement('div');
    detail.dataset.modelProgressDetail = '';
    detail.className = 'mt-1.5 truncate text-[11px] tw-text-muted';

    panel.append(heading, track, detail);
    placeholder.append(panel);
    return panel;
}

/** Render a determinate model-loading progress card over the 3D viewer. */
export function setModelLoadingProgress(placeholder, { label, percent, detail = '' }) {
    if (!placeholder) return;
    const timer = previewHideTimers.get(placeholder);
    if (timer) clearTimeout(timer);
    previewHideTimers.delete(placeholder);

    const panel = ensurePreviewProgressContent(placeholder);
    const value = clampPercent(percent);
    panel.querySelector('[data-model-progress-label]').textContent = label || '正在加载模型';
    panel.querySelector('[data-model-progress-percent]').textContent = `${value}%`;
    panel.querySelector('[data-model-progress-bar]').style.width = `${value}%`;
    panel.querySelector('[data-model-progress-detail]').textContent = detail;
    placeholder.setAttribute('aria-live', 'polite');
    placeholder.classList.remove('hidden');
}

/** Briefly show completion, then restore the unobstructed 3D viewer. */
export function finishModelLoadingProgress(placeholder, { label = '模型加载完成', detail = '' } = {}) {
    if (!placeholder) return;
    setModelLoadingProgress(placeholder, { label, percent: 100, detail });
    const timer = setTimeout(() => {
        placeholder.classList.add('hidden');
        previewHideTimers.delete(placeholder);
    }, 180);
    previewHideTimers.set(placeholder, timer);
}
