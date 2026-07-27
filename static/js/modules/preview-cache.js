// Shared GLB request cache for non-STL previews and thumbnails.
// A single uploaded file can be rendered in the result thumbnail, preview
// modal, and color/orientation refreshes; deduplicate those requests.
const glbRequests = new Map();
const stlRequests = new Map();
const threeMfRequests = new Map();

export function previewFileKey(file) {
    return [file?.name || "", file?.size || 0, file?.lastModified || 0].join(":");
}

export function getPreviewGlb(file) {
    const key = previewFileKey(file);
    const existing = glbRequests.get(key);
    if (existing) return existing;

    const formData = new FormData();
    formData.append("file", file);
    const request = fetch("/api/preview/glb", { method: "POST", body: formData })
        .then((resp) => {
            if (!resp.ok) throw new Error("GLB conversion failed");
            return resp.blob();
        })
        .catch((error) => {
            glbRequests.delete(key);
            throw error;
        });
    glbRequests.set(key, request);
    return request;
}

export function getPreviewStl(file) {
    const key = previewFileKey(file);
    const existing = stlRequests.get(key);
    if (existing) return existing;

    const formData = new FormData();
    formData.append("file", file);
    const request = fetch("/api/preview/stl", { method: "POST", body: formData })
        .then((resp) => {
            if (!resp.ok) throw new Error("STL normalization failed");
            return resp.blob();
        })
        .catch((error) => {
            stlRequests.delete(key);
            throw error;
        });
    stlRequests.set(key, request);
    return request;
}

export function getPreview3mf(file) {
    const key = previewFileKey(file);
    const existing = threeMfRequests.get(key);
    if (existing) return existing;

    const formData = new FormData();
    formData.append("file", file);
    const request = fetch("/api/preview/3mf-scene", { method: "POST", body: formData })
        .then((resp) => {
            if (!resp.ok) throw new Error("3MF scene extraction failed");
            return resp.blob();
        })
        .catch((error) => {
            threeMfRequests.delete(key);
            throw error;
        });
    threeMfRequests.set(key, request);
    return request;
}
