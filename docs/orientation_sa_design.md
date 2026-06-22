# pricer3d 朝向优化模块：模拟退火 + Shapely 重构方案

> 版本: v1.0 | 日期: 2026-06-21 | 作者: 架构组

---

## 1. 背景与动机

### 1.1 现状

当前朝向优化 (`calculator/orientation.py`) 采用「共面聚类 → 逐面打分 → 贪心选最佳面」的离散搜索：

```
model_path
  → cluster_coplanar_faces(mesh)       # 聚类共面三角形
  → for each cluster: evaluate_orientation()  # 逐一评分
  → candidates.sort(score, reverse=True)
  → candidates[0]                       # 贪心取最高分
  → fine_tune_orientation()             # Z轴微调±30°
  → apply_orientation_to_mesh()         # 导出STL
```

评分维度：支撑体积 (50%) + 打印时间 (30%) + 热床附着力 (20%)。

### 1.2 问题

| 问题 | 根因 | 影响 |
|------|------|------|
| 镜像件不对称 | 镜像模型的 XY 面法向互换，独立评分选到不同朝向 | 一对 XY 对称件打印方向不一致 |
| 非全局最优 | 贪心只在离散候选面中选择，无法探索面间连续旋转 | 可能错过更优的非共面朝向 |
| 缺少 2D 几何约束 | 评分只计面附着力(contact_area)，未分析热床投影的凸包形状、最小包围矩形 | 细长件可能以不稳定姿态放置 |

### 1.3 目标

用 **模拟退火 (SA) + Shapely** 替换现有贪心搜索，在 SO(3) 连续旋转空间中全局寻优，同时保持 `get_best_face_for_slicing()` 返回格式完全兼容。

---

## 2. 新增模块：`calculator/orientation_sa.py`

### 2.1 模块职责

- 提供 `SimulatedAnnealingOptimizer` 类，封装 SA 搜索逻辑
- 提供便捷函数 `optimize_orientation_sa(mesh) -> dict`，作为 drop-in 替代
- 集成 Shapely 进行 2D 热床投影稳定性分析

### 2.2 类结构

```
calculator/orientation_sa.py
├── class SAConfig              # 退火参数配置
│   ├── T_init: float           # 初始温度 (默认 1.0)
│   ├── T_min: float            # 终止温度 (默认 1e-3)
│   ├── cooling_rate: float     # 冷却速率 (默认 0.95)
│   ├── max_iter: int           # 最大迭代 (默认 800)
│   ├── neighbor_std: float     # 邻域扰动标准差 (默认 0.3 rad ≈ 17°)
│   └── random_seed: int|None
│
├── class SACostWeights         # 代价函数权重
│   ├── w_support: float        # 支撑体积权重 (默认 0.40)
│   ├── w_time: float           # 打印时间权重 (默认 0.25)
│   ├── w_stability: float      # 热床稳定性权重 (默认 0.35)
│   └── (附加力不再单独计权，并入 stability)
│
├── class BedStabilityAnalyzer  # Shapely 2D 投影分析 (可独立使用)
│   ├── __init__(mesh, R)       # 接受mesh+旋转矩阵
│   ├── bottom_vertices() → np.ndarray        # 提取底部顶点 (Z < z_min + ε)
│   ├── project_to_xy(verts) → np.ndarray     # 投影到XY平面
│   ├── convex_hull_area() → float            # Shapely 凸包面积
│   ├── min_bounding_rect() → (area, width, height, angle)  # 最小包围矩形
│   ├── stability_score() → float             # 稳定性评分 (0~1)
│   └── footprint_stats() → dict              # 完整足迹统计
│
├── class SimulatedAnnealingOptimizer
│   ├── __init__(mesh, config, weights)
│   ├── cost_function(R) → float              # ★ 代价函数
│   ├── neighbor(R, temperature) → np.ndarray # ★ 邻域生成
│   ├── acceptance_prob(delta_cost, T) → float
│   ├── optimize(R_init=None) → SAResult      # ★ 主入口
│   └── _cost_detail(R) → dict               # 代价分解（调试用）
│
├── class SAResult                             # 优化结果
│   ├── R_opt: np.ndarray         # 最优旋转矩阵 3×3
│   ├── cost: float               # 最优代价
│   ├── cost_components: dict     # 代价分解
│   ├── history: list[dict]       # 收敛历史 (迭代, 温度, 代价)
│   ├── euler_angles_deg: dict    # 欧拉角
│   └── metrics: dict             # 详细指标 (兼容现有格式)
│
└── 便捷函数
    optimize_orientation_sa(mesh, **kwargs) → dict  # 一键优化，兼容现有返回格式
```

