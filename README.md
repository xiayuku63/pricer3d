# Pricer3D — 3D 打印自动报价系统

<p align="center">
  <img src="https://img.shields.io/badge/version-0.24.2-blue" alt="version">
  <img src="https://img.shields.io/badge/python-3.11+-green" alt="python">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
  <img src="https://img.shields.io/badge/docker-ready-orange" alt="docker">
</p>

> 🖨️ 专业的 3D 打印自动报价系统，支持 STL/STP/3MF 等格式，批量上传自动计价。

## ✨ 功能特性

### 📦 批量报价
- 支持 STL、STP、STEP、OBJ、3MF 格式
- 批量上传（最多 20 个文件），自动计算价格
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

## 🚀 快速开始

### Docker 部署（推荐）

```bash
# 克隆仓库
git clone https://github.com/xiayuku63/pricer3d.git
cd pricer3d

# 复制环境变量
cp .env.example .env.prod

# 启动服务
docker compose -f docker-compose.prod.yml up -d

# 访问
open http://localhost
```

### 本地开发

```bash
# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 启动开发服务器
python main.py

# 访问
open http://localhost:5001
```

## 📁 项目结构

```
pricer3d/
├── app/                    # 后端核心
│   ├── __init__.py         # FastAPI 工厂 + 路由注册
│   ├── routes_*.py         # API 端点
│   ├── models_orm.py       # SQLAlchemy ORM 模型
│   └── database.py         # 数据库迁移
├── static/                 # 前端资源
│   ├── js/modules/         # JS 模块化
│   │   ├── i18n/           # 语言包（zh.js, en.js）
│   │   ├── settings.js     # 用户中心
│   │   ├── presets.js      # 切片预设
│   │   └── theme.js        # 主题切换
│   ├── partials/           # HTML 组件
│   └── css/                # 样式文件
├── calculator/             # 报价计算引擎
├── parser/                 # 文件解析器
├── deploy/                 # 部署配置
├── docker-compose.yml      # 开发环境
├── docker-compose.prod.yml # 生产环境
└── Dockerfile.prod         # 生产镜像
```

## 🔑 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_ENV` | 运行环境 | `development` |
| `DB_PATH` | 数据库路径 | `./app.db` |
| `JWT_SECRET_KEY` | JWT 密钥 | - |
| `UPLOADS_DIR` | 上传目录 | `./uploads` |

## 🌐 API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/quote` | POST | 单文件报价 |
| `/api/quote/zip` | POST | 批量报价 |
| `/api/user/settings` | GET/PUT | 用户设置 |
| `/api/slicer/presets` | GET | 切片预设 |
| `/api/printers` | GET | 打印机列表 |

## 🛠️ 技术栈

- **后端**: Python 3.11 + FastAPI + SQLAlchemy + SQLite
- **前端**: Vanilla JS + Three.js + Tailwind CSS
- **切片**: PrusaSlicer（命令行集成）
- **部署**: Docker + Nginx + Certbot

## 📝 更新日志

### v0.24.2 (2026-06-13)
- ✨ i18n 语言包系统（独立 zh.js/en.js，支持懒加载）
- 🎨 深色模式完善
- 📐 材料设置排版优化（品牌前置）
- 🔄 用户中心与模型页面单向同步
- 🐛 修复版本号重复前缀

### v0.23.0
- ✨ 用户中心重构（tab + sub-tab 结构）
- ✨ 默认材料/颜色/切片预设选择器
- ✨ 管理员功能样式区分

### v0.22.0
- ✨ 批量报价优化
- ✨ 超尺寸模型处理
- 🐛 修复多个 UI 问题

## 📄 License

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

- GitHub: [@xiayuku63](https://github.com/xiayuku63)
- 项目地址: https://github.com/xiayuku63/pricer3d
