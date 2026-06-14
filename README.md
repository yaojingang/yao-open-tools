# yao-open-tools

Yao 的开源小工具集合，面向本地优先的 AI 编码、开发者效率、终端诊断、网页截图、网页/PDF 翻译、视频转写和磁盘空间分析等日常工作流。

这个仓库不是一个大而全的平台，也不是某个单一产品的源码仓库。它更像一个持续演进的工具箱：每个工具都尽量保持独立、轻量、可直接运行，并围绕一个明确问题提供可复用的命令行、浏览器扩展或本地工作台能力。

## 项目定位

`yao-open-tools` 的目标是沉淀一组真正能在本机工作流里反复使用的小工具。

它重点关注这些方向：

- AI 编码使用量、模型成本、终端来源和工具覆盖率的本地统计。
- 浏览器页面截图、长页面留档、主体内容裁剪和多格式导出。
- 浏览器网页和 PDF 的英译中辅助阅读、划词翻译、渐进式加载和本地缓存。
- 视频下载、字幕提取、音频转写和基于 transcript 的 AI 报告生成。
- 自托管短链接、二维码分发、访问统计和多用户链接管理。
- 本机内存、GPU、软件活跃度和进程热点诊断。
- 磁盘空间扫描、风险分类、可回收空间分析和安全清理计划。
- 未来更多围绕 `tok*`、本地日志、HTML 报告、终端效率和开发者运营的开源工具。

这个仓库的默认取向是本地优先：能在本机完成的采集、分析、渲染和导出，优先不依赖远程服务；必须调用外部服务时，应清楚说明数据路径、凭据来源和隐私边界。

## 当前工具

| 工具 | 类型 | 入口 | 主要用途 |
| --- | --- | --- | --- |
| [TokKit](tools/tokkit/README.md) | Python CLI | `tok` / `tokkit` | AI 编码工具使用量台账，统计 token、成本、模型、终端、客户端和来源覆盖率。 |
| [tokscr](tools/tokscr/README.md) | Chrome MV3 扩展 | 浏览器插件 | 网页截图工具，支持完整页面、可见区域、选择区域、主体去噪、预览页二次裁剪和 PNG/JPEG/PDF/复制/打印导出。 |
| [toktra](tools/toktra/README.md) | Chrome MV3 扩展 | 浏览器插件 | 网页和 PDF 英译中阅读插件，支持手动/站点/全局翻译模式、划词翻译、缓存、PDF 双栏阅读和本地 API 配置。 |
| [TokDoc](tools/TokDoc/README.md) | Node.js / Docker 本地工作台 | `npm run dev` / Docker | 本地文档管理器，支持上传 HTML/PDF/Word、目录监听、生成公开短链接、HTML 页面内编辑、回收站、访问统计和线上同步。 |
| [TokURL](tools/tokurl/README.md) | Node.js / Docker 自托管 Web App | Docker Compose | 短链接系统，支持极短 slug、二维码、访问统计、用户管理、站点设置和本地多容器部署。 |
| [TokChat](tools/tokchat/README.md) | PHP / Docker AI Web App | Docker Compose | 自托管 AI 对话与知识库助手，支持后台用户管理、Prompt 场景、API 轮换、知识库切片、分享页和统计面板。 |
| [vidbrief](tools/vidbrief/README.md) | Python CLI/TUI | `vb` | 视频下载、字幕或音频转写、Transcript 整理和 AI 报告生成。 |
| [mem](tools/mem/README.md) | Python CLI/TUI | `mem` | 本机内存、GPU、软件活跃度和进程明细诊断。 |
| [Scai](tools/yao-scai-cli/README.md) | Python CLI/TUI | `scai` | AI-native 磁盘空间扫描与清理建议工具，用于找大文件、分析风险和生成释放空间方案。 |

## 工具说明

### TokKit

TokKit 是一个本地优先的 AI 编码使用量台账。它面向同时使用 Codex、Claude Code、Warp、Cursor、Augment、CodeBuddy、Trae、ChatGPT 导出、GitHub Copilot usage metrics 等工具的开发者，解决“我的 AI token 和成本到底花在哪里”的问题。

TokKit 会从本地日志、官方导出、可选代理记录和运行时 capture 文件中提取使用数据，统一写入 `~/.tokkit/usage.sqlite`。它不会把所有数字伪装成同一种精度，而是明确区分：

- `exact`：上游日志或响应中有明确 token 字段。
- `partial`：有可用总量，但部分维度缺失。
- `estimated`：从本地缓存文本或元数据中估算。

常见能力包括终端报表、JSON 输出、客户端覆盖率、预算检查、价格覆盖、本地 HTML 交互报表、`tok doctor` 诊断、`tok setup` 引导，以及 macOS `launchd` 自动扫描和日报。

快速开始：

```bash
git clone https://github.com/yaojingang/yao-open-tools.git
cd yao-open-tools/tools/tokkit
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e .
tok help
tok setup
tok today
tok html month
```

### tokscr