### 2.3 接口契约

```python
# 主入口 — 与现有 get_best_face_for_slicing() 同签名
def optimize_orientation_sa(
    model_path: str,
    *,
    sa_config: Optional[SAConfig] = None,
    weights: Optional[SACostWeights] = None,
    use_coplanar_init: bool = True,   # 是否用共面聚类初始化
) -> dict:
    """
    Returns (兼容现有格式):
    {
        oriented_path: str,
        original_path: str,
        rotation_matrix: [[float;3];3],
        euler_angles_deg: {x, y, z},
        score: float,                 # 归一化得分 (0~100)
        cost: float,                  # SA 原始代价
        sa_history: [...],            # 收敛历史
        face: {...} | None,           # 当选中的是共面簇时有值
        tune_report: str,
        all_candidates: [...],        # (兼容字段，SA 下为空或单一最佳)
    }
    """
```

---

## 3. 代价函数设计

### 3.1 公式

```
Cost(R) = w_support · S(R) + w_time · T(R) + w_stability · (1 − B(R))
```

| 符号 | 含义 | 归一化方式 |
|------|------|-----------|
| `S(R)` | 支撑体积归一化值 | `support_volume / (bounding_sphere_volume × 0.5)`，截断到 [0, 1] |
| `T(R)` | 打印时间归一化值 | `z_height / max_model_dim`，截断到 [0, 1] |
| `B(R)` | 热床稳定性 (0~1) | Shapely 计算，见 §3.2 |

其中支撑体积沿用现有 `_score_orientation_3x3` 的算法（overhang_face_area × height × 0.3），不重复造轮子。

### 3.2 热床稳定性 B(R) — Shapely 计算流程

```
1. 提取底部点集
   rotated_verts = mesh.vertices @ R.T
   z_min = rotated_verts[:,2].min()
   bottom_mask = rotated_verts[:,2] < z_min + ε     # ε = max(0.05, z_range * 0.005)
   bottom_pts_2d = rotated_verts[bottom_mask][:, :2]

2. 构建 Shapely 对象
   from shapely.geometry import MultiPoint
   from shapely import convex_hull
   pts = MultiPoint(bottom_pts_2d)
   hull = convex_hull(pts)              # Polygon

3. 计算指标
   hull_area = hull.area
   min_rect = hull.minimum_rotated_rectangle  # 最小包围矩形 Polygon
   rect_area = min_rect.area
   rect_w, rect_h = 排序后的矩形宽高 (rect_w ≥ rect_h)  # 通过坐标差估算
   aspect_ratio = rect_w / max(rect_h, 1e-9)

4. 稳定性评分
   area_ratio = hull_area / max(rect_area, 1e-9)
   # 凸包越接近最小包围矩形 → 越稳
   compactness = min(1.0, area_ratio)

   # 细长惩罚：宽高比越大越不稳
   slenderness_penalty = 1.0 / max(1.0, aspect_ratio / 3.0)

   B(R) = compactness × 0.6 + slenderness_penalty × 0.4
```

**Shapely 依赖**：`shapely>=2.0`，仅需 `geometry.MultiPoint` 和 `convex_hull`，不引入 GEOS 高级功能。

### 3.3 与现有一致性

代价函数内部复用 `orientation_scoring._score_orientation_3x3` 获取 `support_volume` 和 `overhang_ratio`，确保数值口径一致：

```python
def cost_function(self, R: np.ndarray) -> float:
    metrics = _score_orientation_3x3(self.mesh, R)
    S = min(1.0, metrics["support_volume"] / self._support_norm)
    T = min(1.0, metrics["z_height"] / self._max_dim)
    B = self.bed_analyzer.stability_score()   # 需要同步更新 analyzer 的 R
    cost = (self.weights.w_support * S
          + self.weights.w_time * T
          + self.weights.w_stability * (1.0 - B))
    return cost
```

---

## 4. 模拟退火算法设计

### 4.1 邻域生成 — SO(3) 连续扰动

```python
def neighbor(self, R: np.ndarray, temperature: float) -> np.ndarray:
    """
    在 SO(3) 空间生成邻域旋转。
    扰动幅度随温度降低而减小。
    """
    # 随机旋转轴：单位球面均匀采样
    axis = np.random.randn(3)
    axis /= np.linalg.norm(axis)

    # 随机角度：高斯分布，标准差随温度缩放
    std = self.config.neighbor_std * (temperature / self.config.T_init)
    angle = np.random.normal(0, std)

    # 确保不退化
    angle = np.clip(angle, -np.pi/2, np.pi/2)

    # Rodrigues 公式 compose
    R_perturb = rodrigues_rotation(axis, angle)
    R_new = R_perturb @ R
    return R_new
```

