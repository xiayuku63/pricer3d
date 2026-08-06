# GitHub Actions CI/CD 配置说明

## 概览

CI/CD 流水线包含以下阶段：

```text
push/PR to main
    |
    |-- lint (Ruff) -----------|
    |-- typecheck (mypy) ------|-- docker-build -- deploy（仅 main push 或手动触发）
    `-- test (pytest) ---------|
```

## CI 阶段详解

### 1. Lint (Ruff)

- 执行高置信度代码错误检查（`ruff check`）
- Ruff 版本固定，规则配置在 `pyproject.toml` 中
- 格式化与 import 历史债务不阻塞当前部署，后续可分批清理

### 2. Type Check (mypy)

- 静态类型检查
- 当前为非阻塞检查（警告不阻止流水线）

### 3. Test (pytest)

- 运行 `tests/` 目录下的所有测试
- 使用内存数据库（`DB_PATH=:memory:`）
- 生成 JUnit XML 报告并上传为 artifact

### 4. Docker Build

- 使用 `Dockerfile.prod` 构建生产镜像
- 启用 GitHub Actions 缓存加速构建
- 需要 lint、typecheck 和 test 通过后才执行

## CD 阶段详解

### Deploy（仅 push to main 或手动触发）

- 使用 `appleboy/scp-action` 将 GitHub runner 上已校验的当前 revision 上传到服务器，避免服务器访问 GitHub 超时
- 保留服务器 `.env.prod`，并迁移旧容器 `/app/data` 到新持久化卷
- 使用 `appleboy/ssh-action` 远程执行 `deploy/one_click_deploy.sh`
- 部署后自动执行健康检查和 PrusaSlicer 诊断

仓库只保留 `.github/workflows/ci.yml` 这一条部署链路，避免同一次 push 重复部署。

## 必须配置的 GitHub Secrets

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中添加：

| Secret 名称 | 说明 | 示例值 |
|-------------|------|--------|
| `DEPLOY_HOST` | 服务器 IP 地址 | `47.106.102.208` |
| `DEPLOY_USER` | SSH 用户名 | `root` |
| `DEPLOY_SSH_KEY` | SSH 私钥（完整内容） | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT` | SSH 端口（可选，默认 22） | `22` |

### 生成 SSH 密钥对

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy
ssh-copy-id -i ~/.ssh/github_deploy.pub xiayuku63@47.106.102.208
cat ~/.ssh/github_deploy
```

将最后一个命令输出的私钥完整内容保存为 `DEPLOY_SSH_KEY`。

## 相关文件

- `.github/workflows/ci.yml` - 唯一的 CI/CD 流水线配置
- `Dockerfile.prod` - 生产环境 Docker 镜像
- `docker-compose.prod.yml` - 生产环境 Docker Compose 配置
- `deploy/one_click_deploy.sh` - 自动与手动部署共用脚本
- `deploy/docker_deploy.sh` - 手动部署脚本（备用）

## 触发条件

| 事件 | 触发的 Job |
|------|-----------|
| PR to main | lint, typecheck, test, docker-build |
| Push to main | lint, typecheck, test, docker-build, **deploy** |
| Manual dispatch | lint, typecheck, test, docker-build, **deploy** |

## 监控部署

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
curl http://127.0.0.1:5000/healthz
```

## 故障排除

### 部署在 SSH 步骤前失败

检查 Actions 日志中的 secret 预检结果，并确认以下 secrets 均已配置：

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`

### SSH 连接失败

1. 确认服务器 SSH 服务和端口可访问。
2. 确认 `DEPLOY_SSH_KEY` 对应公钥已写入部署用户的 `~/.ssh/authorized_keys`。
3. 确认部署用户可以运行 `git`、`docker` 和 `docker compose`。

### 健康检查失败

1. 查看服务器上的应用日志。
2. 检查 `.env.prod` 配置文件。
3. 确认端口 5000 未被其他服务占用。
