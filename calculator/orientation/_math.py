"""Math utilities: Fibonacci sampling, rotations, Euler conversion."""

import math
import numpy as np


def fibonacci_sphere_sampling(n: int) -> np.ndarray:
    points = np.zeros((n, 3))
    phi = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - (i / max(n - 1, 1)) * 2.0
        r = math.sqrt(1.0 - y * y)
        theta = phi * i
        points[i] = [r * math.cos(theta), r * math.sin(theta), y]
    return points


def rodrigues_rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    axis = np.asarray(axis, dtype=np.float64)
    axis_norm = float(np.linalg.norm(axis))
    if axis_norm < 1e-12:
        return np.eye(3)
    axis = axis / axis_norm
    K = np.array(
        [
            [0.0, -axis[2], axis[1]],
            [axis[2], 0.0, -axis[0]],
            [-axis[1], axis[0], 0.0],
        ],
        dtype=np.float64,
    )
    c = math.cos(angle)
    s = math.sin(angle)
    R = np.eye(3, dtype=np.float64) + s * K + (1.0 - c) * (K @ K)
    return R


def align_face_to_z(normal: np.ndarray) -> np.ndarray:
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


def _clean_value(v: float) -> float:
    if math.isnan(v) or math.isinf(v):
        return 0.0
    return round(v, 6)