**关键设计决策**：
- 扰动标准差与温度成正比的「自适应步长」，高温时大步探索，低温时精细微调
- 最大扰动角限制在 ±90°，避免完全翻转
- 使用现有 `orientation_math.rodrigues_rotation` 避免重复实现

### 4.2 退火调度

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `T_init` | 1.0 | 初始温度，由初始代价自动校准 |
| `T_min` | 1e-3 | 终止温度 |
| `cooling_rate` | 0.95 | 几何冷却：`T_k = T_init × cooling_rate^k` |
| `max_iter` | 800 | 最大迭代次数 |
| `neighbor_std` | 0.3 | 初始扰动标准差 (~17°) |
| `patience` | 200 | 若连续 N 次无改善，触发提前终止 |

**自动校准 T_init**：
```python
# 采样 50 个随机朝向，计算代价分布
sample_costs = [cost_function(random_rotation()) for _ in range(50)]
cost_std = np.std(sample_costs)
T_init = max(0.1, cost_std * 3)  # 3σ 覆盖
```

### 4.3 主循环伪代码

```
输入: mesh, R_init (可选, 默认从共面聚类最佳面获取)
输出: SAResult

1. 初始化
   if R_init is None:
       R_init = 从 coplanar clusters 中选最优面的旋转
   R_best = R_current = R_init
   cost_best = cost_current = cost_function(R_init)
   T = auto_calibrated_T_init()
   history = []

2. 主循环
   for k in 0..max_iter:
       R_candidate = neighbor(R_current, T)
       cost_candidate = cost_function(R_candidate)

       delta = cost_candidate - cost_current

       if delta < 0:                           # 接受更优解
           R_current = R_candidate
           cost_current = cost_candidate
           if cost_current < cost_best:
               R_best = R_current
               cost_best = cost_current
               no_improve = 0
       elif random() < exp(-delta / T):        # Metropolis 准则
           R_current = R_candidate
           cost_current = cost_candidate
           no_improve += 1
       else:
           no_improve += 1

       history.append({k, T, cost_current, cost_best})

       T = T * cooling_rate

       if T < T_min or no_improve >= patience:
           break

3. 返回
   return SAResult(R_opt=R_best, cost=cost_best, history=history, ...)
```

### 4.4 初始化策略

```python
def _get_init_rotation(self) -> np.ndarray:
    """
    用现有共面聚类结果为 SA 提供优质初始解。
    既加速收敛，又保证不会比现有方案差。
    """
    clusters = cluster_coplanar_faces(self.mesh)
    if not clusters:
        # 从 Fibonacci 采样中选最优
        fib = fibonacci_sphere_sampling(64)
        best_cost = float('inf')
        best_R = np.eye(3)
        for up in fib:
            if up[2] < 0: up = -up
            R = rotation_from_up_vector(up)[:3, :3]
            c = self.cost_function(R)
            if c < best_cost:
                best_cost, best_R = c, R
        return best_R

    # 评估所有共面簇
    best_cost = float('inf')
    best_R = np.eye(3)
    for cluster in clusters:
        normal = np.array(cluster["normal"])
        up = -normal
        up /= np.linalg.norm(up)
        if up[2] < 0: up = -up
        R = rotation_from_up_vector(up)[:3, :3]
        c = self.cost_function(R)
        if c < best_cost:
            best_cost, best_R = c, R
    return best_R
```

---

## 5. Shapely 集成方案

### 5.1 依赖声明

**`requirements.txt` 新增行：**

```
shapely>=2.0,<3.0
```

（Shapely 2.x 是纯 Python 的 PyGEOS-free 版本，安装无需编译 GEOS C 库）

### 5.2 安装验证

```bash
pip install "shapely>=2.0,<3.0"
python -c "from shapely import convex_hull; from shapely.geometry import MultiPoint; print('OK')"
```

### 5.3 降级策略

如果 Shapely 不可用（极少数环境），`BedStabilityAnalyzer` 自动退化为朴素矩形估算：

