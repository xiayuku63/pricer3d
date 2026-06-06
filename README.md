# pricer3d — 项目导航文档

> **面向 AI 编码助手的快速检索指南。** 每个文件/目录一句话说明用途，附带关键入口点。

**版本**: 0.3.0 | **技术栈**: FastAPI + SQLite + Three.js + PrusaSlicer | **部署**: Docker

---

## 一、目录地图

```
pricer3d/
│
├── main.py                          # ★ 应用入口，uvicorn 启动
├── requirements.txt                 # Python 依赖清单
├── VERSION                          # 语义化版本号
├── pyproject.toml                   # 项目元数据
│
├── app/                             # ★ 后端核心
│   ├── __init__.py                  # ★ FastAPI 工厂函数 + 全部路由注册（173行，最核心的入口）
│   ├── config.py                    # 配置常量、正则模式、从 settings 重新导出
│   ├── settings.py                  # pydantic-settings 环境变量加载
│   ├── database.py                  # ★ SQLite 建表 + 迁移（raw SQL，init_db）
│   ├── db.py                        # SQLAlchemy ORM session 工厂
│   ├── models.py                    # Pydantic 请求/响应模型（RegisterRequest, MaterialItem, PricingConfig...）
│   ├── models_orm.py                # SQLAlchemy ORM 模型（User, QuoteHistory, PaymentOrder...）
│   ├── models_sql.py                # SQLite raw-SQL 数据模型（如存在）
│   ├── deps.py                      # FastAPI 依赖注入（get_current_user, get_membership_effective）
│   │
│   │   # ── 路由模块（REST API 端点实现）──
│   ├── routes_auth.py               # 注册/登录/验证码/密码重置
│   ├── routes_quote.py              # ★ 核心报价端点（POST /api/quote, GET /api/quote/history）
│   ├── routes_slicer.py             # 切片预设 CRUD（create/update/delete/download preset）
│   ├── routes_orientation.py        # 模型摆放优化、共面检测、训练采样
│   ├── routes_preview.py            # 3D 预览图生成（模型缩略图）
│   ├── routes_user.py               # 用户设置、改密码
│   ├── routes_admin.py              # 管理员：默认值管理、用户列表、审计、备份
│   ├── routes_billing.py            # 会员订阅、支付订单、webhook
│   ├── routes_pages.py              # HTML 页面路由（index, register, legal, admin, health）
│   │
│   │   # ── 基础设施 ──
│   ├── auth.py                      # JWT 生成/验证、密码哈希
│   ├── middleware.py                # 安全头、速率限制
│   ├── errors.py                    # 统一异常处理器（{code, message, data} 格式）
│   ├── rate_limiter.py              # 令牌桶限流实现
│   ├── captcha.py                   # 验证码生成
│   ├── audit.py                     # 审计事件写入
│   ├── backup.py                    # 数据库备份
│   ├── utils.py                     # 工具函数（路径、材料规范化）
│   ├── printers.py                  # 打印机机型配置
│   ├── slicer_presets.py            # 切片预设业务逻辑
│   ├── error_notify.py              # 错误通知
│   ├── logging_config.py            # 日志配置
│   ├── metrics.py                   # 监控指标
│   │
│   └── schemas/                     # 响应 Schema 定义
│       ├── auth.py                  # TokenResponse, CaptchaResponse
│       ├── common.py                # PaginatedData 通用分页
│       ├── quote.py                 # QuoteResponse, QuoteHistoryItem
│       └── user.py                  # MembershipPlan, BillingOrder
│
├── calculator/                      # ★ 报价计算引擎（独立模块）
│   ├── cost.py                      # ★ 核心成本计算 + 公式验证 + 单文件处理 pipeline
│   └── orientation.py               # 模型摆放优化算法
│
├── parser/                          # 切片引擎封装
│   ├── prusa_slicer.py              # PrusaSlicer CLI 调用封装
│   └── geometry.py                  # STL 几何解析（体积、表面积、包围盒）
│
├── profiles/                        # 打印机 & 切片配置文件
│   └── prusa/                       # PrusaSlicer INI 配置
│       ├── print.ini                # 通用打印参数
│       └── printers/                # 各机型 INI（prusa_mk4, voron_v2_250）
│
├── static/                          # ★ 前端
│   ├── index.html                   # ★ 主页面（3D 查看器 + 报价表单）
│   ├── register.html                # 注册页
│   ├── admin_users.html             # 管理后台
│   └── js/
│       ├── main.js                  # ★ 主入口 JS（合并版）
│       ├── main.js.clean            # 清理版
│       ├── main.js.latest           # 最新版
│       ├── main.js.layface          # 含 LayFace 的版本
│       ├── register.js              # 注册页逻辑
│       ├── admin_users.js           # 管理页逻辑
│       ├── vendor/
│       │   ├── three.module.js      # Three.js 核心库
│       │   └── addons/
│       │       ├── loaders/STLLoader.js    # STL 文件加载
│       │       ├── loaders/GLTFLoader.js   # GLTF 文件加载
│       │       ├── controls/OrbitControls.js # 轨道摄像机
│       │       └── utils/BufferGeometryUtils.js
│       └── modules/
│           ├── viewer.js            # ★ Three.js 3D 查看器（渲染、相机、交互）
│           ├── layface.js           # ★ Lay on Face 交互（面片高亮、点击贴合底板）
│           ├── state.js             # 前端状态管理
│           └── history.js           # 报价历史弹窗
│
├── deploy/                          # 部署运维脚本
│   ├── docker-entrypoint.sh         # ★ Docker 容器入口
│   ├── docker_deploy.sh             # 部署脚本
│   ├── nginx_pricer3d.conf          # Nginx 反向代理配置
│   ├── nginx_docker.conf            # Docker 内 Nginx
│   ├── init-ssl.sh                  # ★ 首次 SSL 证书申请脚本
│   ├── test-nginx-config.sh         # Nginx 配置语法测试
│   ├── HTTPS_SETUP.md               # HTTPS 部署文档
│   ├── pricer3d.service             # Systemd 服务文件
│   ├── backup_app_db.sh             # 数据库备份
│   ├── backup_cron.sh               # 定时备份
│   ├── restore_app_db.sh            # 数据库恢复
│   ├── certbot_renew.cron           # SSL 证书自动续期
│   ├── update.sh                    # 更新部署
│   └── mihomo_config.yaml           # Mihomo 代理配置
│
├── alembic/                         # 数据库迁移（Alembic）
│   ├── env.py                       # 迁移环境配置
│   └── versions/04e205d19794_initial_schema.py  # 初始建表迁移
│
├── tests/                           # 测试
│   ├── test_calculations.py         # 报价计算测试
│   ├── test_auth.py                 # 认证测试
│   └── test_geometry.py             # 几何解析测试
│
├── opencode-prompts/                # OpenCode/Claude Code 任务提示词存档
│   ├── project-context.md           # 项目上下文概览
│   ├── fix-face-pick.md             # 面片选取修复
│   ├── face-metrics.md              # 面片度量
│   ├── orientation-optimizer.md     # 摆放优化器
│   ├── professional-orientation.md  # 专业摆放
│   ├── direct-face-click.md         # 直接点击面片
│   └── ...（其他已完成的任务提示词）
│
├── docker-compose.yml               # ★ Docker 编排（开发）
├── docker-compose.prod.yml          # Docker 编排（生产）
├── Dockerfile                       # ★ 应用镜像
├── Dockerfile.prod                  # 生产镜像
├── .env.example                     # 环境变量模板
├── .env                             # 实际环境变量（不提交）
├── .github/workflows/ci.yml         # CI 流程
└── logs/                            # 运行日志
```

