// ── Theme toggling (light / dark) ──
const THEME_KEY = 'pricer3d_theme_v1';
let _currentTheme = 'light';

// Dark theme CSS — injected AFTER Tailwind CDN to guarantee priority
const DARK_CSS = `
[data-theme="dark"] body { background-color: #0f172a !important; color: #e2e8f0 !important; }
[data-theme="dark"] td, [data-theme="dark"] th, [data-theme="dark"] p, [data-theme="dark"] span:not([class*="text-"]) { color: #e2e8f0 !important; }
[data-theme="dark"] .bg-white { background-color: #1e293b !important; }
[data-theme="dark"] .bg-gray-50 { background-color: #0f172a !important; }
[data-theme="dark"] .bg-gray-100 { background-color: #1e293b !important; }
[data-theme="dark"] .bg-gray-200 { background-color: #334155 !important; }
[data-theme="dark"] .bg-indigo-50 { background-color: #1e1b4b !important; }
[data-theme="dark"] .text-gray-900 { color: #f1f5f9 !important; }
[data-theme="dark"] .text-gray-800 { color: #e2e8f0 !important; }
[data-theme="dark"] .text-gray-700 { color: #cbd5e1 !important; }
[data-theme="dark"] .text-gray-600 { color: #94a3b8 !important; }
[data-theme="dark"] .text-gray-500 { color: #94a3b8 !important; }
[data-theme="dark"] .text-gray-400 { color: #64748b !important; }
[data-theme="dark"] .text-gray-300 { color: #475569 !important; }
[data-theme="dark"] .border-gray-200 { border-color: #334155 !important; }
[data-theme="dark"] .border-gray-300 { border-color: #475569 !important; }
[data-theme="dark"] .border-gray-100 { border-color: #1e293b !important; }
[data-theme="dark"] .border-gray-400 { border-color: #475569 !important; }
[data-theme="dark"] .hover\\:bg-gray-50:hover { background-color: #334155 !important; }
[data-theme="dark"] .hover\\:bg-gray-100:hover { background-color: #334155 !important; }
[data-theme="dark"] .hover\\:border-gray-300:hover { border-color: #64748b !important; }
[data-theme="dark"] .hover\\:border-gray-400:hover { border-color: #64748b !important; }
[data-theme="dark"] .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5) !important; }
[data-theme="dark"] .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5) !important; }
[data-theme="dark"] .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5) !important; }
[data-theme="dark"] .shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6) !important; }
[data-theme="dark"] input:not([type="radio"]):not([type="checkbox"]),
[data-theme="dark"] select, [data-theme="dark"] textarea {
    background-color: #334155 !important; color: #e2e8f0 !important; border-color: #475569 !important;
}
[data-theme="dark"] input::placeholder, [data-theme="dark"] textarea::placeholder { color: #64748b !important; }
[data-theme="dark"] .text-indigo-600 { color: #818cf8 !important; }
[data-theme="dark"] .text-indigo-500 { color: #6366f1 !important; }
[data-theme="dark"] .text-indigo-700 { color: #a5b4fc !important; }
[data-theme="dark"] .border-indigo-200 { border-color: #4338ca !important; }
[data-theme="dark"] .border-indigo-300 { border-color: #4f46e5 !important; }
[data-theme="dark"] .border-indigo-400 { border-color: #6366f1 !important; }
[data-theme="dark"] .hover\\:bg-indigo-50:hover { background-color: #312e81 !important; }
[data-theme="dark"] .hover\\:text-indigo-700:hover { color: #a5b4fc !important; }
[data-theme="dark"] .hover\\:text-indigo-800:hover { color: #c7d2fe !important; }
[data-theme="dark"] .hover\\:border-indigo-300:hover { border-color: #4f46e5 !important; }
[data-theme="dark"] .text-green-600 { color: #4ade80 !important; }
[data-theme="dark"] .text-red-600 { color: #f87171 !important; }
[data-theme="dark"] .hover\\:text-red-700:hover { color: #fca5a5 !important; }
[data-theme="dark"] .text-amber-700 { color: #fbbf24 !important; }
[data-theme="dark"] .border-amber-300 { border-color: #92400e !important; }
[data-theme="dark"] .hover\\:bg-amber-50:hover { background-color: #451a03 !important; }
[data-theme="dark"] .hover\\:bg-red-50:hover { background-color: #450a0a !important; }
[data-theme="dark"] .hover\\:bg-indigo-700:hover { background-color: #4338ca !important; }
[data-theme="dark"] .border-dashed { border-color: #475569 !important; }
[data-theme="dark"] svg.text-gray-400 { color: #64748b !important; }
[data-theme="dark"] canvas { background-color: #1e293b !important; }
[data-theme="dark"] .placeholder\\:text-gray-400::placeholder { color: #64748b !important; }
body, .bg-white, .bg-gray-50, .bg-gray-100, .bg-indigo-50, input, select, textarea {
    transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
`;

export function initTheme() {
    // Inject dark CSS into the placeholder style element (after Tailwind CDN loads)
    const styleEl = document.getElementById('dark-theme');
    if (styleEl) {
        styleEl.textContent = DARK_CSS;
        styleEl.removeAttribute('disabled');
    }

    // Restore saved preference
    _currentTheme = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(_currentTheme);

    // Watch system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });

    _injectToggle();
}

export function toggleTheme() {
    _currentTheme = _currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, _currentTheme);
    applyTheme(_currentTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    _currentTheme = theme;
    _updateToggleIcon();
}

function _injectToggle() {
    const authArea = document.getElementById('auth-area');
    if (!authArea) return;
    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.type = 'button';
    btn.className = 'text-sm px-2 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors';
    btn.title = '切换深色/浅色主题';
    btn.addEventListener('click', toggleTheme);
    authArea.insertBefore(btn, authArea.firstChild);
    _updateToggleIcon();
}

function _updateToggleIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isDark = _currentTheme === 'dark';
    btn.innerHTML = isDark
        ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
        : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
}