```python
class BedStabilityAnalyzer:
    def __init__(self, mesh, R):
        self.mesh = mesh
        self.R = R
        self._use_shapely = True
        try:
            from shapely import convex_hull
            from shapely.geometry import MultiPoint
            self._convex_hull_fn = convex_hull
            self._multipoint_cls = MultiPoint
        except ImportError:
            self._use_shapely = False
            logger.warning("Shapely 不可用，降级为朴素XY矩形分析")

    def stability_score(self) -> float:
        if self._use_shapely:
            return self._shapely_stability()
        else:
            return self._naive_stability()

    def _naive_stability(self) -> float:
        """降级方案：XY bounding box 面积比"""
        verts = self.bottom_vertices()
        if len(verts) < 3:
            return 0.3
        x_span = verts[:,0].max() - verts[:,0].min()
        y_span = verts[:,1].max() - verts[:,1].min()
        bbox_area = x_span * y_span
        if bbox_area < 1e-9:
            return 0.5
        return min(1.0, (x_span / max(y_span, 1e-9)) ** 0.5)
```

### 5.4 Shapely 调用点

Shapely 仅在 `BedStabilityAnalyzer` 中使用，不扩散到其他模块：

```
orientation_sa.py
  BedStabilityAnalyzer
    ├── convex_hull( MultiPoint(bottom_2d_pts) )        → Polygon
    ├── hull.minimum_rotated_rectangle                   → Polygon
    ├── hull.area                                        → float
    └── (不调用 buffer / intersects / union 等重型操作)
```

---

## 6. 与现有代码的兼容桥接

### 6.1 `calculator/orientation.py` 改造

```diff
+ from calculator.orientation_sa import optimize_orientation_sa

  def get_best_face_for_slicing(
      model_path: str,
+     method: str = "coplanar",      # "coplanar" | "sa"
+     sa_config: dict | None = None,
  ) -> dict:
+     if method == "sa":
+         return optimize_orientation_sa(model_path, **(sa_config or {}))
+
      # ... 现有代码不变 ...
```

**向后兼容**：默认 `method="coplanar"`，现有调用者零改动。

### 6.2 `calculator/cost.py` 调用点

```python
# 现有调用
from calculator.orientation import get_best_face_for_slicing
orient_result = get_best_face_for_slicing(model_path)

# 切换到 SA 只需改参数
orient_result = get_best_face_for_slicing(model_path, method="sa")
```

### 6.3 返回格式兼容性

| 字段 | coplanar 现有 | SA 新增 | 兼容 |
|------|:---:|:---:|:---:|
| `oriented_path` | ✅ | ✅ | ✅ |
| `original_path` | ✅ | ✅ | ✅ |
| `rotation_matrix` | ✅ | ✅ | ✅ |
| `euler_angles_deg` | ✅ | ✅ | ✅ |
| `score` | ✅ | ✅ (归一化) | ✅ |
| `face` | ✅ | ✅ (如有共面) | ✅ |
| `tune_report` | ✅ | ✅ ("SA退火优化…") | ✅ |
| `all_candidates` | ✅ | `[]` | ✅ |
| `sa_history` | ❌ | ✅ | ✅ 新增，可选 |
| `cost` | ❌ | ✅ | ✅ 新增，可选 |
| `cost_components` | ❌ | ✅ | ✅ 新增，可选 |

---

## 7. 文件变更清单

### 7.1 新增文件

| 文件 | 行数估算 | 说明 |
|------|:---:|------|
| `calculator/orientation_sa.py` | ~350 | SA 优化器主模块 |
| `tests/test_orientation_sa.py` | ~200 | 单元测试 + 回归测试 |
| `docs/orientation_sa_design.md` | — | 本文档 |

### 7.2 修改文件

| 文件 | 改动 |
|------|------|
| `calculator/orientation.py` | +3 行：导入 SA，在 `get_best_face_for_slicing` 增加 `method` 参数分支 |
| `calculator/__init__.py` | 可选：导出新符号 |
| `requirements.txt` | +1 行：`shapely>=2.0,<3.0` |

### 7.3 不变文件

以下文件 **不需要任何修改**：

- `calculator/orientation_math.py` — 纯数学工具，SA 直接复用
- `calculator/orientation_scoring.py` — `_score_orientation_3x3` 被 SA 代价函数内部调用
- `calculator/orientation_cluster.py` — 共面聚类用于 SA 初始化解
- `calculator/cost.py` — 调用 `get_best_face_for_slicing` 的签名不变

---

## 8. 性能预估

| 指标 | 现有 coplanar | SA (800 iter) |
|------|:---:|:---:|
| 候选评估次数 | ~10–20 (共面簇) | 800 |
| 单次评估耗时 | ~5ms (小型件) | ~5ms |
| 总耗时 | ~100ms | ~4s |
| `_score_orientation_3x3` 调用 | 每候选 1次 | 每迭代 1次 |
| Shapely convex_hull 调用 | 0 | 每迭代 1次 (~0.1ms) |

