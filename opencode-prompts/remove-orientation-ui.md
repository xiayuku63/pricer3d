# 任务：从界面移除方向优化功能

## 目标
从 pricer3d 前端界面彻底移除方向优化相关功能。保留后端 API 代码不动（calculator/orientation.py, app/routes_orientation.py）。

## 需要删除/还原

### index.html
- 删除 `<!-- 方向优化弹窗 -->` 整个 orient-modal 区块
- 恢复预览弹窗为原始全宽布局（去掉右侧 orient-controls 面板和 flex 分栏）
- 预览弹窗宽度恢复为 `max-w-4xl`
- 预览区高度恢复为全宽 `h-[70vh]`

### main.js
- 删除所有 orient 相关元素引用（orientModal, orientSlider*, orientAngle*, orientSuggestBtn 等）
- 删除 `quoteOptions.orientation` 字段
- 删除 `openOrientModal()`, `closeOrientModal()`, `loadOrientationAnalysis()`, `renderOrientationResult()`
- 删除 `syncOrientationUI()`, `handleOrientSliderChange()`
- 删除 `currentPreviewFilename` 变量及相关逻辑
- 恢复 `openPreviewModal()` 为原始简单版本（不调用 orientation 相关函数）
- 删除 `previewByFilename` 中我加的 try-catch 和 setTimeout 兜底
- 删除 `batchResultsBody` click handler 中的 orient 按钮处理
- 删除结果行中的 `data-orient-file` 按钮（保留 `data-delete-file` 和 `data-preview-file`）
- 从 import 中移除 `applyOrientationRotation, resetOrientation`

### viewer.js
- 删除 `applyOrientationRotation()` 和 `resetOrientation()` 函数
- 保留 reader.onerror 处理

### 注意事项
- 页面要保持可用，预览按钮、删除按钮、上传、报价功能都要正常
- 改完 `docker compose up -d --build app`
