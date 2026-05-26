# 任务：依照专业规格书重建3D打印朝向优化系统

先读 project-context.md 了解项目。

## 角色
你是一个专业的3D打印切片预处理AI助手，精通计算几何和增材制造工艺。核心任务是根据用户指定的"放置平面"，自动确定并输出3D模型的最佳打印朝向。

## 输入
- 三维模型文件（STL/3MF）
- 用户选择的目标平面（法向量）

## 输出
1. **旋转矩阵**（3x3矩阵）：将模型从原始方向变换到打印朝向
2. **平移向量**：确保模型底部最低点贴于Z=0平面
3. **智能微调报告**：简要说明为何选择最终朝向

## 内部处理（三步）

### 步骤1：模型分析
- 计算目标平面的法向量 \( N_{face} \)（归一化）
- 计算平面中心点 \( C_{face} \)

### 步骤2：计算变换
- 平台法向量 \( N_{plate} = (0, 0, 1) \)
- 旋转轴：\( axis = N_{face} \times N_{plate} \)
- 旋转角：\( \theta = \arccos(N_{face} \cdot N_{plate}) \)
- 用罗德里格斯公式生成旋转矩阵 R
- 将 R 应用于模型所有顶点

### 步骤3：智能微调（关键！）
在步骤2对齐基础上，绕Z轴扫描（-30°~+30°，步长 1°），评估每个角度：
- 悬垂面积（支撑量）
- 底部接触面积（ConvexHull）
- 综合评分

默认优先减少支撑量，支撑无差异时增大接触面积。

## 实现

### calculator/orientation.py — 重建 analyze_orientation
- 实现 `rodrigues_rotation(axis, angle)` → 3x3 矩阵
- 实现 `align_face_to_z(normal)` → 旋转矩阵
- 实现 `fine_tune_orientation(mesh, R_base)` → 扫描 Z 旋转，评分，返回最优
- `analyze_orientation(file)` 对于方向优化 API，用当前朝向作为目标法向

### app/routes_orientation.py — 调整 optimize 端点
- 接收 file + `face_normal` 参数
- 调用步骤1→2→3
- 返回 `{rotation_matrix, translation, euler_angles_deg, report}`

### 前端 main.js — 点面后自动调用新 API
- 点击面的法向量传给 `/api/orientation/optimize`
- 显示旋转矩阵 + 微调报告 + 应用到预览

## 示例输出格式
```json
{
  "rotation_matrix": [[0.965, -0.258, 0.042], [0.258, 0.965, -0.032], [-0.035, 0.045, 0.998]],
  "translation": [0, 0, -2.3],
  "euler_angles_deg": {"x": -1.8, "y": 2.4, "z": 15.0},
  "report": "在用户指定法向对齐基础上，绕Z轴微调15°以消除悬垂"
}
```

## 约束
- 不改变模型拓扑
- 始终输出确定数值
- 默认优先生：最小化支撑 > 最大化接触面积
- 改完 docker compose up -d --build app
