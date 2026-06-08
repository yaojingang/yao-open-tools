# TokDoc

TokDoc 是一个本地文档管理器，用 Docker 或本机 Node 启动后，可以上传 HTML、PDF 和 Word，生成本地短 URL。HTML 可以预览并在页面内像文档一样直接编辑和自动保存；PDF 和 Word 会以阅读器方式打开，其中 Word 会先转换成 PDF 阅读版本。

## 本地启动

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:8080/admin
```

## Docker 启动

```bash
docker compose up --build
```

Docker 默认访问地址：

```text
http://127.0.0.1:18082/admin
```

如果要改宿主机端口：

```bash
TOKDOC_HOST_PORT=8088 docker compose up --build
```

默认挂载：

- `./data:/app/data`：SQLite、上传文件、生成页面和版本快照。
- `./html-inbox:/watch/html-inbox`：容器内默认监听目录。

Docker 镜像内置 LibreOffice Writer 和 Noto CJK 字体，用于把 `.doc/.docx` 转成 PDF。若本机 Node 直接启动并需要 Word 转 PDF，需要额外安装 LibreOffice，或通过 `TOKDOC_SOFFICE_BIN` 指定 `soffice` 路径。旧部署中的 `TOKHTML_*` 环境变量仍会被读取作为兼容 fallback。

## 登录

默认登录信息：

```text
用户名：admin
密码：tokdoc
```

新安装默认密码是 `tokdoc`。如果旧数据库已经保存过账号密码，系统会继续使用数据库里的旧设置，不会覆盖已有登录信息。

登录成功后会写入长期会话 Cookie，默认保持登录状态。可以在“设置”里修改登录用户名和密码；密码留空保存时不会覆盖当前密码。

后台管理入口固定为 `/admin`。普通生成页面 `/<slug>` 不需要登录即可访问；在线编辑模式 `/<slug>?edit=1` 和所有管理 API 仍需要登录。旧格式 `/pages/<slug>.html` 会继续兼容访问。

## 使用方式

1. 点击“选择文件”上传单个或多个 `.html/.htm/.pdf/.doc/.docx` 文件。
2. 点击“导入目录”可以通过浏览器批量导入一个目录下的 HTML 文件和附件，同时也会识别目录中的 PDF、Word。HTML 目录上传会同步 CSS、JS、图片等相对路径附件，并自动写入 `/page-assets/<uploadId>/...` 资源根。
3. 在“设置”里填入容器可访问的目录路径，例如 `/watch/html-inbox`，保存后会持久化监听目录并扫描。
4. 在“设置”的“统计代码注入”里填写统计脚本，新上传或新扫描生成的 HTML 会自动注入该代码，并使用 TokDoc 标记包裹。
5. 文档列表里点击“预览”可在管理器内查看 HTML 或阅读 PDF；生成后的 `/<slug>` 可公开访问。
6. HTML 点击“编辑”会打开 `/<slug>?edit=1`，直接在页面中修改标题、段落、列表、表格等文字，编辑入口需要后台登录态。PDF 和 Word 作为阅读资产，不进入在线编辑桥。
7. 编辑模式会在鼠标所在的最小可调整模块内部显示一个 `↔` 悬浮手柄和四条边缘拉伸区。拖动 `↔` 可移动模块并写入 `left/top`；拖动上下左右边缘可调整 `width/height`。双击 `↔` 可清除自由定位并回到文档流。
8. 编辑后 600ms 防抖自动保存。保存前会生成版本快照。
9. 页面列表默认每页 20 条，底部翻页条支持上一页、下一页和页码跳转。
10. 访问 `/<slug>` 或编辑地址时，会自动统计访问次数，并显示在列表“目录名称”后。
11. 点击删除会把页面移入“回收站”，对应生成文件会移动到 `data/trash/` 下，原本的 `/<slug>` 不再可访问；在回收站里点击“恢复”可重新展示。
12. 在“设置”的“线上绑定”里填写同类线上程序的 API 地址和 Token 后，页面列表可一键上传当前 HTML 到线上程序。PDF 和 Word 暂不支持线上同步。
13. API 支持版本列表和恢复：

```bash
curl http://127.0.0.1:8080/api/pages/<pageId>/versions
curl -X POST http://127.0.0.1:8080/api/pages/<pageId>/restore/<versionId>
```

上传和目录扫描生成的文档 URL 会统一为：

```text
/f812c6
```

实体文件仍保存在 `data/pages/` 下，文件名会带日期、原始名称和短码。HTML 保留 `.html`，PDF 保留 `.pdf`，Word 会转换成 `.pdf`，例如：

```text
data/pages/20260606-yi-xin-geo-report-f812c6.html
data/pages/20260608-contract-a1b2c3.pdf
```

## API 摘要

- `GET /api/health`
- `GET /api/session`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/pages`
- `POST /api/pages/upload`
- `POST /api/pages/samples`
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/pages/:id`
- `PATCH /api/pages/:id/content`
- `POST /api/pages/:id/sync`
- `DELETE /api/pages/:id`
- `POST /api/pages/:id/restore`
- `GET /api/pages/:id/versions`
- `POST /api/pages/:id/restore/:versionId`
- `GET /api/watch-dirs`
- `POST /api/watch-dirs`
- `DELETE /api/watch-dirs/:id`
- `POST /api/watch-dirs/:id/rescan`
- `GET /:slug`
- `GET /:slug?edit=1`
- `GET /pages/:slug.html`：旧链接兼容

## 数据目录

```text
data/tokdoc.db        SQLite 数据库；旧安装若已有 data/tokhtml.db 会继续读取旧库
data/uploads/         上传源文件副本，含 HTML/PDF/Word 原文件和目录附件
data/pages/           生成后的本地页面或阅读文件，文件名包含日期、原始名称和短码
data/trash/           回收站文件，未注册为可访问静态目录
data/versions/        自动保存和恢复用的版本快照
page-assets/          运行时静态前缀，映射到 data/uploads/ 内的上传附件
html-inbox/           本地默认监听目录
```

从旧 TokHtml 升级到 TokDoc 时：

- 本机 Node 直接启动会自动探测同级 `../TokHtml/data/tokhtml.db`，前提是新的 `TokDoc/data/` 里还没有数据库。
- Docker Compose 默认只挂载当前 `TokDoc/data`，如果旧数据仍在 `tools/TokHtml/data`，先把旧 `data` 目录移动或复制到 `tools/TokDoc/data`，再启动新容器。

## 测试

```bash
npm test
```

## 原型归档

早期单文件 UI 原型保留在：

```text
docs/prototype/tokdoc-prototype.html
```
