# TokChat 线上服务器部署文档

本文档用于把 TokChat 部署到一台公网 Linux 服务器。推荐使用 Docker Compose 运行应用，用 Nginx 做公网反向代理和 HTTPS 证书管理。

## 1. 部署架构

```text
用户浏览器
   |
   | HTTPS 443
   v
Nginx 反向代理
   |
   | http://127.0.0.1:18084
   v
Docker Compose
   |
   v
TokChat PHP 服务 + SQLite 数据库
```

应用容器内监听 `8080`，服务器本机默认映射到 `18084`。公网只建议开放 `80` 和 `443`，不要把 `18084` 直接暴露给外部访问。

## 2. 服务器要求

推荐配置：

- 系统：Ubuntu 22.04 / Ubuntu 24.04 / Debian 12
- CPU：2 核及以上
- 内存：2 GB 及以上，知识库文档较多时建议 4 GB
- 磁盘：20 GB 及以上
- 端口：开放 `80`、`443`、`22`
- 软件：Docker Engine、Docker Compose v2、Nginx、Certbot

检查系统：

```bash
uname -a
df -h
free -h
```

## 3. 安装基础软件

以 Ubuntu / Debian 为例：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release nginx certbot python3-certbot-nginx sqlite3 rsync
```

安装 Docker：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

重新登录 SSH 后检查：

```bash
docker --version
docker compose version
```

## 4. 上传项目代码

建议部署目录：

```bash
sudo mkdir -p /opt/tokchat
sudo chown -R "$USER":"$USER" /opt/tokchat
```

如果从本机上传代码：

```bash
rsync -avz --delete \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='data/*' \
  --exclude='uploads/*' \
  --exclude='logs/*' \
  --exclude='cache/*' \
  --exclude='temp/*' \
  ./ user@your-server-ip:/opt/tokchat/
```

如果服务器上直接拉取代码：

```bash
cd /opt
git clone <your-repo-url> tokchat
cd /opt/tokchat
```

进入项目目录：

```bash
cd /opt/tokchat
```

## 5. 配置环境变量

复制环境变量模板：

```bash
cp .env.docker.example .env
nano .env
```

线上建议配置：

```env
SALES_AI_HTTP_PORT=18084
APP_DEBUG=0
TZ=Asia/Shanghai

PHP_MEMORY_LIMIT=256M
PHP_MAX_EXECUTION_TIME=300
PHP_MAX_INPUT_TIME=300
PHP_UPLOAD_MAX_FILESIZE=20M
PHP_POST_MAX_SIZE=24M
UPLOAD_MAX_SIZE=10485760

DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=change-me-now
DEFAULT_ADMIN_NAME=超级管理员
SEED_DEMO_USERS=0
```

API Key 推荐上线后在后台「API 配置」页面维护。默认不会初始化任何第三方 API，避免公开部署暴露服务商地址或历史配置。

如需先通过 `.env` 初始化 API，必须填写完整配置并显式开启：

```env
SEED_DEFAULT_API_CONFIGS=1
TUZI_API_URL=https://api.example.com/v1/chat/completions
TUZI_API_KEY=your-api-key
TUZI_MODEL=your-model-id
```

注意：

- 不要把真实 `.env` 提交到 Git。
- 如果使用云服务器安全组，确认没有放行 `18084` 到公网。
- 如果必须公网直接访问 `18084`，至少先完成管理员密码修改。

## 6. 启动 Docker 服务

```bash
chmod +x deploy.sh stop-server.sh restart-server.sh quick_start.sh
./deploy.sh 18084
```

检查容器：

```bash
docker compose ps
docker compose logs --tail=100 sales-ai
curl -fsS http://127.0.0.1:18084/health.php
```

健康检查返回 `status: ok` 后，说明容器已经正常运行。

## 7. 配置 Nginx 反向代理

把下面的 `tokchat.example.com` 替换成你的域名。

```bash
sudo nano /etc/nginx/sites-available/tokchat.example.com
```

写入：

```nginx
server {
    listen 80;
    server_name tokchat.example.com;

    client_max_body_size 24m;

    access_log /var/log/nginx/tokchat.example.com.access.log;
    error_log /var/log/nginx/tokchat.example.com.error.log;

    location / {
        proxy_pass http://127.0.0.1:18084;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_connect_timeout 60s;
        proxy_send_timeout 360s;
        proxy_read_timeout 360s;

        proxy_buffering off;
        proxy_cache off;
    }
}
```

启用站点：

```bash
sudo ln -sf /etc/nginx/sites-available/tokchat.example.com /etc/nginx/sites-enabled/tokchat.example.com
sudo nginx -t
sudo systemctl reload nginx
```

此时可以先用 HTTP 访问：

```text
http://tokchat.example.com/
```

## 8. 配置 HTTPS

确认域名已经解析到服务器公网 IP，然后执行：

```bash
sudo certbot --nginx -d tokchat.example.com
```

检查自动续期：

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

HTTPS 生效后访问：

```text
https://tokchat.example.com/
https://tokchat.example.com/admin.php
https://tokchat.example.com/health.php
```

## 9. 首次上线配置

默认后台账号：

```text
用户名：admin
密码：change-me-now
```

上线后立即处理：

1. 登录 `/admin.php`。
2. 进入「管理员管理」。
3. 新增一个自己的超级管理员账号，或修改默认管理员密码。更推荐上线前就在 `.env` 中设置 `DEFAULT_ADMIN_PASSWORD`。
4. 进入「API 配置」，添加线上可用 API。
5. 进入「网站设置」，确认站点名称、版权、登录页文案。
6. 上传或启用知识库文档。
7. 在前台完成一次真实对话测试。

## 10. 数据持久化

Docker Compose 会挂载这些目录：

```text
./data    -> SQLite 数据库和知识库上传文件
./logs    -> PHP 日志
./uploads -> 兼容上传目录
./cache   -> 缓存目录
./temp    -> 临时目录
```

关键数据：

```text
/opt/tokchat/data/sales_ai.db
/opt/tokchat/data/uploads/
```

重建镜像不会删除这些目录。只有执行手动删除、覆盖数据目录或 `docker compose down -v` 才会影响数据。

## 11. 备份策略

创建备份目录：

```bash
sudo mkdir -p /var/backups/tokchat
sudo chown -R "$USER":"$USER" /var/backups/tokchat
```

手动备份：

```bash
cd /opt/tokchat
DATE=$(date +%Y%m%d_%H%M%S)

sqlite3 data/sales_ai.db ".backup '/var/backups/tokchat/sales_ai_${DATE}.db'"
tar -czf "/var/backups/tokchat/tokchat_files_${DATE}.tar.gz" data uploads cache
find /var/backups/tokchat -type f -mtime +30 -delete
```

添加定时备份：

```bash
crontab -e
```

加入：

```cron
0 3 * * * cd /opt/tokchat && DATE=$(date +\%Y\%m\%d_\%H\%M\%S) && sqlite3 data/sales_ai.db ".backup '/var/backups/tokchat/sales_ai_${DATE}.db'" && tar -czf "/var/backups/tokchat/tokchat_files_${DATE}.tar.gz" data uploads cache && find /var/backups/tokchat -type f -mtime +30 -delete >> /var/log/tokchat-backup.log 2>&1
```

恢复数据库：

```bash
cd /opt/tokchat
./stop-server.sh
cp /var/backups/tokchat/sales_ai_YYYYMMDD_HHMMSS.db data/sales_ai.db
./deploy.sh 18084
```

## 12. 日常运维命令

```bash
cd /opt/tokchat

# 查看容器状态
docker compose ps

# 查看应用日志
docker compose logs -f sales-ai

# 查看最近日志
docker compose logs --tail=200 sales-ai

# 重启服务
./restart-server.sh 18084

# 停止服务
./stop-server.sh

# 重新部署
./deploy.sh 18084

# 健康检查
curl -fsS http://127.0.0.1:18084/health.php
```

Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo tail -f /var/log/nginx/tokchat.example.com.error.log
sudo tail -f /var/log/nginx/tokchat.example.com.access.log
```

## 13. 升级流程

升级前先备份：

```bash
cd /opt/tokchat
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 data/sales_ai.db ".backup '/var/backups/tokchat/sales_ai_before_upgrade_${DATE}.db'"
tar -czf "/var/backups/tokchat/tokchat_files_before_upgrade_${DATE}.tar.gz" data uploads cache
```

更新代码：

```bash
cd /opt/tokchat
git pull
```

如果代码通过本机上传：

