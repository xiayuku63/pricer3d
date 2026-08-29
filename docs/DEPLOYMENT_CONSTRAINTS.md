# 部署约束（单进程 / 多进程）

当前版本（v0.45.x）以下能力依赖**单进程内存状态**，横向扩容或多 worker 部署前必须逐项处理。

## 受单进程约束的能力

| 能力 | 实现位置 | 约束 | 多进程后果 |
|---|---|---|---|
| IP 限速 | `app/utils.py`（内存字典计数） | 计数器不跨进程共享 | 多 worker 时限速额度按进程数放大，可被绕过 |
| 图形验证码 | 内存存储（TTL + 尝试计数） | 生成与校验必须落在同一进程 | 多 worker 随机 502/校验失败 |
| 报价批次取消注册表 | `app/quote_batch.py`（内存 dict） | 取消请求必须命中持有批次的进程 | 多 worker 时"停止报价"失效 |
| 在途切片硬杀 | `parser/prusa_slicer.py` 注册表（进程内） | 同上 | 同上 |
| 静态资源版本号 | `?v=N` 手动 bump | — | 无（单机即可） |

## 现状许可的部署形态

- **单 uvicorn 进程**（默认）：全部能力正常。生产容器即此形态。
- **单机多进程**：仅当挂 `--workers N > 1` 时上表全部失效，禁止。
- WSL PrusaSlicer 并发切片受 `prusa_execution_lock` 串行保护（AppImage/WSL 启动层），与进程数无关。

## 迁移到多进程/多实例的前提（Redis 化清单）

1. 限速 → Redis INCR+EXPIRE（键 `rl:{scope}:{ip}:{minute}`）
2. 验证码 → Redis String + TTL
3. 批次取消/硬杀 → 批次状态入 DB 或 Redis；硬杀需要 kill 信号跨进程（任务化 P2-15 的 job 表 + worker 心跳是前置）
4. 或直接采用 P2-15 报价任务化：job 表天然把状态移出进程内存

## 相关配置

- `TRUST_PROXY=1`：仅当 nginx 等可信反代在前面时开启（XFF/X-Real-IP 处理）
- `ENABLE_DEV_ADMIN_LOGIN`：生产必须为 0（admin-login 后门 fail-closed）
