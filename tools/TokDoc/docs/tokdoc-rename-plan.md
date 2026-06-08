# TokDoc 改名实施方案

## 目标

把当前 `TokHtml` 升级命名为 `TokDoc`，使产品名和 HTML / PDF / Word 三类文档管理能力一致。改名应覆盖用户可见界面、仓库入口、Docker/Node 运行标识和文档说明，同时保留已有数据、短链接、登录态和已生成 HTML 的兼容能力。

## 当前扫描结论

本次扫描范围：

- 仓库首页：`README.md`
- 工具目录首页：`tools/README.md`
- 当前项目：`tools/TokHtml/**`
- 关联引用：`tools/toktra/README.md`

主要命中点：

- 仓库入口仍以 `TokHtml` 展示，并描述为“本地 HTML 管理器”。
- 项目目录、包名、Docker 服务名、容器名、健康检查、日志和默认配置仍使用 `tokhtml`。
- 前端 UI、登录弹层、编辑桥工具条、设置说明和实施思路仍显示 `tokhtml`。
- 后端默认环境变量为 `TOKHTML_*`，数据库文件为 `tokhtml.db`，Cookie 名为 `tokhtml_session`。
- HTML 注入协议使用大量 `data-tokhtml-*`、`.tokhtml-*`、`tokhtml-tracking` 标记。
- 测试文件显式断言 `tokhtml`、`tokhtml_session`、`tokhtml-edit-panel` 等字符串。

## 推荐策略

采用“一次改主品牌，兼容旧协议”的迁移方式。

公开品牌和新生成内容统一改成 `TokDoc` / `tokdoc`；旧的 `tokhtml` 标记、Cookie、数据库文件和环境变量作为兼容入口保留一段时间。这样能让新用户看到完整的新名字，也不会破坏已有页面和已有部署。

## 改名范围

### 1. 仓库目录与入口文档

建议执行：

- `tools/TokHtml/` 改为 `tools/TokDoc/`。
- 更新根目录 `README.md`：
  - 当前工具表：`TokHtml` -> `TokDoc`
  - 说明：从“本地 HTML 管理器”改为“本地文档发布与编辑管理器”
  - 快速开始路径：`tools/TokHtml` -> `tools/TokDoc`
  - 目录结构示例和使用建议同步改名。
- 更新 `tools/README.md`：
  - `TokHtml/` -> `TokDoc/`
  - 说明改成 HTML/PDF/Word 文档管理。
- 更新 `tools/toktra/README.md`：
  - “借鉴 tokhtml”改为“借鉴 TokDoc，原 TokHtml 的同页 HTML 桥接思路”。

### 2. 项目元数据与 Docker

建议修改：

- `package.json`
  - `name: "tokhtml"` -> `"tokdoc"`
  - description 改为 TokDoc 文档管理器。
- `package-lock.json`
  - 通过 `npm install --package-lock-only` 或 `npm install` 同步包名。
- `docker-compose.yml`
  - service：`tokhtml` -> `tokdoc`
  - container：`tokhtml` -> `tokdoc`
  - 端口环境变量：`TOKHTML_HOST_PORT` -> `TOKDOC_HOST_PORT`
  - 运行环境变量改为 `TOKDOC_*`。
- `Dockerfile`
  - `TOKHTML_DATA_DIR`、`TOKHTML_WATCH_DIRS`、`TOKHTML_SOFFICE_BIN` 改为 `TOKDOC_*`。

兼容要求：

- 后端仍读取旧 `TOKHTML_*` 作为 fallback。
- README 中明确新变量优先，旧变量可兼容但不再推荐。

### 3. 后端配置与运行标识

建议修改：

- `src/config.js`
  - `name: 'tokdoc'`
  - 默认读取顺序改为：
    - `TOKDOC_DATA_DIR` 优先
    - 无新变量时兼容 `TOKHTML_DATA_DIR`
  - `TOKDOC_WATCH_DIRS` 兼容 `TOKHTML_WATCH_DIRS`
  - `TOKDOC_ALLOW_SOURCE_WRITE` 兼容 `TOKHTML_ALLOW_SOURCE_WRITE`
  - `TOKDOC_SOFFICE_BIN` 兼容 `TOKHTML_SOFFICE_BIN`
- `src/server.js`
  - 日志 `tokhtml listening` -> `tokdoc listening`。
- `src/routes.js`
  - `/api/health` 返回 `name: 'tokdoc'`。
  - 内部 URL placeholder 从 `tokhtml.local` 改为 `tokdoc.local`。
  - sync user-agent 改为 `tokdoc-sync`。
  - sync payload 的 `source` 改为 `tokdoc`，可加 `legacySource: 'tokhtml'` 便于线上旧程序过渡。

