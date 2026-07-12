"""模拟退火(Simulated Annealing)朝向优化器 + Shapely热床稳定性分析.

在SO(3)连续旋转空间中全局寻优，替代离散贪心搜索。
集成Shapely进行2D热床投影凸包分析，量化打印稳定性。

Classes:
    SAConfig              — 退火参数配置
    SACostWeights         — 代价函数权重
    BedStabilityAnalyzer  — Shapely 2D投影分析(含降级策略)
    SAResult              — 优化结果数据类
    SimulatedAnnealingOptimizer — SA主优化器

Convenience function:
    optimize_orientation_sa(model_path, **kwargs) -> dict
"""

from __future__ import annotations

import math
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import trimesh

from calculator.orientation_math import (
    rodrigues_rotation,
    rotation_to_euler,
    rotation_from_up_vector,
    fibonacci_sphere_sampling,
)
from calculator.orientation_scoring import (
    _score_orientation_3x3,
    fine_tune_orientation,
)
from calculator.orientation_cluster import cluster_coplanar_faces

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 配置数据类
# ═══════════════════════════════════════════════════════════════════════


@dataclass
class SAConfig:
    """模拟退火参数配置.

    属性:
        T_init: 初始温度 (默认1.0，可由采样自动校准)
        T_min: 终止温度
        cooling_rate: 几何冷却系数 (T_k = T_init * cooling_rate^k)
        max_iter: 最大迭代次数
        neighbor_std: 邻域扰动标准差 (rad, 默认0.3≈17°)
        patience: 早停阈值 — 连续N步无改善则终止
        random_seed: 随机种子 (None则使用系统熵)
        auto_calibrate_T: 是否用随机采样自动校准T_init
        calibrate_samples: 自动校准时采样的随机朝向数
    """

    T_init: float = 1.0
    T_min: float = 1e-3
    cooling_rate: float = 0.95
    max_iter: int = 800
    neighbor_std: float = 0.3
    patience: int = 200
    random_seed: Optional[int] = None
    auto_calibrate_T: bool = True
    calibrate_samples: int = 50


@dataclass
class SACostWeights:
    """代价函数权重配置.

    代价公式: cost = w_support*S + w_time*T + w_stability*(1-B)
    其中 S=支撑归一化值, T=时间归一化值, B=热床稳定性(0~1)
    """

    w_support: float = 0.40
    w_time: float = 0.25
    w_stability: float = 0.35


@dataclass
class SAResult:
    """SA优化结果.

    属性:
        R_opt: 最优旋转矩阵 (3×3)
        cost: 最优代价
        cost_components: 代价分解 {support, time, stability, total}
        history: 收敛历史 [{iteration, temperature, cost_current, cost_best}, ...]
        euler_angles_deg: 欧拉角 {x, y, z}
        metrics: 详细指标 (兼容现有格式)
    """

    R_opt: np.ndarray
    cost: float
    cost_components: dict
    history: list[dict] = field(default_factory=list)
    euler_angles_deg: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.euler_angles_deg:
            self.euler_angles_deg = rotation_to_euler(self.R_opt)


# ═══════════════════════════════════════════════════════════════════════
# BedStabilityAnalyzer — Shapely 2D热床投影分析
# ═══════════════════════════════════════════════════════════════════════


