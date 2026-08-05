# 手动摆放调研与最优方案

> 分支：`codex/manual-placement-research`
> 调研日期：2026-08-04
> 范围：Lay on Face / 手动选择可放置面、可放置面高亮、面拾取、放置解算与性能。

## 1. 结论先行

在当前项目的约束下（FastAPI + `trimesh` 后端、Three.js 原生 ES modules 前端、用户选择一个面后将模型放到打印底板），最优解不是继续优化现有的“全模型共面聚类 + 每个候选逐个射线安全检查 + 前端椭圆标记”，而是采用一个**凸包驱动、缓存的手动摆放 profile**：

1. **候选面计算改为凸包驱动**：能接触无限平面打印底板的平面必然是模型凸包的支撑平面。先在 `mesh.convex_hull` 上做相邻三角面共面聚类，避免先扫描所有原始三角面再做昂贵的内部面过滤。
2. **候选面与真实模型面分离**：凸包只负责确定“哪些平面可能放到底板上”；高亮仍映射回原始模型中共面的真实三角面/连通块，避免把凹槽、孔洞或两个分离接触区之间的空白区域错误涂满。
3. **一次生成、按模型缓存**：以规范化模型的 SHA-256、分析版本和规范化版本组成缓存键。预览、手动摆放、自动摆放复用同一个规范化网格与几何 profile，手动模式重复进入不再重新上传和重新解算。
4. **前端使用真实接触区域的单一 overlay 几何**：不再把椭圆作为点击目标；用一个 indexed `BufferGeometry` 承载所有候选三角面，通过三角形到 `clusterId` 的映射完成 hover/click。椭圆可以保留为低成本的候选提示，但不能作为精确的可放置面视觉或拾取区域。
5. **拾取采用“模型一次射线 + cluster 映射”，复杂模型启用 BVH**：STL/规范化 STL 路径优先从模型 `faceIndex` 直接映射到候选 cluster；3MF 多实体场景保留 overlay 拾取。加入 `three-mesh-bvh`，对模型只构建一次 BVH，并用 `firstHitOnly`/加速 `raycast`；hover 事件只在 `requestAnimationFrame` 中合并处理。
6. **放置解算以“选中平面接触”为真值**：旋转后先让选中平面落到 `Z=0`，检查模型是否有其他顶点低于该平面；若有，则将候选标为“不能无碰撞地严格贴合”，而不是静默用全模型 `Box3.min.z` 把另一处凸起放到底板上。

这套方案同时解决了三个核心问题：高亮准确、解算可扩展、交互延迟稳定。它也与 PrusaSlicer/OrcaSlicer 的核心思路一致：先取凸包，再在凸包上按相邻且共面的三角面聚类、按面积筛选和排序、为候选面单独建立拾取几何。

---

## 2. 当前实现审计

### 2.1 后端流程

当前手动摆放入口为：

- `app/routes_orientation.py`：`POST /api/orientation/coplanar`
- `calculator/orientation.py`：统一加载/规范化模型
- `calculator/orientation_cluster.py`：`cluster_coplanar_faces(mesh, include_upward_faces=True)`

当前流程大致为：

```text
浏览器每次进入手动模式
  -> 重新上传原始文件
  -> normalize_model()
  -> trimesh.load()
  -> 扫描全部原始三角面
  -> 建立原始面邻接图
  -> 全局共面 merge
  -> 计算 convex_hull
  -> 对每个 cluster 做凸包匹配
  -> contains / 单向 ray / 双向 ray / nearest-on-surface 安全检查
  -> 对所有 cluster 生成 outline 和 face_vertices
  -> 最后才按面积截断返回
```

问题：

