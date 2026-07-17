// ── Upload experience: progress bar, drag & drop, file preview chips, toast notifications ──
import {
    authToken, selectedFilesMap, thumbnailMap, quoteOptions,
    escapeHtml,
} from './state.js';
import { buildPlaceholderThumbnail, ensureThumbnailForFile, buildThumbnails } from './preview.js';
import { t } from './i18n.js';

// ── Constants ──
const ALLOWED_EXTENSIONS = ['.stl', '.stp', '.step', '.obj', '.3mf', '.zip'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_ZIP_SIZE = 1024 * 1024 * 1024; // 1GB
const EXT_ICONS = {
    stl: 'STL', stp: 'STP', step: 'STEP', obj: 'OBJ', '3mf': '3MF', zip: 'ZIP',
};

// ── DOM refs (lazy-init) ──
let _progressContainer = null;
let _progressBar = null;
let _progressLabel = null;
let _progressPercent = null;
let _progressDetail = null;
let _previewChips = null;
let _dropZone = null;
let _dropIcon = null;
let _toastContainer = null;
let _progressAnchor = null;

function _initRefs() {
    if (_progressContainer) return;
    _progressContainer = document.getElementById('upload-progress-container');
    _progressBar = document.getElementById('upload-progress-bar');
    _progressLabel = document.getElementById('upload-progress-label');
    _progressPercent = document.getElementById('upload-progress-percent');
    _progressDetail = document.getElementById('upload-progress-detail');
    _previewChips = document.getElementById('file-preview-chips');
    _dropZone = document.getElementById('drop-zone');
    _dropIcon = document.getElementById('drop-icon');
    _toastContainer = document.getElementById('toast-container');
    _progressAnchor = document.getElementById('upload-progress-inline-anchor');

    // Place the live progress bar directly below the selected-file status.
    if (_progressContainer && _progressAnchor && _progressAnchor.parentElement) {
        _progressAnchor.parentElement.insertBefore(_progressContainer, _progressAnchor.nextSibling);
    } else if (_progressContainer && _dropZone && _dropZone.contains(_progressContainer)) {
        _dropZone.parentElement.insertBefore(_progressContainer, _dropZone.nextSibling);
    }
}

// ═══════════════════════════════════════════════
//  Progress Bar
// ═══════════════════════════════════════════════
export function showProgress(label) {
    _initRefs();
    if (!_progressContainer) return;
    _progressContainer.classList.remove('hidden');
    _progressBar.style.width = '0%';
    _progressPercent.textContent = '0%';
    _progressLabel.textContent = label || '上传中...';
    _progressDetail.textContent = '';
    // Animate bar background
    _progressBar.classList.remove('bg-red-500');
    _progressBar.classList.add('bg-indigo-600');
}

export function updateProgress(percent, detail) {
    _initRefs();
    if (!_progressBar) return;
    const p = Math.min(100, Math.max(0, Math.round(percent)));
    _progressBar.style.width = p + '%';
    _progressPercent.textContent = p + '%';
    if (detail) _progressDetail.textContent = detail;
}

export function showProgressSuccess(label) {
    _initRefs();
    if (!_progressContainer) return;
    _progressBar.style.width = '100%';
    _progressBar.classList.remove('bg-indigo-600', 'bg-red-500');
    _progressBar.classList.add('bg-green-500');
    _progressPercent.textContent = '✓';
    _progressPercent.className = 'text-xs font-medium text-green-600';
    _progressLabel.textContent = label || '上传完成';
}

export function showProgressError(label) {
    _initRefs();
    if (!_progressContainer) return;
    _progressBar.classList.remove('bg-indigo-600');
    _progressBar.classList.add('bg-red-500');
    _progressPercent.textContent = '✗';
    _progressPercent.className = 'text-xs font-medium text-red-600';
    _progressLabel.textContent = label || '上传失败';
}

export function hideProgress() {
    _initRefs();
    if (!_progressContainer) return;
    setTimeout(() => {
        _progressContainer.classList.add('hidden');
        // Reset state
        _progressBar.style.width = '0%';
        _progressBar.className = 'bg-indigo-600 h-2 rounded-full transition-all duration-300 ease-out';
        _progressPercent.className = 'text-xs font-medium text-indigo-600';
        _progressPercent.textContent = '0%';
        _progressLabel.textContent = '';
        _progressDetail.textContent = '';
    }, 1500);
}

// ═══════════════════════════════════════════════
//  File Validation
// ═══════════════════════════════════════════════
export function validateFiles(files, existingMap, maxFiles) {
    const errors = [];
    const combined = new Map(existingMap || selectedFilesMap);
    const newFiles = Array.from(files);

    // Check file count
    if (maxFiles !== Infinity && combined.size + newFiles.length > maxFiles) {
        errors.push({
            type: 'count',
            message: `文件数量超限：当前已有 ${combined.size} 个文件，新增 ${newFiles.length} 个，最多支持 ${maxFiles} 个`,
        });
    }

    // Check each file
    const validFiles = [];
    const invalidFiles = [];
    for (const file of newFiles) {
        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            invalidFiles.push({ file, reason: `不支持的格式 "${ext}"，仅支持 ${ALLOWED_EXTENSIONS.join(', ')}` });
            continue;
        }
        const isZip = ext === '.zip';
        const sizeLimit = isZip ? MAX_ZIP_SIZE : MAX_FILE_SIZE;
        if (file.size >= sizeLimit) {
            invalidFiles.push({ file, reason: `文件过大（${formatFileSize(file.size)}），${isZip ? 'ZIP 文件' : '单文件'}需小于 ${formatFileSize(sizeLimit)}` });
            continue;
        }
        if (file.size === 0) {
            invalidFiles.push({ file, reason: '文件为空' });
            continue;
        }
        if (existingMap && existingMap.has(file.name)) {
            invalidFiles.push({ file, reason: '文件名已存在，将被替换' });
            // Still valid, just warn
            validFiles.push(file);
            continue;
        }
        validFiles.push(file);
    }

    if (invalidFiles.length > 0) {
        errors.push({
            type: 'files',
            invalidFiles,
        });
    }

    return { validFiles, invalidFiles, errors };
}

