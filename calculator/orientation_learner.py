"""朝向优化自学习系统 — 特征提取 + 逻辑回归模型训练与推理。

从 coplanar 聚类面提取 16 维特征，训练 Logistic Regression 模型，
替代原有固定权重评分规则。

Classes:
    FaceFeatureExtractor — 从 mesh + coplanar cluster 提取 16 维特征
    OrientationLearner    — 加载 JSONL 样本、训练 LR、预测最优面概率

特征向量 (16维):
    0-2  : face_normal (法向量分量)
    3    : face_area (面面积 mm²)
    4    : face_compactness (面紧凑度)
    5    : face_count (包含三角形数)
    6    : face_area_ratio (面积/模型总面积)
    7    : z_height (旋转后 Z 高度)
    8    : bed_footprint (热床投影面积)
    9    : bed_aspect_ratio (投影矩形宽高比)
    10   : overhang_ratio (悬垂面积占比)
    11   : support_volume (预估支撑体积)
    12   : base_contact_area (底面接触面积)
    13   : cog_z (重心相对底面高度)
    14   : cog_xy_offset (重心水平偏移)
    15   : anisotropy_ratio (惯性各向异性比)
"""

import json
import math
import os
import logging
import pickle
import numpy as np
import trimesh
from typing import Optional

from calculator.orientation_scoring import (
    _score_orientation_3x3,
)
from calculator.orientation_math import rotation_from_up_vector

logger = logging.getLogger(__name__)

# ── 特征维度常量 ──
FEATURE_DIM = 16  # 16 维特征向量