- **每次手动模式都重复规范化和上传**：当前 `static/js/modules/preview-cache.js` 只缓存预览转换请求，没有缓存 `/api/orientation/coplanar`。
- **候选来源过宽**：先按原始网格聚类，再用凸包过滤。对于高面数曲面，会产生大量中间 cluster。
- **全局 merge 有潜在 O(K²)**：`_merge_planar_clusters_internal()` 的第二轮会比较所有 cluster 对。曲面模型中 K 接近三角面数时，这部分会迅速变慢。
- **逐候选安全检查重复构建/查询空间结构**：`contains()`、`mesh.ray.intersects_location()` 和 `conv_hull.nearest.on_surface()` 被放在候选循环中。
- **先为全部候选生成输出，再截断**：`cluster_coplanar_faces()` 末尾才 `result[:MAX_RETURN_CLUSTERS]`，意味着被丢弃的 cluster 也已经付出了 outline、顶点清洗和部分几何计算成本。
- **响应体重复传输三角顶点**：`face_vertices = vertices[faces[cf]].reshape(-1, 3)` 会重复发送共享顶点；同时还发送 outline `vertices`。

### 2.2 前端高亮/拾取流程

相关文件：

- `static/js/modules/layface.js`
- `static/js/modules/orientation-ui.js`
- `static/js/modules/viewer/mesh.js`
- `static/js/modules/viewer/scene.js`

当前行为：

- `renderClusters()` 为每个 cluster 创建椭圆 triangle fan、outline 和 Sprite label。
- `intersectClusters()` 先射线检测 overlay，再遍历 occluder 的 descendants 收集真实 Mesh，之后再次射线检测模型以判断遮挡。
- `orientation-ui.js` 在每个 `mousemove` 事件中立即做 hover 射线检测，没有 rAF 合帧。
- 普通 face highlight 路径在 `viewer/mesh.js` 中按 polygon fan 创建多个独立 `Mesh`，每个三角形独立 Geometry/Material。

问题：

- 椭圆不是实际面边界：对细长、凹形、有孔或多个不相连区域的面，视觉和点击范围都可能不准确。
- overlay 数量和 draw call 随候选/三角数增长；每个三角形独立对象的管理和 dispose 成本高。
- hover 每次都做两套相交测试，并重复 `traverse()` 收集遮挡 Mesh。
- 当前候选的 `face_vertices` 已足够做 overlay，但前端没有使用后端已有的真实 `vertices` outline 来构造精确区域。
- 对非 STL/3MF 场景，浏览器渲染网格与后端规范化网格的面索引可能不一致，不能无条件依赖 `faceIndex` 映射；需要保留 overlay fallback。

### 2.3 本地基线测量

在当前代码、不改实现的情况下，用合成网格测量 `cluster_coplanar_faces()`：

| 模型 | 顶点 | 三角面 | 候选数 | 冷启动耗时 |
|---|---:|---:|---:|---:|
| box | 8 | 12 | 6 | 25.5 ms |
| icosphere subdivision=3 | 642 | 1,280 | 64 | 4,912.5 ms |
| icosphere subdivision=4 | 2,562 | 5,120 | 64 | 8,823.7 ms |
| cylinder sections=512 | 1,026 | 2,048 | 64 | 382.1 ms |

这是本机 Python 运行的相对基线，不是线上 SLO，但足以证明当前算法在曲面/高面数模型上存在明显退化。

对 subdivision=3 的 cProfile 显示主要成本集中在：

- `cluster_coplanar_faces()` 内部过滤循环约 3.75 s；
- 多次 `mesh.ray.intersects_location()` 约 2.17 s；
- `_merge_planar_clusters_internal()` 约 2.14 s；
- `_extract_cluster_outline_p3d()` 约 1.04 s。

因此只做前端优化不能解决主要问题；必须先改候选面算法和缓存边界。

---

## 3. 一手资料与可复用结论

### 3.1 Three.js 官方拾取模型

