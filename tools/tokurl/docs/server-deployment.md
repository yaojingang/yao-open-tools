# TokURL 服务器部署文档

本文档面向生产服务器部署。TokURL 使用 Docker Compose 启动 `web`、`api`、`worker`、`postgres`、`redis` 五个容器。

## 1. 推荐架构

TokURL 默认推荐使用两个域名，规则最简单：

| 用途 | 示例域名 | 指向服务 |
| --- | --- | --- |
| 管理后台 | `https://app.example.com` | `web` |
| API 与短链跳转 | `https://s.example.com` | `api` |

单域名也受支持，例如 `https://ai.laoyao.cn` 同时承载前端、API 和短链。关键是入口路由必须分流：`/api/*` 和 `/{slug}` 进 API，`/`、`/links`、`/analytics`、`/users`、`/settings` 进 Web。当前 Web 容器内置 Nginx 已经支持这套分流，所以公网入口也可以只指向 Web 容器。完整配置见 [single-domain-ai-laoyao-deployment.md](single-domain-ai-laoyao-deployment.md)。

访问流向：

```text
用户浏览器 -> app.example.com -> web 容器
短链访问 -> s.example.com/{slug} -> api 容器 -> Redis/Postgres -> 302 跳转
点击事件 -> Redis Stream -> worker 容器 -> Postgres
```

## 2. 服务器要求

最低建议：

- 1 台 Linux 服务器
- 2 核 CPU
- 2 GB 内存
- 20 GB 以上磁盘
- 已安装 Docker 与 Docker Compose
- 已解析一个或两个域名到服务器公网 IP

生产环境只需要对外开放 `80`、`443`。Postgres、Redis、API、Web 的容器端口建议只绑定到本机，由反向代理转发访问。

## 3. 获取代码

```bash
git clone <your-repo-url> TokURL
cd TokURL
```

如果是直接上传源码包，进入源码目录即可。

## 4. 创建生产环境变量

复制示例文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
nano .env
```

推荐生产配置示例：

```env
COMPOSE_PROJECT_NAME=tokurl

POSTGRES_DB=tokurl
POSTGRES_USER=tokurl
POSTGRES_PASSWORD=replace-with-a-strong-postgres-password
POSTGRES_PORT=127.0.0.1:5432
REDIS_PORT=127.0.0.1:6379
API_PORT=127.0.0.1:8080
WEB_PORT=127.0.0.1:3000

DATABASE_URL=postgres://tokurl:replace-with-a-strong-postgres-password@postgres:5432/tokurl
REDIS_URL=redis://redis:6379

PUBLIC_SHORT_BASE_URL=https://s.example.com
VITE_API_BASE_URL=https://s.example.com
CORS_ORIGIN=https://app.example.com

TOKURL_SLUG_LENGTH=5
TOKURL_REDIRECT_STATUS=302
TOKURL_CACHE_TTL_SECONDS=300
TOKURL_AUTH_SECRET=replace-with-a-long-random-secret
TOKURL_BOOTSTRAP_ADMIN_EMAIL=admin@tokurl.local
TOKURL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-admin-password
TOKURL_ALLOW_REGISTRATION=true
TOKURL_COOKIE_SECURE=true
TOKURL_TITLE_FETCH_TIMEOUT_MS=1200
TOKURL_TITLE_FETCH_MAX_BYTES=131072
TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS=false
TOKURL_ADMIN_TOKEN=
TOKURL_HASH_SALT=replace-with-a-long-random-salt
TOKURL_ANALYTICS_ENABLED=true
```

关键项说明：

- `PUBLIC_SHORT_BASE_URL`：短链对外域名，生成短链时会显示这个域名。
- `VITE_API_BASE_URL`：前端访问 API 的域名。这个值会在构建 Web 镜像时写入前端包，修改后需要重新构建 `web` 镜像。
- `CORS_ORIGIN`：允许访问 API 的管理后台域名。
- `TOKURL_AUTH_SECRET`：Session Cookie 签名密钥，生产必须改。
- `TOKURL_HASH_SALT`：IP 哈希盐，生产必须改。
- `TOKURL_BOOTSTRAP_ADMIN_PASSWORD`：首次空库启动时创建的超级管理员密码。
- `TOKURL_COOKIE_SECURE`：使用 HTTPS 时设为 `true`。
- `TOKURL_ALLOW_REGISTRATION`：是否允许普通用户注册。

默认超级管理员登录用户名是 `admin`。`TOKURL_BOOTSTRAP_ADMIN_EMAIL` 是内部兼容字段，默认 `admin@tokurl.local` 会映射成用户名 `admin`。

## 5. 启动服务

首次启动：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f web
```

API 容器启动时会自动执行数据库迁移：

```text
node apps/api/dist/db/migrate.js && node apps/api/dist/server.js
```

## 6. 配置反向代理

