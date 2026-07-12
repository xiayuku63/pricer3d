// ── Three.js 3D Viewer — Thumbnail Module ──

export function buildPlaceholderThumbnail(ext) {
    const label = (ext || 'file').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#f8fafc"/>
        </linearGradient></defs>
        <rect width="200" height="120" rx="8" fill="url(#g)"/>
        <rect x="12" y="12" width="176" height="96" rx="6" fill="none" stroke="#cbd5e1"/>
        <text x="100" y="62" text-anchor="middle" fill="#334155" font-size="18" font-family="Arial,sans-serif" font-weight="700">${label}</text>
        <text x="100" y="84" text-anchor="middle" fill="#64748b" font-size="11" font-family="Arial,sans-serif">Static Preview</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
