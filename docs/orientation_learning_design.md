# pricer3d 朝向优化自学习系统 — 架构设计

> 版本: v1.0 | 日期: 2026-06-21 | 作者: 架构组

---

## 1. 概述

### 1.1 现状

当前朝向优化 (`calculator/orientation.py`) 采用「共面聚类 → 固定权重打分 → 贪心选最优面」的规则引擎：

```
model_path
  → cluster_coplanar_faces(mesh)       # 聚类共面三角形
  → for each cluster: evaluate_orientation()  # SUPPORT_WEIGHT=0.5, TIME_WEIGHT=0.3, ADHESION_WEIGHT=0.2
  → candidates.sort(score, reverse=True)
  → candidates[0]                       # 贪心取最高分
  → fine_tune_orientation()             # Z轴微调±30°
  → apply_orientation_to_mesh()         # 导出STL
```

用户已可通过预览弹窗中「标记为最优方向」按钮提交训练样本，但：

| 缺陷 | 说明 |
|------|------|
| 特征粒度粗 | 只存全局特征（体积、表面积、Z高），无法学习"为什么选这个面" |
| 无面级标注 | 未记录 coplanar 聚类结果，无法区分正/负样本 |
| 无学习闭环 | 训练数据只写不读，未驱动任何模型 |

### 1.2 目标

构建完整自学习闭环：**用户标记 → 特征提取 → 模型训练 → 推理集成**

最终 `get_best_face_for_slicing(method="learned")` 用学习的评分函数替代固定权重，无训练数据时 fallback 到原规则。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (已有)                                   │
│  预览弹窗 → 用户手动调整朝向 → 点击「标记为最优方向」                    │
│  submitTraining() → POST /api/orientation/train (file + x/y/z)      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     POST /api/orientation/train  (增强)               │
│                                                                      │
│  1. 接收 file + euler(x,y,z)                                         │
│  2. 加载 mesh，运行 coplanar 聚类                                     │
│  3. 对每个候选面提取 16 维特征向量                                     │
│  4. 根据用户欧拉角计算 up_vector，匹配最近候选面 → label=1              │
│  5. 其余候选面 label=0                                                │
│  6. 逐面写入 data/training_samples.jsonl                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  calculator/orientation_learn.py  (新增)              │
│                                                                      │
│  class OrientationLearner:                                           │
│    - load_samples(jsonl) → List[Sample]                              │
│    - extract_features(mesh, cluster) → np.ndarray (16D)               │
│    - train() → sklearn LogisticRegression                             │
│    - predict(features) → float (概率)                                 │
│    - save/load model to data/orientation_model.pkl                    │
│                                                                      │
│  触发方式:                                                            │
│    A. 管理员命令 /api/admin/orientation/train (手动触发)               │
│    B. 每次新增 N 条样本后自动重训 (可配置)                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│              get_best_face_for_slicing(method="learned")              │
│                                                                      │
│  候选生成仍用 coplanar 聚类                                           │
│  评分用 learn.predict() 替代固定权重                                   │
│  无模型时 fallback 到原 evaluate_orientation()                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据采集增强

### 3.1 新版 JSONL 样本格式

每行一个面级样本（原一个文件一行改为一个面一行）：

```json
{
  "timestamp": "2026-06-21T10:30:00+00:00",
  "sample_id": "uid-abc",
  "filename": "gear.stl",
  "user_id": 1,
  "user_euler_deg": {"x": 0.0, "y": 90.0, "z": 0.0},
  "is_positive": true,
  "cluster_index": 3,
  "total_clusters": 8,
  "features": {
    "face_normal_x": 0.0,
    "face_normal_y": 0.0,
    "face_normal_z": 1.0,
    "face_area_mm2": 1250.5,
    "face_compactness": 0.82,
    "face_count": 234,
    "face_area_ratio": 0.15,
    "z_height_mm": 45.2,
    "bed_footprint_mm2": 980.3,
    "bed_aspect_ratio": 1.8,
    "overhang_ratio": 0.12,
    "support_volume_mm3": 320.0,
    "base_contact_area_mm2": 850.0,
    "cog_z_mm": 22.1,
    "cog_xy_offset_mm": 3.2,
    "anisotropy_ratio": 2.3
  }
}
```

