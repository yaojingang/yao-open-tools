# TokDoc 后端开发计划

## 结论

TokDoc 应该把“打开页面后直接编辑并自动保存”作为主流程，独立编辑器保留为备用入口。这个方案更接近飞书文档的使用方式：用户先看到最终页面，再直接改标题、段落、列表、表格文字，系统在后台自动保存。独立编辑器适合处理复杂 HTML、批量替换、恢复版本和排版修复，不应该成为日常编辑的唯一入口。

## 推荐架构

- 前端：现有原型升级为 Vite + TypeScript 单页应用，负责上传、列表、筛选、预览、编辑状态和设置。
- 后端：Node.js + Fastify，提供文件上传、目录监听、HTML 解析、页面服务、自动保存和版本管理 API。
- 数据库：SQLite，保存页面元信息、监听目录、版本记录和保存状态。
- 文件系统：Docker volume 挂载本地目录，TokDoc 只管理 HTML 文件和生成后的页面副本。
- 目录监听：chokidar 监听多个目录，发现新增、修改、删除后增量更新 SQLite。

## Docker 本地运行

目标是一条命令启动：

```bash
docker compose up -d
```

建议映射：

```yaml
services:
  tokdoc:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - ./html-inbox:/watch/html-inbox
```

容器内约定：

- `/app/data/tokdoc.db`：SQLite 数据库。
- `/app/data/uploads/`：单文件上传的 HTML。
- `/app/data/generated/`：生成后的可访问页面。
- `/app/data/versions/`：自动保存前后的版本快照。
- `/watch/<name>/`：用户挂载的一个或多个本地 HTML 目录。

## 核心接口

- `GET /`：TokDoc 管理首页。
- `GET /api/pages`：页面列表，支持搜索、状态和目录筛选。
- `POST /api/pages/upload`：上传一个或多个 HTML。
- `POST /api/watch-dirs`：新增监听目录。
- `DELETE /api/watch-dirs/:id`：移除监听目录记录。
- `POST /api/watch-dirs/:id/rescan`：手动重新扫描目录。
- `GET /pages/:slug.html`：普通预览页面。
- `GET /pages/:slug.html?edit=1`：注入 TokDoc 编辑桥的可编辑页面。
- `PATCH /api/pages/:id/content`：自动保存编辑后的 HTML。
- `GET /api/pages/:id/versions`：查看版本历史。
- `POST /api/pages/:id/restore/:versionId`：恢复某个版本。

## 目录与页面识别

导入目录时，后端只需要存完整路径和展示名。列表里的“目录名称”取 HTML 文件所在路径的上级目录名：

```text
/watch/html-inbox/school/a.html -> school
/watch/html-inbox/report/geo.html -> report
```

单文件上传没有本地上级目录，列表显示 `-`。

页面元信息解析优先级：

1. `<title>`
2. 页面第一个 `<h1>`
3. 文件名去掉 `.html` 或 `.htm`

## 在线编辑方案

推荐使用“同页编辑桥”：

1. 用户点击预览或打开页面。
2. 默认进入只读预览。
3. 点击“编辑”后，后端返回同一份 HTML，但注入 TokDoc 工具条和编辑脚本。
4. 编辑脚本把 `h1-h6`、`p`、`li`、`td`、`blockquote`、`figcaption` 等文本块标记为可编辑。
5. 用户直接在页面中改字。
6. 前端用 600ms 左右防抖，把当前 HTML 快照或文本补丁提交给后端。
7. 后端先写版本快照，再写入生成页面；如果该目录允许回写，再同步写回源文件。

第一版不要做多人协同编辑。TokDoc 是本地管理器，先实现单用户、多标签可恢复的自动保存即可。多标签场景用 `revision` 字段做乐观锁，发现旧版本提交时提示用户刷新或另存。

## 为什么不是只保留独立编辑器

只保留独立编辑器实现更简单，但用户需要在“预览”和“编辑器”之间来回切换，和管理 HTML 页面这个场景不够顺。直接在页面内编辑更符合最终使用方式，也能减少编辑后的视觉偏差。

独立编辑器仍然应该保留，原因是：

- 有些 HTML 页面结构复杂，直接编辑可能破坏布局。
- 用户需要做长文本粘贴、标题层级整理、批量替换时，独立编辑器更稳。
- 页面脚本或样式干扰编辑时，可以切换到独立编辑器兜底。

## 开发阶段

### 阶段 1：后端骨架

- 初始化 Node.js + TypeScript + Fastify。
- 增加 SQLite 连接和迁移。
- 提供 `GET /api/health`、`GET /api/pages`。
- Dockerfile 和 docker-compose 能启动本地服务。

### 阶段 2：上传、解析与页面服务

- 实现 HTML 上传。
- 解析标题、大小、上传时间、slug。
- 生成 `/pages/:slug.html` 本地 URL。
- 管理首页能读取真实后端数据。

### 阶段 3：多目录监听

- 支持新增多个监听目录。
- 用 chokidar 监听新增、修改、删除。
- 提取上级目录名作为列表里的“目录名称”。
- 目录记录持久化到 SQLite。

### 阶段 4：预览页内直接编辑

- 实现 `/pages/:slug.html?edit=1` 注入编辑桥。
- 文本块 contenteditable。
- 600ms 防抖自动保存。
- 保存状态显示“保存中 / 已保存 / 保存失败”。

### 阶段 5：版本与安全回滚

- 每次自动保存前生成版本快照。
- 支持版本列表和恢复。
- 默认先写生成副本；源目录回写需要目录级开关。
- 对不可写文件、重复 slug、解析失败给出明确状态。

### 阶段 6：打包与使用说明

- 完善 Docker 镜像。
- 增加 `.env` 配置。
- 增加 README：启动、挂载目录、上传、编辑、恢复版本。
- 增加基础测试：上传解析、目录扫描、自动保存、版本恢复。

## 当前原型下一步

早期 UI 原型归档在 `docs/prototype/tokdoc-prototype.html`。真正开发时建议拆成：

- `apps/web/`：管理界面。
- `apps/server/`：Fastify 后端。
- `packages/shared/`：页面类型、API 类型、slug 和路径工具。
- `data/`：本地运行数据目录，不提交业务 HTML。
