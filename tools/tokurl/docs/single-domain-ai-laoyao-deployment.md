# TokURL 单域名部署修改文档：ai.laoyao.cn

本文档用于把 TokURL 统一部署到一个二级域名：

```text
https://ai.laoyao.cn
```

单域名部署后，后台、API 和短链都走同一个域名：

| 访问内容 | URL 示例 | 转发到 |
| --- | --- | --- |
| 首页创建短链 | `https://ai.laoyao.cn/` | `web` 容器 |
| 链接管理 | `https://ai.laoyao.cn/links` | `web` 容器 |
| 数据统计 | `https://ai.laoyao.cn/analytics` | `web` 容器 |
| 用户管理 | `https://ai.laoyao.cn/users` | `web` 容器 |
| 设置页面 | `https://ai.laoyao.cn/settings` | `web` 容器 |
| API | `https://ai.laoyao.cn/api/*` | `api` 容器 |
| 短链跳转 | `https://ai.laoyao.cn/abcde` | `api` 容器 |

## 1. 这次要解决的问题

当前线上页面显示的短链前缀是：

```text
ai.laoyao.cn/api/
```

原因是 API 返回的运行时配置里，`shortBaseUrl` 被配置成了：

```text
https://ai.laoyao.cn/api
```

也就是线上 `.env` 里的 `PUBLIC_SHORT_BASE_URL` 写成了带 `/api` 的地址。`PUBLIC_SHORT_BASE_URL` 表示“用户最终访问短链的公开地址”，不是 API 接口地址，所以单域名部署时不能带 `/api`。

## 2. 修改 `.env`

进入 TokURL 部署目录：

```bash
cd /path/to/TokURL
```

备份当前环境变量：

```bash
cp .env ".env.bak.$(date +%Y%m%d-%H%M%S)"
```

编辑 `.env`：

```bash
nano .env
```

把下面几项改成：

```env
PUBLIC_SHORT_BASE_URL=https://ai.laoyao.cn
VITE_API_BASE_URL=https://ai.laoyao.cn
CORS_ORIGIN=https://ai.laoyao.cn
TOKURL_COOKIE_SECURE=true
```

不要写成：

```env
PUBLIC_SHORT_BASE_URL=https://ai.laoyao.cn/api
VITE_API_BASE_URL=https://ai.laoyao.cn/api
```

`VITE_API_BASE_URL` 也不需要带 `/api`，前端代码请求接口时会自动拼 `/api/config`、`/api/links` 这些路径。

## 3. 修改反向代理

单域名部署的关键是路由分流：

- `/api/*` 转发到 API。
- `/assets/*` 和前端页面路径转发到 Web。
- `/{slug}` 这种短码路径转发到 API。
- 其它路径回到 Web，让前端伪静态路由正常工作。

如果公网 Nginx、宝塔、1Panel 或云厂商网关把 `https://ai.laoyao.cn/*` 全部转发到 Web 容器，旧版 Web 容器会把 `/LBQyb` 这类路径回退到前端 `index.html`，短链就不会跳转。现在 Web 容器内置 Nginx 已经增加了 `/api/` 和 `/{slug}` 到 API 容器的反代，公网入口可以直接指向 Web 容器。

如果你希望公网 Nginx 直接分别转发到 Web 和 API 两个端口，也可以使用下面的 Nginx 示例。把证书路径改成你服务器上的真实路径。

```nginx
upstream tokurl_web {
  server 127.0.0.1:3000;
}

upstream tokurl_api {
  server 127.0.0.1:8080;
}

server {
  listen 80;
  server_name ai.laoyao.cn;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ai.laoyao.cn;

  ssl_certificate /etc/letsencrypt/live/ai.laoyao.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ai.laoyao.cn/privkey.pem;

  client_max_body_size 10m;

  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # API。注意 proxy_pass 后面不要加尾部斜杠，否则 /api/config 可能会被改写成 /config。
  location ^~ /api/ {
    proxy_pass http://tokurl_api;
  }

  # API 健康检查。
  location = /health {
    proxy_pass http://tokurl_api;
  }

  # 前端静态资源。
  location ^~ /assets/ {
    proxy_pass http://tokurl_web;
  }

  location = /favicon.ico {
    proxy_pass http://tokurl_web;
  }

  location = /robots.txt {
    proxy_pass http://tokurl_web;
  }

  # 前端伪静态页面。
  location = / {
    proxy_pass http://tokurl_web;
  }

  location = /create {
    proxy_pass http://tokurl_web;
  }

  location = /links {
    proxy_pass http://tokurl_web;
  }

  location = /analytics {
    proxy_pass http://tokurl_web;
  }

  location = /users {
    proxy_pass http://tokurl_web;
  }

  location = /settings {
    proxy_pass http://tokurl_web;
  }

  # 短链跳转。TokURL 的短码支持 2 到 64 位，字符为数字、字母、下划线和短横线。
  location ~ "^/[0-9A-Za-z_-]{2,64}$" {
    proxy_pass http://tokurl_api;
  }

  # 其它路径交给前端，避免刷新前端页面时 404。
  location / {
    proxy_pass http://tokurl_web;
  }
}
```

检查并重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