class BedStabilityAnalyzer:
    """Shapely 2D热床投影稳定性分析器.

    分析给定旋转姿态下模型底部在热床上的2D投影，
    计算凸包面积、最小包围矩形、宽高比，综合得出稳定性评分(0~1)。

    若Shapely不可用，自动降级为朴素XY矩形分析。
    """

    def __init__(self, mesh: trimesh.Trimesh, R: np.ndarray):
        """初始化分析器.

        Args:
            mesh: trimesh网格对象
            R: 3×3旋转矩阵
        """
        self.mesh = mesh
        self.R = np.asarray(R, dtype=np.float64)
        self._use_shapely = True
        self._cached_bottom_2d: Optional[np.ndarray] = None

        # 尝试导入Shapely
        try:
            from shapely import convex_hull as _ch_fn
            from shapely.geometry import MultiPoint as _mp_cls

            self._convex_hull_fn = _ch_fn
            self._multipoint_cls = _mp_cls
        except ImportError:
            self._use_shapely = False
            logger.warning("Shapely不可用，热床稳定性降级为朴素XY矩形分析。安装: pip install 'shapely>=2.0,<3.0'")

    # ── 底部顶点提取 ──

    def bottom_vertices(self) -> np.ndarray:
        """提取旋转后模型底部顶点 (Z < z_min + ε).

        Returns:
            (N, 3) 底部顶点坐标数组
        """
        vertices = np.asarray(self.mesh.vertices, dtype=np.float64)
        rotated = vertices @ self.R.T
        z_all = rotated[:, 2]
        z_min = float(z_all.min())
        z_range = float(z_all.max()) - z_min
        eps = max(0.05, z_range * 0.005)
        bottom_mask = z_all < z_min + eps
        return rotated[bottom_mask]

    def project_to_xy(self, verts: np.ndarray) -> np.ndarray:
        """将3D顶点投影到XY平面 (舍弃Z).

        Args:
            verts: (N, 3) or (N, >=2) 顶点数组

        Returns:
            (N, 2) XY投影点
        """
        return np.asarray(verts[:, :2], dtype=np.float64)

    # ── Shapely 稳定性分析 ──

    def convex_hull_area(self) -> float:
        """Shapely凸包面积.

        Returns:
            凸包面积 (mm²)
        """
        pts_2d = self._get_bottom_2d()
        if len(pts_2d) < 3:
            return 0.0
        if self._use_shapely:
            mp = self._multipoint_cls(pts_2d.tolist())
            hull = self._convex_hull_fn(mp)
            return float(hull.area)
        else:
            return self._naive_bbox_area(pts_2d)

    def min_bounding_rect(self) -> tuple[float, float, float, float]:
        """最小包围矩形 (Shapely minimum_rotated_rectangle).

        Returns:
            (rect_area, width, height, angle_deg)
            其中 width >= height
        """
        pts_2d = self._get_bottom_2d()
        if len(pts_2d) < 3:
            return (0.0, 0.0, 0.0, 0.0)

        if self._use_shapely:
            mp = self._multipoint_cls(pts_2d.tolist())
            hull = self._convex_hull_fn(mp)
            rect = hull.minimum_rotated_rectangle

            # 退化情况：投影点共线时 min_rotated_rect 返回 LineString
            if rect.geom_type == "LineString" or rect.area < 1e-9:
                return (0.0, 0.0, 0.0, 0.0)

            # 提取矩形顶点坐标
            rect_coords = np.array(rect.exterior.coords)[:4]  # 去掉闭合重复点
            # 计算边长
            edges = np.diff(np.vstack([rect_coords, rect_coords[0]]), axis=0)[:4]
            lengths = np.linalg.norm(edges, axis=1)
            # 矩形有两对平行边，取两个不同长度（正方形则相同）
            unique_lengths = sorted(set(round(length_val, 6) for length_val in lengths), reverse=True)
            w = unique_lengths[0] if len(unique_lengths) > 0 else 0.0
            h = unique_lengths[1] if len(unique_lengths) > 1 else w  # 正方形: w==h
            if w < h:
                w, h = h, w
            area = float(rect.area)
            # 计算旋转角度
            v_edge = rect_coords[1] - rect_coords[0]
            angle = float(np.degrees(np.arctan2(v_edge[1], v_edge[0])))
            return (area, w, h, angle)
        else:
            # 降级: 使用轴对齐包围盒
            x_min, y_min = pts_2d[:, 0].min(), pts_2d[:, 1].min()
            x_max, y_max = pts_2d[:, 0].max(), pts_2d[:, 1].max()
            w = x_max - x_min
            h = y_max - y_min
            if w < h:
                w, h = h, w
            return (w * h, w, h, 0.0)

    def stability_score(self) -> float:
        """计算热床稳定性评分 B(R) ∈ [0, 1].

        评分公式:
            B = compactness × 0.6 + slenderness_penalty × 0.4
            其中:
                compactness = hull_area / rect_area  (凸包越接近矩形越稳)
                slenderness_penalty = 1.0 / max(1.0, aspect_ratio / 3.0)

        Returns:
            稳定性评分 (0=极不稳定, 1=完美稳定)
        """
        rect_area, rect_w, rect_h, _ = self.min_bounding_rect()
        hull_area = self.convex_hull_area()

        if rect_area < 1e-9 or hull_area < 1e-9:
            return 0.1  # 极小接触面 → 极不稳定

        # 凸包填充率
        area_ratio = hull_area / rect_area
        compactness = min(1.0, area_ratio)

        # 细长惩罚: 宽高比越大越不稳
        aspect_ratio = rect_w / max(rect_h, 1e-9)
        slenderness_penalty = 1.0 / max(1.0, aspect_ratio / 3.0)

        B = compactness * 0.6 + slenderness_penalty * 0.4
        return float(np.clip(B, 0.0, 1.0))

    def footprint_stats(self) -> dict:
        """完整足迹统计信息.

        Returns:
            {
                hull_area, rect_area, rect_width, rect_height,
                aspect_ratio, compactness, slenderness_penalty,
                stability_score, bottom_vertex_count, use_shapely
            }
        """
        rect_area, rect_w, rect_h, rect_angle = self.min_bounding_rect()
        hull_area = self.convex_hull_area()
        aspect_ratio = rect_w / max(rect_h, 1e-9) if rect_h > 1e-9 else 999.0
        area_ratio = hull_area / max(rect_area, 1e-9) if rect_area > 1e-9 else 0.0
        compactness = min(1.0, area_ratio)
        slenderness_penalty = 1.0 / max(1.0, aspect_ratio / 3.0)
        B = compactness * 0.6 + slenderness_penalty * 0.4

        pts_2d = self._get_bottom_2d()
        return {
            "hull_area": round(hull_area, 2),
            "rect_area": round(rect_area, 2),
            "rect_width": round(rect_w, 2),
            "rect_height": round(rect_h, 2),
            "rect_angle_deg": round(rect_angle, 1),
            "aspect_ratio": round(aspect_ratio, 2),
            "compactness": round(compactness, 4),
            "slenderness_penalty": round(slenderness_penalty, 4),
            "stability_score": round(B, 4),
            "bottom_vertex_count": len(pts_2d),
            "use_shapely": self._use_shapely,
        }

    # ── 内部辅助 ──

    def _get_bottom_2d(self) -> np.ndarray:
        """获取底部顶点的2D投影 (带缓存)."""
        if self._cached_bottom_2d is None:
            verts = self.bottom_vertices()
            self._cached_bottom_2d = self.project_to_xy(verts)
        return self._cached_bottom_2d

    def _naive_bbox_area(self, pts_2d: np.ndarray) -> float:
        """降级方案: XY轴对齐包围盒面积."""
        if len(pts_2d) < 3:
            return 0.0
        x_span = float(pts_2d[:, 0].max() - pts_2d[:, 0].min())
        y_span = float(pts_2d[:, 1].max() - pts_2d[:, 1].min())
        return x_span * y_span