class FaceFeatureExtractor:
    """从 coplanar cluster + mesh 提取 16 维面级特征。

    使用方式:
        extractor = FaceFeatureExtractor()
        features = extractor.extract(mesh, cluster)  # shape=(16,)
    """

    # 面朝上旋转时的 Z 向上向量
    Z_UP = np.array([0.0, 0.0, 1.0], dtype=np.float64)

    def extract(self, mesh: trimesh.Trimesh, cluster: dict) -> np.ndarray:
        """从单个 coplanar 候选面提取 16 维特征向量。

        Args:
            mesh: 原始模型 (未旋转)
            cluster: cluster_coplanar_faces() 返回的单条记录，
                     需含 normal, area, face_count, vertices 字段。

        Returns:
            shape=(16,) 的 float64 数组，各维度含义见模块文档。
        """
        normal = np.asarray(cluster["normal"], dtype=np.float64)
        # 归一化法向量
        n_len = float(np.linalg.norm(normal))
        if n_len > 1e-8:
            normal = normal / n_len
        else:
            normal = np.array([0.0, 0.0, 1.0])

        # ── 面级特征 (原始模型空间) ──
        area = float(cluster.get("area", 0.0))
        face_count = int(cluster.get("face_count", 0))
        total_area = max(float(mesh.area), 1e-9)
        area_ratio = area / total_area

        # 紧凑度: 从 cluster vertices 计算 2D 凸包
        compactness = self._compute_compactness(cluster, normal)

        # ── 旋转后评分特征 ──
        # 计算"面朝上"的旋转矩阵 (法向的反方向对齐 +Z)
        up = -normal
        up_norm = float(np.linalg.norm(up))
        if up_norm < 1e-8:
            up = np.array([0.0, 0.0, 1.0])
        else:
            up = up / up_norm
        if up[2] < 0:
            up = -up

        R = rotation_from_up_vector(up)[:3, :3].copy()
        metrics = _score_orientation_3x3(mesh, R)

        z_height = float(metrics.get("z_height", 0.0))
        overhang_ratio = float(metrics.get("overhang_ratio", 0.0))
        support_volume = float(metrics.get("support_volume", 0.0))
        base_contact_area = float(metrics.get("contact_area", 0.0))

        # ── 热床投影分析 ──
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        rotated_verts = vertices @ R.T
        z_all = rotated_verts[:, 2]
        z_min = float(z_all.min())
        eps_bottom = max(0.1, z_height * 0.01)
        bottom_mask = z_all < z_min + eps_bottom
        bottom_xy = rotated_verts[bottom_mask, :2]

        if len(bottom_xy) >= 3:
            footprint, aspect = self._compute_footprint(bottom_xy)
        else:
            footprint, aspect = 0.0, 1.0

        # ── 重心特征 ──
        try:
            cog = np.asarray(mesh.center_mass, dtype=np.float64) @ R.T
        except Exception:
            cog = rotated_verts.mean(axis=0)
        cog_z = float(cog[2] - z_min)

        if len(bottom_xy) > 0:
            cog_xy_center = bottom_xy.mean(axis=0)
            cog_xy_offset = float(np.linalg.norm(cog[:2] - cog_xy_center))
        else:
            cog_xy_offset = 0.0

        # ── 惯性各向异性 (与旋转无关的全局属性) ──
        try:
            inertia = mesh.moment_inertia
            eigvals = np.linalg.eigvalsh(inertia)
            anisotropy = float(eigvals.max() / max(eigvals.min(), 1e-9))
        except Exception:
            anisotropy = 1.0

        return np.array(
            [
                float(normal[0]),
                float(normal[1]),
                float(normal[2]),
                area,
                compactness,
                float(face_count),
                area_ratio,
                z_height,
                footprint,
                aspect,
                overhang_ratio,
                support_volume,
                base_contact_area,
                cog_z,
                cog_xy_offset,
                anisotropy,
            ],
            dtype=np.float64,
        )

    # ── 内部辅助方法 ──

    @staticmethod
    def _compute_compactness(cluster: dict, normal: np.ndarray) -> float:
        """计算面的 2D 紧凑度: 4π·area/perimeter²。

        将 cluster 的 3D 顶点投影到法向平面上，求 2D 凸包面积与周长。
        """
        verts = np.asarray(cluster.get("vertices", []), dtype=np.float64)
        if len(verts) < 3:
            # fallback: 用 area 估算
            area = float(cluster.get("area", 1.0))
            if area <= 0:
                return 0.0
            # 假设近似圆形: perimeter ≈ 2√(π·area), compactness≈1
            return 0.8

        # 投影到法向平面
        centroid = verts.mean(axis=0)
        z_axis = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        if abs(float(np.dot(normal, z_axis))) > 0.999:
            x_axis = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        else:
            x_axis = np.cross(normal, z_axis)
            x_axis /= float(np.linalg.norm(x_axis))
        y_axis = np.cross(normal, x_axis)

        proj_2d = np.column_stack(
            [
                (verts - centroid) @ x_axis,
                (verts - centroid) @ y_axis,
            ]
        )

        try:
            from scipy.spatial import ConvexHull

            if len(proj_2d) >= 3:
                hull = ConvexHull(proj_2d)
                hull_area = float(hull.volume)  # 2D convex hull 面积
                # 周长 = 各边长度之和
                hull_verts = proj_2d[hull.vertices]
                perimeter = 0.0
                nv = len(hull_verts)
                for i in range(nv):
                    d = hull_verts[(i + 1) % nv] - hull_verts[i]
                    perimeter += float(np.linalg.norm(d))
                if perimeter > 1e-9:
                    return float(4.0 * math.pi * hull_area / (perimeter * perimeter))
        except Exception:
            pass

        # fallback: bounding box 近似
        x_range = float(proj_2d[:, 0].max() - proj_2d[:, 0].min())
        y_range = float(proj_2d[:, 1].max() - proj_2d[:, 1].min())
        if x_range + y_range > 1e-9:
            return float(4.0 * math.pi * (x_range * y_range * 0.7) / ((x_range + y_range) * 2) ** 2)
        return 0.0

    @staticmethod
    def _compute_footprint(bottom_xy: np.ndarray) -> tuple[float, float]:
        """从底部顶点 XY 坐标计算热床投影面积和矩形宽高比。

        Args:
            bottom_xy: shape=(N, 2) 底部顶点 XY 坐标

        Returns:
            (footprint_mm2: float, aspect_ratio: float)
        """
        if len(bottom_xy) < 3:
            return 0.0, 1.0

        try:
            from scipy.spatial import ConvexHull

            hull = ConvexHull(bottom_xy)
            footprint = float(hull.volume)  # 2D 凸包面积
        except Exception:
            x_range = float(bottom_xy[:, 0].max() - bottom_xy[:, 0].min())
            y_range = float(bottom_xy[:, 1].max() - bottom_xy[:, 1].min())
            footprint = x_range * y_range

            if max(x_range, y_range) > 1e-9:
                aspect = max(x_range, y_range) / max(min(x_range, y_range), 1e-9)
            else:
                aspect = 1.0
            return footprint, aspect

        # 宽高比: 使用旋转卡壳法求最小包围矩形
        aspect = 1.0
        try:
            # 尝试每条凸包边的方向计算包围矩形
            hull_pts = bottom_xy[hull.vertices]
            n_hull = len(hull_pts)
            for i in range(n_hull):
                edge = hull_pts[(i + 1) % n_hull] - hull_pts[i]
                e_len = float(np.linalg.norm(edge))
                if e_len < 1e-9:
                    continue
                dir_vec = edge / e_len
                # 垂直方向
                perp = np.array([-dir_vec[1], dir_vec[0]], dtype=np.float64)
                # 投影到两个方向
                proj_dir = hull_pts @ dir_vec
                proj_perp = hull_pts @ perp
                w = float(proj_dir.max() - proj_dir.min())
                h = float(proj_perp.max() - proj_perp.min())
                if w + h > 1e-9:
                    cur_aspect = max(w, h) / max(min(w, h), 1e-9)
                    if cur_aspect < aspect or aspect == 1.0:
                        aspect = cur_aspect
        except Exception:
            # fallback: XY range ratio
            x_range = float(bottom_xy[:, 0].max() - bottom_xy[:, 0].min())
            y_range = float(bottom_xy[:, 1].max() - bottom_xy[:, 1].min())
            if max(x_range, y_range) > 1e-9:
                aspect = max(x_range, y_range) / max(min(x_range, y_range), 1e-9)

        return footprint, aspect


