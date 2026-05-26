# Pricer3D 项目上下文 — 给 OpenCode 的提示词

## 项目概述
**pricer3d** — 3D打印自动报价系统，FastAPI (Python) + 静态 HTML/JS 前端 (Tailwind CSS CDN)。

## 技术架构
- **后端:** FastAPI, SQLAlchemy ORM, Alembic 迁移
- **前端:** 单页 HTML (`static/index.html`) + 原生 JS 模块 (`static/js/main.js`)
- **部署:** Docker (`docker compose up -d --build app`)，端口 `127.0.0.1:5000`
- **关键目录:** `app/` (路由/模型), `static/` (前端), `calculator/` (计价逻辑), `parser/` (3MF 解析)

## 2026-05-16 修复记录

### 1. 用户中心切片配置 Tab HTML 嵌套错误 ✅
**文件:** `static/index.html`
**问题:** `uc-tab-slicer` 内多了一层无用的 `<div>` 包裹，导致 tab pane 过早关闭，三个内容区块被踢出面板。
**修复:** 去掉多余包裹，所有切片内容收在 `uc-tab-slicer` 内。修复后 `<div>` 133:133 平衡。

### 2. 切片配置 Tab 多余的机型选择器 ✅
**文件:** `static/index.html`, `static/js/main.js`
**问题:** 切片配置 tab 里有 `id="cfg-printer-model"` 的打印机选择器，但机型选择应在「机型配置」tab 的 `cfg-printer-model-main`。
**修复:**
- HTML: 删掉切片 tab 里的 `cfg-printer-model` div
- JS: `preloadPrinterSelectors()` 和 `fetchPrinterModels()` 循环从 `["cfg-printer-model", "cfg-printer-model-main"]` 改为只遍历 `["cfg-printer-model-main"]`

### 3. 页脚提示可见范围 ✅
**文件:** `static/index.html`, `static/js/main.js`
**问题:** 「修改密码后需重新登录」提示在所有 tab 显示。
**最终方案:** 用 `invisible` (visibility:hidden) 代替 `hidden` (display:none)，避免 flex justify-between 布局破坏。仅在账号安全 tab 移除 `invisible`。
- HTML: `<div id="user-center-hint" class="... invisible">`
- JS: `userCenterHint.classList.toggle('invisible', tabId !== 'security')`

## 注意事项
- 静态文件是 COPY 进 Docker 镜像的，每次 HTML/JS 修改后必须 `docker compose up -d --build app`
- 用户中心 6 个 tab: 材料设置、计算公式、成本与时间、机型配置、切片配置、账号安全
- 不要往切片配置加机型选择器，机型只在机型配置选

## OpenCode 环境配置
- 安装路径: `~/.local/bin/opencode` (v1.15.0)
- 配置文件: `~/.config/opencode/opencode.jsonc`
- API 环境变量: `source ~/.opencode_env`
- 已配 API: DeepSeek (`DEEPSEEK_API_KEY`), 阿里云百炼 (`DASHSCOPE_API_KEY`)
- 可用 provider: `deepseek/`, `alibaba/`, `alibaba-cn/`, `opencode/`
