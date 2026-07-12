// ── Brand settings (logo upload) ──
import {
    authToken, currentUser,
    authFetch,
} from '../state.js';
import { t } from '../i18n.js';

// ── Logo upload handler ──
export function initBrandLogoUpload() {
    const uploadBtn = document.getElementById('brand-logo-upload-btn');
    const fileInput = document.getElementById('brand-logo-input');
    const preview = document.getElementById('brand-logo-preview');
    if (!uploadBtn || !fileInput) return;
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            alert(t('settings.logoTooLarge') || 'Logo 文件不能超过 2MB');
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        try {
            const resp = await authFetch('/api/user/brand-logo', { method: 'POST', body: fd });
            if (resp.ok) {
                const data = await resp.json();
                if (preview && data.url) {
                    preview.innerHTML = `<img src="${data.url}" class="w-full h-full object-contain rounded-md" />`;
                    const delBtn = document.getElementById('brand-logo-delete-btn');
                    if (delBtn) delBtn.classList.remove('hidden');
                }
            }
        } catch (e) { console.error("Logo upload failed", e); }
        fileInput.value = '';
    });

    // ── Delete logo handler ──
    const deleteBtn = document.getElementById('brand-logo-delete-btn');
    if (deleteBtn && preview) {
        deleteBtn.addEventListener('click', async () => {
            const confirmed = confirm(t('settings.confirmDeleteLogo') || '确定要删除Logo吗？');
            if (!confirmed) return;
            try {
                const resp = await authFetch('/api/user/brand-logo', { method: 'DELETE' });
                if (resp.ok) {
                    preview.innerHTML = '无';
                    deleteBtn.classList.add('hidden');
                }
            } catch (e) { console.error("Logo delete failed", e); }
        });
    }
}
