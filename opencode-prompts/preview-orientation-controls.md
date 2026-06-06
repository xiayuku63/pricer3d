# 任务：预览界面交互式打印方向调整

请先阅读 `opencode-prompts/project-context.md` 了解项目背景（pricer3d）。

## 目标
在 3D 预览界面中，集成交互式打印方向调整功能：
1. 展示方向优化推荐结果
2. 允许用户手动旋转模型（X/Y/Z 轴）来微调打印方向
3. 实时显示当前旋转角度
4. 将调整后的方向应用到报价计算

## 具体要求

### 1. 预览弹窗改造 — `static/index.html`
在现有的 `preview-modal`（模型在线预览弹窗）中添加：
- 预览区右侧或底部添加旋转控制面板
- X / Y / Z 三个旋转滑块（范围 -180° ~ 180°，步长 1°）
- 显示当前 Euler 角度数值
- 「方向优化建议」按钮 → 打开方向优化结果
- 「重置」按钮 → 归零旋转
- 「应用此方向」按钮 → 保存当前方向（后续报价使用）

### 2. 前端逻辑 — `static/js/main.js` 
- 滑块拖动时实时调用 `applyOrientationRotation({x, y, z})`（已有函数，在 viewer.js）
- 「方向优化建议」按钮 → 弹出优化结果选择列表，点击候选方向自动应用旋转
- 「应用此方向」保存到全局状态（如 `quoteOptions.orientation`），报价时传给后端

### 3. 3D 交互 — `static/js/modules/viewer.js`
- 滑块变化时调用 `applyOrientationRotation()`（已有）
- 确保旋转后 camera 自适应（`fitCameraToMesh` 已存在）

## 约束
- 不要修改现有报价逻辑的输入字段
- 用 Tailwind CSS 排版
- 改完后 `docker compose up -d --build app`
