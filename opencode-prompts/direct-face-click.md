# 任务：预览图上直接点选面

先读 project-context.md 了解项目。

## 目标
用户打开预览后，直接点击 3D 模型上的任意面，自动旋转使该面朝下贴打印平台。
去掉「显示可摆放面」按钮的两步流程。

## 实现

### viewer.js
- 始终启用 Raycaster 面点击检测
- 点击面后通过回调返回被点击面的法向量 (Three.js world-space normal)
- 不需要预先高亮面

### main.js
- 打开预览后自动设置 faceClickHandler
- 收到面的法向量后：
  1. 用 Three.js Quaternion 计算旋转（法向 → 朝下）
  2. 更新滑块和数字输入
  3. 调用 applyOrientationRotation
- 删除「显示可摆放面」和「取消」按钮
- 删除 orient-face-list 候选列表
- 删除 getStableFaces API 调用相关代码

### 后端 - 不动

## 约束
- 改完 docker compose up -d --build app