### 3.2 `POST /api/orientation/train` 增强逻辑

```
当前逻辑 (routes_orientation.py: train_sample):
  1. 保存文件到临时路径
  2. 加载 mesh，提取 volume / area / z_height
  3. 写入单行 (全局特征 + euler)
  4. 删除临时文件

增强后逻辑:
  1. 保存文件到临时路径
  2. 加载 mesh → trimesh.Trimesh
  3. 运行 cluster_coplanar_faces(mesh) → 候选面列表
  4. 从用户 euler 计算 up_vector:
     R = euler_to_rotation(x, y, z)     [见下方]
     up_user = R @ [0, 0, 1]^T          (用户朝向的上方向)
  5. 遍历候选面，计算 normal 与 up_user 的夹角:
     cos_theta = |dot(normal, up_user)|
     选 cos_theta 最大且 ≥0.98 的面为 positive
     若无匹配面则跳过 (该样本无法用于面级学习)
  6. 对每个候选面:
     - 提取 16 维特征 (见第4节)
     - 构建样本 dict
     - 追加写入 JSONL
  7. 检查样本数是否达到自动重训阈值，若达到则触发重训
```

### 3.3 欧拉角 → up_vector 转换

```python
import math, numpy as np

def euler_to_up_vector(x_deg, y_deg, z_deg):
    """用户欧拉角 (Three.js XYZ 顺序) → 打印上方向向量"""
    rx = math.radians(x_deg)
    ry = math.radians(y_deg)
    rz = math.radians(z_deg)
    # Three.js 默认旋转顺序: 'XYZ' (intrinsic)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    R = Rz @ Ry @ Rx
    up = R @ np.array([0, 0, 1])   # 原始Z轴旋转后方向
    if up[2] < 0:
        up = -up                     # 确保指向上方
    return up
```

---

## 4. 特征工程

### 4.1 特征向量定义 (16维)

| 维度 | 特征名 | 含义 | 来源 |
|------|--------|------|------|
| 0 | `face_normal_x` | 面法向量 X 分量 | cluster["normal"][0] |
| 1 | `face_normal_y` | 面法向量 Y 分量 | cluster["normal"][1] |
| 2 | `face_normal_z` | 面法向量 Z 分量 | cluster["normal"][2] |
| 3 | `face_area` | 面面积 (mm²) | cluster["area"] |
| 4 | `face_compactness` | 面紧凑度: 4π·area/perimeter² | 从 cluster vertices 算 2D 凸包 |
| 5 | `face_count` | 面包含三角形数 | len(cluster["faces"]) |
| 6 | `face_area_ratio` | 面面积/模型总表面积 | cluster["area"] / mesh.area |
| 7 | `z_height` | 摆放后 Z 向高度 (mm) | evaluate_orientation() 输出 |
| 8 | `bed_footprint` | 热床投影面积 (mm²) | 底部顶点 XY 凸包面积 |
| 9 | `bed_aspect_ratio` | 投影矩形宽高比 | 2D 凸包 min_rotated_rect |
| 10 | `overhang_ratio` | 悬垂面积占比 | _score_orientation_3x3() |
| 11 | `support_volume` | 预估支撑体积 (mm³) | _score_orientation_3x3() |
| 12 | `base_contact_area` | 底面接触面积 (mm²) | evaluate_orientation() |
| 13 | `cog_z` | 重心 Z 坐标 (相对底面) | mesh.center_mass 旋转后 Z - z_min |
| 14 | `cog_xy_offset` | 重心 XY 水平偏移 (mm) | mesh.center_mass 旋转后 XY 距投影中心距离 |
| 15 | `anisotropy_ratio` | 惯性椭球最大/最小轴比 | mesh.moment_inertia 特征值 λ_max/λ_min |