---

## 二、API 端点速查

| 方法 | 路径 | 功能 | 文件 |
|------|------|------|------|
| **页面** |||
| GET | `/` | 主页 (SPA) | `routes_pages.py` |
| GET | `/register` | 注册页 | `routes_pages.py` |
| GET | `/admin/users` | 管理后台 | `routes_pages.py` |
| GET | `/legal/terms` | 服务条款 | `routes_pages.py` |
| GET | `/legal/privacy` | 隐私政策 | `routes_pages.py` |
| **认证** |||
| GET | `/api/auth/captcha` | 获取验证码 | `routes_auth.py` |
| GET | `/api/auth/captcha/image/{id}` | 验证码图片 | `routes_auth.py` |
| POST | `/api/auth/verify/send` | 发送邮箱/手机验证码 | `routes_auth.py` |
| POST | `/api/auth/verify/confirm` | 确认验证码 | `routes_auth.py` |
| POST | `/api/auth/register/check` | 检查用户名/邮箱/手机是否存在 | `routes_auth.py` |
| POST | `/api/auth/register` | 注册 | `routes_auth.py` |
| POST | `/api/auth/login` | 登录（返回 JWT） | `routes_auth.py` |
| GET | `/api/auth/me` | 获取当前用户信息 | `routes_auth.py` |
| POST | `/api/auth/password/reset/request` | 请求密码重置 | `routes_auth.py` |
| POST | `/api/auth/password/reset/confirm` | 确认密码重置 | `routes_auth.py` |
| **报价** |||
| POST | `/api/quote` | ★ 上传 STL 文件获取报价 | `routes_quote.py` |
| GET | `/api/quote/history` | 报价历史（分页） | `routes_quote.py` |
| POST | `/api/formula/validate` | 验证自定义公式 | `routes_quote.py` |
| **切片** |||
| GET | `/api/slicer/presets` | 列出切片预设 | `routes_slicer.py` |
| POST | `/api/slicer/presets/generate` | 生成默认预设 | `routes_slicer.py` |
| POST | `/api/slicer/presets` | 创建/更新预设 | `routes_slicer.py` |
| GET | `/api/slicer/presets/{id}/download` | 下载预设文件 | `routes_slicer.py` |
| DELETE | `/api/slicer/presets/{id}` | 删除预设 | `routes_slicer.py` |
| GET | `/api/slicer/printers` | 列出打印机机型 | `routes_slicer.py` |
| **摆放优化** |||
| POST | `/api/orientation/optimize` | 优化模型摆放方向 | `routes_orientation.py` |
| POST | `/api/orientation/faces` | 列出稳定面 | `routes_orientation.py` |
| POST | `/api/orientation/coplanar` | 共面面簇检测 | `routes_orientation.py` |
| POST | `/api/orientation/train` | 训练样本采集 | `routes_orientation.py` |
| **用户** |||
| GET | `/api/user/settings` | 获取用户设置 | `routes_user.py` |
| PUT | `/api/user/settings` | 更新用户设置 | `routes_user.py` |
| POST | `/api/users/change-password` | 修改密码 | `routes_user.py` |
| **管理** |||
| GET | `/api/admin/defaults` | 获取系统默认值 | `routes_admin.py` |
| POST | `/api/admin/defaults/from-me` | 将当前用户设置设为系统默认 | `routes_admin.py` |
| GET | `/api/admin/users` | 用户列表 | `routes_admin.py` |
| POST | `/api/admin/users/{id}/membership` | 更新用户会员 | `routes_admin.py` |
| GET | `/api/admin/audit` | 审计日志 | `routes_admin.py` |
| GET | `/api/admin/metrics` | 系统指标 | `routes_admin.py` |
| POST | `/api/admin/maintenance/cleanup` | 清理过期数据 | `routes_admin.py` |
| POST | `/api/admin/maintenance/backup` | 创建备份 | `routes_admin.py` |
| GET | `/api/admin/maintenance/backup` | 备份列表 | `routes_admin.py` |
| POST | `/api/admin/maintenance/backup/cleanup` | 清理旧备份 | `routes_admin.py` |
| **计费** |||
| GET | `/api/billing/plans` | 套餐列表 | `routes_billing.py` |
| POST | `/api/billing/checkout` | 创建支付订单 | `routes_billing.py` |
| GET | `/api/billing/orders` | 订单历史 | `routes_billing.py` |
| POST | `/api/billing/mock/complete` | Mock 支付完成 | `routes_billing.py` |
| POST | `/api/billing/webhook` | 支付回调 | `routes_billing.py` |
| **健康检查** |||
| GET | `/healthz` | 存活检查 | `routes_pages.py` |
| GET | `/readyz` | 就绪检查 | `routes_pages.py` |
| GET | `/api/version` | 版本号 | `routes_pages.py` |