### 4. 数据库与数据兼容

不建议简单把数据库文件硬改成 `tokdoc.db`，否则已有 `data/tokhtml.db` 部署会像“数据丢了”。

推荐实现：

- 新增配置项 `dbPath`。
- 默认逻辑：
  - 如果设置了 `TOKDOC_DB_PATH`，使用它。
  - 否则如果设置了旧 `TOKHTML_DB_PATH`，使用旧变量。
  - 否则如果 `data/tokhtml.db` 已存在且 `data/tokdoc.db` 不存在，继续使用 `tokhtml.db`。
  - 否则新安装默认使用 `data/tokdoc.db`。
- `src/db.js` 从 `config.dbPath` 读取数据库路径。
- README 数据目录说明写清：
  - 新安装：`data/tokdoc.db`
  - 旧安装：可继续使用 `data/tokhtml.db`

不迁移、不复制、不删除旧数据库文件，避免误操作。

### 5. 登录与 Cookie

建议修改：

- 新安装默认密码：`tokdoc`。
- 已有数据库中的用户密码不强行改，继续沿用已有设置。
- Cookie：
  - 新 Cookie 名：`tokdoc_session`
  - 登录时写入 `tokdoc_session`
  - 鉴权时同时接受 `tokdoc_session` 和旧 `tokhtml_session`
  - 退出时同时清除两个 Cookie
- 登录 UI：
  - `tokhtml 登录` -> `TokDoc 登录`
  - 默认密码提示改为 `tokdoc`

### 6. 前端 UI 文案

建议修改：

- `public/index.html`
  - `<title>` 改为 `TokDoc 本地文档管理器`
  - 顶部品牌 `tokhtml` 改为 `TokDoc`
  - 登录标题改为 `TokDoc 登录`
  - 说明文字中的 `tokhtml 标记` 改为 `TokDoc 标记`
  - “tokhtml 编辑桥”改为 “TokDoc 编辑桥”
- `public/app.js`
  - 若有 toast 或展示文案涉及旧名，同步改成 TokDoc。

### 7. HTML 注入协议与编辑桥

这里不能只做字符串替换，因为已生成 HTML 可能含旧标记。

推荐实现：

- 新生成的编辑桥使用 `tokdoc` 前缀：
  - `data-tokdoc-bridge`
  - `data-tokdoc-editable`
  - `data-tokdoc-module`
  - `.tokdoc-edit-panel`
  - `.tokdoc-editable`
  - `.tokdoc-module-*`
- 清理函数必须同时识别旧标记和新标记：
  - `data-tokhtml-*`
  - `.tokhtml-*`
  - `data-tokdoc-*`
  - `.tokdoc-*`
- 统计代码标记改为：
  - 新：`<!-- tokdoc-tracking:start -->`
  - 旧：`<!-- tokhtml-tracking:start -->`
  - `stripTrackingCode` 同时清理新旧标记，避免重复注入。
- 资源 base 标记改为：
  - 新：`data-tokdoc-base`
  - 旧：`data-tokhtml-base`
  - `strip...AssetBase` 同时清理新旧 base。
- 编辑桥工具条显示 `TokDoc`。

这样会让新生成页面完全呈现 TokDoc，同时旧页面仍能被正常保存和清理。

### 8. 默认密码与测试

测试需要同步改动：

- `test/auth.test.js`
  - 默认登录密码改为 `tokdoc`
  - Cookie 断言改为 `tokdoc_session`
  - 增加旧 `tokhtml_session` 兼容测试
  - 登录页断言改为 `TokDoc 登录`
- `test/page-store.test.js`
  - 临时目录前缀可从 `tokhtml-*` 改为 `tokdoc-*`
  - tracking/base 标记断言改成 `tokdoc`
  - 增加旧 `tokhtml` 标记会被清理的断言
- `test/url-and-edit-bridge.test.js`
  - 新编辑桥断言改成 `tokdoc-*`
  - 保留旧 `tokhtml-*` 清理测试
- `test/home-layout.test.js`
  - UI 文案改成 TokDoc。

### 9. 历史文档和原型

建议修改：

- `docs/backend-development-plan.md`
  - 主标题和主文案改为 TokDoc。
  - 如果涉及历史第一版 HTML 管理器，可写成“原 TokHtml 阶段”。
- `docs/prototype/tokhtml-prototype.html`
  - 文件名建议改为 `tokdoc-prototype.html`
  - 原型页面里的品牌同步改成 TokDoc。
