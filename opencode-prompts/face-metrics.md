# 任务：可摆放面增加评估指标

先读 project-context.md 了解项目。

## 目标
点击「显示可摆放面」后，3D 模型高亮灰白面的同时，在方向控制面板下方显示候选面列表，每个面展示三个指标：

1. **接触面积** - 该面放平后与打印平台的接触面积 (mm²)
2. **倾角>45°区域** - 悬垂面占比 (%)
3. **悬垂面积** - 需要支撑的面积 (mm²)

## 实现方案

### 后端 — `calculator/orientation.py`
- 修改 `get_stable_faces()`，对每个候选面调用 `evaluate_orientation()` 计算旋转后的指标
- 返回结果里每个 face 增加 `metrics` 字段（overhang_ratio, base_contact_area, z_height）
- 按综合评分降序排列

### 前端 — `static/js/main.js`
- `highlightFaces` 调用后，在预览面板底部追加候选面列表
- 每个面显示：标签、接触面积、悬垂占比、Z 高度，按评分排序
- 点击列表项 = 点击 3D 对应面，自动旋转

### 约束
- 不增加 API 调用次数（一次 `/api/orientation/faces` 返回所有数据）
- 改完 docker compose up -d --build app
