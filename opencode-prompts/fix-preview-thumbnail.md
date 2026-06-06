# 紧急修复：预览列缩略图不显示

## 问题
pricer3d 报价结果表格中，「预览」列的表头存在，但每行里的预览缩略图/按钮没有渲染出来（整个单元格内容为空）。

## 需要做的事
1. 检查 `renderResultsTable()` 函数中预览列的渲染逻辑
2. 对比成功行和失败行的预览按钮 HTML 是否一致
3. 检查 `buildPlaceholderThumbnail()` 返回的 SVG data URI 是否有效
4. 如果 SVG 有问题，先用纯文本 "预览" 链接替代缩略图，确保按钮能点
5. 修复后 `docker compose up -d --build app`