### 4.2 特征提取实现要点

```python
def extract_face_features(mesh: trimesh.Trimesh, cluster: dict) -> np.ndarray:
    """
    对单个 coplanar 候选面提取 16 维特征。
    - mesh: 原始模型 (未旋转)
    - cluster: cluster_coplanar_faces() 返回的单条记录
    返回: np.float64 (16,)
    """
    normal = np.array(cluster["normal"])

    # 面级特征
    area = float(cluster["area"])
    face_count = int(cluster.get("face_count", len(cluster.get("faces", []))))
    area_ratio = area / max(mesh.area, 1e-9)

    # 紧凑度: 2D投影凸包
    verts = np.array(cluster["vertices"])  # 3D 多边形顶点
    compactness = _compute_compactness(verts, normal)

    # 计算旋转矩阵 (面朝上 → print bed)
    R = _compute_face_up_rotation(normal)

    # 旋转后评分
    metrics = _score_orientation_3x3(mesh, R)
    z_height = metrics["z_height"]
    overhang_ratio = metrics["overhang_ratio"]
    support_volume = metrics["support_volume"]
    base_contact = metrics["contact_area"]

    # 热床投影分析
    rotated_verts = mesh.vertices @ R.T
    z_min = rotated_verts[:, 2].min()
    bottom_mask = rotated_verts[:, 2] < z_min + max(0.1, z_height * 0.01)
    bottom_xy = rotated_verts[bottom_mask, :2]
    if len(bottom_xy) >= 3:
        footprint, aspect = _compute_footprint(bottom_xy)
    else:
        footprint, aspect = 0.0, 1.0

    # 重心
    cog = mesh.center_mass @ R.T
    cog_z = cog[2] - z_min
    cog_xy_center = bottom_xy.mean(axis=0) if len(bottom_xy) > 0 else np.array([0, 0])
    cog_xy_offset = float(np.linalg.norm(cog[:2] - cog_xy_center))

    # 惯性各向异性 (与旋转无关的全局属性)
    inertia = mesh.moment_inertia
    eigvals = np.linalg.eigvalsh(inertia)
    anisotropy = eigvals.max() / max(eigvals.min(), 1e-9)

    return np.array([
        normal[0], normal[1], normal[2],
        area, compactness, face_count, area_ratio,
        z_height, footprint, aspect,
        overhang_ratio, support_volume, base_contact,
        cog_z, cog_xy_offset, anisotropy,
    ], dtype=np.float64)
```

### 4.3 特征归一化

训练前对连续特征做 StandardScaler 标准化（存到模型文件的 `scaler_` 属性），推理时复用。

**注意**：`face_normal_*` (三维) 本身在 [-1, 1]，可适当放大或保持原值。`bed_aspect_ratio` 对极端细长件取对数抑制离群值。

---

## 5. 学习模型

### 5.1 模型选择: Logistic Regression

| 考虑 | 选择 |
|------|------|
| 可解释性 | 权重向量直接反映每个特征对"最优"的贡献 |
| 冷启动 | 少至 10-20 样本即可训练，XGBoost 在小样本上易过拟合 |
| 依赖管理 | scikit-learn 已是 Python 生态标配 |

如未来样本量积累到 500+ 可考虑轻量 XGBoost，当前用 LR 即可。

### 5.2 模型定义

