# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v0.36.1] - 2026-06-16

### Changed
- ZIP 材料从清单自动读取
- 缩略图颜色从清单源获取

## [v0.36.0] - 2026-06-15

### Added
- ZIP 上传处理中新增取消按钮
- ZIP 取消按钮 i18n 键值及后端 processed 字段

## [v0.35.0] - 2026-06-15

### Added
- 删除品牌 Logo 按钮

## [v0.24.2] - 2026-06-13

### Added
- i18n 语言包系统 — 完整多语言支持
- 深色模式支持
- 用户中心重构

### Changed
- 材料设置优化

## [v0.21.2] - 2026-06-07

### Fixed
- 超尺寸模型保留几何信息，仅标记失败不计价

## [v0.21.1] - 2026-06-07

### Changed
- 切片参数卡片风格统一
- 大模型 hover 时展示失败原因

### Fixed
- 尺寸校验改用内置 PRINTER_MODELS 查询

## [v0.20.0] - 2026-06-06

### Added
- 切片参数集成
- 报价页面材料选择器

## [v0.19.0] - 2026-06-06

### Added
- 打印机参数管理
- 材料分类系统（品牌/类型/材料三级管理）
- 品牌/类型 datalist 输入 + 自定义徽章指示器
- 自定义打印机型号 + 动态层高校验
- 前端显示打印机速度参数（只读，硬件绑定）
- 前端重构 + 后端速度参数集成 + 尺寸校验
- 状态简化 + gcode 详情折叠

### Changed
- CI/CD GitHub Actions 自动部署工作流
- README 完整项目文档
- PrusaSlicer 尝试从 2.7.2 升级至 2.9.3（后 revert 回 2.7.2）

## [v0.18.0] - 2026-06-06

### Fixed
- 注册流程验证码从步骤2移至步骤3（提交前验证），提升用户体验


## [v0.13.0] - 2026-05-30

### Added
- ZIP 上传功能 — Excel 清单 + STL 模型打包上传，自动匹配参数切片
- ZIP 清单打印机 + 喷嘴批量运用 — 名称→compound_id 解析，per-file pricing_config

### Changed
- 拆分 `index.html` (907行) 为 12 个 partial 文件 + `routes_pages.py` 动态拼接

### Fixed
- 修复 HTML partials 中 read_file 行号前缀污染，恢复原始内容
- ZIP 预览和批量重算 — `_saved_path` → `checklist_file_path` 避免 FastAPI 过滤
- 移除难度系数系统、ZIP 上传支持默认打印机/预设、表格列简化

## [v0.12.3] - 2026-05-30

### Fixed
- 批量设置工具栏修改参数不再自动触发重算

## [v0.12.2] - 2026-05-30

### Fixed
- 批量设置时显示「重新计算中」而非旧时间/价格

## [v0.12.0] - 2026-05-30

### Added
- i18n 全覆盖 — presets / settings / membership / orientation / preview / history 全部国际化

### Fixed
- 修复默认预设不生效 — fetchUserSettings 同步 defaultSlicerPresetId 到 quoteOptions
- 修复 initViewer 异常导致按钮无响应 — try-catch 保护 + 诊断日志

## [v0.11.0] - 2026-05-30

### Added
- i18n 中英双语 — 语言切换器 + 翻译模块 (auth / quote / index)

## [v0.10.5] - 2026-05-29

### Added
- 磁盘自动清理 — gcode 7天 / 上传30天过期自动删除

## [v0.10.4] - 2026-05-29

### Fixed
- 修复用户中心喷嘴被打印机默认值覆盖
- 保存默认后用户中心选择器回退 — fetchPrinterModels 加 await + 打开用户中心时刷新

## [v0.10.3] - 2026-05-29

### Fixed
- 保存默认设置后批量工具栏实时同步

## [v0.10.2] - 2026-05-29

### Fixed
- 默认设置竞态 + 隐藏打印机过滤遗漏
- 统一默认配置项视觉风格：打印机/喷嘴/预设标签加琥珀色「默认项」徽章

## [v0.10.1] - 2026-05-29

### Added
- 切片预设默认选用户组合；喷嘴可清空；上传前提醒未设置打印机/喷嘴/预设

## [v0.9.9] - 2026-05-29

### Fixed
- Fix system preset print:custom section overriding quote form layer_height via reversed-order write dedup
- G-code detail rows auto-expanded by default
- Always send manual slicing params alongside preset; backend handles precedence

## [v0.9.8] - 2026-05-29

### Fixed
- Fix per-file slicer preset not applying, total price lingering during recalc, row edit error state recovery

## [v0.9.5] - 2026-05-28

### Fixed
- 修复自定义预设参数被表单默认值覆盖
- 修复预设参数完全不生效（两个根因）
- 移除预设设置中的顶部/底部外壳层数和底边宽度
- 统一参数名为切片软件标准术语（外墙层数 / 顶部外壳层数 / 底部外壳层数 / 初始层高 / 填充密度）

