# Pricer3D — 3D 打印自动报价系统

<p align="center">
  <img src="https://img.shields.io/badge/version-0.45.2-blue" alt="version">
  <img src="https://img.shields.io/badge/python-3.12+-green" alt="python">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
  <img src="https://img.shields.io/badge/docker-ready-orange" alt="docker">
</p>

> 🖨️ 面向 3D 打印工作室和制造团队的自动报价工作台：上传 STL/STP/STEP/OBJ/3MF 模型或 ZIP 清单，批量估算打印时间、耗材和价格，并支持模型预览、朝向优化与报价单导出。

## 功能概览

- **批量报价**：支持单文件、多文件和 ZIP 清单；结果工作区统一展示成功/失败、重量、时间和费用。
- **多格式预览**：支持 STL、STP、STEP、OBJ、3MF；3MF 多实体模型支持颜色预览和材料颜色映射。
- **朝向优化**：支持智能摆放、Lay on Face 和手动旋转；调整后可保存朝向并重新计算。
- **参数管理**：打印机、喷嘴、材料、颜色、切片参数和成本/时间参数均可配置，并可保存切片预设。
- **报价调整**：在结果表中批量修改打印机、预设、品牌、材料、颜色和数量，并按需重新计算。
- **导出与历史**：支持 CSV、Excel、PDF 导出；报价历史支持搜索、状态筛选和清理关联文件。
- **账号与主题**：注册/登录、邮箱验证、用户中心、中文/English、深色/浅色主题和响应式布局。
- **会员与管理**：会员套餐、品牌定制、用户管理和全局默认配置（按部署配置启用）。

## 新手教程

第一次使用建议先阅读完整的 [新手教程](docs/GETTING_STARTED.md)。登录后的首次使用引导会自动带你完成：

1. 选择打印机和喷嘴；
2. 配置材料、单价和颜色；
3. 设置并保存切片预设；
4. 核对成本与时间参数；
5. 上传模型并生成第一份报价。

## 快速开始

### 方式一：Docker 生产部署（推荐）

```bash
git clone https://github.com/xiayuku63/pricer3d.git
cd pricer3d

# 创建生产环境配置
cp .env.prod.example .env.prod
# 至少修改 JWT_SECRET_KEY 和 PAYMENT_WEBHOOK_SECRET

# 启动应用、Nginx、Certbot
# HTTP/HTTPS 端口分别为 80/443
docker compose -f docker-compose.prod.yml up -d
```

生产容器会在构建阶段安装 Linux 版 PrusaSlicer 2.8.1 AppImage。由于较新的 PrusaSlicer Linux 发行包不再提供同类 AppImage，Docker 环境固定使用该版本；这不影响 Windows 本地使用 2.9.6。

### 方式二：Docker 开发环境

```bash
cp .env.example .env
docker compose up -d
```

开发 compose 默认将宿主机 `127.0.0.1:5001` 映射到容器 `5000`，访问 <http://127.0.0.1:5001>。数据写入 Docker volume `pricer3d_data`。

### 方式三：本地开发

#### Linux/macOS

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 确保 prusa-slicer 在 PATH 中，或设置 PRUSA_EXECUTABLE
python main.py
```

#### Windows

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 自动检测/静默安装仓库内的 PrusaSlicer 2.9.6
.\deploy\start_windows.ps1
```

本地默认访问地址为 <http://127.0.0.1:5001>（`main.py` 默认端口）；Windows 启动脚本会显式使用 `127.0.0.1:5000`。

也可以手动指定端口：

```bash
PORT=5000 UVICORN_RELOAD=false python main.py
```

### PrusaSlicer 路径

程序会自动检测常见安装路径。无法检测时，在 `.env` 中设置：

```dotenv
PRUSA_EXECUTABLE=/path/to/prusa-slicer
```

Windows 示例：

```dotenv
PRUSA_EXECUTABLE=C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe
```

## 配置说明