> **结论**：800 次迭代 × 5ms ≈ 4 秒。对于 Web 报价场景可接受，且可通过 `max_iter=200` 快速模式降至 ~1 秒。

### 8.1 加速策略

1. **Early stop**：patience=200 时大多数模型 300–500 次即收敛
2. **快速模式** `max_iter=200`：质量略降但速度快 4×
3. **缓存底部顶点投影**：同一 R 下 `BedStabilityAnalyzer` 只计算一次
4. **向量化**：`_score_orientation_3x3` 已用 numpy 向量化，无优化空间

---

## 9. 测试策略

### 9.1 回归测试

对 20+ 个真实 STL 文件，验证 SA 结果得分 ≥ 现有 coplanar 结果得分。

### 9.2 单元测试

```python
# tests/test_orientation_sa.py

def test_sa_config_defaults():
    cfg = SAConfig()
    assert 0 < cfg.cooling_rate < 1
    assert cfg.T_init > cfg.T_min

def test_cost_function_monotonic():
    # 同一模型，更小支撑体积 → 更小代价
    ...

def test_neighbor_stays_on_so3():
    R = np.eye(3)
    opt = SimulatedAnnealingOptimizer(mesh)
    R_new = opt.neighbor(R, temperature=0.5)
    # R_new 应为正交矩阵
    assert np.allclose(R_new @ R_new.T, np.eye(3), atol=1e-10)

def test_bed_stability_flat_plate():
    # 平板模型 → stability ≈ 1.0
    ...

def test_bed_stability_needle():
    # 针状模型 → stability ≈ 0.1
    ...

def test_compat_return_format():
    result = optimize_orientation_sa("test.stl")
    for key in ["oriented_path", "rotation_matrix", "euler_angles_deg", "score"]:
        assert key in result
```

### 9.3 镜像件对称性测试

```python
def test_mirror_symmetry():
    """X/Y 互换的镜像模型应得相同旋转（模镜像变换）"""
    mesh_xy = load_mesh("part_xy.stl")
    mesh_yx = load_mesh("part_yx.stl")
    R1 = optimize_orientation_sa(mesh_xy)["rotation_matrix"]
    R2 = optimize_orientation_sa(mesh_yx)["rotation_matrix"]
    # 将R2做XY镜像变换后应与R1一致
    mirror = np.diag([-1, -1, 1])  # 或者根据实际情况
    assert np.allclose(R1, mirror @ R2 @ mirror.T, atol=0.1)
```

---

## 10. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|:---:|------|
| SA 陷入局部最优 | 中 | 共面聚类初始化 + 自适应步长 + Metropolis 跳出 |
| Shapely 安装失败 | 低 | 自动降级为朴素矩形分析 |
| 4秒延迟超预算 | 中 | 快速模式 max_iter=200 (1秒)；前端异步展示 |
| 新评分口径与旧报价不兼容 | 低 | 仅影响朝向选择（物理结果），不影响计价公式 |

---

## 11. 实施路线

| 阶段 | 内容 | 工期 |
|------|------|:---:|
| Phase 1 | `orientation_sa.py` 核心实现 (SAConfig, Cost, Neighbor, Annealer) | 2天 |
| Phase 2 | `BedStabilityAnalyzer` (Shapely 集成 + 降级) | 1天 |
| Phase 3 | `optimize_orientation_sa()` 便捷函数 + `orientation.py` 桥接 | 0.5天 |
| Phase 4 | 单元测试 + 回归测试 | 1天 |
| Phase 5 | 真实模型 benchmark + 参数调优 | 1天 |

**总计**: ~5.5 人天。

---

## 附录 A：SA 参数调优建议

```python
# 生产建议配置
SAConfig(
    T_init=1.0,          # 自动校准后可覆盖
    T_min=1e-3,
    cooling_rate=0.95,   # 越接近1越慢但越精细
    max_iter=800,        # 大多数模型 400-600 次收敛
    neighbor_std=0.3,    # 17° 初始扰动
    patience=200,        # 连续200步无改善→停止
)

# 快速模式
SAConfig(max_iter=200, patience=50, cooling_rate=0.92)

# 精细模式
SAConfig(max_iter=2000, patience=500, cooling_rate=0.97, neighbor_std=0.2)
```

## 附录 B：cost.py 中 auto_orient 配置扩展

```python
# pricing_config 新增可选字段
{
    "auto_orient": True,           # 现有
    "auto_orient_method": "sa",    # 新增: "coplanar"(默认) | "sa"
    "auto_orient_sa_max_iter": 800,# 新增: SA 最大迭代
}
```