```python
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import pickle

class OrientationLearner:
    def __init__(self, model_dir: str = "data"):
        self.model_path = os.path.join(model_dir, "orientation_model.pkl")
        self.model: Optional[LogisticRegression] = None
        self.scaler: Optional[StandardScaler] = None
        self._load()

    def train(self, samples: list[dict]):
        """从 JSONL 样本训练。
        samples: 每行含 features(dict) + is_positive(bool)
        """
        X_raw = np.array([list(s["features"].values()) for s in samples])
        y = np.array([1 if s["is_positive"] else 0 for s in samples])

        # 处理类别不平衡: 正样本权重 = neg_count / pos_count
        n_pos = y.sum()
        n_neg = len(y) - n_pos
        class_weight = {0: 1.0, 1: n_neg / max(n_pos, 1)}

        self.scaler = StandardScaler()
        X = self.scaler.fit_transform(X_raw)

        self.model = LogisticRegression(
            class_weight=class_weight,
            max_iter=1000,
            C=1.0,
            solver='lbfgs',
        )
        self.model.fit(X, y)
        self._save()

    def predict_proba(self, features_batch: np.ndarray) -> np.ndarray:
        """返回每个候选面是"最优"的概率 (batch, 1)"""
        X = self.scaler.transform(features_batch)
        return self.model.predict_proba(X)[:, 1]   # 正类概率

    def _save(self):
        with open(self.model_path, "wb") as f:
            pickle.dump({"model": self.model, "scaler": self.scaler}, f)

    def _load(self):
        if os.path.exists(self.model_path):
            with open(self.model_path, "rb") as f:
                data = pickle.load(f)
                self.model = data["model"]
                self.scaler = data["scaler"]

    def is_trained(self) -> bool:
        return self.model is not None and self.scaler is not None
```

### 5.3 训练策略

| 维度 | 方案 |
|------|------|
| **正样本** | 用户标记的面 (cos_sim ≥ 0.98 匹配的 cluster) |
| **负样本** | 同一模型的其他所有 coplanar 候选面 |
| **样本权重** | 自动 class_weight='balanced' 处理正负不平衡 |
| **触发方式** | 方式一: `POST /api/admin/orientation/train` 手动触发 |
|  | 方式二: 新增样本数 ≥ N (默认10) 后自动触发 |
| **重训策略** | 全量重训 (数据量小时)，后续可改为增量 warm_start |

### 5.4 训练状态 API

```
GET  /api/orientation/model/status
→ {"trained": true, "n_samples": 42, "n_positive": 15, "accuracy": 0.87, "last_trained": "..."}

POST /api/admin/orientation/train
→ {"status": "ok", "n_samples": 42, "accuracy": 0.87, "coef": {...}}
```

---

## 6. 推理集成

### 6.1 新增 `method="learned"`

在 `get_best_face_for_slicing()` 中新增分支：

```python
def get_best_face_for_slicing(
    model_path: str,
    method: str = "coplanar",   # "coplanar" | "sa" | "learned"
    sa_config: Optional[dict] = None,
) -> dict:

    if method == "sa":
        from calculator.orientation_sa import optimize_orientation_sa
        return optimize_orientation_sa(model_path, **(sa_config or {}))

    if method == "learned":
        return _learned_best_face(model_path)

    # ... existing coplanar method ...


def _learned_best_face(model_path: str) -> dict:
    from calculator.orientation_learn import OrientationLearner, extract_face_features

    mesh = _load_mesh(model_path)
    learner = OrientationLearner()

    # 候选生成仍用 coplanar 聚类
    clusters = cluster_coplanar_faces(mesh)

    if not learner.is_trained() or len(clusters) < 2:
        # Fallback → 原固定权重
        logger.info("学习模型未训练或无候选面，回退到固定权重评分")
        return get_best_face_for_slicing(model_path, method="coplanar")

    # 批量提取特征
    features_batch = np.array([extract_face_features(mesh, c) for c in clusters])

    # 学习模型评分
    scores = learner.predict_proba(features_batch)

    candidates = []
    for i, cluster in enumerate(clusters):
        candidates.append({
            "face": cluster,
            "score": round(float(scores[i]) * 100, 2),   # 概率 → 0-100
            "method": "learned",
        })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    # ... 后续逻辑同原 coplanar 分支 (微调 + 旋转 + 导出)
```

### 6.2 前后端集成

**前端 (orientation-ui.js)**:
- 「自动摆放」按钮点击时，请求参数传 `method: "learned"`
- 如服务端返回 `"fallback": true` 则静默使用原算法

**后端新增路由**:
```
POST /api/orientation/best-face
  body: {file, method: "learned" | "coplanar" | "sa"}
  → {oriented_path, score, method_used, fallback, ...}
```