- [Three.js Raycaster API](https://threejs.org/docs/pages/Raycaster.html)：标准拾取依赖 `Raycaster.intersectObject(s)`，返回结果含 `object`、距离和三角形相关的 `faceIndex`；这支持“模型一次拾取后通过三角形索引查 cluster”的设计。
- [Three.js Picking 手册](https://threejs.org/manual/en/picking.html)：拾取应在指针事件中更新射线，命中后更新交互状态；适合在现有 on-demand renderer 上继续使用“只有 hover/selection 变化时才 requestRender”。
- [Three.js Rendering on Demand](https://threejs.org/manual/en/rendering-on-demand.html)：当前项目已经采用按需渲染；hover 合帧后只在命中 cluster 改变时触发渲染，避免为了高亮保持全速渲染。

### 3.2 three-mesh-bvh

- [three-mesh-bvh 官方仓库](https://github.com/gkjohnson/three-mesh-bvh)：提供 `computeBoundsTree`、`acceleratedRaycast`、`firstHitOnly`、`shapecast` 等能力；支持 indexed 和 non-indexed `BufferGeometry`，但会在构建时生成/保留 index。
- 适合本项目的方式是：模型几何加载完成后构建一次 BVH；模型只旋转/平移时 BVH 不需要重建，因为几何顶点未变；hover 使用 first-hit，选中使用同一条路径。
- 项目现有 STL loader 产生 non-indexed geometry；因此应在加载完成后统一转换/构建 indexed geometry，并保存“渲染三角形索引 ↔ 规范化 mesh face index”的映射，不能只依赖 Three.js 的默认三角序号。

### 3.3 PrusaSlicer / OrcaSlicer 一手实现

- [PrusaSlicer `GLGizmoFlatten.hpp`](https://github.com/prusa3d/PrusaSlicer/blob/master/src/slic3r/GUI/Gizmos/GLGizmoFlatten.hpp)
- [PrusaSlicer `GLGizmoFlatten.cpp`](https://github.com/prusa3d/PrusaSlicer/blob/master/src/slic3r/GUI/Gizmos/GLGizmoFlatten.cpp)
- [OrcaSlicer `GLGizmoFlatten.cpp`](https://github.com/SoftFever/OrcaSlicer/blob/main/src/slic3r/GUI/Gizmos/GLGizmoFlatten.cpp)

两者采用的关键步骤高度一致：

1. 对模型取 3D convex hull；
2. 在凸包三角面上做相邻 BFS，同法向量的面合并为一个平面；
3. 将每个平面变换到平面坐标系；
4. 用 2D convex hull 去掉内部点，计算面积，过滤过小面；
5. 按面积排序并限制候选数；
6. 为候选面建立独立的 VBO / raycaster；hover 只切换候选面的颜色；点击后使用候选法向量执行 flattening rotate。

PrusaSlicer 源码还明确使用了候选上限（源码中为 254，受 picking pass 限制）。本项目不需要照搬 254，建议默认返回 16～32 个手动候选，按需通过“显示更多”加载其余候选。

### 3.4 trimesh

- [trimesh ray documentation](https://trimesh.org/ray.html)
- [trimesh convex hull documentation](https://trimesh.org/trimesh.convex.html)

当前项目已经使用 `mesh.convex_hull`、`mesh.ray` 和 `conv_hull.nearest.on_surface()`。调研结论不是“增加更多射线检查”，而是把射线检查从主路径移到异常/校验路径：对交互式候选面，凸包支撑平面本身已经提供了更强的候选约束；只有在模型非 watertight、凸包失败或选中面与源网格映射不一致时才降级做安全检查。

---

## 4. 最优方案设计

### 4.1 后端：Placement Profile

建议新增一个与预览缓存同级的“手动摆放 profile”概念，而不是让 UI 每次重新 POST 原始文件：

```text
source bytes
  -> sha256(source bytes)
  -> normalize_model()                 # 只做一次
  -> canonical mesh cache              # 规范化 STL/mesh
  -> placement profile cache
       - convex hull
       - hull supporting planes
       - source face -> plane/cluster mapping
       - compact highlight geometry
       - placement metrics
```

缓存键：

```text
sha256(source bytes)
+ model_normalization_version
+ placement_algorithm_version
+ tolerance_profile
```

不能只使用 `filename:size`，因为同名同大小文件可能内容不同。

建议 API 形态：

```http
POST /api/orientation/profile
Content-Type: multipart/form-data

-> {
  "profile_id": "...",
  "model_hash": "...",
  "analysis_version": "manual-v2",
  "clusters": [...]
}
```

或者更小的改动：保留 `/api/orientation/coplanar`，但让它接收已有的 `profile_id`；没有 profile 时才接收文件并创建缓存。客户端沿用 `preview-cache.js` 的 Promise Map，确保同一文件并发只发一个请求。

缓存策略：

- 内存 LRU：最近 N 个 profile，限制总顶点/三角形字节数；
- 磁盘短期缓存：按 hash 分目录，记录 schema/version；
- 缓存失效：规范化版本、容差、算法版本变更时自动失效；
- 响应只返回手动模式所需的紧凑 profile，不返回完整重复源文件。

### 4.2 候选面解算：凸包驱动 + 原始面回映射

#### Step A：在凸包上产生支撑平面

复用并扩展现有 `get_convex_hull_candidate_planes()`：

1. `hull = mesh.convex_hull`；
2. 计算 hull 三角面 normals/plane offsets/areas；
3. 用 edge adjacency + quantized plane key 或 BFS 聚类同一支撑平面；
4. 用面积排序；
5. 只保留前 K 个候选平面（建议 K=32，UI 默认展示前 12～16）。

为什么这是正确的：如果一个平面能在不穿透模型的情况下接触无限平面打印底板，它必须是模型的支撑平面；支撑平面属于模型凸包的支撑面。当前代码已存在这条思路的 `get_convex_hull_candidate_planes()`，但手动流程仍走了完整原始面聚类和逐候选安全检查。

#### Step B：将 hull 平面映射回源 mesh

对于每个 hull plane，向量化筛选源 mesh 三角面：

```python
normal_match = abs(face_normals @ plane_normal) >= cos_tol
plane_match = abs(face_plane_offsets_aligned - plane_offset) <= plane_tol
mask = normal_match & plane_match
```

再按 face adjacency 将 mask 内的三角面拆成连通 patch。返回：

- `cluster_id`
- `support_normal`
- `plane_offset`
- `area`
- `patches[]`
- `render_triangles`
- `outline_loops`
- `z_clearance_after_flatten`
- `stability_score`

不再对每个 cluster 调用四套内部面安全检查。只有以下情况进入降级检查：

- convex hull 失败；
- mesh 非 watertight 且源面映射出现歧义；
- plane offset 在容差边界；
- 选中后检测到模型低于选中平面。

#### Step C：避免 O(K²) global merge

将 `_merge_planar_clusters_internal()` 的全局两两比较改为 plane key 分桶：

```text
key = (round(abs-normal components / angular_bin), round(offset / offset_bin))
```

同桶内再做精确验证。相邻连接仍用 adjacency/Union-Find。这样不会在高面数曲面中把所有 cluster 两两比较。

#### Step D：只对保留候选生成昂贵输出

候选应先按 area/stability/risk 排序并截断，再生成 outline 和 JSON 序列化数据。当前逻辑在返回 `MAX_RETURN_CLUSTERS` 之前已经处理全部 cluster，应调整顺序。

### 4.3 返回数据：去重、可精确渲染

建议 profile schema：

```json
{
  "profile_id": "sha256:...",
  "coordinate_frame": "canonical_mesh",
  "vertices": [[x, y, z], "..."],
  "clusters": [
    {
      "id": 0,
      "normal": [nx, ny, nz],
      "area_mm2": 123.4,
      "stability": 0.91,
      "face_indices": [12, 13, 18],
      "patches": [
        {
          "triangle_indices": [[0, 1, 2], [0, 2, 3]],
          "outline_indices": [0, 1, 4, 3]
        }
      ],
      "strict_contact": true,
      "clearance_mm": 0.0
    }
  ]
}
```

实现时可以进一步压缩：

- `vertices` 使用一个共享 pool；
- triangles 使用整型索引；
- cluster 只保存 triangle range/offset；
- outline 使用索引，不重复发坐标；
- 对较大的模型可返回 gzip/brotli JSON，或直接返回 binary buffer。

不要把 `face_vertices` 作为唯一格式；它适合快速接入，但不适合高面数模型和精确点击。

### 4.4 前端高亮：真实区域、少对象、可访问

#### 推荐视觉层级

- 默认候选：低饱和青色/蓝色，opacity 0.18～0.28；
- hover 候选：提高 opacity、加亮边界，opacity 0.55～0.75；
- selected：保持高亮，显示“已选择” badge；
- 非当前视角可见候选：降低 opacity 或暂不显示；
- 只给 top 8～12 个候选显示文字标签，避免 Sprite 堆积；其余通过右侧列表展示。

#### Geometry 方案

优先使用一个 indexed `BufferGeometry`：

```text
all candidate triangles
  -> one position/index buffer
  -> one material with vertex colors
  -> triangleIndexToClusterId[]
  -> clusterId -> triangle ranges
```

hover 时只更新受影响顶点的 color/opacity 属性，不创建/销毁 Mesh。若需要每 cluster 独立材质，可用少量 geometry groups，但不要“每个三角一个 Mesh”。

实际区域建议直接来自 source mesh 的 supporting-plane patches。凸包 polygon 可作为 outline/简化提示，但不能单独代替真实三角区域，否则孔洞和不相连接触区会被填平。

#### 深度与闪烁

- `depthTest=true`，`depthWrite=false`；
- 沿 plane normal 做很小的 epsilon 偏移；
- 只在共面候选上绘制，不通过整模型后处理做全屏色彩覆盖；
- outline 与 fill 使用同一套 candidate geometry 的 metadata，避免视觉与点击区域分叉。

#### 遮挡

如果 overlay 与模型使用同一 canonical mesh，可直接通过模型 `faceIndex`/cluster 映射完成前侧拾取，不需要第二次 occluder raycast。

如果必须使用 overlay raycast：

- 缓存 occluder mesh 列表，禁止每次 hover `traverse()`；
- overlay 只设置一组 raycastable objects；
- 使用 BVH first-hit；
- 对隐藏/背面候选通过深度结果或 `dot(normal, viewDirection)` 快速剔除。

### 4.5 拾取与 hover 性能

1. 页面加载完成后构建一次模型 BVH；
2. `mousemove` 只记录最后一个指针坐标；
3. 用一个 rAF 处理 hover，上一帧未处理完则合并；
4. 命中结果与上次 `clusterId` 相同则不更新材质、不触发 render；
5. pointerleave 清除 hover；
6. click 复用同一套 pick 结果，不再重复进行两次 raycast；
7. 触摸端使用 tap/click，不绑定高频 hover。

伪代码：

```js
let pendingPointer = null;
let hoverFrame = 0;

function onPointerMove(event) {
  pendingPointer = { x: event.clientX, y: event.clientY };
  if (hoverFrame === 0) hoverFrame = requestAnimationFrame(flushHover);
}

function flushHover() {
  hoverFrame = 0;
  if (!pendingPointer) return;
  const point = pendingPointer;
  pendingPointer = null;
  const hit = pickPlacementCluster(point); // BVH or exact overlay
  if (hit.clusterId !== hoveredClusterId) {
    updateClusterColor(hoveredClusterId, false);
    updateClusterColor(hit.clusterId, true);
    hoveredClusterId = hit.clusterId;
    requestRender();
  }
}
```

### 4.6 放置解算：严格接触 + 可解释降级

点击 cluster 后：

1. 取 `support_normal`，不要重新从屏幕命中点推断法向；
2. 计算“最小旋转”四元数，将支持面法向转为打印床的向下方向；
3. 绕床法向保留当前 yaw，或使用确定性 roll（例如把当前模型 +X 投影到床面）；避免每次点击出现不可预测的自转；
4. 更新 world matrix；
5. 计算选中 plane 的 world-space `z`，将它平移到 `Z=0`；
6. 计算模型所有顶点的 `minZ`：
   - `minZ >= -epsilon`：严格贴合成功；
   - `minZ < -epsilon`：模型其他区域会穿床，返回 `strict_contact=false`，UI 提示“该面不能无碰撞地作为最低接触面”，或明确执行安全降级到整体 `minZ=0`；
7. XY 居中；
8. 一次 `fitCameraToMesh()`；
9. 将 draft orientation 写回现有 orientation draft，只有用户确认/保存时提交 quote state。

这比当前 `placeFaceOnBed()` 仅通过“两个法向方向 + 全局 Box3.min.z”选择结果更可解释。当前的 bbox settle 可以保留作为兼容 fallback，但要把“选中面是否真的接触床面”暴露给 UI。

---

## 5. 方案对比

| 方案 | 高亮准确性 | 冷启动 | 重复进入 | 实现复杂度 | 结论 |
|---|---|---:|---:|---:|---|
| 继续优化当前 full-mesh pipeline | 中 | 差 | 差 | 低 | 不推荐，瓶颈仍在候选生成 |
| 纯前端根据渲染 mesh 自己聚类 | 高（同源时） | 好 | 好 | 高 | 3MF/STEP 同源和拓扑映射复杂，不作为主方案 |
| 只返回凸包 polygon/椭圆 | 中/低 | 好 | 好 | 低 | 视觉简单，但孔洞/分离 patch 会误高亮 |
| **凸包候选 + 源面回映射 + profile 缓存 + 精确 overlay/BVH** | **高** | **好** | **极好** | 中 | **推荐** |

推荐的核心取舍是：

- **后端负责“哪些平面合法”**，利用凸包的几何正确性；
- **前端负责“真实区域怎么显示/拾取”**，利用共享索引几何；
- **profile 缓存负责“只算一次”**，避免把交互延迟绑定到文件上传和 STEP/OBJ 规范化。

---

## 6. 分阶段落地计划

### P0???????????????

1. ? BFS ? `list.pop(0)` ?? `collections.deque.popleft()`?
2. ?? client-side `placementProfileRequests` Promise cache????? session ?????
3. ? `cluster_coplanar_faces()` ???????????/????? outline ????
4. ? `_merge_planar_clusters_internal()` ?? plane key ??????? O(K?) ?????
5. ????????????????????????? contains/ray/proximity ??????? fallback?
6. ?? `occluderMeshes`?hover ?? rAF ???
7. ????????????cluster ????????

???

- subdivision=3/4 ????????????? 4.9/8.8 s?
- ?????????????????????
- hover ??????????????
- ???????????????

#### P0 ?????2026-08-04?

P0 ???????????

- ?? BFS ?? deque?
- ???? merge ?? normal/offset ?????????
- ?????????????????? cluster ???????
- ??? outline/JSON ????? `MAX_RETURN_CLUSTERS`?
- `/api/orientation/coplanar` ?? load/cluster ????????
- ????????????? Promise???????????????
- hover ?? `requestAnimationFrame` ???????? Mesh ???

????????????????????

| ?? | P0 ? | P0 ? | ?? |
|---|---:|---:|---:|
| box?12 faces? | 25.5 ms | 7.9 ms | 3.2? |
| icosphere subdivision=3?1,280 faces? | 4,912.5 ms | 202.0 ms | 24.3? |
| icosphere subdivision=4?5,120 faces? | 8,823.7 ms | 516.8 ms | 17.1? |
| cylinder 512 sections?2,048 faces? | 382.1 ms | 119.6 ms | 3.2? |

?????????????????????P1 ???????????????????? overlay geometry?

### P1：正确的可放置面高亮

1. profile 返回 shared vertex pool + triangle indices + outline loops。
2. `layface.js` 用一个 indexed `BufferGeometry` 替代每 cluster 椭圆作为主点击区域。
3. 支持多个 disconnected patches；每个 patch 可共用同一个 cluster 的法向和放置动作。
4. top-N 标签和侧边列表，避免 64 个 Sprite 同时占满视图。
5. 对 hole/concave 面增加回归 fixture，确认高亮不填洞、不覆盖空白。

### P2：BVH 与严格接触语义

1. 引入并本地 vendor/构建 `three-mesh-bvh`，避免线上 CDN 依赖。
2. 统一 indexed canonical geometry 和 face mapping。
3. hover/click 使用模型 BVH first-hit；3MF 场景用 overlay fallback。
4. `placeFaceOnBed()` 返回严格接触状态、穿床深度和最终姿态。
5. UI 区分“严格选中面接触”和“为保证不穿床而整体落床”的 fallback。

---

## 7. 建议的测试矩阵

### 几何正确性

- 立方体：6 个候选面，面积一致；
- 反向 winding：候选面数量和法向方向不受 winding 影响；
- 单个大三角面：仍然可选；
- 凹槽/孔洞：内部面不高亮，孔洞不被 overlay 填充；
- 两个分离但共面的接触 patch：同一 plane 下显示两个 patch，点击任意 patch 使用同一 cluster；
- 曲面模型：候选来自凸包支撑平面，不出现内部曲面三角面候选；
- 3MF 多实体：实体遮挡、实体坐标和 overlay 映射正确；
- STEP/OBJ：规范化后 profile 与预览坐标系一致。

### 性能与交互

建议建立固定 fixture，并记录：

| 指标 | 目标 |
|---|---:|
| 缓存命中 profile 获取 | < 50 ms |
| 5k 三角面手动候选冷启动 | < 300 ms |
| 50k 三角面手动候选冷启动 | < 1 s（允许后台预计算） |
| hover 主线程 pick | < 2 ms |
| hover 连续指针事件 | 不超过 1 次/rAF |
| click 到姿态更新 | < 100 ms（不含相机动画） |
| 手动模式重复进入 | 0 次重复模型分析请求 |

这些是落地目标，不是当前系统已达到的指标；正式实现后应在 CI 或本地性能脚本中记录 P50/P95。

---

## 8. 不建议的方向

1. **继续增加每个候选的 ray/contains 检查**：当前 profile 已证明这会把几何安全性变成主要延迟来源。
2. **把椭圆做得更大/更亮来“模拟”可放置面**：这会改善可见性，但不会改善几何正确性，反而扩大误点击区域。
3. **每个三角面创建一个 Mesh 和 Material**：短期易写，长期会增加 draw call、GC 和 dispose 复杂度。
4. **只在前端按当前 GLB 的面索引解释后端 face index**：STL/规范化 STL/3MF 的拓扑来源不同，必须带 mapping 或使用 overlay fallback。
5. **把全局 `Box3.min.z=0` 当作选中面接触的唯一证明**：它只能证明某个模型点落在床上，不能证明用户选择的 plane 真的接触床面。

---

## 9. 关键文件映射

| 主题 | 当前文件 | 推荐改动 |
|---|---|---|
| 手动 API | `app/routes_orientation.py` | 增加 profile/cache/idempotent path |
| 模型规范化 | `parser/model_pipeline.py` | 共享 canonical mesh cache |
| 候选解算 | `calculator/orientation_cluster.py` | convex-hull-first、分桶 merge、延后 outline |
| 旋转/贴床 | `static/js/modules/layface.js` | strict contact、稳定 roll、返回 placement result |
| overlay/pick | `static/js/modules/layface.js` | single indexed geometry、cluster map、BVH/fallback |
| hover | `static/js/modules/orientation-ui.js` | rAF 合帧、缓存 occluder、复用 pick 结果 |
| 模型几何 | `static/js/modules/viewer/mesh.js` | indexed canonical geometry、BVH 初始化、face mapping |
| 请求缓存 | `static/js/modules/preview-cache.js` | 增加 placement profile Promise cache |
| 回归测试 | `tests/`、`tests_js/` | 凹槽、孔洞、分离 patch、3MF、多面数性能 fixture |

---

## 10. 最终建议

先做 **P0 + P1**，不要一开始就把所有自由移动/碰撞检测都引入。对本项目当前“点击一个可放置面并自动放到底板”的工作流，**凸包驱动候选面 + 源面精确高亮 + profile 缓存**是收益最大、风险最低、也最接近成熟切片器实现的组合。

P2 的 BVH 与严格接触语义随后加入，用来把高面数模型和复杂 3MF 场景的交互延迟稳定下来。若未来要支持用户在热床上拖动模型、检测多个模型之间的碰撞，再另外引入 bed-plane spatial index / broad-phase，不应与当前 Lay on Face 候选面问题混为一个算法。

---

## 11. P1 implementation status (2026-08-05)

Implemented after visual comparison with Bambu Studio's public `GLGizmoFlatten` implementation:

- Removed ellipse markers and all per-candidate letter sprites.
- Render source candidate triangles directly, preserving concave regions, holes, and disconnected coplanar patches.
- Merge all fills into one indexed `BufferGeometry` and all contours into one `LineSegments` object.
- Map Three.js `faceIndex` back to `clusterId` in O(1) for hover and click picking.
- Use pale translucent fills and white contours, with a brighter hover state.
- Keep model-first occlusion checks so invisible back-side candidates cannot be clicked.

Still deferred to later work:

- Compact server response with a shared vertex/index pool instead of duplicated `face_vertices` JSON.
- Reliable source-topology mapping for every multi-entity 3MF path.
- BVH acceleration for very high triangle-count browser picking.
