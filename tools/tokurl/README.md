# TokURL

TokURL is a fast, self-hostable short-link system. It provides a public redirect endpoint, an editable account console, user management, click analytics, and a local multi-container deployment.

The admin console defaults to Simplified Chinese and includes a top-right language switch for English.

## Stack

- API: Fastify, TypeScript, Drizzle ORM
- Storage: Postgres
- Cache and analytics queue: Redis
- Worker: Redis Stream consumer that persists click events asynchronously
- Web: React, Vite, TanStack Query
- Deployment: Docker Compose with `postgres`, `redis`, `api`, `worker`, and `web`

```
Browser -> web console -> API -> Postgres
Visitor -> /:slug -> Redis cache -> Postgres fallback -> 302 redirect
                         |
                         v
                    Redis Stream -> worker -> clicks table
```

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Open the console at `http://localhost:3000`.

The first startup bootstraps a super admin:

- Username: `admin`
- Password: `tokurl-admin`

Change these values with environment variables before exposing a production deployment.

Short links resolve from `http://localhost:8080/{slug}` by default. Change `PUBLIC_SHORT_BASE_URL` when running behind a real domain. For a single-domain setup such as `https://ai.laoyao.cn/{slug}`, the public gateway must route `/api/*` and root short-code paths to the API. The packaged Web container already proxies those paths to the API when all traffic is sent to the Web container.

For production server setup, see [docs/server-deployment.md](docs/server-deployment.md).

## Local Development

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

## API Surface

Public:

- `GET /health`
- `GET /:slug`
- `GET /api/config`

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Authenticated links:

- `GET /api/links?search=&limit=&offset=`
- `POST /api/links`
- `GET /api/links/:id`
- `PATCH /api/links/:id`
- `DELETE /api/links/:id`
- `GET /api/links/stats`
- `GET /api/links/:id/stats`

Admin users can see and manage every link. Ordinary users only see their own links and analytics.

Admin-only users:

- `GET /api/users?search=&limit=&offset=`
- `POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/password`

The console uses an HttpOnly session cookie. `TOKURL_ADMIN_TOKEN` is still supported as an optional machine-token compatibility path for admin API automation.

Example create request:

```bash
curl -c tokurl.cookies -b tokurl.cookies -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"tokurl-admin"}'

curl -b tokurl.cookies -X POST http://localhost:8080/api/links \
  -H 'Content-Type: application/json' \
  -d '{"targetUrl":"https://example.com","title":"Example"}'
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_SHORT_BASE_URL` | `http://localhost:8080` | Base URL returned by the API and shown in the console. |
| `VITE_API_BASE_URL` | `http://localhost:8080` | API URL baked into the web image. |
| `WEB_PORT` | `3000` | Host port for the web console container. |
| `API_PORT` | `8080` | Host port for the API and redirect container. |
| `POSTGRES_PORT` | `5432` | Host port for Postgres. |
| `REDIS_PORT` | `6379` | Host port for Redis. |
| `TOKURL_SLUG_LENGTH` | `5` | Generated base62 slug length. Increase before very high volume. |
| `TOKURL_REDIRECT_STATUS` | `302` | Supports `301`, `302`, `307`, `308`. |
| `TOKURL_CACHE_TTL_SECONDS` | `300` | Redis cache TTL for active redirect targets. |
| `TOKURL_AUTH_SECRET` | dev value | Secret used to sign session cookies. Change in production. |
| `TOKURL_BOOTSTRAP_ADMIN_EMAIL` | `admin@tokurl.local` | Internal identifier for the first super admin. The default login username is `admin`; the variable is kept for existing deployments. |
| `TOKURL_BOOTSTRAP_ADMIN_PASSWORD` | `tokurl-admin` | Password for the first super admin. Change in production. |
| `TOKURL_ALLOW_REGISTRATION` | `true` | Allows ordinary users to self-register. |
| `TOKURL_COOKIE_SECURE` | `false` | Set to `true` when serving HTTPS. |
| `TOKURL_TITLE_FETCH_TIMEOUT_MS` | `1200` | Best-effort page title fetch timeout during link creation. |
| `TOKURL_TITLE_FETCH_MAX_BYTES` | `131072` | Maximum HTML bytes read while extracting the page title. |
| `TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS` | `false` | Allows title fetching for localhost/private-network targets. Keep disabled for public deployments. |
| `TOKURL_ADMIN_TOKEN` | empty | Optional bearer token for machine-admin API access. |
| `TOKURL_HASH_SALT` | dev value | Used to hash visitor IPs before analytics persistence. Change in production. |
| `TOKURL_ANALYTICS_ENABLED` | `true` | Disables click enqueueing when set to `false`. |

## Performance Model

Redirects read from Redis first. On a cache miss, TokURL reads Postgres, refreshes Redis, and still records analytics asynchronously through Redis Streams. The redirect response does not wait for click persistence.

Generated slugs use base62 and default to five characters. That keeps URLs short while providing a large local namespace. Custom aliases support URL-safe characters and can be edited later.

## Open-Source Defaults

- No external SaaS dependency is required.
- Account sessions use HttpOnly cookies and Argon2id password hashing.
- User ownership is part of the data model, so SaaS, SSO, or team-workspace auth can be layered on later.
- `TOKURL_ADMIN_TOKEN` keeps simple server-to-server automation possible without forcing browser login.
- Database migrations are plain SQL files in `apps/api/drizzle`.
- The redirect behavior, base URL, slug length, cache TTL, and analytics switch are environment-driven.
