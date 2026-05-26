# Pricer3D 用户中心排版修复 — OpenCode 提示词

> 项目：pricer3d — 3D打印自动报价系统
> 技术栈：FastAPI (Python) + 静态 HTML/JS 前端 (Tailwind CSS CDN)

## 项目结构
- `static/index.html` — 主页面，包含用户中心弹窗
- `static/js/main.js` — 全部前端逻辑
- Docker 部署：`docker compose up -d --build app`

## 已完成的三项修复

### 1. 切片配置 Tab HTML 嵌套错误

**问题：** `uc-tab-slicer` 里多了一层无用的 `<div>` 包裹，导致 tab pane 过早关闭，"已保存的预设"表格、"报价默认使用的预设"下拉、"当前打印机型号"下拉三个区块被挤到 tab 面板外面。

**修复：** 去掉多余 `<div>` 包裹，所有切片相关内容统一收在 `uc-tab-slicer` 内部。

### 2. 切片配置里多余的机型选择器

**问题：** 切片配置 tab 里有 `id="cfg-printer-model"` 的打印机型号选择器，但打印机型号应该只在「机型配置」tab 的 `cfg-printer-model-main` 中选择。

**修复：**
- HTML：删除切片 tab 里的 `cfg-printer-model` 整个 div 块
- JS：`preloadPrinterSelectors()` 和 `fetchPrinterModels()` 两个函数里的循环从 `["cfg-printer-model", "cfg-printer-model-main"]` 改为只遍历 `["cfg-printer-model-main"]`

### 3. 页脚提示「修改密码后需重新登录」的可见范围

**问题：** 页脚提示在所有 tab 都可见，应该只在「账号安全」tab 显示。用 `hidden`（display:none）会导致 flex justify-between 布局破坏、保存按钮跑到左边。

**最终方案：**
- HTML：提示 div 加 `id="user-center-hint"`，默认 `invisible`（visibility:hidden，占位不可见）
- JS：tab 切换时 `classList.toggle('invisible', tabId !== 'security')`，仅在账号安全 tab 显示文字

## 后续注意
- HTML 静态文件是 COPY 进 Docker 镜像的（不是 volume mount），每次修改后必须 `docker compose up -d --build app` 重建
- 所有 `<div>` 已确认 133:133 平衡，HTML5 验证通过
- 用户中心有 6 个 tab：材料设置、计算公式、成本与时间、机型配置、切片配置、账号安全
