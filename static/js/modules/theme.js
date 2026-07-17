// ── Theme toggling (light / dark) + Language selector ──
import { lang, setLang, toggleLang, SUPPORTED_LANGS, langLabel, langFlag, onLangChange } from './i18n.js';

const THEME_KEY = 'pricer3d_theme_v1';
let _currentTheme = 'light';

export function initTheme() {
    // Restore saved preference (default: light)
    _currentTheme = localStorage.getItem(THEME_KEY) || 'light';
    applyTheme(_currentTheme);

    // Watch system preference changes (only if user hasn't explicitly chosen)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });

    _injectControls();
}

export function toggleTheme() {
    _currentTheme = _currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, _currentTheme);
    applyTheme(_currentTheme);
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    // Toggle .dark class for Tailwind dark: prefix and CSS variable overrides
    document.documentElement.classList.toggle('dark', isDark);
    // Keep data-theme attribute for backward compatibility (register.html, existing [data-theme] CSS)
    document.documentElement.setAttribute('data-theme', theme);
    _currentTheme = theme;
    _updateToggleLabel();
}

function _injectControls() {
    const authArea = document.getElementById('auth-area');
    if (!authArea) return;

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'flex items-center gap-1';

    // Theme toggle button — SVG sun/moon icons, no emoji
    const themeBtn = document.createElement('button');
    themeBtn.id = 'theme-toggle-btn';
    themeBtn.type = 'button';
    themeBtn.className = 'text-sm px-2.5 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors whitespace-nowrap flex items-center gap-1 tw-text';
    themeBtn.title = '切换深色/浅色主题';
    themeBtn.innerHTML = `<svg id="theme-icon" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;
    themeBtn.addEventListener('click', toggleTheme);
    controlsContainer.appendChild(themeBtn);

    // Language selector dropdown
    const langDropdown = document.createElement('div');
    langDropdown.className = 'relative';
    _renderLangDropdown(langDropdown);
    controlsContainer.appendChild(langDropdown);

    authArea.insertBefore(controlsContainer, authArea.firstChild);

    // Listen for language changes to update dropdown
    onLangChange(() => {
        _renderLangDropdown(langDropdown);
        _bindLangEvents(langDropdown);
    });

    _bindLangEvents(langDropdown);
    _updateToggleLabel();
}

function _renderLangDropdown(container) {
    container.innerHTML = `
        <button id="lang-toggle-btn" type="button" class="text-sm px-2 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1 tw-text tw-popup-trigger">
            <span>${langFlag(lang)}</span>
            <span id="lang-current-label">${langLabel(lang)}</span>
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </button>
        <div id="lang-dropdown-list" class="hidden absolute right-0 mt-1 tw-dropdown-panel z-50 min-w-[120px]">
            ${SUPPORTED_LANGS.map(l => `
                <button type="button" class="lang-option tw-dropdown-option text-sm ${l.code === lang ? 'tw-dropdown-option-active font-medium' : 'tw-text'}" data-lang="${l.code}">
                    <span>${l.flag}</span>
                    <span>${l.label}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function _bindLangEvents(container) {
    const langBtn = container.querySelector('#lang-toggle-btn');
    const langList = container.querySelector('#lang-dropdown-list');
    if (!langBtn || !langList) return;

    langBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        langList.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        langList.classList.add('hidden');
    });

    langList.querySelectorAll('.lang-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const newLang = opt.getAttribute('data-lang');
            if (newLang && newLang !== lang) {
                setLang(newLang);
            }
            langList.classList.add('hidden');
        });
    });
}

function _updateToggleLabel() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isDark = _currentTheme === 'dark';
    // Sun icon for light mode, moon icon for dark mode — no emoji
    const sunSVG = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>';
    const moonSVG = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
    btn.innerHTML = (isDark ? sunSVG : moonSVG) + '<span>' + (isDark ? '浅色' : '深色') + '</span>';
}
