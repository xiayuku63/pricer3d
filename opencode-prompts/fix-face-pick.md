# 修复：可摆放面不显示

## 问题
预览弹窗中点击「显示可摆放面」按钮后，3D 模型上应该高亮的灰白色面没有加载出来。

## 后台已验证
- `get_stable_faces()` 正常，测试返回 4 个面
- API `/api/orientation/faces` 端点已注册

## 需要排查
1. `orientFacePickBtn` 点击后 `currentPreviewFilename` 是否有值
2. `selectedFilesMap.get(currentPreviewFilename)` 是否拿到文件
3. API 调用是否成功（看 Network 面板 `/api/orientation/faces` 的响应）
4. `highlightFaces(faceIndices)` 传入的 faceIndices 是否为空
5. Three.js 面索引与 trimesh 面索引是否一致（STLLoader 可能重排面）

## 修复方向
- 如果面索引不一致：改用法向量匹配而非索引匹配
- 如果 API 没调通：检查 auth header
- 如果 highlightFaces 有问题：加 console.log 调试

改完 docker compose up -d --build app
