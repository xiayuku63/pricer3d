# 修复：可摆放面错位 + 复杂模型无面 + 加坐标系

先读 project-context.md。

## 问题
1. 复杂模型完全检测不出可摆放面
2. 简单模型高亮面与 3D 模型位置错位
3. 需要加 XYZ 坐标轴参考

## 根因分析
- 错位：STLLoader 加载后 `geometry.center()` 把模型归中，但后端 ConvexHull 顶点是原始坐标 → 偏移
- 复杂模型无面：后端可能计算超时或返回空

## 修复

### viewer.js — 错位修复
- `highlightFaces(faces)` 接收 faces 时，用 `currentMesh.geometry` 计算偏移量
- 偏移 = 原始质心（从顶点算） - currentMesh 位置
- 每个面顶点减去这个偏移，使高亮层与模型对齐

### viewer.js — 加坐标系
- 调用 THREE.AxesHelper(50) 在场景原点显示红绿蓝 XYZ 轴
- 放在 `initViewer` 中初始化

### 后端 — 复杂模型无面
- `get_stable_faces` 增加兜底：ConvexHull 失败或面太少时，退回到 Fibonacci 球面采样
- 增加超时保护或面数上限

改完 docker compose up -d --build app
不要跨行字符串