---

## 三、核心数据流

### 报价请求 (POST /api/quote)

```
用户上传 STL + 参数（材料/颜色/填充/层高/数量...）
    │
    ▼
routes_quote.py::get_quote()
    │  参数校验 + 用户认证
    │  并发控制（QUOTE_CONCURRENCY）
    ▼
calculator/cost.py::process_single_file()
    │
    ├── parser/geometry.py          → 解析 STL：体积、表面积、包围盒（trimesh/numpy-stl）
    │
    ├── 切片：
    │   └── parser/prusa_slicer.py  → PrusaSlicer CLI 无头切片
    │
    ├── calculator/orientation.py   → 自动摆放（可选，auto_orient=true）
    │
    └── calculator/cost.py          → 成本计算（材料费 + 机器时间费 + 后处理费）
        │
        ▼
    返回 QuoteResponse（成本、时间、重量、尺寸...）
```

### 摆放优化 (POST /api/orientation/optimize)

```
上传 STL → calculator/orientation.py
    │  检测稳定面 / 共面簇
    │  计算最优摆放方向（最小支撑、最短时间）
    ▼
返回优化后的旋转矩阵 + 推荐面
```

---

## 四、数据库表结构

所有表通过 `app/database.py::init_db()` 创建（raw SQL + `_safe_add_column` 渐进式迁移）。