```bash
rsync -avz --delete \
  --exclude='.env' \
  --exclude='data/*' \
  --exclude='uploads/*' \
  --exclude='logs/*' \
  --exclude='cache/*' \
  --exclude='temp/*' \
  ./ user@your-server-ip:/opt/tokchat/
```

重新部署：

```bash
cd /opt/tokchat
./deploy.sh 18084
curl -fsS http://127.0.0.1:18084/health.php
```

升级后检查：

- 前台首页能打开
- 登录页能打开
- 后台能登录
- API 配置页面能测试连通
- 知识库页面能看到已有文档
- 聊天页面能正常返回回答

## 14. 安全建议

- 只开放 `80`、`443`、`22`，不要在云安全组放行 `18084`。
- 上线后立即修改默认管理员密码。
- `.env` 文件只保存在服务器，不提交到 Git。
- 定期备份 `data/sales_ai.db` 和上传目录。
- 生产环境保持 `APP_DEBUG=0`。
- 如果有运维堡垒机或 VPN，优先限制后台路径访问来源。
- 定期查看 `logs/php_errors.log` 和 Nginx 错误日志。

## 15. 常见问题

### 访问域名返回 502

先检查容器是否运行：

```bash
cd /opt/tokchat
docker compose ps
curl -fsS http://127.0.0.1:18084/health.php
```

如果容器正常，再检查 Nginx：

```bash
sudo nginx -t
sudo tail -f /var/log/nginx/tokchat.example.com.error.log
```

### 文件上传失败

如果页面提示“服务器响应格式异常”，先打开浏览器开发者工具的 Network，查看 `api/knowledge.php?action=upload` 的状态码：

- `413`：通常是 Nginx `client_max_body_size` 太小，请确认站点配置里有 `client_max_body_size 24m;` 并已 `sudo systemctl reload nginx`。
- `502` / `504`：反向代理没有连上容器，检查 `docker compose ps` 和 Nginx `proxy_pass`。
- `500`：应用处理异常，查看容器日志和 `logs/php_errors.log`。
- `200` 但不是 JSON：通常是 PHP 输出了 warning/fatal 内容，仍按 `500` 的方式查日志。

检查 `.env`：

```env
PHP_UPLOAD_MAX_FILESIZE=20M
PHP_POST_MAX_SIZE=24M
UPLOAD_MAX_SIZE=10485760
```

`PHP_POST_MAX_SIZE` 应大于 `PHP_UPLOAD_MAX_FILESIZE`，两者都应大于业务上传限制。

确认 Nginx 配置里有：

```nginx
client_max_body_size 24m;
proxy_read_timeout 360s;
proxy_send_timeout 360s;
```

确认容器 PHP 扩展和上传目录：

```bash
docker compose exec sales-ai php -m | grep -E 'zip|mbstring|fileinfo|pdo_sqlite'
docker compose exec sales-ai test -w /var/www/html/data/uploads
docker compose logs --tail=100 sales-ai
sudo tail -n 100 /var/log/nginx/tokchat.example.com.error.log
```

重新部署：

```bash
./deploy.sh 18084
```

### 前台流式回答很慢或中断

确认 Nginx 配置里有：

```nginx
proxy_buffering off;
proxy_read_timeout 360s;
proxy_send_timeout 360s;
```

同时检查后台「API 配置」里的超时时间。

### 后台登录后数据为空

确认挂载目录存在且可写：

```bash
cd /opt/tokchat
ls -lah data logs uploads cache temp
docker compose logs --tail=100 sales-ai
```

如数据库不存在，容器启动时会自动初始化：

```bash
docker compose exec sales-ai php -r "require_once '/var/www/html/api/db.php'; initDatabase(); echo 'ok';"
```

## 16. 上线检查清单

- [ ] 服务器安全组只开放 `22`、`80`、`443`
- [ ] Docker 和 Docker Compose 正常
- [ ] `.env` 已配置，且未提交到 Git
- [ ] `./deploy.sh 18084` 执行成功
- [ ] `health.php` 返回 `status: ok`
- [ ] Nginx 反向代理配置通过 `nginx -t`
- [ ] HTTPS 证书配置成功
- [ ] 默认管理员密码已修改
- [ ] API 配置测试成功
- [ ] 知识库上传和检索正常
- [ ] 前台对话正常
- [ ] 定时备份已配置
