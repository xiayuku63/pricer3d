# 任务：3D打印件智能方向优化

请阅读 `opencode-prompts/project-context.md` 了解 pricer3d 项目背景。

## 目标
写一个程序，智能分析 3D 模型文件（STL / 3MF），自动推荐最优打印方向，以最小化支撑材料、缩短打印时间、保证底板附着力。

## 技术要求

### 1. 核心算法 — `calculator/orientation.py`
- 输入：STL/3MF 文件路径
- 生成候选方向：Fibonacci 球面采样 + 大面法向对齐
- 每个候选方向评估：
  - **支撑体积**：检测悬垂面（法向 Z 分量 < -cos(45°)），投影到 XY 平面估算支撑量
  - **Z 高度**：打印时间代理指标
  - **底板接触面积**：使用 ConvexHull 估算
- 加权评分（支撑 50%、时间 30%、附着力 20%），返回 top-N 最优方向
- 输出：旋转矩阵 + Euler 角 + 各指标分数

### 2. API 端点 — `app/routes_orientation.py`
- `POST /api/orientation/optimize` — 接收上传文件，返回最优方向列表
- 复用现有认证中间件
- 注册到 `app/__init__.py` 的 create_app()

### 3. 前端展示
- 在报价结果中展示推荐旋转角度（X/Y/Z 度）
- 显示预估支撑节省百分比

## 已有依赖
- `trimesh`, `numpy` — 已安装
- `scipy` — 如需 ConvexHull 可用 scipy 或手动实现
- 3MF 解析：`parser/geometry.py` 里 `_extract_geometry_from_3mf()`

## 注意事项
- 改完后 `docker compose up -d --build app` 部署
- 文件头加 docstring 说明用法