| 表名 | 用途 |
|------|------|
| `users` | 用户（含材料/颜色/定价配置 JSON 列、会员信息） |
| `slicer_presets` | 用户切片预设（Base64 存储 preset 文件） |
| `app_defaults` | 系统全局默认值（材料/颜色/定价） |
| `verification_codes` | 邮箱/手机验证码 |
| `audit_events` | 审计日志 |
| `idempotency_responses` | 幂等性响应缓存 |
| `login_failures` | 登录失败记录（防暴力破解） |
| `membership_plans` | 会员套餐定义 |
| `payment_orders` | 支付订单 |
| `quote_history` | 报价历史记录 |
| `rate_limit_state` | 限流器状态持久化 |

---

## 五、前端模块速查

> 已从单文件 2436 行重构为 8 个独立模块 + 1 个编排器。

| 文件 | 行数 | 功能 |
|------|------|------|
| `static/js/main.js` | ~320 | ★ 应用编排器：DOM收集 → 模块初始化 → 事件绑定 → 启动 |
| `static/js/modules/state.js` | ~250 | 共享状态（auth/options/collections/settings）+ 全部工具函数 |
| `static/js/modules/auth.js` | ~200 | 登录/注册/验证码/session/handleAuthSuccess |
| `static/js/modules/settings.js` | ~350 | 用户中心/材料编辑/颜色编辑器/定价配置/公式/改密码 |
| `static/js/modules/presets.js` | ~200 | 切片预设 CRUD + localStorage + 打印机选择器 |
| `static/js/modules/membership.js` | ~130 | 会员套餐/支付/订单 |
| `static/js/modules/quote.js` | ~380 | ★ 报价核心：上传→API→结果表格→行内编辑→批量重算 |
| `static/js/modules/preview.js` | ~180 | STL/非STL缩略图生成 + 预览弹窗 + 视角Cube |
| `static/js/modules/orientation-ui.js` | ~150 | Lay on Face / 模型居中 / 方向同步 / 训练标记 |
| `static/js/modules/viewer.js` | 415 | Three.js 3D查看器（场景/相机/交互） |
| `static/js/modules/layface.js` | 184 | 共面面簇渲染 + 点击贴合底板 |
| `static/js/modules/history.js` | 71 | 报价历史弹窗 |

