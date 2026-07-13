# Pricer3D P0 技术债修复 + 本地部署测试报告

**日期**: 2026-07-02 | **版本**: v0.44.1 (P0-fix) | **测试端口**: 5001

---

## 一、修复概览

| ID | 问题 | 修复方式 | 状态 |
|----|------|---------|------|
| P0-3 | `_process_single_file_sync` 事件循环反模式 | `new_event_loop()+close()` → `asyncio.run()` | ✅ |
| P0-2 | `_safe_add_column` 静默吞错 + Alembic | `except: pass` → 分级日志 + 创建迁移脚本 | ✅ |
| P0-1 | 时间戳 String → DateTime | 创建 `UTCDateTime` / `UnixTimestamp` TypeDecorator | ✅ |

### 隐藏 Bug 发现

修复 `_safe_add_column` 时发现所有 ALTER TABLE 语句**从未真正执行**——SQLAlchemy 2.0 要求 `conn.execute(text(...))` 包装 SQL 字符串，原代码直接传字符串被静默吞错。修复后首次正常执行，成功添加缺失列。

---

## 二、类型迁移统计

### UTCDateTime（ISO datetime → datetime 对象）
覆盖 **16 个模型、25 个字段**：
- User: created_at, terms_accepted_at, privacy_accepted_at
- QuoteHistory: created_at
- AuditEvent: created_at
- PaymentOrder: created_at, paid_at
- VerificationCode: created_at, used_at
- MembershipPlan: created_at
- IdempotencyResponse: created_at
- AppDefault: updated_at
- RateLimitState: updated_at
- Category: created_at
- Todo: due_date, created_at, updated_at
- PrinterParam: created_at, updated_at
- MaterialBrand: created_at
- MaterialType: created_at
- Material: created_at, updated_at
- PrinterPreset: created_at
- SlicerPreset: created_at

### UnixTimestamp（Unix 时间戳 → float）
覆盖 **4 个模型、7 个字段**：
- User: membership_expires_at
- VerificationCode: expires_at
- LoginFailure: created_at, first_failed_at, last_failed_at, locked_until
- IdempotencyResponse: expires_at

---

## 三、API 测试结果

所有测试在 `http://127.0.0.1:5000` 执行，使用 JWT Token 认证。

| # | 端点 | 状态码 | P0 相关 | 结果 |
|---|------|--------|---------|------|
| 1 | `GET /healthz` | 200 | — | ✅ |
| 2 | `GET /readyz` | 200 | — | ✅ `user_count=5, db=ok` |
| 3 | `GET /api/version` | 200 | — | ✅ `v0.44.0` |
| 4 | `GET /` | 200 | — | ✅ HTML 首页 |
| 5 | `GET /openapi.json` | 200 | — | ✅ OpenAPI 可用 |
| 6 | `GET /api/auth/me` | 200 | P0-1 ✅ | `created_at`: ISO datetime, `membership_expires_at`: null → UnixTimestamp 正常 |
| 7 | `GET /api/quote/history` | 200 | P0-1 ✅ | 全部 `created_at` 以 ISO datetime 格式返回 |
| 8 | `GET /api/admin/audit` | 200 | P0-1 ✅ | 修复 detached instance 后 43 条审计日志正常返回 |
| 9 | `GET /api/admin/users` | 200 | P0-1 ✅ | 用户列表 `created_at` ISO datetime |
| 10 | `GET /api/admin/metrics` | 200 | — | ✅ 指标正常 |
| 11 | `POST /api/admin/maintenance/cleanup` | 200 | P0-1 ✅ | datetime 比较查询正常，cleaned=0 |
| 12 | `POST /api/quote` | 200 | P0-3 ✅ | `asyncio.run()` 无崩溃，无事件循环泄漏 |
| 13 | `DELETE /api/quote/history` | 200 | — | ✅ 清理 16 条记录 |
| 14 | `GET /api/user/settings` | 200 | — | ✅ |
| 15 | `GET /api/billing/plans` | 200 | — | ✅ |

### 已知非 P0 问题

| 端点 | 问题 | 原因 |
|------|------|------|
| `GET /api/billing/orders` | 500 (missing `total`) | 预存 bug：`PaginatedData` schema 要求 `total` 但路由未返回 |
| `GET /api/quote/export` | 403 | 免费用户需升级会员导出 |

---

## 四、LoginFailure UnixTimestamp 验证

```
first_failed_at:  type=float, value=1782951893.50885   ✅
last_failed_at:   type=float, value=1782951893.50885   ✅
locked_until:     type=float, value=0.0                ✅
created_at:       type=NoneType (pre-existing, not set by code)
```

`is_login_locked()` 正常返回 `(False, 0)`。

---

## 五、Session 生命周期 Bug 修复

**问题**: `admin_list_audit` 在 `with get_db_session()` 块外访问 `row.created_at`，session commit 后属性过期导致 `DetachedInstanceError`。

**根本原因**: String 类型列的值直接缓存在实例 dict 中，`expire_on_commit` 不会清除；但 `UTCDateTime` TypeDecorator 通过 `process_result_value` 返回的值在 commit 后过期，触发 lazy refresh 失败。

**修复**: 将 `items` 构建和属性访问全部移入 `with` 块内。

---

## 六、Alembic 迁移

创建了 `alembic/versions/a1b2c3d4e5f6_timestamp_types.py`：
- SQLite batch mode 逐表重建
- 数据自动从 STRING/REAL 迁移到新的列类型
- 支持 `upgrade()` 和 `downgrade()` 双向迁移

运行命令：`alembic upgrade head`

**注意**: 当前 TypeDecorator 在读取时已完成类型转换，数据库实际存储仍为 TEXT/REAL。迁移脚本确保新表使用正确的列类型，但 TypeDecorator 已提供运行时兼容。

---

## 七、服务器状态

- **端口**: `http://127.0.0.1:5000`
- **环境**: development
- **启动时间**: 无错误
- **服务状态**: 正常运行
- **内存占用**: 正常
- **请求延迟**: 2-10ms (健康端点)

---

## 八、后续建议

| 优先级 | 建议 |
|--------|------|
| P0-后续 | 在服务器环境运行 `alembic upgrade head` 应用迁移 |
| P1 | 修复 `billing_orders` 缺失 `total` 字段 |
| P1 | 检查所有路由是否存在 session 外 ORM 访问模式 |
| P1 | 根目录 24 个 `_*.py` 调试脚本应移入 `scripts/` 目录 |
| P2 | 为 `process_single_file` 添加超时控制，防止 asyncio.run() 长时间阻塞线程 |