- `README.md`
  - 原型路径同步改成 `docs/prototype/tokdoc-prototype.html`。

### 10. 旧链接和公开路由

不改：

- `/admin`
- `/<slug>`
- `/pages/:slug.html` 旧链接兼容
- `/page-assets/...`

这些是访问协议，不应该因为品牌改名改变。

## 非目标

本次不做：

- 不删除或清空 `data/`。
- 不强制迁移旧数据库文件。
- 不修改已生成页面的短链接。
- 不改变 HTML/PDF/Word 上传、阅读、编辑、回收站、访问统计等业务行为。
- 不改变 Docker 默认端口 `18082`。
- 不要求线上绑定程序立即改造，但会给 sync payload 增加兼容字段。

## 实施步骤

1. 用 `git mv tools/TokHtml tools/TokDoc` 改目录名。
2. 更新仓库首页、`tools/README.md`、TokDoc README、历史文档和原型文件名。
3. 更新 `package.json` 并同步 `package-lock.json`。
4. 更新 Dockerfile 和 docker-compose 新变量，后端配置保留旧变量 fallback。
5. 更新数据库路径策略，新增 `config.dbPath`。
6. 更新后端健康检查、日志、Cookie、默认密码、sync 标识。
7. 更新前端 UI 和编辑桥显示名。
8. 将新 HTML 协议前缀改成 `tokdoc`，并保留旧 `tokhtml` 清理兼容。
9. 更新所有测试断言，并增加旧标记兼容测试。
10. 用 `rg -n -i "tokhtml|TokHtml|TOKHTML"` 做最终扫描，只允许以下遗留：
    - 旧环境变量 fallback
    - 旧 Cookie 兼容
    - 旧数据库兼容
    - 旧 HTML 标记清理兼容
    - 历史说明文档中的“原 TokHtml”
11. 运行验证命令。
12. 提交并推送。

## 验证命令

在 `tools/TokDoc` 下运行：

```bash
npm test
node --check src/config.js
node --check src/db.js
node --check src/html.js
node --check src/edit-bridge.js
node --check src/page-store.js
node --check src/routes.js
node --check src/server.js
node --check public/app.js
npm_config_registry=https://registry.npmjs.org npm audit --omit=dev
docker compose build
docker compose up -d
curl -sS http://127.0.0.1:18082/api/health
docker exec tokdoc soffice --version
```

额外 smoke test：

- 新安装登录：`admin / tokdoc`
- 上传 HTML 后 `/<slug>` 可公开访问，`?edit=1` 需要登录。
- 上传 PDF 后 `/<slug>` 返回 `application/pdf`。
- 上传 Word 后 `/<slug>` 返回转换后的 `application/pdf`。
- 旧 `data/tokhtml.db` 存在时，服务仍读取旧数据。
- 旧 `tokhtml_session` Cookie 在过渡期仍能鉴权。
- 旧 HTML 中的 `data-tokhtml-*` 和 `.tokhtml-*` 保存后会被清理。

## 风险与处理

### 风险 1：旧部署数据看起来丢失

原因：数据库文件从 `tokhtml.db` 改成 `tokdoc.db` 后，旧数据不会自动出现。

处理：实现 `tokhtml.db` 自动兼容，不做强制迁移。

### 风险 2：旧页面保存后残留旧编辑桥

原因：已生成 HTML 可能含 `data-tokhtml-*` 或 `.tokhtml-*`。

处理：清理逻辑同时支持 `tokhtml` 和 `tokdoc`。

### 风险 3：旧环境变量失效

原因：服务器可能仍设置 `TOKHTML_DATA_DIR` 等变量。

处理：后端保留旧变量 fallback；README 标记新变量为推荐。

### 风险 4：线上同步接收端依赖 `source: tokhtml`

原因：线上同类程序可能按 source 字段判断来源。

处理：新 payload 使用 `source: tokdoc`，同时带 `legacySource: tokhtml` 过渡字段。

## 回滚方式

代码层回滚：恢复本次提交即可。

数据层不需要回滚，因为方案不删除、不复制、不强制迁移数据库。若新安装已生成 `tokdoc.db`，旧版本服务不会自动读取它；这属于新旧版本配置差异，可通过 `TOKHTML_DATA_DIR` 或手动指定旧版本数据路径处理。

## 推荐结论

建议按本方案实施。关键原则是：用户看到的是 TokDoc，新生成内容使用 TokDoc；历史 `tokhtml` 只作为兼容协议存在，直到确认没有旧部署和旧页面依赖后再考虑彻底移除。
