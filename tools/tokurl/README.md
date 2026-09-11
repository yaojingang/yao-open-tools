# TokURL

> 英文版说明文档：[README.en.md](README.en.md)

TokURL 是一个快速、可自部署的短链系统。它提供公开跳转入口、可编辑的账号控制台、用户管理、点击统计和本地多容器部署能力。

管理后台默认使用简体中文，右上角提供英文切换入口。

## 技术栈

- API：Fastify、TypeScript、Drizzle ORM
- 存储：Postgres
- 缓存与统计队列：Redis
- Worker：Redis Stream 消费者，异步写入点击事件
- Web：React、Vite、TanStack Query
- 部署：Docker Compose，包含 `postgres`、`redis`、`api`、`worker`、`web`

```text
Browser -> web console -> API -> Postgres
Visitor -> /:slug -> Redis cache -> Postgres fallback -> 302 redirect
                         |
                         v
                    Redis Stream -> worker -> clicks table
```

## 快速开始

```bash
cp .env.example .env
docker compose up --build
```

打开控制台：

```text
http://localhost:3000
```

首次启动会自动创建一个超级管理员：

- 用户名：`admin`
- 密码：`tokurl-admin`

生产环境上线前，请先通过环境变量修改默认账号和密码。

默认情况下，短链从下面的地址访问：

```text
http://localhost:8080/{slug}
```

如果部署到真实域名，请修改 `PUBLIC_SHORT_BASE_URL`。如果使用 `https://ai.laoyao.cn/{slug}` 这类单域名部署，公网网关需要把 `/api/*` 和根路径短码转发到 API。当前 Web 容器已经内置代理规则，当所有流量先进入 Web 容器时，可以把这些路径继续代理到 API。

生产服务器部署说明见：[docs/server-deployment.md](docs/server-deployment.md)。

## 本地开发

```bash
npm install
docker compose up -d postgres redis
DATABASE_URL=postgres://tokurl:tokurl@localhost:5432/tokurl \
REDIS_URL=redis://localhost:6379 \
npm run db:migrate

DATABASE_URL=postgres://tokurl:tokurl@localhost:5432/tokurl REDIS_URL=redis://localhost:6379 npm run dev:api
DATABASE_URL=postgres://tokurl:tokurl@localhost:5432/tokurl REDIS_URL=redis://localhost:6379 npm run dev:worker
VITE_API_BASE_URL=http://localhost:8080 npm run dev:web
```

## API 接口

公开接口：

- `GET /health`
- `GET /:slug`
- `GET /api/config`

认证接口：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

登录后可用的短链接口：

- `GET /api/links?search=&limit=&offset=`
- `POST /api/links`
- `GET /api/links/:id`
- `PATCH /api/links/:id`
- `DELETE /api/links/:id`
- `GET /api/links/stats`
- `GET /api/links/:id/stats`

管理员可以查看和管理所有短链。普通用户只能查看自己的短链和统计数据。

仅管理员可用的用户接口：

- `GET /api/users?search=&limit=&offset=`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/password`

控制台使用 HttpOnly session cookie。`TOKURL_ADMIN_TOKEN` 仍然保留，可用于管理员 API 自动化场景下的机器令牌兼容。

创建短链示例：

```bash
curl -c tokurl.cookies -b tokurl.cookies -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"tokurl-admin"}'

curl -b tokurl.cookies -X POST http://localhost:8080/api/links \
  -H 'Content-Type: application/json' \
  -d '{"targetUrl":"https://example.com","title":"Example"}'