# ═══════════════════════════════════════════════════════════════════════
# SimulatedAnnealingOptimizer — SA主优化器
# ═══════════════════════════════════════════════════════════════════════


class SimulatedAnnealingOptimizer:
    """模拟退火朝向优化器.

    在SO(3)连续旋转空间中搜索最优打印朝向。
    代价函数融合支撑体积、打印时间和Shapely热床稳定性。
    邻域生成采用Rodrigues旋转，扰动幅度随温度自适应缩放。
    """

    def __init__(
        self,
        mesh: trimesh.Trimesh,
        config: Optional[SAConfig] = None,
        weights: Optional[SACostWeights] = None,
    ):
        """初始化优化器.

        Args:
            mesh: trimesh网格对象
            config: 退火参数配置 (默认SAConfig())
            weights: 代价函数权重 (默认SACostWeights())
        """
        self.mesh = mesh
        self.config = config or SAConfig()
        self.weights = weights or SACostWeights()

        # 设置随机种子
        if self.config.random_seed is not None:
            np.random.seed(self.config.random_seed)

        # 预计算归一化参考值
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        self._max_dim = float(np.linalg.norm(vertices.max(axis=0) - vertices.min(axis=0)))
        if self._max_dim < 1e-9:
            self._max_dim = 1.0

        # 支撑体积归一化参考: bounding sphere体积 × 0.5
        center = (vertices.max(axis=0) + vertices.min(axis=0)) / 2.0
        max_radius = float(np.max(np.linalg.norm(vertices - center, axis=1)))
        sphere_vol = (4.0 / 3.0) * math.pi * (max_radius**3)
        self._support_norm = max(sphere_vol * 0.5, 1e-3)

        # BedStabilityAnalyzer 缓存
        self._bed_analyzer: Optional[BedStabilityAnalyzer] = None
        self._bed_analyzer_R_hash: Optional[int] = None

    # ── 代价函数 ──

    def cost_function(self, R: np.ndarray) -> float:
        """计算给定旋转的代价.

        cost = w_support*S + w_time*T + w_stability*(1-B)

        Args:
            R: 3×3旋转矩阵

        Returns:
            代价浮点数 (越小越好)
        """
        # 复用现有评分函数获取支撑和时间指标
        metrics = _score_orientation_3x3(self.mesh, R)

        # 支撑归一化
        S = min(1.0, metrics["support_volume"] / self._support_norm)

        # 时间归一化
        T = min(1.0, metrics["z_height"] / self._max_dim)

        # 热床稳定性
        B = self._get_bed_stability(R)

        cost = self.weights.w_support * S + self.weights.w_time * T + self.weights.w_stability * (1.0 - B)
        return float(cost)

    def _cost_detail(self, R: np.ndarray) -> dict:
        """代价函数详细分解 (调试用).

        Returns:
            {support_cost, time_cost, stability_cost, total,
             S, T, B, support_volume, z_height, max_dim}
        """
        metrics = _score_orientation_3x3(self.mesh, R)
        S = min(1.0, metrics["support_volume"] / self._support_norm)
        T = min(1.0, metrics["z_height"] / self._max_dim)
        B = self._get_bed_stability(R)

        support_cost = self.weights.w_support * S
        time_cost = self.weights.w_time * T
        stability_cost = self.weights.w_stability * (1.0 - B)
        total = support_cost + time_cost + stability_cost

        return {
            "support_cost": round(support_cost, 6),
            "time_cost": round(time_cost, 6),
            "stability_cost": round(stability_cost, 6),
            "total": round(total, 6),
            "S": round(S, 4),
            "T": round(T, 4),
            "B": round(B, 4),
            "support_volume": metrics["support_volume"],
            "z_height": metrics["z_height"],
            "max_dim": round(self._max_dim, 2),
            "support_norm": round(self._support_norm, 2),
        }

    def _get_bed_stability(self, R: np.ndarray) -> float:
        """获取给定旋转的热床稳定性评分 (带缓存)."""
        R_bytes = R.tobytes()
        if self._bed_analyzer is None or hash(R_bytes) != self._bed_analyzer_R_hash:
            self._bed_analyzer = BedStabilityAnalyzer(self.mesh, R)
            self._bed_analyzer_R_hash = hash(R_bytes)
        return self._bed_analyzer.stability_score()

    # ── 邻域生成 ──

    def neighbor(self, R: np.ndarray, temperature: float) -> np.ndarray:
        """在SO(3)空间生成邻域旋转.

        扰动幅度随温度降低而减小 (自适应步长):
        - 高温: 大步探索全局空间
        - 低温: 精细微调局部最优

        Args:
            R: 当前旋转矩阵 (3×3)
            temperature: 当前温度

        Returns:
            新的旋转矩阵 (3×3)
        """
        # 随机旋转轴: 单位球面均匀采样
        axis = np.random.randn(3)
        axis_norm = float(np.linalg.norm(axis))
        if axis_norm < 1e-12:
            axis = np.array([0.0, 0.0, 1.0])
        else:
            axis = axis / axis_norm

        # 随机角度: 高斯分布, 标准差随温度缩放
        std = self.config.neighbor_std * (temperature / max(self.config.T_init, 1e-9))
        angle = np.random.normal(0.0, std)

        # 限制最大扰动角 ±90° 避免完全翻转
        angle = np.clip(angle, -math.pi / 2, math.pi / 2)

        # Rodrigues 公式生成扰动旋转
        R_perturb = rodrigues_rotation(axis, angle)
        R_new = R_perturb @ R
        return R_new

    # ── Metropolis接受准则 ──

    @staticmethod
    def acceptance_prob(delta_cost: float, temperature: float) -> float:
        """Metropolis接受概率.

        Args:
            delta_cost: 代价变化 (新-旧, 负=改善)
            temperature: 当前温度

        Returns:
            接受概率 [0, 1]
        """
        if delta_cost <= 0:
            return 1.0
        if temperature < 1e-12:
            return 0.0
        return float(np.exp(-delta_cost / temperature))

    # ── 初始化旋转 ──

    def _get_init_rotation(self, use_coplanar: bool = True) -> np.ndarray:
        """获取SA初始旋转矩阵.

        策略优先级:
        1. 共面聚类最佳面 (快速启动)
        2. Fibonacci球面采样 (兜底)

        Args:
            use_coplanar: 是否使用共面聚类初始化

        Returns:
            3×3旋转矩阵
        """
        if use_coplanar:
            clusters = cluster_coplanar_faces(self.mesh)
            if clusters:
                best_cost = float("inf")
                best_R = np.eye(3)
                for cluster in clusters:
                    normal = np.array(cluster["normal"], dtype=np.float64)
                    up = -normal
                    up_norm = float(np.linalg.norm(up))
                    if up_norm < 1e-8:
                        continue
                    up = up / up_norm
                    if up[2] < 0:
                        up = -up
                    R = rotation_from_up_vector(up)[:3, :3]
                    c = self.cost_function(R)
                    if c < best_cost:
                        best_cost = c
                        best_R = R
                logger.info("SA初始化: 共面聚类最佳面, 初始代价=%.4f", best_cost)
                return best_R

        # Fibonacci球面采样兜底
        fib = fibonacci_sphere_sampling(64)
        best_cost = float("inf")
        best_R = np.eye(3)
        for up in fib:
            if up[2] < 0:
                up = -up
            R = rotation_from_up_vector(up)[:3, :3]
            c = self.cost_function(R)
            if c < best_cost:
                best_cost = c
                best_R = R
        logger.info("SA初始化: Fibonacci球面采样, 初始代价=%.4f", best_cost)
        return best_R

    # ── 自动校准初始温度 ──

    def _calibrate_T_init(self, R_init: np.ndarray) -> float:
        """通过随机采样代价分布自动校准初始温度.

        T_init = max(0.1, cost_std * 3)  # 3σ覆盖

        Args:
            R_init: 初始旋转矩阵

        Returns:
            校准后的初始温度
        """
        if not self.config.auto_calibrate_T:
            return self.config.T_init

        n = self.config.calibrate_samples
        sample_costs = [self.cost_function(R_init)]
        for _ in range(n - 1):
            R_rand = self.neighbor(R_init, temperature=self.config.neighbor_std * 2)
            sample_costs.append(self.cost_function(R_rand))

        cost_std = float(np.std(sample_costs))
        T_calibrated = max(0.1, cost_std * 3.0)
        logger.info("自动校准T_init: cost_std=%.4f → T_init=%.4f", cost_std, T_calibrated)
        return T_calibrated

    # ── 主优化循环 ──

    def optimize(self, R_init: Optional[np.ndarray] = None, use_coplanar_init: bool = True) -> SAResult:
        """执行模拟退火优化.

        Args:
            R_init: 初始旋转矩阵 (None则自动选择)
            use_coplanar_init: 是否用共面聚类初始化

        Returns:
            SAResult 包含最优旋转、代价、收敛历史等
        """
        # 1. 初始化
        if R_init is None:
            R_init = self._get_init_rotation(use_coplanar=use_coplanar_init)
        R_best = R_current = np.asarray(R_init, dtype=np.float64)
        cost_best = cost_current = self.cost_function(R_current)

        T = self._calibrate_T_init(R_init)
        history: list[dict] = []
        no_improve = 0

        logger.info(
            "SA优化开始: T_init=%.4f, max_iter=%d, patience=%d, cooling=%.3f",
            T,
            self.config.max_iter,
            self.config.patience,
            self.config.cooling_rate,
        )

        # 2. 主循环
        for k in range(self.config.max_iter):
            # 生成邻域候选
            R_candidate = self.neighbor(R_current, T)
            cost_candidate = self.cost_function(R_candidate)

            delta = cost_candidate - cost_current

            # Metropolis接受/拒绝
            if delta < 0 or np.random.random() < self.acceptance_prob(delta, T):
                R_current = R_candidate
                cost_current = cost_candidate
                if cost_current < cost_best:
                    R_best = R_current.copy()
                    cost_best = cost_current
                    no_improve = 0
                else:
                    no_improve += 1
            else:
                no_improve += 1

            # 记录历史
            history.append(
                {
                    "iteration": k,
                    "temperature": round(T, 6),
                    "cost_current": round(cost_current, 6),
                    "cost_best": round(cost_best, 6),
                }
            )

            # 温度衰减
            T *= self.config.cooling_rate

            # 终止条件
            if T < self.config.T_min:
                logger.info("SA收敛: 温度降至T_min (iter=%d)", k)
                break
            if no_improve >= self.config.patience:
                logger.info("SA早停: 连续%d步无改善 (iter=%d)", self.config.patience, k)
                break

        # 3. 计算最终详细指标
        cost_detail = self._cost_detail(R_best)
        final_metrics = _score_orientation_3x3(self.mesh, R_best)
        footprint = BedStabilityAnalyzer(self.mesh, R_best).footprint_stats()

        result = SAResult(
            R_opt=R_best,
            cost=cost_best,
            cost_components=cost_detail,
            history=history,
            euler_angles_deg=rotation_to_euler(R_best),
            metrics={
                **final_metrics,
                "footprint": footprint,
                "sa_iterations": len(history),
                "sa_final_temperature": T,
            },
        )

        logger.info(
            "SA优化完成: cost=%.4f, iter=%d, euler=(%.1f, %.1f, %.1f)",
            cost_best,
            len(history),
            result.euler_angles_deg.get("x", 0),
            result.euler_angles_deg.get("y", 0),
            result.euler_angles_deg.get("z", 0),
        )
        return result