### 模块依赖图

```
main.js (编排器)
  ├── state.js ←── 所有模块都依赖
  ├── auth.js → settings, presets, preview, quote
  ├── settings.js → quote, presets
  ├── presets.js → quote
  ├── membership.js → (独立)
  ├── quote.js → preview, history
  ├── preview.js → viewer
  ├── orientation-ui.js → viewer, layface, preview(dynamic)
  ├── viewer.js (Three.js 核心)
  ├── layface.js → viewer
  └── history.js → (独立)
```

---

## 六、AI 助手常用操作指南

### 你想修改某个功能？从这里开始

| 需求 | 先看这个文件 |
|------|-------------|
| 添加/修改 API 端点 | `app/__init__.py`（路由注册）→ 对应的 `routes_*.py` |
| 修改报价计算公式 | `calculator/cost.py` |
| 修改定价参数 | `app/models.py::PricingConfig` |
| 修改材料/颜色默认值 | `app/database.py::DEFAULT_MATERIALS` / `app_defaults` 表 |
| 修改前端表单/UI | `static/index.html` + `static/js/main.js` |
| 修改 3D 查看器行为 | `static/js/modules/viewer.js` |
| 修改 LayFace 交互 | `static/js/modules/layface.js` |
| 修改数据库表结构 | `app/database.py::init_db()` + `app/models_orm.py` |
| 修改切片引擎调用 | `parser/prusa_slicer.py` 或 `parser/slicer.py` |
| 修改打印机配置 | `profiles/prusa/printers/*.ini` |
| 部署相关 | `docker-compose.yml` + `deploy/` |

### 常用命令

```bash
# 本地开发
cd /home/xiayuku63/.openclaw/workspace/pricer3d
python main.py                    # 启动开发服务器（8000 端口，reload）

# Docker 操作
docker restart pricer3d-app       # 重启生产容器
docker logs pricer3d-app --tail 50  # 查看日志

# HTTPS 部署（首次申请证书）
./deploy/init-ssl.sh your-email@example.com
./deploy/test-nginx-config.sh     # 测试 nginx 配置语法

# 访问
curl https://pricer3d.top/         # 生产（HTTPS）
curl http://127.0.0.1:5000/        # 本地开发
curl http://127.0.0.1:5000/healthz  # 健康检查
```

### 前端 JS 编译说明

`static/js/main.js` 是从多个模块合并/编译的产物。原始模块在 `static/js/modules/` 下。修改时：

1. 先确认要改的是哪个版本（`main.js` / `main.js.clean` / `main.js.latest` / `main.js.layface`）
2. 优先改 `modules/` 下的源文件，然后重新合并
3. 如果只改少量逻辑，直接在 `main.js` 中修改也可以

---

## 七、注意事项

- **数据库**: 同时存在 raw SQL（`database.py`）和 SQLAlchemy ORM（`db.py` + `models_orm.py`）两套路径，新功能优先用 ORM
- **切片引擎**: PrusaSlicer 是唯一引擎（通过 apt 安装）
- **用户上传**: 文件存在 `user/user_{id}/uploads/{date}/{uuid}_{name}/` 下
- **校正系数**: `prusa_time_correction: 0.44` 用于将 PrusaSlicer 预估时间校准到实际打印时间
- **前端主入口**: `main.js` 是合并产物，源模块在 `modules/` 子目录
