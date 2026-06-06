# GitHub Actions CI/CD 配置说明

## 📋 概览

CI/CD 流水线包含以下阶段：

```
push/PR to main
    │
    ├── lint (Ruff) ──────────────┐
    ├── typecheck (mypy) ─────────┤── docker-build ── deploy (仅 main push)
    └── test (pytest) ────────────┘
```

## 🔧 CI 阶段详解

### 1. Lint (Ruff)
- 代码风格检查 (`ruff check`)
- 格式检查 (`ruff format --check`)
- 配置在 `pyproject.toml` 中

### 2. Type Check (mypy)
- 静态类型检查
- 非阻塞（警告不阻止流水线）

### 3. Test (pytest)
- 运行 `tests/` 目录下的所有测试
- 使用内存数据库 (`DB_PATH=:memory:`)
- 生成 JUnit XML 报告并上传为 artifact

### 4. Docker Build
- 使用 `Dockerfile.prod` 构建生产镜像
- 启用 GitHub Actions 缓存加速构建
- 需要 lint 和 test 通过后才执行

## 🚀 CD 阶段详解

### Deploy (仅 push to main)
- 使用 `appleboy/ssh-action` 通过 SSH 连接到阿里云服务器
- 在服务器上执行 `git pull` + `docker compose build` + `docker compose up -d`
- 部署后自动健康检查

## 🔐 必须配置的 GitHub Secrets

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中添加：

| Secret 名称 | 说明 | 示例值 |
|-------------|------|--------|
| `DEPLOY_HOST` | 服务器 IP 地址 | `47.106.102.208` |
| `DEPLOY_USER` | SSH 用户名 | `xiayuku63` |
| `DEPLOY_SSH_KEY` | SSH 私钥 (完整内容) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT` | SSH 端口 (可选，默认 22) | `22` |

### 生成 SSH 密钥对

```bash
# 在本地机器上生成密钥对
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy

# 将公钥添加到服务器
ssh-copy-id -i ~/.ssh/github_deploy.pub xiayuku63@47.106.102.208

# 将私钥内容复制到 GitHub Secret (DEPLOY_SSH_KEY)
cat ~/.ssh/github_deploy
```

## 🌐 IPv4 强制配置

由于阿里云服务器可能存在 IPv6 连接超时问题，流水线通过以下方式强制使用 IPv4：

1. 使用直接 IPv4 地址 (`47.106.102.208`) 而非域名
2. 设置 `GODEBUG=netdns=go+netgo` 环境变量

## 📁 相关文件

- `.github/workflows/ci.yml` - CI/CD 流水线配置
- `Dockerfile.prod` - 生产环境 Docker 镜像
- `docker-compose.prod.yml` - 生产环境 Docker Compose 配置
- `deploy/docker_deploy.sh` - 手动部署脚本（备用）
- `deploy/update.sh` - 快速更新脚本（备用）

## 🎯 触发条件

| 事件 | 触发的 Job |
|------|-----------|
| PR to main | lint, typecheck, test, docker-build |
| Push to main | lint, typecheck, test, docker-build, **deploy** |

## 📊 监控部署

部署后可以通过以下方式检查：

```bash
# 在服务器上查看服务状态
docker compose -f docker-compose.prod.yml ps

# 查看应用日志
docker compose -f docker-compose.prod.yml logs -f app

# 健康检查
curl http://127.0.0.1:5000/healthz
```

## ⚠️ 故障排除

### 部署失败
1. 检查 GitHub Actions 日志
2. 确认 SSH 密钥是否正确配置
3. 确认服务器上的 Docker 服务是否运行

### 健康检查失败
1. 查看服务器上的应用日志
2. 检查 `.env.prod` 配置文件
3. 确认端口 5000 未被占用

### IPv4 连接问题
如果仍然遇到超时，可以在服务器上配置 SSH：
```bash
# 编辑 /etc/ssh/sshd_config
AddressFamily inet
```
