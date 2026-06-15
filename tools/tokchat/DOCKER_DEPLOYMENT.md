# Docker 部署说明

## 本地启动

```bash
./deploy.sh
```

也可以直接使用 Compose：

```bash
docker compose up -d --build
```

默认访问地址：

- 前台：`http://127.0.0.1:18084/`
- 后台：`http://127.0.0.1:18084/admin.php`
- 健康检查：`http://127.0.0.1:18084/health.php`
- 默认后台账号：`admin / change-me-now`

可在 `.env` 中通过 `DEFAULT_ADMIN_USERNAME`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME` 修改首次初始化账号。生产环境上线后请立即在后台修改默认密码。

## 数据持久化

`docker-compose.yml` 会把以下目录挂载到容器中：

- `./data`：SQLite 数据库和知识库上传文件
- `./logs`：PHP 日志
- `./uploads`、`./cache`、`./temp`：运行时目录

重建镜像或重启容器不会清空 `data/sales_ai.db`。

## 运行时配置

复制 `.env.docker.example` 为 `.env` 后可以调整本机端口、PHP 运行参数和上传限制：

```bash
SALES_AI_HTTP_PORT=18084
PHP_MEMORY_LIMIT=256M
PHP_MAX_EXECUTION_TIME=300
PHP_MAX_INPUT_TIME=300
PHP_UPLOAD_MAX_FILESIZE=20M
PHP_POST_MAX_SIZE=24M
PHP_CLI_SERVER_WORKERS=16
UPLOAD_MAX_SIZE=10485760
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=change-me-now
DEFAULT_ADMIN_NAME=超级管理员
SEED_DEMO_USERS=0
```

`PHP_UPLOAD_MAX_FILESIZE` 和 `PHP_POST_MAX_SIZE` 需要大于或等于 `UPLOAD_MAX_SIZE`，否则知识库文件上传会被 PHP 层拦截。`health.php` 会检查这些限制是否满足当前系统上传配置。

`PHP_CLI_SERVER_WORKERS` 控制容器内 PHP 内置服务器的 worker 数。默认是 `16`，适合避免知识库上传、解析、切片等长请求阻塞整个站点；启动脚本会把该值限制在 `1-50` 之间。如果服务器内存较小，可降到 `4` 或 `8`。

## API Key 配置

推荐在后台「API 配置」页面维护 API Key。默认不会初始化任何第三方 API，避免公开部署暴露服务商地址或历史配置。

如确实需要通过 `.env` 初始化 API，可复制 `.env.docker.example` 为 `.env` 后填写完整配置，并显式开启：

```bash
SEED_DEFAULT_API_CONFIGS=1
TUZI_API_URL=https://api.example.com/v1/chat/completions
TUZI_API_KEY=your-primary-key
TUZI_MODEL=your-model-id

TUZI_BACKUP_API_URL=
TUZI_BACKUP_API_KEY=your-backup-key
TUZI_BACKUP_MODEL=
```

不要把真实 `.env` 或 API Key 提交到仓库。

## 常用命令

```bash
# 默认部署 / 更新
./deploy.sh

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f sales-ai

# 停止
./stop-server.sh

# 重新构建并启动
./restart-server.sh

# 修改端口启动
./deploy.sh 18085
```
