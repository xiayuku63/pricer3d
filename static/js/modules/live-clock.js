/**
 * live-clock.js — 实时时钟模块
 * 页面左上角标题区域实时时钟，支持自定义时区
 *
 * API: 导出 initLiveClock(), startClock(), stopClock()
 * 无需 DOM refs，clock 元素通过 HTML id="live-clock" 自动绑定
 */

// ── 默认时区 ──
const STORAGE_KEY = 'pricer3d_live_clock_timezone';
const DEFAULT_TZ = 'Asia/Shanghai';

const TZ_OPTIONS = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
  'UTC',
];

let intervalId = null;
let selectedTz = DEFAULT_TZ;
let selectorVisible = false;

// ── 读取/写入 localStorage ──
function loadTimezone() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && TZ_OPTIONS.includes(saved)) {
      selectedTz = saved;
    }
  } catch (_) { /* localStorage unavailable */ }
}

function saveTimezone(tz) {
  selectedTz = tz;
  try { localStorage.setItem(STORAGE_KEY, tz); } catch (_) {}
}

// ── 格式化时间 ──
function formatClock(tz) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const map = {};
    for (const p of parts) map[p.type] = p.value;

    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} ${tz}`;
  } catch (_) {
    return '--:--:--';
  }
}

// ── 构建时区选择器 DOM ──
function buildTimezoneSelector() {
  const existing = document.getElementById('live-clock-tz-selector');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'live-clock-tz-selector';
  container.style.cssText = `
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 9999;
    min-width: 180px;
    margin-top: 4px;
    padding: 4px 0;
    border: 1px solid var(--color-border, #e0e0e0);
    border-radius: var(--radius-md, 8px);
    background: var(--color-card-bg, #fff);
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  `;
  container.className = 'tw-card';

  const header = document.createElement('div');
  header.style.cssText = 'padding: 6px 12px; font-size: 0.75rem; font-weight: 600; color: var(--color-text-muted, #888); border-bottom: 1px solid var(--color-border, #e0e0e0);';
  header.textContent = '时区 / Timezone'; // i18n not critical for selector header
  container.appendChild(header);

  TZ_OPTIONS.forEach((tz) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `
      display: block;
      width: 100%;
      text-align: left;
      padding: 6px 12px;
      font-size: 0.8rem;
      font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
      background: ${tz === selectedTz ? 'var(--color-primary-bg, #eef2ff)' : 'transparent'};
      color: ${tz === selectedTz ? 'var(--color-primary, #4361ee)' : 'var(--color-text, #333)'};
      border: none;
      cursor: pointer;
    `;
    btn.textContent = tz;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveTimezone(tz);
      updateClock();
      hideSelector();
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--color-hover-bg, #f5f5f5)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = tz === selectedTz ? 'var(--color-primary-bg, #eef2ff)' : 'transparent';
    });
    container.appendChild(btn);
  });

  return container;
}

function showSelector() {
  if (selectorVisible) return;
  hideSelector(); // clean up any stale instance

  const clockEl = document.getElementById('live-clock');
  if (!clockEl) return;

  const selector = buildTimezoneSelector();
  clockEl.parentNode.style.position = 'relative';
  clockEl.parentNode.appendChild(selector);
  selectorVisible = true;

  // Click outside to close
  document.addEventListener('click', _outsideClickHandler);
}

function hideSelector() {
  const sel = document.getElementById('live-clock-tz-selector');
  if (sel) sel.remove();
  selectorVisible = false;
  document.removeEventListener('click', _outsideClickHandler);
}

function _outsideClickHandler(e) {
  const clockEl = document.getElementById('live-clock');
  const sel = document.getElementById('live-clock-tz-selector');
  if (!clockEl || !sel) return;
  if (!clockEl.contains(e.target) && !sel.contains(e.target)) {
    hideSelector();
  }
}

// ── 更新时钟 ──
function updateClock() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = formatClock(selectedTz);
}

// ── 启动/停止 ──
function startClock() {
  if (intervalId) return;
  loadTimezone();
  updateClock();
  intervalId = setInterval(updateClock, 1000);
}

function stopClock() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  hideSelector();
}

// ── 时钟点击切换时区 ──
function wireClockClick() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  el.style.cursor = 'pointer';
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectorVisible) {
      hideSelector();
    } else {
      showSelector();
    }
  });
}

// ── 初始化 ──
export function initLiveClock() {
  loadTimezone();
  updateClock();
  startClock();
  wireClockClick();

  // Clean up on page unload
  window.addEventListener('beforeunload', stopClock);
}

// ════════════════════════════════════
//  Dev / debug (also exported)
// ════════════════════════════════════
export { stopClock, startClock };
