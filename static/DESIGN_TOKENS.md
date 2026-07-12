# Pricer3D 设计令牌系统 (Design Tokens)

> **版本**: v1.0  
> **风格**: iOS 蓝色系 · 浅色主界面  
> **最后更新**: 2026-07-04

---

## 目录

1. [🎨 语义色板](#-语义色板)
2. [📐 CSS 变量定义](#-css-变量定义)
3. [📏 间距 / 圆角 / 阴影](#-间距--圆角--阴影)
4. [🔤 排版层级](#-排版层级)
5. [🌓 深色模式（规划）](#-深色模式规划)
6. [📦 完整变量引用表](#-完整变量引用表)
7. [🔄 迁移计划](#-迁移计划)

---

## 🎨 语义色板

所有色板基于 iOS 蓝色系，Primary 锚定 `#007AFF`。

### Primary — iOS 蓝色

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#E8F2FF` | 极浅背景、激活状态底色、表格行悬停 |
| 100 | `#C8E0FF` | 浅背景色、徽章背景、进度条底色 |
| 200 | `#A3CBFF` | 边框、分割线 |
| 300 | `#7AB5FF` | Hover 边框、次要强调 |
| 400 | `#4D9AFF` | 悬停状态、辅助按钮 |
| **500** | **`#007AFF`** | **主色 — 按钮、链接、活动标签、强调文本** |
| 600 | `#0062CC` | 主色悬停、按压状态 |
| 700 | `#004999` | 深色背景上的主色、深色对比文本 |
| 800 | `#003173` | 极深强调（仅在深色模式中使用） |
| 900 | `#001A3D` | — |

### Success — 绿色（iOS 系统绿）

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#EBF9F0` | 成功提示背景 |
| 100 | `#C8F0D5` | — |
| 200 | `#A3E3B9` | 状态边框 |
| 300 | `#7AD59B` | — |
| 400 | `#55C77E` | — |
| **500** | **`#34C759`** | **成功主色 — 状态徽章、成功提示、已处理标记** |
| 600 | `#28A745` | 成功悬停 |
| 700 | `#1E7E34` | 深色背景上的成功色 |
| 800 | `#145522` | — |
| 900 | `#0A2B11` | — |

### Warning — 橙色（iOS 系统橙）

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#FFF3E0` | 警告提示背景 |
| 100 | `#FFE0B2` | — |
| 200 | `#FFCC80` | 状态边框 |
| 300 | `#FFB74D` | — |
| 400 | `#FFA726` | — |
| **500** | **`#FF9500`** | **警告主色 — 待处理标记、中等优先级、导出 PDF 按钮** |
| 600 | `#F57C00` | 警告悬停 |
| 700 | `#E65100` | 深色背景上的警告色 |
| 800 | `#BF360C` | — |
| 900 | `#871F00` | — |

### Danger — 红色（iOS 系统红）

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#FFEBEE` | 错误提示背景、删除按钮底色 |
| 100 | `#FFCDD2` | 错误边框 |
| 200 | `#EF9A9A` | — |
| 300 | `#E57373` | — |
| 400 | `#EF5350` | — |
| **500** | **`#FF3B30`** | **危险主色 — 错误信息、失败状态、删除操作** |
| 600 | `#D32F2F` | 危险悬停 |
| 700 | `#B71C1C` | 深色背景上的危险色 |
| 800 | `#8B0000` | — |
| 900 | `#4A0000` | — |

### Info — 青色（iOS 系统蓝灰）

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#E4F0F5` | 信息提示背景 |
| 100 | `#BDD8E6` | — |
| 200 | `#93BFD3` | — |
| 300 | `#6BA6C2` | — |
| 400 | `#4691B3` | — |
| **500** | **`#5AC8FA`** | **信息主色 — 提示信息、帮助文本、链接辅助色** |
| 600 | `#00A2E8` | — |
| 700 | `#007A9E` | — |
| 800 | `#00526A` | — |
| 900 | `#002938` | — |

### Neutral — 灰色（iOS 系统灰）

| 梯度 | Hex | 用途 |
|------|-----|------|
| 50 | `#F2F2F7` | **页面背景色** |
| 100 | `#E5E5EA` | 卡片边框、分割线、轻分割线 |
| 200 | `#D1D1D6` | 输入框边框、禁用状态 |
| 300 | `#C7C7CC` | 占位文本、次要边框 |
| 400 | `#AEAEB2` | 禁用文本、辅助说明 |
| 500 | `#8E8E93` | 次要文本 |
| 600 | `#636366` | 主要文本（次强调） |
| 700 | `#3A3A3C` | 主要文本（深色界面） |
| 800 | `#1C1C1E` | 标题文本、高对比度文本 |
| 900 | `#000000` | 极深文本（极少使用） |

### 色板与 Tailwind 映射关系

| 语义 | 新 CSS 变量名 | 对应 Tailwind（CDN） |
|------|--------------|---------------------|
| Primary-500 | `--color-primary` | `rgb(0 122 255)` — 对应 `blue-500` 附近 |
| Primary-600 | `--color-primary-hover` | `rgb(0 98 204)` |
| Primary-50 | `--color-primary-bg` | `bg-blue-50` |
| Success-500 | `--color-success` | `rgb(52 199 89)` — 对应 `green-500` |
| Warning-500 | `--color-warning` | `rgb(255 149 0)` — 对应 `orange-500` |
| Danger-500 | `--color-danger` | `rgb(255 59 48)` — 对应 `red-500` |
| Neutral-50 | `--color-bg` | `bg-gray-50` = `#F9FAFB`（略浅于 iOS #F2F2F7） |
| Neutral-100 | `--color-border-light` | `border-gray-100` = `#F3F4F6` |
| Neutral-200 | `--color-border` | `border-gray-200` = `#E5E7EB` |
| Neutral-300 | `--color-border-strong` | `border-gray-300` = `#D1D5DB` |
| Neutral-500 | `--color-text-muted` | `text-gray-500` = `#6B7280` |
| Neutral-700 | `--color-text` | `text-gray-700` = `#374151` |
| Neutral-800 | `--color-text-strong` | `text-gray-900` = `#111827` |
| Neutral-900 | `--color-heading` | `text-gray-900` |

---

## 📐 CSS 变量定义

```css
:root {
  /* ════════════════════════════════════════════
     1. 色板 - Primary (iOS Blue #007AFF)
     ════════════════════════════════════════════ */
  --color-primary-50:   #E8F2FF;
  --color-primary-100:  #C8E0FF;
  --color-primary-200:  #A3CBFF;
  --color-primary-300:  #7AB5FF;
  --color-primary-400:  #4D9AFF;
  --color-primary-500:  #007AFF;
  --color-primary-600:  #0062CC;
  --color-primary-700:  #004999;
  --color-primary-800:  #003173;
  --color-primary-900:  #001A3D;

  /* ── 语义别名 ── */
  --color-primary:         var(--color-primary-500);
  --color-primary-hover:   var(--color-primary-600);
  --color-primary-active:  var(--color-primary-700);
  --color-primary-bg:      var(--color-primary-50);
  --color-primary-border:  var(--color-primary-200);
  --color-primary-text:    var(--color-primary-700);   /* 浅色背景上的对比文本 */

  /* ════════════════════════════════════════════
     2. 色板 - Success (Green #34C759)
     ════════════════════════════════════════════ */
  --color-success-50:   #EBF9F0;
  --color-success-100:  #C8F0D5;
  --color-success-200:  #A3E3B9;
  --color-success-300:  #7AD59B;
  --color-success-400:  #55C77E;
  --color-success-500:  #34C759;
  --color-success-600:  #28A745;
  --color-success-700:  #1E7E34;
  --color-success-800:  #145522;
  --color-success-900:  #0A2B11;

  --color-success:        var(--color-success-500);
  --color-success-hover:  var(--color-success-600);
  --color-success-bg:     var(--color-success-50);
  --color-success-border: var(--color-success-200);
  --color-success-text:   var(--color-success-700);

  /* ════════════════════════════════════════════
     3. 色板 - Warning (Orange #FF9500)
     ════════════════════════════════════════════ */
  --color-warning-50:   #FFF3E0;
  --color-warning-100:  #FFE0B2;
  --color-warning-200:  #FFCC80;
  --color-warning-300:  #FFB74D;
  --color-warning-400:  #FFA726;
  --color-warning-500:  #FF9500;
  --color-warning-600:  #F57C00;
  --color-warning-700:  #E65100;
  --color-warning-800:  #BF360C;
  --color-warning-900:  #871F00;

  --color-warning:        var(--color-warning-500);
  --color-warning-hover:  var(--color-warning-600);
  --color-warning-bg:     var(--color-warning-50);
  --color-warning-border: var(--color-warning-200);
  --color-warning-text:   var(--color-warning-700);

  /* ════════════════════════════════════════════
     4. 色板 - Danger (Red #FF3B30)
     ════════════════════════════════════════════ */
  --color-danger-50:   #FFEBEE;
  --color-danger-100:  #FFCDD2;
  --color-danger-200:  #EF9A9A;
  --color-danger-300:  #E57373;
  --color-danger-400:  #EF5350;
  --color-danger-500:  #FF3B30;
  --color-danger-600:  #D32F2F;
  --color-danger-700:  #B71C1C;
  --color-danger-800:  #8B0000;
  --color-danger-900:  #4A0000;

  --color-danger:         var(--color-danger-500);
  --color-danger-hover:   var(--color-danger-600);
  --color-danger-bg:      var(--color-danger-50);
  --color-danger-border:  var(--color-danger-100);
  --color-danger-text:    var(--color-danger-700);

  /* ════════════════════════════════════════════
     5. 色板 - Info (Cyan-like #5AC8FA)
     ════════════════════════════════════════════ */
  --color-info-50:   #E4F0F5;
  --color-info-100:  #BDD8E6;
  --color-info-200:  #93BFD3;
  --color-info-300:  #6BA6C2;
  --color-info-400:  #4691B3;
  --color-info-500:  #5AC8FA;
  --color-info-600:  #00A2E8;
  --color-info-700:  #007A9E;
  --color-info-800:  #00526A;
  --color-info-900:  #002938;

  --color-info:         var(--color-info-500);
  --color-info-bg:      var(--color-info-50);
  --color-info-border:  var(--color-info-200);
  --color-info-text:    var(--color-info-700);

  /* ════════════════════════════════════════════
     6. 色板 - Neutral (iOS Gray)
     ════════════════════════════════════════════ */
  --color-neutral-50:   #F2F2F7;
  --color-neutral-100:  #E5E5EA;
  --color-neutral-200:  #D1D1D6;
  --color-neutral-300:  #C7C7CC;
  --color-neutral-400:  #AEAEB2;
  --color-neutral-500:  #8E8E93;
  --color-neutral-600:  #636366;
  --color-neutral-700:  #3A3A3C;
  --color-neutral-800:  #1C1C1E;
  --color-neutral-900:  #000000;

  /* ── 页面级语义别名 ── */
  --color-bg:           var(--color-neutral-50);    /* 页面背景 #F2F2F7 */
  --color-surface:      #FFFFFF;                     /* 卡片/面板背景 */
  --color-surface-hover: #FAFAFA;                   /* 卡片悬停背景 */

  --color-border:        var(--color-neutral-100);   /* 常规边框 #E5E5EA */
  --color-border-input:  var(--color-neutral-200);   /* 输入框边框 #D1D1D6 */
  --color-border-strong: var(--color-neutral-300);   /* 强调边框 */

  --color-text-muted:    var(--color-neutral-500);   /* 次要文本 #8E8E93 */
  --color-text-secondary: var(--color-neutral-600);  /* 辅助文本 #636366 */
  --color-text:           var(--color-neutral-700);  /* 正文 #3A3A3C */
  --color-text-strong:    var(--color-neutral-800);  /* 标题/高对比 #1C1C1E */
  --color-heading:        var(--color-neutral-800);  /* 标题 */

  --color-disabled-bg:   var(--color-neutral-100);   /* 禁用背景 */
  --color-disabled-text: var(--color-neutral-400);   /* 禁用文本 */
  --color-placeholder:   var(--color-neutral-300);   /* 占位文本 */

  /* ════════════════════════════════════════════
     7. 背景混合色
     ════════════════════════════════════════════ */
  --color-overlay:      rgba(0, 0, 0, 0.4);         /* 弹窗遮罩 */
  --color-overlay-light: rgba(0, 0, 0, 0.06);       /* 轻遮罩/行悬停 */

  /* ════════════════════════════════════════════
     8. 间距 (Spacing)
     ════════════════════════════════════════════ */
  --space-0:    0px;
  --space-1:    4px;    /* 极紧凑 */
  --space-2:    8px;    /* 紧凑 */
  --space-3:    12px;   /* 常规内部间距 */
  --space-4:    16px;   /* 标准 padding */
  --space-5:    20px;   /* 宽松 */
  --space-6:    24px;   /* 段落间距 */
  --space-8:    32px;   /* 区域间距 */
  --space-10:   40px;   /* 大间距 */
  --space-12:   48px;   /* 超大间距 */

  /* ════════════════════════════════════════════
     9. 圆角 (Border Radius)
     ════════════════════════════════════════════ */
  --radius-none:   0px;
  --radius-sm:     4px;     /* 标签、小徽章 */
  --radius-md:     6px;     /* 输入框、小按钮、表格 */  /* ← Tailwind `rounded-md` */
  --radius-lg:     8px;     /* 卡片、常规按钮、select */
  --radius-xl:     12px;    /* 模态框、大卡片、toast */  /* ← iOS 风格 */
  --radius-2xl:    16px;    /* 移动端底部弹窗圆角 */
  --radius-full:   9999px;  /* 药丸形徽章、圆点 */

  /* ════════════════════════════════════════════
     10. 阴影 (Box Shadow)
     ════════════════════════════════════════════ */
  --shadow-xs:     0 1px 2px rgba(0, 0, 0, 0.04);              /* 极轻阴影 */
  --shadow-sm:     0 1px 3px rgba(0, 0, 0, 0.06);              /* 卡片常规 */
  --shadow-md:     0 4px 6px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);  /* 下拉菜单 */
  --shadow-lg:     0 10px 15px rgba(0, 0, 0, 0.08), 0 4px 6px rgba(0, 0, 0, 0.04); /* 模态框 */
  --shadow-xl:     0 20px 25px rgba(0, 0, 0, 0.10), 0 10px 10px rgba(0, 0, 0, 0.04); /* 弹窗 */
  --shadow-2xl:    0 25px 50px rgba(0, 0, 0, 0.15);            /* Toast */
  --shadow-inner:  inset 0 2px 4px rgba(0, 0, 0, 0.04);        /* 内阴影 */

  /* ════════════════════════════════════════════
     11. 排版 (Typography)
     ════════════════════════════════════════════ */
  --font-sans:  -apple-system, BlinkMacSystemFont, 'PingFang SC', 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif;
  --font-mono:  'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace;

  /* 字号层级 (1rem = 16px) */
  --text-h1:       1.75rem;   /* 28px — 页面大标题 */
  --text-h2:       1.5rem;    /* 24px — 区域标题 */
  --text-h3:       1.25rem;   /* 20px — 卡片标题 */
  --text-h4:       1.125rem;  /* 18px — 弹窗标题 */
  --text-body-lg:  1rem;      /* 16px — 大号正文 */
  --text-body:     0.9375rem; /* 15px — 标准正文 (iOS default) */
  --text-body-sm:  0.875rem;  /* 14px — 小号正文 */
  --text-caption:  0.8125rem; /* 13px — 说明文字 */
  --text-tiny:     0.75rem;   /* 12px — 标签/辅助 */
  --text-micro:    0.6875rem; /* 11px — 极小注释 */

  /* 行高 */
  --leading-tight:    1.25;
  --leading-normal:   1.5;
  --leading-relaxed:  1.625;

  /* 字重 */
  --weight-normal:    400;
  --weight-medium:    500;
  --weight-semibold:  600;
  --weight-bold:      700;

  /* ════════════════════════════════════════════
     12. 过渡动画
     ════════════════════════════════════════════ */
  --transition-fast:   0.15s ease;
  --transition-normal: 0.2s ease;
  --transition-slow:   0.3s ease;

  /* ════════════════════════════════════════════
     13. Z-index 层级
     ════════════════════════════════════════════ */
  --z-dropdown:    100;
  --z-sticky:      200;
  --z-modal-backdrop: 400;
  --z-modal:       500;
  --z-toast:       600;
  --z-tooltip:     700;
}
```

---

## 📏 间距 / 圆角 / 阴影

### 间距层级（10 级）

| 变量名 | 值 | Tailwind 类名 | 典型用途 |
|--------|-----|---------------|---------|
| `--space-0` | 0px | `p-0` `m-0` `gap-0` | 零间距 |
| `--space-1` | 4px | `p-1` `gap-1` | 图标与文字间距、极小间隙 |
| `--space-2` | 8px | `p-2` `gap-2` | 紧凑内边距、标签间距 |
| `--space-3` | 12px | `p-3` `gap-3` | 常规内边距、弹窗 padding |
| `--space-4` | 16px | `p-4` `gap-4` | 标准 padding（卡片内边距） |
| `--space-5` | 20px | `p-5` `gap-5` | 宽松 padding |
| `--space-6` | 24px | `p-6` `gap-6` | 段落间距、section 间距 |
| `--space-8` | 32px | `p-8` `gap-8` | 区域间距、大段间距 |
| `--space-10` | 40px | `p-10` | 大间距 |
| `--space-12` | 48px | `p-12` | 超大间距 |

### 圆角层级（6 级）

| 变量名 | 值 | Tailwind 类名 | 典型用途 |
|--------|-----|---------------|---------|
| `--radius-none` | 0px | `rounded-none` | 无圆角 |
| `--radius-sm` | 4px | `rounded-sm` | 标签、小徽章 |
| `--radius-md` | 6px | `rounded-md` | 输入框、小按钮、表格 |
| `--radius-lg` | 8px | `rounded-lg` | 卡片、常规按钮、select |
| `--radius-xl` | 12px | `rounded-xl` | 模态框、大卡片、toast |
| `--radius-2xl` | 16px | `rounded-2xl` | 移动端底部弹窗 |
| `--radius-full` | 9999px | `rounded-full` | 药丸形徽章、圆点 |

### 阴影层级（7 级）

| 变量名 | 值 | Tailwind 类名 | 典型用途 |
|--------|-----|---------------|---------|
| `--shadow-xs` | 0 1px 2px rgba(0,0,0,0.04) | `shadow-sm`（接近） | 极轻阴影 |
| `--shadow-sm` | 0 1px 3px rgba(0,0,0,0.06) | `shadow` | 卡片常规 |
| `--shadow-md` | 0 4px 6px rgba(0,0,0,0.06) + 0 1px 3px rgba(0,0,0,0.04) | `shadow-md` | 下拉菜单 |
| `--shadow-lg` | 0 10px 15px rgba(0,0,0,0.08) + 0 4px 6px rgba(0,0,0,0.04) | `shadow-lg` | 模态框 |
| `--shadow-xl` | 0 20px 25px rgba(0,0,0,0.10) + 0 10px 10px rgba(0,0,0,0.04) | `shadow-xl` | 弹窗 |
| `--shadow-2xl` | 0 25px 50px rgba(0,0,0,0.15) | `shadow-2xl` | Toast |
| `--shadow-inner` | inset 0 2px 4px rgba(0,0,0,0.04) | `shadow-inner` | 内阴影 |

---

## 🔤 排版层级

### 字体系列

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'SF Pro Display',
             'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif;
--font-mono: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono',
             'Courier New', monospace;
```

> 苹方 (PingFang SC) 和 SF 字体家族是 iOS/macOS 系统字体，确保在所有 Apple 设备上一致显示。

### 字号层级（10 级）

| 层级 | 变量名 | 大小 | 字重 | 行高 | Tailwind 类名 | 用途 |
|------|-------|------|------|------|---------------|------|
| H1 | `--text-h1` | 1.75rem (28px) | 700 (Bold) | 1.25 | `text-2xl`（接近） | 页面大标题 |
| H2 | `--text-h2` | 1.5rem (24px) | 700 (Bold) | 1.25 | `text-2xl` | 区域标题 |
| H3 | `--text-h3` | 1.25rem (20px) | 600 (Semibold) | 1.25 | `text-xl` | 卡片标题 |
| H4 | `--text-h4` | 1.125rem (18px) | 600 (Semibold) | 1.25 | `text-lg` | 弹窗标题 |
| Body-Lg | `--text-body-lg` | 1rem (16px) | 400 (Normal) | 1.5 | `text-base` | 大号正文 |
| Body | `--text-body` | 0.9375rem (15px) | 400 (Normal) | 1.5 | `text-sm`（接近） | 标准正文（iOS 默认） |
| Body-Sm | `--text-body-sm` | 0.875rem (14px) | 400 (Normal) | 1.5 | `text-sm` | 小号正文 |
| Caption | `--text-caption` | 0.8125rem (13px) | 400 (Normal) | 1.5 | `text-xs`（接近） | 说明文字 |
| Tiny | `--text-tiny` | 0.75rem (12px) | 400 (Normal) | 1.5 | `text-xs` | 标签/辅助文字 |
| Micro | `--text-micro` | 0.6875rem (11px) | 400 (Normal) | 1.5 | `text-[11px]` | 极小注释 |

---

## 🌓 深色模式（规划）

> 当前阶段专注于浅色主界面。深色模式变量名已预留，可在第二阶段实施。

```css
/* 未来深色模式覆盖示例
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:           #0F1419;
    --color-surface:      #1A1F2E;
    --color-surface-hover: #252B3B;
    --color-border:        rgba(255,255,255,0.08);
    --color-border-input:  rgba(255,255,255,0.12);
    --color-text:          #E4E8F1;
    --color-text-muted:    #8B95A5;
    --color-text-strong:   #FFFFFF;
    --color-heading:       #FFFFFF;
  }
}
*/
```

---

## 📦 完整变量引用表

### 语义别名速查（日常使用）

| 用途 | 变量名 | 示例值 |
|------|--------|--------|
| **主色（按钮/链接）** | `var(--color-primary)` | `#007AFF` |
| **主色悬停** | `var(--color-primary-hover)` | `#0062CC` |
| **主色背景** | `var(--color-primary-bg)` | `#E8F2FF` |
| **主色边框** | `var(--color-primary-border)` | `#A3CBFF` |
| **成功色** | `var(--color-success)` | `#34C759` |
| **警告色** | `var(--color-warning)` | `#FF9500` |
| **危险色** | `var(--color-danger)` | `#FF3B30` |
| **信息色** | `var(--color-info)` | `#5AC8FA` |
| **页面背景** | `var(--color-bg)` | `#F2F2F7` |
| **卡片/表面** | `var(--color-surface)` | `#FFFFFF` |
| **常规边框** | `var(--color-border)` | `#E5E5EA` |
| **输入框边框** | `var(--color-border-input)` | `#D1D1D6` |
| **正文** | `var(--color-text)` | `#3A3A3C` |
| **次要文本** | `var(--color-text-muted)` | `#8E8E93` |
| **标题** | `var(--color-heading)` | `#1C1C1E` |
| **弹窗遮罩** | `var(--color-overlay)` | `rgba(0,0,0,0.4)` |

---

## 🔄 迁移计划

### 迁移策略

**阶段一（颜色替换，低风险）**：将 Tailwind 颜色类名（`text-indigo-*`, `bg-indigo-*`, `border-indigo-*`, `hover:bg-indigo-*`, `focus:ring-indigo-*`, `focus:border-indigo-*`）替换为对应的 CSS 变量，引入 `design-tokens.css`。

**阶段二（间距/圆角/阴影）**：将部分硬编码的内联样式替换为变量，添加排版类名。

**阶段三（完整统一）**：重构所有页面使用统一 tokens，生成深色模式变体。

### 阶段一：颜色替换（Phase 1 — Colors）

#### Step 1 — 在 `head.html` 中引入 CSS 变量文件

**文件**: `D:\Projects\pricer3d\static\partials\head.html`

```
+ <link rel="stylesheet" href="/static/css/design-tokens.css?v=1">
```

#### Step 2 — 主界面 Shell

**文件**: `D:\Projects\pricer3d\static\partials\page-shell.html`

| 当前类名 | 替换为 | 出现次数 |
|----------|--------|---------|
| `bg-gray-50` | `style="background: var(--color-bg)"` | 1 (body) |
| `bg-white rounded-xl shadow-md` | `style="background: var(--color-surface); border-radius: var(--radius-xl); box-shadow: var(--shadow-md)"` | 1 (主容器) |
| `text-indigo-500` | `style="color: var(--color-primary)"` | ~2 |
| `text-indigo-600` | `style="color: var(--color-primary)"` | ~4 |
| `text-indigo-700` | `style="color: var(--color-primary-text)"` | ~2 |
| `bg-indigo-600` | `style="background: var(--color-primary)"` | ~3 |
| `bg-indigo-50` | `style="background: var(--color-primary-bg)"` | ~2 |
| `hover:bg-indigo-50` | `style="..."` (hover via class) | ~10 |
| `hover:bg-indigo-700` | `style="..."` | ~2 |
| `border-indigo-200` | `style="border-color: var(--color-primary-border)"` | ~3 |
| `focus:ring-indigo-500` | `style="..."` | ~3 |
| `text-red-600` | `style="color: var(--color-danger)"` | ~2 |
| `bg-red-50` | `style="background: var(--color-danger-bg)"` | ~2 |
| `text-green-600` | `style="color: var(--color-success)"` | ~1 |
| `text-amber-700` | `style="color: var(--color-warning-text)"` | ~2 |
| `bg-amber-50` | `style="background: var(--color-warning-bg)"` | ~3 |

**替换估算**: 约 **40-50** 处颜色引用

#### Step 3 — 登录弹窗

**文件**: `D:\Projects\pricer3d\static\partials\login-modal.html`

| 当前类名 | 替换为 | 出现次数 |
|----------|--------|---------|
| `bg-indigo-600` | 主色背景 | 1 |
| `text-indigo-600` | 主色文本 | ~2 |
| `focus:ring-indigo-500/20 focus:border-indigo-500` | 主色 focus ring | ~3 |
| `bg-green-50 border-green-200 text-green-700` | 成功色 | 1 |
| `bg-red-50 border-red-200 text-red-700` | 危险色 | 1 |

**替换估算**: 约 **10** 处

#### Step 4 — 报价参数弹窗

**文件**: `D:\Projects\pricer3d\static\partials\options-modal.html`

| 当前类名 | 出现次数 |
|----------|---------|
| `bg-indigo-600`, `hover:bg-indigo-700` | ~1 |
| `focus:ring-indigo-500 focus:border-indigo-500` | ~3 |
| `text-indigo-700` / `bg-indigo-50` | ~1 |

**替换估算**: 约 **6** 处

#### Step 5 — 会员弹窗

**文件**: `D:\Projects\pricer3d\static\partials\membership-modal.html`

| 当前类名 | 出现次数 |
|----------|---------|
| `bg-gray-50` | ~1 |
| `border-gray-200` | ~4 |
| `text-gray-500/600/700/800` | ~8 |

**替换估算**: 约 **15** 处（主要替换 border/text 颜色）

#### Step 6 — 用户中心弹窗

**文件**: `D:\Projects\pricer3d\static\partials\user-center-modal.html`

| 当前类名 | 出现次数 |
|----------|---------|
| `text-indigo-700 bg-indigo-50` | ~2 |
| `bg-indigo-50` | ~1 |
| `border-gray-200` | ~5 |
| `text-gray-500/600/700/800` | ~15 |
| `bg-gray-50` | ~2 |
| `border-amber-400 text-amber-600 hover:bg-amber-50` | ~1 |

**替换估算**: 约 **25** 处

#### Step 7 — 预览弹窗 / 色彩编辑弹窗 / 报价历史弹窗 / ZIP 预览弹窗

**文件**: `static/partials/preview-modal.html`, `color-editor-modal.html`, `quote-history-modal.html`, `zip-preview-modal.html`

- 主要替换 `indigo-*` → `var(--color-primary)` 系列
- 替换 `gray-*` → `var(--color-text-*)` / `var(--color-border)`

**替换估算**: 约 **20-30** 处总计

#### Step 8 — 配置页

**文件**: `D:\Projects\pricer3d\static\html\config.html`

| 当前 | 替换 | 次数 |
|------|------|------|
| `bg-indigo-600`, `hover:bg-indigo-700` | 主色 | ~1 |
| `text-indigo-600`, `hover:text-indigo-800` | 主色 | ~3 |
| `border-indigo-200`, `hover:bg-indigo-50` | 主色 | ~2 |
| `text-indigo-500` | 主色 | ~1 |

**替换估算**: 约 **8** 处

#### Step 9 — 表格增强 CSS

**文件**: `D:\Projects\pricer3d\static\css\table-enhancements.css`

| 当前值 | 替换为 |
|--------|--------|
| `#ef4444` (table-row-failed) | `var(--color-danger)` |
| `#22c55e` (table-row-success) | `var(--color-success)` |
| `#f59e0b` / `#fbbf24` (table-row-pending) | `var(--color-warning-500)` / `var(--color-warning-300)` |
| `#6366f1` (resize handle) | `var(--color-primary)` |
| `#dcfce7` / `#166534` / `#bbf7d0` (success badge) | `var(--color-success-bg)` / `var(--color-success-text)` / `var(--color-success-border)` |
| `#fef2f2` / `#991b1b` / `#fecaca` (failed badge) | `var(--color-danger-bg)` / `var(--color-danger-text)` / `var(--color-danger-border)` |
| `#fffbeb` / `#92400e` / `#fde68a` (pending badge) | `var(--color-warning-bg)` / `var(--color-warning-text)` / `var(--color-warning-border)` |
| `rgba(199, 210, 254, 0.3)` / `rgba(99, 102, 241, 0.3)` (selected row) | `var(--color-primary-50)` opacity / `var(--color-primary)` opacity |

**替换估算**: 约 **15** 处硬编码颜色值

#### Step 10 — 移动端 CSS

**文件**: `D:\Projects\pricer3d\static\css\mobile.css`

- 替换硬编码颜色 `#e5e7eb`, `#cbd5e1`, `#f3f4f6` 等 → 对应的 `var(--color-border)`, `--color-neutral-*` 等

**替换估算**: 约 **10** 处硬编码颜色值

---

### 阶段一总结

| 文件 | 估算替换量 |
|------|-----------|
| `partials/page-shell.html` | ~45 处 |
| `partials/login-modal.html` | ~10 处 |
| `partials/options-modal.html` | ~6 处 |
| `partials/membership-modal.html` | ~15 处 |
| `partials/user-center-modal.html` | ~25 处 |
| `partials/preview-modal.html` | ~8 处 |
| `partials/color-editor-modal.html` | ~4 处 |
| `partials/quote-history-modal.html` | ~6 处 |
| `partials/zip-preview-modal.html` | ~4 处 |
| `html/config.html` | ~8 处 |
| `css/table-enhancements.css` | ~15 处 |
| `css/mobile.css` | ~10 处 |
| **总计** | **~156 处** |

### 执行顺序（推荐）

1. 引入 `design-tokens.css` 到 `head.html` ✅
2. 替换 `table-enhancements.css` 硬编码颜色（CSS 文件替换，风险最低）
3. 替换 `page-shell.html` 主界面颜色
4. 替换各 modal partial 的颜色
5. 替换 `mobile.css` 中的颜色
6. 替换 `config.html` 颜色
7. 回归测试：确认报价、登录、弹窗等交互正常