`tokscr` 是一个 Chrome MV3 网页截图扩展，适合网页证据留存、产品界面归档、长文档截图、社媒页面截图和内容页面摘取。

它的核心设计是本地完成截图、拼接、裁剪、预览和导出，不把截图上传到服务器。当前支持：

- 完整页面截图：自动滚动并拼接成长图。
- 可见区域截图：快速捕捉当前浏览器窗口。
- 选择区域截图：拖拽框选页面局部。
- 主体去噪截图：识别文章、文档、详情页等主体内容，裁掉导航栏、侧边栏、页脚等干扰区域。
- 预览页二次裁剪：截图生成后可拖动裁剪框微调边界，再保存、复制或打印。
- 多格式导出：PNG、JPEG、PDF、复制到剪贴板和打印。
- 低权限设计：使用 `activeTab` 和用户主动点击触发，不申请全站点长期访问权限。

本地加载方式：

```text
1. 打开 chrome://extensions/
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 tools/tokscr/
```

### toktra

`toktra` 是一个 Chrome MV3 英译中阅读扩展，适合阅读英文网页、技术文档、论文 PDF、博客和长文章。它不会直接覆盖原文，而是在原文附近渲染中文译文，并通过本地缓存减少重复翻译。

它的核心能力包括：

- 手动模式、仅当前网站自动翻译、所有网站自动翻译。
- 网页正文、导航、侧栏、卡片和动态内容的渐进式翻译。
- 划词翻译，选中英文后可在页面附近显示中文解释。
- PDF 翻译视图，支持网页 PDF 和本地 `file://` PDF。
- PDF 双栏阅读：左侧原 PDF，右侧译文页；译文页保留原 PDF 图层，并遮罩原文文本后叠加中文译文。
- OpenAI-compatible API 配置，可使用自有 API Base URL、API Key 和模型。
- 本地缓存译文，重复打开页面或 PDF 时减少 API 请求。

本地加载方式：

```text
1. 打开 chrome://extensions/
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 tools/toktra/extension/
```

### TokDoc

TokDoc 是一个本地文档管理器，用于把零散 HTML 文件、带附件的 HTML 目录、PDF、Word 和本地监听目录统一收录成可管理、可预览、可阅读的文档库。

它可以在本机 Node.js 或 Docker 容器里运行。后台管理入口固定为 `/admin`，生成后的 `/<slug>` 页面可公开访问；进入 `?edit=1` 的 HTML 在线编辑模式和管理 API 仍需要登录。旧格式 `/pages/<slug>.html` 继续兼容访问。

主要能力包括：

- 上传单个 HTML/PDF/Word、批量文件或完整 HTML 文件夹，并保留图片、CSS、JS 等相对路径附件。
- 监听多个本地目录，自动识别 HTML/PDF/Word 新增和更新。
- 自动生成短 URL，例如 `/f812c6`。
- 页面内直接修改文字并自动保存，保留版本快照。
- 回收站、恢复、访问次数统计、分页列表和统计代码注入。
- 可绑定同类线上程序，一键同步当前 HTML。

快速开始：

```bash
cd yao-open-tools/tools/TokDoc
npm install
npm run dev
```

Docker 启动：

```bash
cd yao-open-tools/tools/TokDoc
docker compose up --build
```

默认访问：

```text
http://127.0.0.1:8080/admin      # Node 本机运行
http://127.0.0.1:18082/admin     # Docker 运行
```

### TokURL

TokURL 是一个可自托管的短链接系统，适合把长链接转换成短 slug，并提供二维码分享、访问统计、链接二次编辑、用户管理和站点 SEO/统计代码设置。

它采用 Fastify、React、Postgres、Redis 和 Docker Compose 组合。Redirect 路径优先读取 Redis 缓存，点击事件通过 Redis Stream 异步写入，避免把统计写入阻塞在跳转链路里。

主要能力包括：

- 首页公开可访问，未登录用户创建短链时可弹出极简注册/登录。
- 普通用户只能管理自己的短链，默认每日创建额度为 5 条。
- 超级管理员可管理所有用户、链接和全站设置。
- 支持真实二维码生成、短链复制、链接编辑、标题抓取、分页管理和全部 URL 统计。
- 支持 Docker Compose 本地多容器部署，包含 Web、API、worker、Postgres 和 Redis。

快速开始：

```bash
cd yao-open-tools/tools/tokurl
cp .env.example .env
docker compose up --build
```

默认访问：

```text
http://localhost:3000      # Web 控制台
http://localhost:8080/:id  # 短链跳转入口
```

生产部署说明见 `tools/tokurl/docs/server-deployment.md`。

### vidbrief

`vidbrief` 提供 `vb` 命令，用于把在线视频或本地媒体转成可阅读、可归档、可继续交给 AI 处理的资料包。

它包装了 `yt-dlp`，可以下载视频、提取字幕、在没有字幕时转写音频，并用配置好的 AI provider 生成 Markdown 报告。适合整理课程、访谈、演讲、YouTube 视频、资料型内容和需要批量归档的视频来源。

常见输出包括：

