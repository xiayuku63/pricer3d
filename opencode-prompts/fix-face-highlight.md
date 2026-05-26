# 修复：可摆放面标记混乱

## 问题
`matchFacesToGeometry` 通过法向匹配原网格三角形，一个大 ConcaveHull 面匹配出几百个小三角，高亮图层支离破碎。

## 方案：后端返回 ConvexHull 面顶点 + 前端渲染大面

### 后端 — `calculator/orientation.py`
修改 `get_stable_faces()`：每个面增加 `convex_hull_vertices` 字段
- 用 `hull.vertices[hull.faces[face_idx]]` 取实际顶点坐标
- 返回：`{"faces": [{"vertices": [[x,y,z],...], "normal": [...], "area": float}, ...]}`

### 前端 — `viewer.js`
重写 `highlightFaces()`：
- 接收后端返回的 faces 数组（含 vertices）
- 对每个面直接用返回的顶点创建大三角形叠加层
- 不需要 `matchFacesToGeometry`（删除该函数）
- 不需要扫描原网格三角形

### 前端 — `main.js`
- 删除 `matchFacesToGeometry` 函数
- `showPlaceableFaces` 中直接 `highlightFaces(faces)` 传原始数据

### 过滤
维持现有过滤：面积 < 总面积 2% + < 50mm² 的丢弃

改完 docker compose up -d --build app
不要写跨行字符串
