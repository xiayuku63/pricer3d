// ── Preview conversion request cache ──
// Keep one conversion request per uploaded-file identity so thumbnails and the
// interactive viewer can reuse backend work instead of converting twice.

const glbRequests = new Map();
const stlRequests = new Map();
const threeMfRequests = new Map();

export function previewFileKey(file) {
    return [file?.name || '', file?.size || 0, file?.lastModified || 0].join(':');
}

async function readPreviewResponse(resp, onProgress) {
    const contentLength = Number(resp.headers?.get?.('content-length')) || 0;
    if (!resp.body?.getReader) {
        const blob = await resp.blob();
        onProgress?.(100, '预览数据已就绪');
        return blob;
    }

    const reader = resp.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        loaded += value.byteLength;
        const downloadPercent = contentLength > 0 ? (loaded / contentLength) * 25 : 20;
        onProgress?.(75 + downloadPercent, '正在下载预览数据');
    }
    onProgress?.(100, '预览数据已就绪');
    return new Blob(chunks, { type: resp.headers.get('content-type') || 'application/octet-stream' });
}

function requestPreview(url, file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);
    onProgress?.(5, '正在提交模型');
    return fetch(url, { method: 'POST', body: formData })
        .then((resp) => {
            if (!resp.ok) throw new Error('模型预处理失败');
            // Headers arrive after server-side normalization/conversion. Keep this
            // stage explicit so long STEP/OBJ/3MF conversions never look stalled.
            onProgress?.(75, '正在读取预处理结果');
            return readPreviewResponse(resp, onProgress);
        });
}

export function getPreviewGlb(file, onProgress = null) {
    const key = previewFileKey(file);
    const existing = glbRequests.get(key);
    if (existing) return existing;

    const request = requestPreview('/api/preview/glb', file, onProgress)
        .catch((error) => {
            glbRequests.delete(key);
            throw error;
        });
    glbRequests.set(key, request);
    return request;
}

export function getPreviewStl(file, onProgress = null) {
    const key = previewFileKey(file);
    const existing = stlRequests.get(key);
    if (existing) return existing;

    const request = requestPreview('/api/preview/stl', file, onProgress)
        .catch((error) => {
            stlRequests.delete(key);
            throw error;
        });
    stlRequests.set(key, request);
    return request;
}

export function getPreview3mf(file, onProgress = null) {
    const key = previewFileKey(file);
    const existing = threeMfRequests.get(key);
    if (existing) return existing;

    const request = requestPreview('/api/preview/3mf-scene', file, onProgress)
        .catch((error) => {
            threeMfRequests.delete(key);
            throw error;
        });
    threeMfRequests.set(key, request);
    return request;
}