下面以 Nginx 为例。证书可以用 Certbot、宝塔、1Panel、Caddy 或云厂商证书管理。核心是：

- `app.example.com` 转发到 `127.0.0.1:3000`
- `s.example.com` 转发到 `127.0.0.1:8080`

Nginx 示例：

```nginx
server {
  listen 80;
  server_name app.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name app.example.com;

  ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name s.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name s.example.com;

  ssl_certificate /etc/letsencrypt/live/s.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/s.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

修改 Nginx 后检查并重载：

```bash
nginx -t
systemctl reload nginx
```

## 7. 首次登录与安全设置

打开管理后台：

```text
https://app.example.com
```

首次空库启动后，默认管理员为：

- 用户名：`admin`
- 密码：`.env` 中的 `TOKURL_BOOTSTRAP_ADMIN_PASSWORD`

登录后建议立即检查：

- 修改默认管理员密码。
- 在“设置”中配置站点名称、SEO 标题、描述、关键词。
- 如果不希望开放注册，把 `.env` 中的 `TOKURL_ALLOW_REGISTRATION` 改成 `false`，然后重启 API。

重启：

```bash
docker compose up -d --build api worker web
```

## 8. 验证部署

检查 API 健康状态：

```bash
curl https://s.example.com/health
```

预期返回：

```json
{"ok":true,"service":"tokurl-api"}
```

检查 Web 健康状态：

```bash
curl https://app.example.com/health
```

预期返回：

```text
ok
```

在后台创建一个短链，确认生成结果类似：

```text
https://s.example.com/abcde
```

然后访问短链，确认能跳转到目标网址。

## 9. 备份与恢复

TokURL 的核心数据在 Postgres，Redis 主要用于缓存和异步点击队列。生产环境必须定期备份 Postgres。

备份数据库：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U tokurl -d tokurl > backups/tokurl-$(date +%F-%H%M%S).sql
```

恢复数据库：

```bash
cat backups/tokurl-YYYY-MM-DD-HHMMSS.sql | docker compose exec -T postgres psql -U tokurl -d tokurl
```

如果需要完整迁移服务器，也要保留 Docker volume：

```bash
docker volume ls | grep tokurl
```

重点 volume：

- `tokurl_postgres_data`
- `tokurl_redis_data`

## 10. 升级流程

拉取新代码：

```bash
git pull
```

重新构建并启动：

```bash
docker compose up -d --build
```

检查服务：

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
```

注意：如果修改了 `VITE_API_BASE_URL`，必须重新构建 `web` 镜像，否则前端仍会使用旧 API 地址。

## 11. 日常运维

查看实时日志：

```bash
docker compose logs -f api worker
```

重启单个服务：

```bash
docker compose restart api
docker compose restart worker
docker compose restart web
```

查看资源占用：

```bash
docker stats
```

清理未使用镜像：

```bash
docker image prune
```

## 12. 常见问题

### 后台打不开

检查：

```bash
docker compose ps
docker compose logs --tail=100 web
```

确认 `WEB_PORT` 是否绑定到本机端口，Nginx 是否代理到正确端口。

### 前端提示 API 请求失败

检查 `.env`：

```env
VITE_API_BASE_URL=https://s.example.com
CORS_ORIGIN=https://app.example.com
```

修改后重新构建：

```bash
docker compose up -d --build web api
```

### 登录后 Cookie 不生效

如果使用 HTTPS，确认：

```env
TOKURL_COOKIE_SECURE=true
```

如果本地 HTTP 调试，才使用：

```env
TOKURL_COOKIE_SECURE=false
```

### 短链跳转 404

检查短链域名是否指向 API：

```bash
curl https://s.example.com/health
```

如果 `PUBLIC_SHORT_BASE_URL` 写错，需要修改 `.env` 后重启 API。已有短码不需要重建，后台展示的短链域名会跟随新的配置更新。

### 点击数据没有写入

检查 worker：

```bash
docker compose logs --tail=100 worker
```

确认 Redis 正常：

```bash
docker compose exec redis redis-cli ping
```

### 普通用户无法注册

检查：

```env
TOKURL_ALLOW_REGISTRATION=true
```

TokURL 还有每日注册限制：同一个 IP 或同一个客户端每天只能注册 1 次，用于降低批量注册风险。

## 13. 生产安全建议

- 不要使用默认数据库密码。
- 不要使用默认管理员密码。
- `TOKURL_AUTH_SECRET` 和 `TOKURL_HASH_SALT` 必须使用强随机字符串。
- 只开放 `80` 和 `443` 到公网。
- Postgres、Redis、API、Web 的容器端口建议绑定到 `127.0.0.1`。
- 保持 `TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS=false`，避免公网部署时抓取内网地址。
- 定期备份 Postgres。
- 若开放注册，建议结合反向代理限流、WAF 或验证码做进一步防护。
