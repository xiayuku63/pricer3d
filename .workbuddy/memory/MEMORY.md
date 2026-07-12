# Pricer3D 项目记忆

## 项目基础信息
- **名称**: Pricer3D — 3D 打印自动报价系统
- **版本**: v0.44.0
- **技术栈**: FastAPI + SQLAlchemy 2.0 + SQLite(WAL) + Three.js + Vanilla JS
- **仓库**: https://github.com/xiayuku63/pricer3d
- **部署**: 阿里云 47.106.102.208，Docker + Nginx + Certbot

## 核心架构
- **入口**: main.py → app/__init__.py create_app() 工厂模式
- **后端**: app/ 目录（48 个 Python 文件），路由手动注册 + 部分 APIRouter 混用
- **计算引擎**: calculator/ 目录独立于 Web 层（cost.py, orientation_*.py）
- **前端**: static/ 目录，15 个 ES Module + Three.js，无 SPA 框架
- **数据库**: SQLite WAL，15 个 ORM 模型，Alembic 仅 1 个初始迁移

## 已知技术债（2026-07-02 最终状态）

### P0（已修复 ✅ + 本地 5001 端口测试通过）
- ✅ 时间戳 String 存储 → UTCDateTime/UnixTimestamp TypeDecorator，25+7 字段
- ✅ Alembic/_safe_add_column → 修复 text() 包装 + 分级日志 + 迁移脚本
- ✅ _process_single_file_sync → asyncio.run()

### 修复中发现的新 bug
- ✅ admin_list_audit detached instance（session 外 ORM 访问，已修复）
- ✅ _safe_add_column SQLAlchemy 2.0 text() 兼容（已修复，暴露了所有 ALTER TABLE 从未执行的隐藏 bug）
- 📝 billing_orders 缺失 total 字段（预存 bug，未修复）

### P1（待修复）
- 路由注册不统一 / calculate_cost 293行过长 / 根目录 24 个调试脚本
- 两个部署 workflow 分支混淆（main vs master）

## P0 修复关键决策（2026-07-02）
- 使用 TypeDecorator 而非直接改 Column 类型：写入端兼容现有 .isoformat() 代码，无需改 35+ 处
- UTCDateTime: impl=DateTime(timezone=True)，读取返回 tz-aware datetime
- UnixTimestamp: impl=Float，用于 membership_expires_at / verification expires_at / login_failures 时间戳
- _safe_add_column 修复发现隐藏 bug：SQLAlchemy 2.0 需要 text() 包装，原 except:pass 掩盖了全部 ALTER TABLE 失败

## 架构亮点
- AST 公式沙箱（calculator/cost.py safe_eval_formula）
- 自学习朝向优化（orientation_learner.py，16维特征+LR）
- 混合限流（内存+DB持久化，middleware.py + rate_limiter.py）
- 完整 CI/CD（Ruff + mypy + pytest + Docker + SSH 部署）
