/**
 * i18n (Internationalization) — 语言包系统
 *
 * 支持懒加载语言包，便于扩展新语言
 * 语言包文件: /js/modules/i18n/{lang}.js
 *
 * Usage: import { t, lang, setLang, toggleLang } from './i18n.js'
 * In HTML: data-i18n="key.name"
 * In JS:   t('key.name') → translated string
 *          t('key.name', { count: 3 }) → interpolated
 *
 * Language priority: localStorage > browser setting > default 'zh'
 */

// ── 支持的语言列表 ──
export const SUPPORTED_LANGS = [
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
];

// ── 语言包缓存 ──
const _packs = {};
let _packLoaded = {};

// ── State ──
export let lang = localStorage.getItem('pricer3d_lang_v1') || _getBrowserLang();
const _listeners = new Set();

function _getBrowserLang() {
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('en')) return 'en';
  return 'zh';
}

/**
 * 加载语言包（带缓存）
 */
async function _loadPack(langCode) {
  if (_packs[langCode]) return _packs[langCode];
  try {
    const mod = await import(`./i18n/${langCode}.js`);
    _packs[langCode] = mod.default || mod;
    _packLoaded[langCode] = true;
    return _packs[langCode];
  } catch (e) {
    console.warn(`[i18n] Failed to load language pack: ${langCode}`, e);
    return null;
  }
}

/**
 * 设置语言
 */
export async function setLang(l) {
  const prev = lang;
  lang = l;
  localStorage.setItem('pricer3d_lang_v1', l);

  // 确保语言包已加载
  await _loadPack(l);

  // 更新 DOM 中 data-i18n 元素
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  // 更新 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const ph = el.getAttribute('data-i18n-placeholder');
    if (ph) el.placeholder = t(ph);
  });

  // 通知监听器
  _listeners.forEach(fn => {
    try { fn({ lang: l, prev }); } catch (e) { console.error(e); }
  });

  window.dispatchEvent(new CustomEvent('i18n-change', { detail: { lang: l, prev } }));
}

/**
 * 切换语言
 */
export function toggleLang() {
  const idx = SUPPORTED_LANGS.findIndex(l => l.code === lang);
  const next = SUPPORTED_LANGS[(idx + 1) % SUPPORTED_LANGS.length];
  setLang(next.code);
}

/**
 * 初始化 i18n
 */
export async function initI18n() {
  await _loadPack(lang);
  await _loadPack('zh'); // 始终加载中文作为 fallback
  setLang(lang);
}

/**
 * 动态加载额外翻译（兼容旧接口）
 */
export async function loadTranslations(newStrings) {
  Object.assign(_packs, newStrings);
}

/**
 * 翻译函数
 */
export function t(key, params) {
  const str = (_packs[lang] && _packs[lang][key])
    || (_packs['zh'] && _packs['zh'][key])
    || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
}

/**
 * 监听语言变化
 */
export function onLangChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * 获取当前语言标签
 */
export function langLabel(l) {
  const found = SUPPORTED_LANGS.find(s => s.code === (l || lang));
  return found ? found.label : l;
}

/**
 * 获取当前语言国旗
 */
export function langFlag(l) {
  const found = SUPPORTED_LANGS.find(s => s.code === (l || lang));
  return found ? found.flag : '🌐';
}
