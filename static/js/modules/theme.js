// Theme toggling (light / dark) + language selector
import { lang, setLang, SUPPORTED_LANGS, langLabel, langFlag, onLangChange } from './i18n.js';

const THEME_KEY = 'pricer3d_theme_v1';
const DARK_QUERY = '(prefers-color-scheme: dark)';
let _currentTheme = 'light';
let _langOutsideClickBound = false;

function preferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

export function initTheme() {
    _currentTheme = preferredTheme();
    applyTheme(_currentTheme);

    const media = window.matchMedia?.(DARK_QUERY);
    media?.addEventListener?.('change', (event) => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(event.matches ? 'dark' : 'light');
    });

    _injectControls();
}

export function toggleTheme() {
    const nextTheme = _currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    // Keep data-theme for the auth pages and older selectors.
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    _currentTheme = isDark ? 'dark' : 'light';
    _updateToggleLabel();
}

function _injectControls() {
    const authArea = document.getElementById('auth-area');
    if (authArea && !document.getElementById('theme-toggle-btn')) {
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'theme-language-controls flex items-center gap-1.5';

        const themeBtn = document.createElement('button');
        themeBtn.id = 'theme-toggle-btn';
        themeBtn.type = 'button';
        themeBtn.className = 'theme-toggle-control tw-btn-ghost';
        themeBtn.title = '\u5207\u6362\u6df1\u8272/\u6d45\u8272\u4e3b\u9898';
        themeBtn.addEventListener('click', toggleTheme);
        controlsContainer.appendChild(themeBtn);

        const langDropdown = document.createElement('div');
        langDropdown.className = 'relative';
        _renderLangDropdown(langDropdown);
        controlsContainer.appendChild(langDropdown);
        authArea.insertBefore(controlsContainer, authArea.firstChild);

        onLangChange(() => {
            _renderLangDropdown(langDropdown);
            _bindLangEvents(langDropdown);
            _updateToggleLabel();
        });
        _bindLangEvents(langDropdown);
    }

    const mobileThemeBtn = document.getElementById('mobile-theme-toggle-btn');
    if (mobileThemeBtn && !mobileThemeBtn.dataset.bound) {
        mobileThemeBtn.dataset.bound = 'true';
        mobileThemeBtn.addEventListener('click', toggleTheme);
    }
    _updateToggleLabel();
}

function _renderLangDropdown(container) {
    container.innerHTML = `
        <button id="lang-toggle-btn" type="button" class="language-toggle-control tw-btn-ghost" aria-haspopup="listbox" aria-expanded="false">
            <span aria-hidden="true">${langFlag(lang)}</span>
            <span id="lang-current-label">${langLabel(lang)}</span>
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </button>
        <div id="lang-dropdown-list" class="hidden absolute right-0 mt-1 tw-dropdown-panel z-50 min-w-[120px]" role="listbox">
            ${SUPPORTED_LANGS.map(option => `
                <button type="button" role="option" aria-selected="${option.code === lang}" class="lang-option tw-dropdown-option text-sm ${option.code === lang ? 'tw-dropdown-option-active font-medium' : 'tw-text'}" data-lang="${option.code}">
                    <span aria-hidden="true">${option.flag}</span>
                    <span>${option.label}</span>
                </button>
            `).join('')}
        </div>
    `;
}

function _bindLangEvents(container) {
    const langBtn = container.querySelector('#lang-toggle-btn');
    const langList = container.querySelector('#lang-dropdown-list');
    if (!langBtn || !langList) return;

    langBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = !langList.classList.contains('hidden');
        langList.classList.toggle('hidden', isOpen);
        langBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    if (!_langOutsideClickBound) {
        document.addEventListener('click', () => {
            document.querySelectorAll('#lang-dropdown-list:not(.hidden)').forEach(list => {
                list.classList.add('hidden');
                list.previousElementSibling?.setAttribute('aria-expanded', 'false');
            });
        });
        _langOutsideClickBound = true;
    }

    langList.querySelectorAll('.lang-option').forEach(option => {
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            const nextLang = option.getAttribute('data-lang');
            if (nextLang && nextLang !== lang) setLang(nextLang);
            langList.classList.add('hidden');
            langBtn.setAttribute('aria-expanded', 'false');
        });
    });
}

function _updateToggleLabel() {
    const buttons = [
        document.getElementById('theme-toggle-btn'),
        document.getElementById('mobile-theme-toggle-btn'),
    ].filter(Boolean);
    const isDark = _currentTheme === 'dark';
    const labels = lang === 'en'
        ? { dark: 'Dark mode', light: 'Light mode', toDark: 'Switch to dark mode', toLight: 'Switch to light mode' }
        : { dark: '\u6df1\u8272\u6a21\u5f0f', light: '\u6d45\u8272\u6a21\u5f0f', toDark: '\u5207\u6362\u5230\u6df1\u8272\u6a21\u5f0f', toLight: '\u5207\u6362\u5230\u6d45\u8272\u6a21\u5f0f' };
    const sunSVG = '<svg class="theme-toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>';
    const moonSVG = '<svg class="theme-toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>';
    buttons.forEach(button => {
        button.innerHTML = `${isDark ? sunSVG : moonSVG}<span>${isDark ? labels.light : labels.dark}</span>`;
        button.setAttribute('aria-label', isDark ? labels.toLight : labels.toDark);
        button.setAttribute('aria-pressed', String(isDark));
        button.title = isDark ? labels.toLight : labels.toDark;
    });
}
