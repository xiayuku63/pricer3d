# 修复：选面后贴合打印板 + FDM 平面约束

先读 project-context.md。

## 问题
1. 选面旋转后，面没有贴到 Z=0 打印板（模型悬浮或穿透）
2. FDM 打印机要求选的面必须是能平放在底板上的真实平面

## 修复

### calculator/orientation.py — 旋转后平移贴底
- `analyze_orientation` 返回的 `translation` 要确保选定面旋转后**最低点精确在 Z=0**
- 计算：旋转模型所有顶点 → 取旋转后选定面所有顶点的最小 Z 值 → 平移 -min_z

### viewer.js — 应用旋转时同步平移
- `applyOrientationRotation` 改为接收 `{euler, translation}` 
- 旋转模型后用 `currentMesh.position.z = translation_z` 下沉/抬升到 Z=0
- `resetOrientation` 重置 position 为 0

### main.js — 传递 translation
- `onFaceClicked` / 方向优化弹窗「应用」按钮 → 把 `translation` 传给 `applyOrientationRotation`

### FDM 约束
- `fine_tune_orientation` 中评估底面平坦度：底面的 Z 方差 < 0.1mm
- 不满足平坦度要求的候选角度跳过

改完 docker compose up -d --build app
不要跨行字符串
