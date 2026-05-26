# 任务：可摆放面筛选 + 高亮标记

先读 project-context.md 了解项目。

## 问题
1. 可摆放面识别出来太小，小碎面也被当成候选
2. 候选面没有视觉区分，跟整体模型混在一起

## 参考 PrusaSlicer 做法
- 用 ConvexHull 提取稳定面，过滤面积太小的面
- 候选面用半透明彩色层高亮（不同面色调不同）
- 只高亮 ConvexHull 面上面积 > 阈值的面

## 具体改动

### 1. viewer.js — 加回 highlightFaces（精简化）
- 输入：面索引数组 + 对应颜色数组
- 在原模型上方叠加半透明面层（opacity 0.7~0.85）
- 每个候选面用不同颜色（如绿色系、蓝色系、紫色系交替）
- 导出 `highlightFaces(faceColors)` 和 `resetHighlight()`

### 2. viewer.js — 面点击检测分两种模式
- 默认模式：点击模型任意面 → 回调世界空间法向量
- 高亮模式：仅高亮面可点击 → 回调该面的法向量

### 3. main.js — 「显示可摆放面」按钮回归
- 点击后调用 `/api/orientation/faces` 获取候选面
- 过滤：面积 < 模型总面积 2% 的面丢弃
- 前端再次过滤：面积 < 50mm² 的面丢弃
- 调用 `highlightFaces` 高亮候选面
- 高亮后点击面 → 自动旋转

### 4. 后端 — `get_stable_faces()` 不改（已有 metrics）

## 约束
- 改完 docker compose up -d --build app
- 不要引入跨行字符串 bug
