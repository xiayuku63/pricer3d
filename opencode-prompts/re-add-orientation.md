# 任务：重新添加打印方向优化 + 手动旋转控制

## 重要：基础功能已稳定
- 预览按钮 ✅ 正常
- 3D 模型加载 ✅ 正常  
- FileReader 读取 ✅ 正常
- 页面其他功能 ✅ 正常

## 目标
在 3D 预览弹窗中添加：
1. 方向优化建议弹窗（推荐最优打印方向）
2. 预览区右侧的手动旋转面板（X/Y/Z 滑块）

## 具体改动

### index.html — 预览弹窗
- 预览弹窗改为左右分栏：`flex flex-col md:flex-row`
  - 左：3D 预览区 `w-full md:w-3/4 h-[55vh] md:h-[70vh]`
  - 右：控制面板 `w-full md:w-1/4 p-4 bg-gray-50`
- 控制面板内容：
  - 当前角度显示 X/Y/Z
  - 三个 range 滑块（-180~180，步长1）
  - 「方向优化建议」按钮 → 打开 orient-modal
  - 「重置」按钮 → 归零
- 下方新增「方向优化弹窗」orient-modal（完整保留之前的弹窗结构：loading/result/best/candidates/error）

### main.js
- 新增 orient 相关元素引用（orientSliderX/Y/Z, orientAngleX/Y/Z, orientSuggestBtn, orientResetBtn）
- 新增 orient-modal 相关元素引用
- openPreviewModal 中同步滑块到当前 quoteOptions.orientation
- 滑块 input 事件 → applyOrientationRotation + 更新角度显示
- 「方向优化建议」→ 打开 orient-modal，调用 /api/orientation/optimize
- 「重置」→ 归零
- orient-modal 里的候选方向点击 → 应用旋转到预览
- 结果表格行中不加「方向优化」按钮（只保留删除按钮）——方向优化入口仅在预览弹窗里

### viewer.js
- 重新添加 applyOrientationRotation(eulerAnglesDeg) 和 resetOrientation()
- 不要改动 renderSTL 现有逻辑

### backend
- calculator/orientation.py 和 app/routes_orientation.py 不动（已存在）

完成后 docker compose up -d --build app