## [v0.9.4] - 2026-05-28

### Changed
- Bambu A1 设为默认打印机

## [v0.9.3] - 2026-05-28

### Fixed
- 修复切片参数不生效 Bug

## [v0.9.2] - 2026-05-27

### Added
- G-code 分析自动集成 — 切片后自动解析并在前端展示详情

## [v0.9.1] - 2026-05-27

### Changed
- 缩短上传文件名（UUID 32→8 位 + stem 80→40 字符）

## [v0.9.0] - 2026-05-27

### Added
- 新增 STP/STEP 文件支持
- 修复 PrusaSlicer INI section headers preserved — layer_height & infill now actually applied

## [v0.8.0] - 2026-05-27

### Added
- 切片配置 / 机型配置 PrusaSlicer 风格改造，新增层高 / 顶底实心层 / 底边宽度参数

## [v0.7.9] - 2026-05-27

### Added
- 配置 Resend API key，邮箱验证正式可用

## [v0.7.8] - 2026-05-27

### Added
- 注册邮箱验证修复 + 数据库健康检查工具

## [v0.7.7] - 2026-05-27

### Added
- 打印机名称绑定喷嘴 + 预设表单独立打印机选择器联动喷嘴

### Changed
- 本地 Docker 部署

## [v0.7.6] - 2026-05-27

### Fixed
- 用户中心切换 tab 固定内容区最小高度，防对话框跳动
- 拆分 orientation.py 为 4 模块 + 修复智能摆放点击无响应
- 登录表单支持浏览器密码管理器保存凭据

## [v0.7.5] - 2026-05-27

### Fixed
- auth.js 缺 loadUserSession 导入导致刷新掉登录

## [v0.7.4] - 2026-05-27

### Fixed
- 批量设置颜色下拉改用 compact 模式

## [v0.7.3] - 2026-05-27

### Fixed
- compact 颜色色块添加边框，浅色不再融入背景

## [v0.7.2] - 2026-05-26

### Changed
- 颜色统一只显示色块 + hex 色号，不显示颜色名称
- 色块边框加深为 gray-400，白色 #ffffff 等浅色可见

## [v0.7.1] - 2026-05-26

### Fixed
- 修复批量颜色 hex 重复 + 批量设置先改模型再计算

## [v0.7.0] - 2026-05-26

### Added
- 登录自动回填用户名 + JWT remember_me 30 天支持
- 新增材料默认同时包含黑色 #000000 和白色 #ffffff

## [v0.6.2] - 2026-05-26

### Fixed
- 登录表单密码自动填充 + 验证码左对齐
- 移除 support_mode=diff 的二次切片，改为强制带支撑单次切片 (-50% 计算时间)

## [v0.6.0] - 2026-05-26

### Added
- 批量设置打印材料 / 颜色 / 数量工具栏
- 每种材料至少内置黑色 #000000 作为默认颜色

## [v0.5.0] - 2026-05-26

### Changed
- 前端模块化重构 + Bambu 清理 + orientation / preview 模块
- 代码审查清理 + 默认 A1 + 时间拆分为单件/总时间
- 加 Voron / Prusa profile + 去主页打印机残留

### Added
- 打印机-Bambu 内置 Profile + 报价页打印机选择器

## [v0.3.0] - 2026-05-16

### Added
- 打印机机型配置 — 去上传/预设改名/材料重命名
- PrusaSlicer 大文件 gcode 统计解析 + 3MF 切片支持
- 原生 3MF XML 几何解析 — 不再依赖 PrusaSlicer
- 3MF 文件解析 + 非 STL 格式预览提示

## [v0.2.1] - 2026-05-15

### Changed
- 报价历史改为独立弹窗，与用户中心平级

## [v0.2.0] - 2026-05-15

### Added
- 前端版本号 + /api/version 端点
- Pydantic v2 Schemas 层 — API 请求/响应模型
- 并行切片 + 限流持久化 + 密码重置 + 错误通知 + 备份 cron
- 报价历史前端 + 59 测试 + Docker 生产镜像
- 拖拽上传 + 报价历史 + 移动适配
- JS 拆分 + viewer / history / state 模块
- 45 个自动化测试 (计算+API)

### Changed
- 模块化拆分 3014 行 → app/ 14 个模块 + 10 行 main.py
- 统一错误处理 — {code, message, data} 格式
- 配置层改用 pydantic-settings
- 重写 PrusaSlicer 切片引擎 — 配置合并+临时文件加载

### Fixed
- requirements.txt 补充 pydantic-settings / python-docx / openpyxl
- PrusaSlicer diff 模式切片时间丢失
- HTML 路由和导入问题
- VerifySendRequest 去除多余 captcha 字段，修复邮箱验证码

### Security
- 清理敏感文件 — .env 移出版本控制
- 生产加固 — 日志系统 / lifespan / DB 备份 / 安全头 / 健康检查

---

*Generated from git history on 2026-06-06.*