export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// ═══════════════════════════════════════════════
//  File Preview Chips
// ═══════════════════════════════════════════════
export function renderFilePreviewChips(files) {
    _initRefs();
    if (!_previewChips) return;

    _previewChips.classList.remove('hidden');
    _previewChips.innerHTML = '';

    const allFiles = Array.from(selectedFilesMap.values());
    const newFileNames = new Set(Array.from(files).map(f => f.name));

    allFiles.forEach(file => {
        const isNew = newFileNames.has(file.name);
        const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '-';
        const icon = EXT_ICONS[ext] || ext.toUpperCase() || 'FILE';
        const thumbnail = thumbnailMap.get(file.name);

        const chip = document.createElement('div');
        chip.className = `relative group flex items-center gap-2 px-3 py-2 rounded-lg border ${isNew ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'} shadow-sm transition-all duration-200 hover:shadow-md`;

        const previewHtml = thumbnail && thumbnail.startsWith('data:image/png')
            ? `<img src="${thumbnail}" class="w-10 h-10 rounded object-cover bg-white border border-gray-200" alt="" />`
            : `<span class="w-10 h-10 flex items-center justify-center rounded bg-gray-100 text-[10px] font-semibold text-gray-500">${icon}</span>`;

        chip.innerHTML = `
            ${previewHtml}
            <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-gray-900 truncate" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</p>
                <p class="text-[10px] text-gray-400">${formatFileSize(file.size)}${isNew ? ' · <span class="text-indigo-500">新增</span>' : ''}</p>
            </div>
            <button type="button" class="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 text-sm" data-remove-file="${escapeHtml(file.name)}" title="移除">✕</button>
        `;

        _previewChips.appendChild(chip);
    });

    if (allFiles.length === 0) {
        _previewChips.classList.add('hidden');
    }
}

export function removeFileChip(filename) {
    selectedFilesMap.delete(filename);
    thumbnailMap.delete(filename);
    // Re-render
    renderFilePreviewChips([]);
}