```

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PUBLIC_SHORT_BASE_URL` | `http://localhost:8080` | API 返回并在控制台展示的短链基础地址。 |
| `VITE_API_BASE_URL` | `http://localhost:8080` | 构建 Web 镜像时写入前端的 API 地址。 |
| `WEB_PORT` | `3000` | Web 控制台容器映射到宿主机的端口。 |
| `API_PORT` | `8080` | API 与短链跳转容器映射到宿主机的端口。 |
| `POSTGRES_PORT` | `5432` | Postgres 映射到宿主机的端口。 |
| `REDIS_PORT` | `6379` | Redis 映射到宿主机的端口。 |
| `TOKURL_SLUG_LENGTH` | `5` | 自动生成的 base62 短码长度。高流量场景建议提前加长。 |
| `TOKURL_REDIRECT_STATUS` | `302` | 支持 `301`、`302`、`307`、`308`。 |
| `TOKURL_CACHE_TTL_SECONDS` | `300` | Redis 中活跃跳转目标的缓存时间。 |
| `TOKURL_AUTH_SECRET` | 开发默认值 | session cookie 签名密钥，生产环境必须修改。 |
| `TOKURL_BOOTSTRAP_ADMIN_EMAIL` | `admin@tokurl.local` | 首个超级管理员的内部标识。默认登录用户名是 `admin`，该变量保留给既有部署使用。 |
| `TOKURL_BOOTSTRAP_ADMIN_PASSWORD` | `tokurl-admin` | 首个超级管理员密码，生产环境必须修改。 |
| `TOKURL_ALLOW_REGISTRATION` | `true` | 服务器注册总开关。设为 `false` 时始终关闭对外注册，管理员设置无法覆盖。 |
| `TOKURL_COOKIE_SECURE` | `false` | HTTPS 部署时请设为 `true`。 |
| `TOKURL_TITLE_FETCH_TIMEOUT_MS` | `1200` | 创建短链时抓取页面标题的超时时间。 |
| `TOKURL_TITLE_FETCH_MAX_BYTES` | `131072` | 提取页面标题时最多读取的 HTML 字节数。 |
| `TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS` | `false` | 是否允许为 localhost 或私有网络目标抓取标题。公网部署建议保持关闭。 |
| `TOKURL_ADMIN_TOKEN` | 空 | 可选的管理员 Bearer Token，用于机器访问管理接口。 |
| `TOKURL_HASH_SALT` | 开发默认值 | 点击统计入库前用于哈希访客 IP，生产环境必须修改。 |
| `TOKURL_ANALYTICS_ENABLED` | `true` | 设为 `false` 后停止写入点击统计队列。 |

## 性能模型

短链跳转优先读取 Redis。缓存未命中时，TokURL 会读取 Postgres，刷新 Redis，并继续通过 Redis Streams 异步记录点击事件。跳转响应不会等待点击记录入库。

自动短码使用 base62，默认长度为 5 位，在保持链接很短的同时提供足够的本地命名空间。自定义短码支持 URL 安全字符，并且可以在创建后继续编辑。

## 开源默认设计

- 不依赖外部 SaaS。
- 账号会话使用 HttpOnly cookie，密码使用 Argon2id 哈希。
- 数据模型内置用户归属，后续可以继续扩展 SaaS、SSO 或团队空间能力。
- `TOKURL_ADMIN_TOKEN` 保留简单的服务端自动化入口，不强制浏览器登录。
- 数据库迁移使用 `apps/api/drizzle` 下的普通 SQL 文件。
- 跳转行为、短链基础地址、短码长度、缓存时间和统计开关都可以通过环境变量配置。

## 对外注册控制

管理员可进入 **设置 → 网站设置**，调整 **允许对外注册**，点击“保存网站设置”后生效，无需重启服务。关闭后，页面隐藏注册入口，`POST /api/auth/register` 返回 `403 registration_disabled`。已有账号仍可登录，管理员仍可创建用户。

同一页面的 **账号使用权限** 支持分页浏览、按用户名搜索现有账号，并直接禁用或重新启用。账号被禁用后，现有会话的下一次请求会失效，登录接口也会拒绝该账号；重新启用后需要重新登录。当前登录的管理员账号不会出现在这个快捷列表中，避免误操作导致自己退出。

注册默认开启，同时受网站设置和 `TOKURL_ALLOW_REGISTRATION` 控制，两者均开启时才允许注册。设置保存在数据库中；更新 API 前请执行数据库迁移（`npm run db:migrate`）。Docker Compose 会在 API 启动时自动执行迁移。