class OrientationLearner:
    """朝向学习器：从 JSONL 样本训练 Logistic Regression，预测最优面概率。

    使用方式:
        learner = OrientationLearner(data_dir="data")
        if learner.is_trained():
            probs = learner.predict_proba(features_batch)

        # 训练
        samples = learner.load_samples("training_samples.jsonl")
        if samples:
            accuracy = learner.train(samples)
    """

    def __init__(self, data_dir: str = "data"):
        """初始化学习器，尝试加载已有模型。

        Args:
            data_dir: 数据目录，模型文件保存在 data_dir/orientation_model.pkl
        """
        self.data_dir = data_dir
        self.model_path = os.path.join(data_dir, "orientation_model.pkl")
        self.model: Optional[object] = None  # LogisticRegression
        self.scaler: Optional[object] = None  # StandardScaler
        self._n_samples: int = 0
        self._n_positive: int = 0
        self._accuracy: Optional[float] = None
        self._load()

    # ── 公开 API ──

    def load_samples(self, jsonl_filename: str = "training_samples.jsonl") -> list[dict]:
        """从 JSONL 文件加载训练样本。

        Args:
            jsonl_filename: JSONL 文件名 (相对于 data_dir)

        Returns:
            list of sample dict，每条含 features(dict) + is_positive(bool)
        """
        jsonl_path = os.path.join(self.data_dir, jsonl_filename)
        samples: list[dict] = []
        if not os.path.exists(jsonl_path):
            logger.warning("训练数据文件不存在: %s", jsonl_path)
            return samples

        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    sample = json.loads(line)
                    if "features" in sample and "is_positive" in sample:
                        samples.append(sample)
                except json.JSONDecodeError:
                    logger.warning("跳过无效 JSONL 行")
                    continue

        logger.info("加载 %d 条训练样本", len(samples))
        return samples

    def train(self, samples: list[dict]) -> float:
        """从 JSONL 样本训练 Logistic Regression 模型。

        Args:
            samples: load_samples() 返回的样本列表，
                     每条含 features(dict) + is_positive(bool)

        Returns:
            float: 训练准确率 (自行评估)
        """
        if len(samples) < 3:
            logger.warning("样本过少 (n=%d)，无法训练", len(samples))
            return 0.0

        # 提取特征矩阵和标签
        X_raw_list = []
        y_list = []
        for s in samples:
            feats = s.get("features", {})
            if not feats:
                continue
            # 按固定顺序提取特征值
            feat_array = self._features_to_array(feats)
            if feat_array is not None:
                X_raw_list.append(feat_array)
                y_list.append(1 if s.get("is_positive") else 0)

        if len(X_raw_list) < 3:
            logger.warning("有效特征样本过少 (n=%d)，无法训练", len(X_raw_list))
            return 0.0

        X_raw = np.array(X_raw_list, dtype=np.float64)
        y = np.array(y_list, dtype=np.int32)

        n_pos = int(y.sum())
        n_neg = len(y) - n_pos
        logger.info("训练数据: %d 条 (正样本=%d, 负样本=%d)", len(y), n_pos, n_neg)

        if n_pos < 1:
            logger.warning("无正样本，无法训练")
            return 0.0

        # 处理类别不平衡
        class_weight = {0: 1.0, 1: float(n_neg) / max(float(n_pos), 1.0)}

        from sklearn.preprocessing import StandardScaler
        from sklearn.linear_model import LogisticRegression

        self.scaler = StandardScaler()
        X = self.scaler.fit_transform(X_raw)

        self.model = LogisticRegression(
            class_weight=class_weight,
            max_iter=1000,
            C=1.0,
            solver="lbfgs",
            random_state=42,
        )
        self.model.fit(X, y)

        # 自行评估准确率
        y_pred = self.model.predict(X)
        accuracy = float(np.mean(y_pred == y))

        self._n_samples = len(y)
        self._n_positive = n_pos
        self._accuracy = accuracy

        self._save()
        logger.info(
            "模型已训练: samples=%d, pos=%d, accuracy=%.3f, coef=%s",
            self._n_samples,
            self._n_positive,
            accuracy,
            str(np.round(self.model.coef_[0], 3).tolist()),
        )
        return accuracy

    def predict_proba(self, features_batch: np.ndarray) -> np.ndarray:
        """返回每个候选面是"最优"的概率。

        Args:
            features_batch: shape=(N, 16) 特征矩阵

        Returns:
            shape=(N,) 每个候选面的正类概率 (0~1)
        """
        if not self.is_trained():
            raise RuntimeError("模型未训练，请先调用 train() 或确认模型文件存在")

        X = self.scaler.transform(features_batch)
        return self.model.predict_proba(X)[:, 1]

    def is_trained(self) -> bool:
        """判断是否有可用的训练模型。"""
        return self.model is not None and self.scaler is not None

    @property
    def n_samples(self) -> int:
        return self._n_samples

    @property
    def n_positive(self) -> int:
        return self._n_positive

    @property
    def accuracy(self) -> Optional[float]:
        return self._accuracy

    # ── 内部方法 ──

    @staticmethod
    def _features_to_array(feats: dict) -> Optional[np.ndarray]:
        """将 features dict 转换为固定顺序的 numpy 数组。

        按 16 维顺序: normal_x, normal_y, normal_z, area, compactness,
        face_count, area_ratio, z_height, footprint, aspect,
        overhang_ratio, support_volume, base_contact,
        cog_z, cog_xy_offset, anisotropy
        """
        keys = [
            "face_normal_x",
            "face_normal_y",
            "face_normal_z",
            "face_area_mm2",
            "face_compactness",
            "face_count",
            "face_area_ratio",
            "z_height_mm",
            "bed_footprint_mm2",
            "bed_aspect_ratio",
            "overhang_ratio",
            "support_volume_mm3",
            "base_contact_area_mm2",
            "cog_z_mm",
            "cog_xy_offset_mm",
            "anisotropy_ratio",
        ]
        try:
            return np.array([float(feats.get(k, 0.0)) for k in keys], dtype=np.float64)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def features_to_dict(feature_array: np.ndarray) -> dict:
        """将 16 维特征数组转为 key-value 字典 (用于 JSONL 写入)。

        Args:
            feature_array: shape=(16,) 特征数组

        Returns:
            dict with named feature keys
        """
        keys = [
            "face_normal_x",
            "face_normal_y",
            "face_normal_z",
            "face_area_mm2",
            "face_compactness",
            "face_count",
            "face_area_ratio",
            "z_height_mm",
            "bed_footprint_mm2",
            "bed_aspect_ratio",
            "overhang_ratio",
            "support_volume_mm3",
            "base_contact_area_mm2",
            "cog_z_mm",
            "cog_xy_offset_mm",
            "anisotropy_ratio",
        ]
        return {k: float(feature_array[i]) for i, k in enumerate(keys)}

    def _save(self) -> None:
        """保存模型到 pickle 文件。"""
        os.makedirs(self.data_dir, exist_ok=True)
        data = {
            "model": self.model,
            "scaler": self.scaler,
            "n_samples": self._n_samples,
            "n_positive": self._n_positive,
            "accuracy": self._accuracy,
        }
        with open(self.model_path, "wb") as f:
            pickle.dump(data, f)
        logger.info("模型已保存: %s", self.model_path)

    def _load(self) -> None:
        """从 pickle 文件加载模型。"""
        if not os.path.exists(self.model_path):
            logger.info("模型文件不存在: %s", self.model_path)
            return
        try:
            with open(self.model_path, "rb") as f:
                data = pickle.load(f)
            self.model = data.get("model")
            self.scaler = data.get("scaler")
            self._n_samples = data.get("n_samples", 0)
            self._n_positive = data.get("n_positive", 0)
            self._accuracy = data.get("accuracy")
            logger.info(
                "模型已加载: samples=%d, pos=%d, accuracy=%s",
                self._n_samples,
                self._n_positive,
                f"{self._accuracy:.3f}" if self._accuracy else "N/A",
            )
        except Exception as e:
            logger.warning("加载模型失败: %s", e)
            self.model = None
            self.scaler = None


# ── 便捷函数 ──


def extract_face_features(mesh: trimesh.Trimesh, cluster: dict) -> np.ndarray:
    """提取单个 coplanar 候选面的 16 维特征的便捷函数。

    等同 FaceFeatureExtractor().extract(mesh, cluster)
    """
    extractor = FaceFeatureExtractor()
    return extractor.extract(mesh, cluster)