// ═══════════════════════════════════════════════
//  Drag & Drop Enhancement
// ═══════════════════════════════════════════════
export function setupEnhancedDragDrop(fileInput, onFilesDropped) {
    _initRefs();
    if (!_dropZone) return;

    let dragCounter = 0;

    _dropZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        _dropZone.classList.add('border-indigo-400', 'bg-indigo-50', 'scale-[1.01]');
        _dropZone.classList.remove('border-gray-300', 'bg-gray-50');
        if (_dropIcon) _dropIcon.classList.add('scale-110');
    });

    _dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    _dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            _dropZone.classList.remove('border-indigo-400', 'bg-indigo-50', 'scale-[1.01]');
            _dropZone.classList.add('border-gray-300', 'bg-gray-50');
            if (_dropIcon) _dropIcon.classList.remove('scale-110');
        }
    });

    _dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        _dropZone.classList.remove('border-indigo-400', 'bg-indigo-50', 'scale-[1.01]');
        _dropZone.classList.add('border-gray-300', 'bg-gray-50');
        if (_dropIcon) _dropIcon.classList.remove('scale-110');

        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
            onFilesDropped(droppedFiles);
        }
    });

    // Also allow clicking the drop zone to open file picker
    _dropZone.addEventListener('click', (e) => {
        if (e.target.closest('label') || e.target.closest('input') || e.target.closest('a')) return;
        fileInput.click();
    });
}

// ═══════════════════════════════════════════════
//  Toast Notifications
// ═══════════════════════════════════════════════
export function showToast(message, type = 'info', duration = 4000) {
    _initRefs();
    if (!_toastContainer) return;

    const toast = document.createElement('div');
    const colorMap = {
        success: 'bg-green-50 border-green-400 text-green-800',
        error: 'bg-red-50 border-red-400 text-red-800',
        warning: 'bg-amber-50 border-amber-400 text-amber-800',
        info: 'bg-blue-50 border-blue-400 text-blue-800',
    };
    const iconMap = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ',
    };
    const colorClass = colorMap[type] || colorMap.info;
    const icon = iconMap[type] || iconMap.info;

    toast.className = `pointer-events-auto flex items-start gap-2 px-4 py-3 rounded-lg border shadow-lg ${colorClass} transform translate-x-full opacity-0 transition-all duration-300 ease-out max-w-sm`;
    toast.innerHTML = `
        <span class="text-sm font-bold flex-shrink-0">${icon}</span>
        <p class="text-sm flex-1">${escapeHtml(message)}</p>
        <button type="button" class="text-current opacity-50 hover:opacity-100 flex-shrink-0 text-sm" onclick="this.parentElement.remove()">✕</button>
    `;

    _toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    });

    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('translate-x-0', 'opacity-100');
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ═══════════════════════════════════════════════
//  Progress-Aware Upload (using XMLHttpRequest)
// ═══════════════════════════════════════════════
export function uploadWithProgress(url, formData, token) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);

        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                updateProgress(percent, `${formatFileSize(e.loaded)} / ${formatFileSize(e.total)}`);
            }
        });

        xhr.addEventListener('load', () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({ ok: true, status: xhr.status, data });
                } else {
                    resolve({ ok: false, status: xhr.status, data, error: data.detail || data.error || '请求失败' });
                }
            } catch (e) {
                reject(new Error('响应解析失败'));
            }
        });

        xhr.addEventListener('error', () => {
            reject(new Error('网络错误，请检查网络连接'));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('上传已取消'));
        });

        xhr.addEventListener('timeout', () => {
            reject(new Error('上传超时，请重试'));
        });

        xhr.timeout = 300000; // 5 min timeout
        xhr.send(formData);
    });
}

// ═══════════════════════════════════════════════
//  File Size Summary
// ═══════════════════════════════════════════════
export function getFilesSizeSummary(files) {
    const totalSize = Array.from(files).reduce((sum, f) => sum + f.size, 0);
    return `${files.length} 个文件，共 ${formatFileSize(totalSize)}`;
}
