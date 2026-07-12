# Pricer3D — 3D 打印自动报价系统

<p align="center">
  <img src="https://img.shields.io/badge/version-0.45.2-blue" alt="version">
  <img src="https://img.shields.io/badge/python-3.12+-green" alt="python">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
  <img src="https://img.shields.io/badge/docker-ready-orange" alt="docker">
</p>

> 🖨️ 专业的 3D 打印自动报价系统，支持 STL/STP/3MF 等格式，批量上传自动计价，集成 PrusaSlicer v2.9.6 精确估算。

---

## 功能特性

### 📦 批量报价
- 支持 STL、STP、STEP、OBJ、3MF 格式
- 批量上传，自动计算价格
- 实时 3D 预览（Three.js）
- 智能朝向分析（Lay on Face）

### 🎛️ 灵活配置
- **打印机管理**：支持 Bambu Lab、Prusa、Voron 等主流机型
- **材料管理**：自定义材料（PLA/ABS/Resin 等）、品牌、密度、单价、颜色
- **切片预设**：层高、壁数、填充密度等参数预设
- **定价公式**：可自定义单件成本和总价计算公式

### 👤 用户系统
- 注册/登录（邮箱验证）
- 用户中心：打印参数、计算公式、成本时间、账号安全
- 报价历史记录
- 会员套餐（可选）

### 🌍 多语言 & 主题
- 中文 / English 双语支持（语言包系统，易于扩展）
- 深色 / 浅色主题切换
- 响应式设计，支持移动端

### 🔧 管理功能
- 用户管理（管理员）
- 配置导入导出
- 全局默认设置

---

## 快速开始

### Docker 部署（推荐）

```bash
# 克隆仓库
git clone https://github.com/xiayuku63/pricer3d.git
cd pricer3d

# 复制环境变量
cp .env.example .env.prod
# 编辑 .env.prod，至少设置 JWT_SECRET_KEY

# 启动服务
docker compose -f docker-compose.prod.yml up -d

# 访问
open http://localhost:5000
```

首次构建会自动下载并安装 **PrusaSlicer v2.8.1**（从 GitHub Release 下载 AppImage）。

### 本地开发

```bash
# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 安装 PrusaSlicer CLI
# Linux: 下载 PrusaSlicer AppImage 并放到 PATH 中
# Windows: 下载 PrusaSlicer 并安装，程序会自动检测

# 启动开发服务器
python main.py

# 访问
open http://localhost:5000
```

### 一键更新脚本

生产环境可通过 `deploy/update.sh` 一键更新：

```bash
# 拉取最新代码 + 更新 Python 依赖 + 重启服务
bash deploy/update.sh
```

---

## 项目结构

```
pricer3d/
├── app/                    # 后端核心 (FastAPI)
│   ├── __init__.py         # 应用工厂 + 路由注册
│   ├── routes_*.py         # API 端点
│   ├── routes/             # 模块化路由
│   ├── services/           # 业务逻辑（报价、导出、PDF）
│   ├── schemas/            # Pydantic 模型
│   ├── models_orm.py       # SQLAlchemy ORM 模型
│   └── database.py         # 数据库迁移
├── static/                 # 前端资源
│   ├── js/modules/         # JS 模块（ES modules）
│   ├── partials/           # HTML 组件
│   ├── css/tokens/         # Design tokens
│   └── ...
├── calculator/             # 报价计算引擎
│   ├── cost.py             # 核心计价
│   └── orientation*.py     # 朝向分析与摆放
├── parser/                 # 文件解析
│   └── prusa_slicer.py     # PrusaSlicer 集成
├── profiles/prusa/         # 切片配置文件
├── deploy/                 # 部署脚本与配置
├── .env.example            # 环境变量模板
├── Dockerfile              # 开发镜像
├── Dockerfile.prod         # 生产镜像
├── docker-compose.yml      # 开发环境
├── docker-compose.prod.yml # 生产环境 (含 Nginx + Certbot)
└── VERSION                 # 版本号
```

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_ENV` | 运行环境（development/production） | `development` |
| `DB_PATH` | 数据库路径 | `/app/data/app.db` |
| `JWT_SECRET_KEY` | JWT 密钥（生产环境必填） | - |
| `ALLOWED_ORIGINS` | 允许的 CORS 域名 | 见 `.env.example` |
| `RESEND_API_KEY` | Resend 邮件 API Key | - |
| `PRUSA_EXECUTABLE` | PrusaSlicer 可执行文件路径（可选，自动检测） | - |

完整列表见 `.env.example` 和 `app/settings.py`。

---

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/quote` | POST | 单文件报价 |
| `/api/quote/zip` | POST | ZIP 批量报价 |
| `/api/quote/history` | GET | 报价历史 |
| `/api/quote/export-pdf-inline` | POST | 导出 PDF |
| `/api/user/settings` | GET/PUT | 用户设置 |
| `/api/slicer/presets` | GET | 切片预设列表 |
| `/api/orientation/optimize` | POST | 智能朝向优化 |

---

## 技术栈

- **后端**: Python 3.12 + FastAPI + SQLAlchemy + SQLite
- **前端**: Vanilla JS (ES modules) + Three.js + Tailwind CSS
- **切片**: PrusaSlicer v2.8.1 CLI（AppImage，精确估算时间/耗材）
- **部署**: Docker + Nginx + Certbot
- **CI/CD**: GitHub Actions（Ruff + mypy + pytest + Docker Build + SSH Deploy）

---

## 更新日志

### v0.45.1 (2026-07-06)
- ✨ PrusaSlicer v2.9.6 精确估算已启用
- 🐛 修复智能摆放后模型不居中
- 🐛 修复导出 PDF 登录状态误判
- 🎨 下拉菜单被报价结果卡片遮挡修复

### v0.24.2 (2026-06-13)
- ✨ i18n 语言包系统（独立的 zh.js/en.js）
- 🎨 深色模式完善
- 📐 材料设置排版优化（品牌前置）
- 🔄 用户中心与模型页面单向同步

### v0.23.0
- ✨ 用户中心重构（tab + sub-tab 结构）
- ✨ 默认材料/颜色/切片预设选择器
- ✨ 管理员功能样式区分

### v0.22.0
- ✨ 批量报价优化
- ✨ 超尺寸模型处理
- 🐛 修复多个 UI 问题

---

## PrusaSlicer 集成

系统集成 **PrusaSlicer** CLI 进行精确的 G-code 切片估算：

- **Docker 部署**：构建时自动从 GitHub Release 下载安装 **v2.8.1 AppImage**
- **Linux 本地**：下载 PrusaSlicer AppImage 或 `apt install prusa-slicer`
- **Windows 本地**：运行 `deploy/start_windows.ps1` 自动检测/静默安装

在用户设置中开启"使用 PrusaSlicer 精确估算"后，报价时会调用 PrusaSlicer 切片，获取精确的打印时间和耗材用量。

---

## License

MIT License

## 联系方式

- GitHub: [@xiayuku63](https://github.com/xiayuku63)
- 项目地址: https://github.com/xiayuku63/pricer3d