如果使用宝塔、1Panel 或云厂商反向代理，按同样规则配置：

- `/api/` 指向 `127.0.0.1:8080`，不要去掉 `/api` 前缀。
- `/assets/`、`/links`、`/analytics`、`/users`、`/settings` 指向 `127.0.0.1:3000`。
- 短码路径指向 `127.0.0.1:8080`。
- 其它路径指向 `127.0.0.1:3000`。

如果你的公网入口只支持配置一个上游，推荐直接指向 Web 容器端口：

```text
https://ai.laoyao.cn/* -> 127.0.0.1:3000
```

Web 容器会继续做二次分流：

```text
/api/*                  -> api:8080
/{2-64位短码}            -> api:8080
/, /links, /settings 等 -> Web 静态前端
```

## 4. 重新构建和启动

`PUBLIC_SHORT_BASE_URL` 是 API 运行时配置，改完后需要重建或重启 API 容器。

`VITE_API_BASE_URL` 会写进前端构建包，改完后必须重新构建 Web 镜像。

执行：

```bash
docker compose up -d --build web api
```

如果 worker 没有运行，也可以一起拉起：

```bash
docker compose up -d --build web api worker
```

查看状态：

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 web
```

## 5. 验证

先验证运行时配置：

```bash
curl -s https://ai.laoyao.cn/api/config
```

返回里的 `shortBaseUrl` 应该是：

```json
"shortBaseUrl": "https://ai.laoyao.cn"
```

如果还是：

```json
"shortBaseUrl": "https://ai.laoyao.cn/api"
```

说明 API 容器没有拿到新的 `.env`，或者容器还没重启成功。

再验证 API：

```bash
curl -i https://ai.laoyao.cn/api/config
curl -i https://ai.laoyao.cn/health
```

验证前端页面：

```bash
curl -I https://ai.laoyao.cn/
curl -I https://ai.laoyao.cn/links
curl -I https://ai.laoyao.cn/settings
```

验证短链跳转，需要先在后台创建一个短链。假设短码是 `abcde`：

```bash
curl -I https://ai.laoyao.cn/abcde
```

正常情况下会返回 `302`，并带有目标地址：

```text
HTTP/2 302
location: https://example.com/...
```

## 6. 已有短链是否需要重建

不需要。

TokURL 数据库里保存的是短码和目标地址，短链完整 URL 是运行时按 `PUBLIC_SHORT_BASE_URL + "/" + slug` 生成的。把 `PUBLIC_SHORT_BASE_URL` 从 `https://ai.laoyao.cn/api` 改成 `https://ai.laoyao.cn` 后，后台列表、二维码和新建结果都会跟随新前缀显示。

## 7. 单域名部署的路径保留

单域名部署会让短码和前端页面共享同一个根路径，所以这些路径不能作为短码使用：

```text
api
assets
health
favicon.ico
robots.txt
create
links
analytics
users
settings
```

如果未来新增前端页面，也要把对应路径加入反向代理保留路径，避免短链和页面路由冲突。

## 8. 常见问题

### 首页仍然显示 `ai.laoyao.cn/api/`

检查：

```bash
docker compose exec api printenv PUBLIC_SHORT_BASE_URL
curl -s https://ai.laoyao.cn/api/config
```

如果环境变量仍然带 `/api`，修改 `.env` 后重启 API：

```bash
docker compose up -d api
```

### 前端接口请求变成 `/api/api/config`

通常是 `VITE_API_BASE_URL` 写成了：

```env
VITE_API_BASE_URL=https://ai.laoyao.cn/api
```

改成：

```env
VITE_API_BASE_URL=https://ai.laoyao.cn
```

然后重新构建 Web：

```bash
docker compose up -d --build web
```

### `/api/config` 404

检查 Nginx 的 `/api/` 配置。单域名部署时应保留原始 URI：

```nginx
location ^~ /api/ {
  proxy_pass http://tokurl_api;
}
```

不要写成：

```nginx
location ^~ /api/ {
  proxy_pass http://tokurl_api/;
}
```

后者可能会把 `/api/config` 转成 `/config`。

### 短链打开后还是前端页面

说明 `/{slug}` 没有转发到 API。检查 Nginx 里是否有这段：

```nginx
location ~ "^/[0-9A-Za-z_-]{2,64}$" {
  proxy_pass http://tokurl_api;
}
```

还要确认这段没有被更靠前的 `location ^~ /` 或平台面板的默认站点规则覆盖。

### `/links`、`/users` 刷新后进了 API

说明前端页面路径没有作为保留路径转发到 Web。补上：

```nginx
location = /links {
  proxy_pass http://tokurl_web;
}

location = /users {
  proxy_pass http://tokurl_web;
}
```

然后重载 Nginx：

```bash
nginx -t
systemctl reload nginx
```

## 9. 推荐最终状态

完成后，线上应该满足：

```text
https://ai.laoyao.cn/                 -> Web 首页
https://ai.laoyao.cn/links            -> Web 链接管理
https://ai.laoyao.cn/api/config       -> API 配置
https://ai.laoyao.cn/{slug}           -> API 短链跳转
```

后台创建短链时，自定义短码前缀应显示：

```text
ai.laoyao.cn/
```