### 6.3 Fallback 策略

```
┌─ 请求 method="learned" ─┐
│                          │
│  模型文件存在? ──No──→ fallback coplanar
│       │
│      Yes
│       │
│  coplanar聚类 ≥ 2? ─No──→ fallback coplanar
│       │
│      Yes
│       │
│  学习模型评分 ──→ 返回结果 (method_used="learned")
└──────────────────────────┘
```

---

## 7. 文件结构变更

```
pricer3d/
├── calculator/
│   ├── orientation.py              # [修改] 新增 _learned_best_face(), 方法分支
│   ├── orientation_learn.py        # [新增] OrientationLearner, extract_face_features
│   ├── orientation_scoring.py      # [不变]
│   ├── orientation_cluster.py      # [不变]
│   └── orientation_math.py         # [修改] 新增 euler_to_up_vector()
│
├── app/
│   ├── routes_orientation.py       # [修改] 增强 train_sample, 新增 train_model, model_status
│   ├── routes_admin.py             # [修改] 新增 admin 训练触发端点
│   └── __init__.py                 # [修改] 注册新路由
│
├── data/
│   ├── training_samples.jsonl      # [格式变更] 每行=一个面级样本
│   └── orientation_model.pkl       # [新增] 训练好的模型
│
├── requirements.txt                # [修改] + scikit-learn
└── docs/
    └── orientation_learning_design.md  # [本文档]
```

---

## 8. 部署与依赖

### 8.1 requirements.txt 变更

```diff
+ scikit-learn>=1.3,<2.0
```

`scikit-learn` 核心依赖只有 `numpy` 和 `scipy`，不引入额外重依赖。

### 8.2 数据迁移

原 `training_samples.jsonl` 格式为每行一个全局样本，新格式为每行一个面级样本：

- **迁移策略**: 旧样本无法还原面级信息，保留旧文件为 `training_samples_v0.jsonl.bak`，新样本写入新文件
- **模型初始化**: 首次训练从零开始，积累 10+ 新样本后首次模型可用

### 8.3 自动重训配置

在 `app/config.py` 新增：

```python
# 朝向学习配置
ORIENT_LEARNING_AUTO_RETRAIN = True       # 是否自动重训
ORIENT_LEARNING_MIN_NEW_SAMPLES = 10      # 新样本数阈值
ORIENT_LEARNING_MIN_POSITIVE = 3          # 最少正样本数
```

新增样本数达到阈值时，下次 `train_sample` 调用完成后异步触发重训。

---

## 9. 实施路线

| 阶段 | 内容 | 预估工时 |
|------|------|---------|
| **Phase 1** | `calculator/orientation_learn.py`: 特征提取 + Learner 类 + 模型存取 | 1d |
| **Phase 2** | 增强 `POST /api/orientation/train`: 面级聚类 + 正负标注 + JSONL 写入 | 0.5d |
| **Phase 3** | 新增 `GET /api/orientation/model/status` + `POST /api/admin/orientation/train` | 0.5d |
| **Phase 4** | `get_best_face_for_slicing(method="learned")` + fallback 逻辑 | 0.5d |
| **Phase 5** | 前端: `submitTraining()` 增强 + 「自动摆放」按钮传 method="learned" | 0.5d |
| **Phase 6** | 集成测试 + 样例数据积累 + 日志/监控 | 0.5d |
| **总计** | | **3.5d** |

---

## 10. 附录

### A. 特征重要性解读 (LR 系数)

训练完成后可通过 `learner.model.coef_[0]` 查看每个特征对"最优概率"的边际贡献：

- 正系数 → 该特征值越大，被选为最优的概率越高
- 负系数 → 该特征值越大，被选为最优的概率越低

这为调优固定权重提供了数据驱动的参考。

### B. 安全考量

- 训练样本仅供本实例使用，不跨用户共享模型（MVP 阶段）
- 管理员触发训练需 admin 权限
- JSONL 文件定期备份，避免误删导致数据丢失