# ═══════════════════════════════════════════════════════════════════════
# 便捷函数 — 与 get_best_face_for_slicing() 兼容的入口
# ═══════════════════════════════════════════════════════════════════════


def _load_mesh_sa(model_path: str) -> trimesh.Trimesh:
    """加载STL模型文件 (与 orientation.py 中 _load_mesh 相同逻辑)."""
    ext = os.path.splitext(model_path)[1].lower()
    _tmp = None
    if ext in (".stp", ".step"):
        import tempfile
        import subprocess

        fd, _tmp = tempfile.mkstemp(suffix=".stl", prefix="p3d_sa_step_")
        os.close(fd)
        result = subprocess.run(
            ["prusa-slicer", "--export-stl", "--output", _tmp, model_path],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 or not os.path.exists(_tmp):
            if _tmp and os.path.exists(_tmp):
                os.unlink(_tmp)
            raise ValueError(f"STEP文件转换失败: {os.path.basename(model_path)}")
        load_path = _tmp
    else:
        load_path = model_path

    try:
        mesh = trimesh.load(load_path, force="mesh")
        if isinstance(mesh, trimesh.Scene):
            meshes = mesh.dump()
            mesh = trimesh.util.concatenate(meshes)
        if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
            raise ValueError(f"无法加载模型: {model_path}")
        if not hasattr(mesh, "face_normals") or mesh.face_normals is None or len(mesh.face_normals) == 0:
            mesh = trimesh.Trimesh(
                vertices=mesh.vertices,
                faces=mesh.faces,
                process=True,
                validate=True,
            )
        return mesh
    finally:
        if _tmp and os.path.exists(_tmp):
            try:
                os.unlink(_tmp)
            except OSError:
                pass


def optimize_orientation_sa(
    model_path: str,
    *,
    sa_config: Optional[SAConfig] = None,
    weights: Optional[SACostWeights] = None,
    use_coplanar_init: bool = True,
) -> dict:
    """模拟退火朝向优化 — 一键入口，兼容 get_best_face_for_slicing() 返回格式.

    Args:
        model_path: STL模型文件路径
        sa_config: 退火参数配置
        weights: 代价函数权重
        use_coplanar_init: 是否用共面聚类初始化

    Returns:
        {
            oriented_path: str,          # 旋转后STL路径
            original_path: str,          # 原始模型路径
            rotation_matrix: [[...], ...],  # 3×3旋转矩阵
            euler_angles_deg: {x, y, z},  # 欧拉角(度)
            score: float,                # 归一化得分(0~100)
            cost: float,                 # SA原始代价
            cost_components: dict,       # 代价分解
            sa_history: [...],           # 收敛历史
            face: {...} | None,          # 共面簇信息(如有)
            tune_report: str,            # 微调报告
            all_candidates: [],          # (兼容字段)
        }
    """
    mesh = _load_mesh_sa(model_path)

    # 执行SA优化
    optimizer = SimulatedAnnealingOptimizer(mesh, config=sa_config, weights=weights)
    result = optimizer.optimize(use_coplanar_init=use_coplanar_init)

    # Z轴微调 (复用现有 fine_tune_orientation)
    tune = fine_tune_orientation(mesh, result.R_opt)
    R_opt = tune["R"]
    euler = rotation_to_euler(R_opt)

    # 应用旋转并导出STL
    from calculator.orientation import apply_orientation_to_mesh

    oriented_path = apply_orientation_to_mesh(model_path, R_opt)

    # 归一化得分: cost ∈ [0, ~1.5], 映射到 [0, 100]
    # 代价越低越好 → 得分越高越好
    max_cost = 1.5
    score = max(0.0, min(100.0, (1.0 - result.cost / max_cost) * 100.0))

    # 尝试获取共面簇信息
    face_info = None
    if use_coplanar_init:
        try:
            clusters = cluster_coplanar_faces(mesh)
            if clusters:
                # 找与最优旋转最接近的簇
                best_cluster = clusters[0]
                best_dot = -2.0
                for cluster in clusters:
                    normal = np.array(cluster["normal"], dtype=np.float64)
                    # 最优朝向的up向量
                    up_opt = R_opt[:, 2]  # Z轴在最优旋转下的方向
                    cluster_up = -normal / np.linalg.norm(normal)
                    dot = float(np.dot(cluster_up, up_opt))
                    if dot > best_dot:
                        best_dot = dot
                        best_cluster = cluster
                if best_dot > 0.7:
                    face_info = best_cluster
        except Exception:
            pass

    return {
        "oriented_path": oriented_path,
        "original_path": model_path,
        "rotation_matrix": [[round(float(R_opt[i, j]), 6) for j in range(3)] for i in range(3)],
        "euler_angles_deg": euler,
        "score": round(score, 2),
        "cost": round(result.cost, 6),
        "cost_components": result.cost_components,
        "sa_history": result.history,
        "face": face_info,
        "tune_report": f"SA退火优化 (iter={len(result.history)}, cost={result.cost:.4f})，{tune['report']}",
        "all_candidates": [],
    }