- 下载的媒体文件。
- `.info.json` 元数据。
- 字幕文件。
- `.transcript.md` 转写文本。
- `.report.md` AI 报告。

快速开始：

```bash
cd yao-open-tools/tools/vidbrief
python3 -m pip install -e ".[openai]"
vb
vb run "https://www.youtube.com/watch?v=VIDEO_ID"
```

### mem

`mem` 是一个本机内存与活跃度查看 CLI。默认执行 `mem` 会先展示健康摘要和诊断优先级，再展示内存分类、GPU/显卡统计、软件活跃度和完整进程明细。

它适合在 Mac 或 Linux 机器出现卡顿、内存压力、进程异常占用时快速定位问题。工具会聚合软件级别的资源占用，并提供下一步引导，例如 AI 建议、优化指令和持续观察。

主要能力包括：

- 内存健康摘要：活跃、固定、压缩、缓存/可回收、空闲等分类。
- 诊断优先级：先指出最可能造成卡顿的信号。
- GPU/显卡信息：在权限允许范围内展示当前 GPU 与统一内存状态。
- 软件活跃度：按应用聚合多个进程。
- 进程明细：按 RSS、CPU、状态、命令等维度展示。
- TUI 模式：使用 `mem tui` 持续观察。
- AI 建议：复用本机已登录的 AI CLI，不读取或复制账号密钥。

快速开始：

```bash
cd yao-open-tools/tools/mem
python3 -m pip install -e .
mem
mem tui
mem ai
```

### Scai

Scai 是 `Scan + AI` 的缩写，工具目录是 `tools/yao-scai-cli`，主命令是 `scai`。它不是单纯的 `du` 包装，而是一个面向决策的磁盘空间顾问。

Scai 会扫描文件和目录大小，识别缓存、构建产物、归档、媒体、备份、数据文件和高风险系统路径，并生成保守的清理建议。它默认不删除文件，重点是帮助用户判断哪些空间值得关注、哪些内容需要人工确认、哪些路径不应直接操作。

常用命令：

```bash
cd yao-open-tools/tools/yao-scai-cli
./install.sh
scai              # 当前目录 Space Brief
scai all          # 从 / 做安全全盘扫描
scai top          # 最大文件
scai dirs         # 最大目录
scai tui          # 交互式浏览
scai plan 20g     # 生成释放 20GB 的建议方案
scai ai           # 调用 Codex CLI 生成诊断建议
```

## 设计原则

这个仓库里的工具优先遵循以下规则：

- 小而清晰：每个工具先解决一个明确问题，再考虑扩展。
- 本地优先：默认在本机采集、处理、存储和渲染。
- 可独立安装：每个工具放在自己的目录里，有自己的 README 和项目元数据。
- 依赖克制：只引入与核心功能直接相关的依赖。
- 隐私透明：涉及浏览器、日志、转写、AI provider 或本地文件时，说明读取了什么、写到了哪里。
- 风险保守：清理、覆盖、删除、上传、发送等高风险动作必须显式触发。
- 输出可复用：尽量提供 Markdown、JSON、HTML、图片或本地文件，方便继续分析和归档。
- 命令稳定：公开文档写出的命令名应尽量保持兼容，必要时保留别名。

## 目录结构

```text
yao-open-tools/
  README.md
  LICENSE
  tools/
    README.md
    tokkit/
    tokscr/
    toktra/
    TokDoc/
    tokurl/
    vidbrief/
    mem/
    yao-scai-cli/
```

每个工具目录通常包含：

```text
tools/<tool-name>/
  README.md
  pyproject.toml、package.json、manifest.json 或同类项目元数据
  src/、bin/ 或浏览器扩展源码
  tests/
  docs/
  docs/assets/
```

## 使用建议

首次使用可以先从具体工具目录开始阅读，因为每个工具的安装方式和依赖不同：

```bash
git clone https://github.com/yaojingang/yao-open-tools.git
cd yao-open-tools
ls tools
```

如果你只想看 AI 编码使用量，从 `tools/tokkit` 开始。如果你想截图网页，从 `tools/tokscr` 开始。如果你想翻译英文网页或 PDF，从 `tools/toktra` 开始。如果你想管理 HTML/PDF/Word 文档并在线编辑 HTML 页面，从 `tools/TokDoc` 开始。如果你想部署短链接服务，从 `tools/tokurl` 开始。如果你想处理视频 transcript，从 `tools/vidbrief` 开始。如果你想诊断本机内存，从 `tools/mem` 开始。如果你想找磁盘空间占用，从 `tools/yao-scai-cli` 开始。

## 后续方向

仓库后续会继续围绕实用、可分享、可本地运行的小工具扩展，重点包括：

- `tok*` 系列工具，例如 token、日志、HTML 报告、终端工作流和本地数据整理。
- 面向英文网页、PDF、长文档和浏览器阅读流的本地优先翻译辅助工具。
- 面向 AI 编码工具的使用量、成本、质量和效率分析。
- 本地文件、截图、视频、网页和日志的结构化处理。
- 更清晰的工具发布规范、截图资产、隐私说明和测试覆盖。

## License

MIT
