# 任务：手动选面摆放 + 自学习标记

先读 `opencode-prompts/project-context.md` 了解项目。

## 功能一：手动选面摆放

### 前端 — 预览面板
- 新增「显示可摆放面」按钮，点击后：
  1. 调用后端 API 获取模型的所有可摆放面（稳定平面）
  2. 在 3D 预览中把可摆放面高亮为灰白色，其他面保持原色
  3. 按钮文字变为「选面模式中...」
- 用户点击 3D 模型上的某个灰白面：
  1. 通过 Three.js Raycaster 检测点击的面
  2. 计算该面法向，自动旋转模型使该面朝下（对齐底板）
  3. 退出选面模式，恢复模型原色
- 按钮旁边加「取消」按钮，退出选面模式

### 后端 API — `app/routes_orientation.py` 新增
- `POST /api/orientation/faces` 
  - 接收上传的 STL 文件
  - 返回模型所有稳定面（ConvexHull 面 + 大面）的法向量和顶点索引
  - 响应格式: `{"faces": [{"normal": [x,y,z], "area": 123, "vertices": [[x,y,z],...]}, ...]}`

### viewer.js 新增
- 导出函数 `highlightFaces(faceIndexSets)` — 将指定面着色为灰白色
- 导出函数 `resetFaceColors()` — 恢复原始颜色
- 导出函数 `setupFaceClickHandler(callback)` — 设置面点击回调（Raycaster）

## 功能二：自学习标记

### 前端 — 预览面板
- 在方向控制区底部新增「标记为最优」按钮
- 点击后将当前 Euler 角 + 模型特征 POST 到 `/api/orientation/train`
- 显示「已标记」反馈

### 后端 — `app/routes_orientation.py` 新增
- `POST /api/orientation/train`
  - 接收 file + euler 角 (x, y, z)
  - 计算模型特征（悬垂比、Z高、接触面积等）
  - 追加到 `data/training_samples.jsonl`

## 约束
- 不要改动报价核心逻辑
- 改完 `docker compose up -d --build app`
