"""3D rotation math utilities for orientation optimization.

Pure math functions with no project dependencies — safe for any module to import.
"""

import math
import numpy as np


def fibonacci_sphere_sampling(n: int) -> np.ndarray:
    """Generate n nearly-uniform points on the unit sphere using Fibonacci spiral."""
    points = np.zeros((n, 3))
    phi = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - (i / max(n - 1, 1)) * 2.0
        r = math.sqrt(1.0 - y * y)
        theta = phi * i
        points[i] = [r * math.cos(theta), r * math.sin(theta), y]
    return points


def rodrigues_rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    """Rodrigues rotation formula — rotate around an arbitrary axis."""
    axis = np.asarray(axis, dtype=np.float64)
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm < 1e-12:
        return np.eye(3)
    axis = axis / axis_norm
    K = np.array([
        [0.0, -axis[2], axis[1]],
        [axis[2], 0.0, -axis[0]],
        [-axis[1], axis[0], 0.0],
    ], dtype=np.float64)
    c = math.cos(angle)
    s = math.sin(angle)
    R = np.eye(3, dtype=np.float64) + s * K + (1.0 - c) * (K @ K)
    return R


def align_face_to_z(normal: np.ndarray) -> np.ndarray:
    """Compute rotation matrix that aligns a face normal to +Z axis."""
    normal = np.asarray(normal, dtype=np.float64)
    n2 = float(np.linalg.norm(normal))
    if n2 < 1e-12:
        return np.eye(3)
    normal = normal / n2
    z_axis = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    v = np.cross(normal, z_axis)
    s = float(np.linalg.norm(v))
    c = float(np.clip(np.dot(normal, z_axis), -1.0, 1.0))
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    return rodrigues_rotation(v / s, math.acos(c))


def rotation_to_euler(R: np.ndarray) -> dict:
    """Convert a 3x3 or 4x4 rotation matrix to Euler angles (degrees)."""
    if R.shape == (4, 4):
        R3 = R[:3, :3].astype(np.float64)
    else:
        R3 = np.asarray(R, dtype=np.float64)[:3, :3]
    sy = math.sqrt(float(R3[0, 0]) ** 2 + float(R3[1, 0]) ** 2)
    singular = sy < 1e-6
    if not singular:
        x = math.atan2(float(R3[2, 1]), float(R3[2, 2]))
        y = math.atan2(-float(R3[2, 0]), sy)
        z = math.atan2(float(R3[1, 0]), float(R3[0, 0]))
    else:
        x = math.atan2(-float(R3[1, 2]), float(R3[1, 1]))
        y = math.atan2(-float(R3[2, 0]), sy)
        z = 0.0
    return {
        "x": round(math.degrees(x), 1),
        "y": round(math.degrees(y), 1),
        "z": round(math.degrees(z), 1),
    }


def rotation_from_up_vector(up: np.ndarray) -> np.ndarray:
    """Compute 4x4 rotation matrix so that the given up vector points to +Z."""
    z = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    up = np.asarray(up, dtype=np.float64)
    norm = float(np.linalg.norm(up))
    if norm < 1e-12:
        return np.eye(4)
    up = up / norm
    v = np.cross(up, z)
    s = float(np.linalg.norm(v))
    c = float(np.dot(up, z))
    if s < 1e-8:
        R3 = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:
        R3 = rodrigues_rotation(v / s, math.acos(c))
    result = np.eye(4)
    result[:3, :3] = R3
    return result


def euler_to_up_vector(x_deg: float, y_deg: float, z_deg: float) -> np.ndarray:
    """将用户欧拉角 (Three.js XYZ intrinsic 顺序) 转换为打印上方向向量。

    前端 Three.js 使用 XYZ intrinsic 旋转顺序，用户手动调整的朝向以
    欧拉角 (x, y, z) 传入。此函数计算出该旋转下原始 Z 轴 (打印时竖直方向)
    所指的向量，用于与候选面法向进行匹配。

    Args:
        x_deg: X 轴旋转角度 (度)
        y_deg: Y 轴旋转角度 (度)
        z_deg: Z 轴旋转角度 (度)

    Returns:
        shape=(3,) 单位向量，指向打印时的上方向 (指向 +Z 打印热床)
    """
    rx = math.radians(x_deg)
    ry = math.radians(y_deg)
    rz = math.radians(z_deg)

    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    # Three.js XYZ intrinsic 旋转: R = Rz @ Ry @ Rx
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], dtype=np.float64)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float64)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], dtype=np.float64)
    R = Rz @ Ry @ Rx

    # 原始 Z 轴经过旋转后的方向 → 底面法向的反方向 (即"上"方向)
    up = R @ np.array([0.0, 0.0, 1.0], dtype=np.float64)
    # 确保指向上方 (Z>0)
    if up[2] < 0:
        up = -up
    return up