复制 `.env.example` 为 `.env`（本地）或 `.env.prod`（生产），常用配置如下：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_ENV` | 运行环境：`development` / `production` | `development` |
| `DB_PATH` | SQLite 数据库路径 | `app.db`（本地） |
| `JWT_SECRET_KEY` | JWT 密钥；生产环境必须修改 | - |
| `PAYMENT_WEBHOOK_SECRET` | 支付回调密钥；生产环境必须修改 | - |
| `ALLOWED_ORIGINS` | 允许的 CORS 来源，逗号分隔 | 见 `.env.example` |
| `RESEND_API_KEY` | Resend 邮件 API Key，可选 | - |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | SMTP 邮件配置，可选 | - |
| `SHOW_DEV_CODES` | 开发环境在响应中返回验证码 | `false` |
| `PAYMENT_PROVIDER` | 支付实现 | `mock` |
| `PRUSA_EXECUTABLE` | PrusaSlicer 可执行文件路径 | 自动检测 |
| `PRUSA_SLICE_CACHE` | 是否启用 G-code 切片缓存 | `1` |
| `TERMS_VERSION` / `PRIVACY_VERSION` | 用户协议和隐私政策版本 | `v2` |
| `LEGAL_EFFECTIVE_DATE` | 法律文件生效日期 | `2026-07-31` |
| `LEGAL_OPERATOR_NAME` | 运营主体名称 | `Pricer3D 运营方` |
| `LEGAL_CONTACT_EMAIL` | 法律与隐私联系邮箱 | - |
| `LEGAL_CONTACT_ADDRESS` | 运营主体联系地址 | - |

完整配置见 [.env.example](.env.example) 和 [app/settings.py](app/settings.py)。生产环境不要使用开发密钥，也不要把 `.env.prod` 提交到仓库。

法律文件上线前，请将 `LEGAL_OPERATOR_NAME`、`LEGAL_CONTACT_EMAIL` 和 `LEGAL_CONTACT_ADDRESS` 替换为真实主体信息，并由运营方或法律顾问审核《用户协议》和《隐私政策》内容。修改法律文本时同步递增 `TERMS_VERSION` 或 `PRIVACY_VERSION`。

## 项目结构

```text
pricer3d/
├── app/                    # FastAPI 应用、路由、服务和 ORM
├── calculator/             # 成本计算、朝向分析和几何评分
├── parser/                 # 模型解析、预览和 PrusaSlicer 集成
├── static/                 # HTML partials、CSS、ES modules 和 i18n
├── profiles/prusa/         # PrusaSlicer 配置
├── deploy/                 # Docker、Windows 启动、备份和部署脚本
├── docs/                   # 新手教程、部署说明和设计文档
├── tests/                  # Python 测试
├── tests_js/               # JavaScript 测试
├── Dockerfile              # 开发镜像
├── Dockerfile.prod         # 生产镜像
└── VERSION                 # 当前版本号
```

## 常用 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/healthz` | GET | 存活检查 |
| `/readyz` | GET | 就绪检查 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/register` | POST | 注册 |
| `/api/quote` | POST | 单文件/常规报价 |
| `/api/quote/zip` | POST | ZIP 批量报价 |
| `/api/quote/history` | GET | 报价历史 |
| `/api/quote/export-pdf-inline` | POST | 导出 PDF |
| `/api/user/settings` | GET/PUT | 读取或保存用户设置 |
| `/api/slicer/presets` | GET | 获取切片预设 |
| `/api/orientation/optimize` | POST | 智能朝向优化 |
| `/api/orientation/coplanar` | POST | Lay on Face 候选面分析 |

登录、报价和用户设置接口需要按应用要求携带 JWT 认证信息。完整接口以运行中的 `/openapi.json` 为准。

## 技术栈

- **后端**：Python 3.12、FastAPI、SQLAlchemy、SQLite、Alembic
- **前端**：原生 JavaScript ES modules、Three.js、Tailwind CSS
- **模型与切片**：trimesh、numpy-stl、PrusaSlicer CLI
- **部署**：Docker、Nginx、Certbot
- **质量保障**：pytest、Ruff、mypy、JavaScript 测试和 GitHub Actions

## 更新与维护

生产环境可使用更新脚本：

```bash
bash deploy/update.sh
```

该脚本会拉取 `main`、同步 Python 依赖并重启 `pricer3d` systemd 服务。执行前请确认本地没有需要保留的未提交修改；脚本会清理本地未提交文件。

健康检查：

```bash
curl http://127.0.0.1:5000/healthz
curl http://127.0.0.1:5000/readyz
```

## 当前版本

当前仓库版本为 **v0.45.2**。近期更新包括：

- 报价历史支持搜索、状态筛选和关联模型/G-code 清理；
- 报价过程增加模型处理进度展示和切片缓存；
- 智能朝向评分、手动放置和 Lay on Face 流程改进；
- 3MF 多实体颜色预览、颜色复用和多色切片流程完善；
- PrusaSlicer 2.9.6 Windows 本地检测与 Docker Linux AppImage 兼容处理。

## License

MIT License

## 联系方式

- GitHub：[@xiayuku63](https://github.com/xiayuku63)
- 项目地址：https://github.com/xiayuku63/pricer3d
