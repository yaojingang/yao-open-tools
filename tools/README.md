# Tools

`tools/` 目录收纳本仓库里的独立工具。每个子目录都应该能被单独理解、安装、运行和维护。

这些工具不要求共享同一套技术栈。它们可以是 Python CLI、TUI、浏览器扩展、脚本型工具或小型本地工作台，但必须有清楚的用途、入口和文档。

## 当前工具

| 目录 | 入口 | 类型 | 说明 |
| --- | --- | --- | --- |
| [`tokkit/`](tokkit/README.md) | `tok` / `tokkit` | Python CLI | 本地优先的 AI 编码使用量台账，统计 token、成本、模型、终端、客户端和来源覆盖率。 |
| [`tokscr/`](tokscr/README.md) | Chrome 扩展 | Browser Extension | Chrome MV3 网页截图工具，支持完整页面、可见区域、选择区域、主体去噪、预览页二次裁剪和多格式导出。 |
| [`toktra/`](toktra/README.md) | Chrome 扩展 | Browser Extension | Chrome MV3 网页/PDF 英译中阅读插件，支持手动/自动翻译模式、划词翻译、本地缓存和 OpenAI-compatible API。 |
| [`TokDoc/`](TokDoc/README.md) | `npm run dev` / Docker | Node.js Local Web App | 本地文档管理器，支持上传 HTML/PDF/Word、目录监听、生成公开短链接、HTML 页面内编辑、回收站、访问统计和线上同步。 |
| [`vidbrief/`](vidbrief/README.md) | `vb` | Python CLI/TUI | 视频下载、字幕提取、音频转写和 AI Markdown 报告生成。 |
| [`mem/`](mem/README.md) | `mem` | Python CLI/TUI | 本机内存、GPU、软件活跃度和进程热点诊断。 |
| [`yao-scai-cli/`](yao-scai-cli/README.md) | `scai` | Python CLI/TUI | 磁盘空间扫描、风险分类和安全清理建议。 |

## 推荐目录结构

```text
tools/<tool-name>/
  README.md
  pyproject.toml、package.json、manifest.json 或同类项目元数据
  src/ 或 bin/
  tests/
  docs/
  docs/assets/
```

浏览器扩展或纯脚本工具可以按自身生态调整目录，但仍应保留 README、入口说明和必要的发布资产。

## 工具标准

- 每个工具都要有明确的问题陈述：它解决什么问题，不解决什么问题。
- 每个工具都要在 README 中写清安装方式、快速开始、常用命令和输出位置。
- 依赖应尽量少，并且与核心功能直接相关。
- 处理本地日志、浏览器页面、截图、媒体、AI provider 或文件系统时，应说明隐私边界和数据写入位置。
- 清理、覆盖、删除、上传、发送等高风险动作必须显式触发。
- 命令行输出应能被人直接读懂；必要时提供 JSON、Markdown、HTML 或图片导出。
- 测试应覆盖核心解析、报表、文件写入和命令路由。
- 示例图片、演示 HTML、商店截图等资产优先放在对应工具的 `docs/assets/` 或 `store-assets/` 目录下。

## 命名建议

新工具优先使用短、明确、可读的英文小写名称。若属于 token、日志、HTML 报告、终端效率或 AI 编码工作流方向，可以优先考虑 `tok*` 系列命名。

已有工具可以保留历史名称和兼容别名，但公开 README 应明确主命令、兼容命令和推荐入口。
