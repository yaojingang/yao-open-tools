# toktra

toktra 是一个 Chrome MV3 英译中网页翻译插件。它会扫描当前网页中的英文文本块，在原文下方插入中文译文，并用 `MutationObserver` 监听动态加载内容，自动补译新增 HTML。

## 功能

- 英文文本自动识别，跳过脚本、代码块、媒体和插件自身 DOM；输入框不会改写已输入内容，只会翻译可见 placeholder。
- 默认扫描整页用户可见文本模块，包括顶部导航、hero、正文、独立文章链接、侧栏榜单、卡片列表和深层 `div`/`span` 文本。
- 翻译队列按页面视觉位置从上到下排序；扫描到的目标会一次性入队，并按批次并发调用 API，让首屏和后续模块更快出现译文。
- 内部采用五层实时翻译管线：Segmenter、Scheduler、Provider、Render、Rule/AI Strategy。
- Segmenter 会优先选择完整段落或完整句子；对网页中被多个 `span` 拆开的句子，会回收到最近的完整父级模块再翻译，避免单词碎片化。
- 页面翻译时显示轻量进度提示，可看到已处理、缓存命中和失败数量。
- 网页和 PDF 都采用当前屏 + 后两屏的懒加载翻译策略；PDF 下拉时会优先用实时 DOM 位置判断可见段落，避免译文插入后旧 PDF 坐标漂移造成漏译。
- 支持通过 toktra 自带 PDF 翻译视图读取网页 PDF 和本地 `file://` PDF 文本，并先按 `x/y` 坐标把 PDF 文本拆成视觉行和列，再合并段落、修复常见 PDF 标题截断文本，最后按页内自上而下顺序翻译。
- 中文译文插入在原文下方，不覆盖原页面文本。
- 动态页面实时监听，新增或变更文本会自动进入翻译队列。
- 后台 service worker 调用 OpenAI-compatible `/chat/completions` API，并把译文合并缓存到本地，避免并发批次互相覆盖缓存。
- 首次访问某个域名时可用 AI 生成网页结构策略，缓存正文容器和排除区域选择器，后续同域名优先按该策略翻译。
- 设置页可配置 API Base URL、API Key、模型、域名允许/禁用列表和批量大小。
- 设置页支持站点翻译规则：`domain##selector` 跳过区域，`domain#+#selector` 补充翻译区域。
- 插件弹窗支持三种模式：手动模式、仅此网站自动翻译、所有网站自动翻译。
- 手动模式不会自动翻译页面，但保留“手动翻译当前页”和划线翻译。
- 仅此网站自动翻译会把当前域名加入自动翻译网站列表。
- 页面中选中英文文本后会出现“翻译”按钮，点击后先显示带加载动画的译文浮层，再在选区附近显示中文译文；这个功能使用同一套 API 和本地缓存。
- 检测到中文页面时会跳过自动翻译，避免中文页面被重复处理。

## 智能结构识别

开启“首次访问域名时用 AI 智能识别网页结构”后，toktra 会把当前页面的轻量结构摘要发送给已配置的 API：包括标题、语言、候选容器选择器、文本长度和少量短文本样本。它不会发送整页 HTML。页面会先用本地规则快速扫描整页可见文本并开始翻译，AI 在后台并行分析结构；API 返回的正文容器和排除区域选择器会按域名缓存到本地，并作为补充扫描策略使用，不会覆盖默认快速扫描。

## 本地加载

1. 打开 Chrome：`chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：

```text
tools/toktra/extension
```

## PDF 翻译

Chrome 内置 PDF 查看器不允许普通内容脚本稳定注入。toktra 遇到 PDF URL 时，会从弹窗的“手动翻译当前页”在当前标签页打开自带的 `pdf-viewer.html`；如果当前标签页无法被更新，才会降级新开一个标签页。该视图使用 pdf.js 在本地提取 PDF 文本，按 `y` 容差合成行、按大 `x` 间距拆开左右列或图注，再把同一列的连续视觉行合并成完整段落，按页码和段落位置从上到下渲染原文，并复用同一套分段、缓存、三屏懒加载和翻译接口。

本地 PDF 示例：`file:///Users/you/Documents/example.pdf`。这类 `file://` 文件需要在 `chrome://extensions/` 打开 toktra 详情页，并启用「允许访问文件网址 / Allow access to file URLs」，否则 Chrome 不会把本地文件读取权限交给扩展。

## API 配置

默认使用 OpenAI-compatible API 格式：

```text
POST {API Base URL}/chat/completions
Authorization: Bearer {API Key}
```

如果你的服务地址已经包含 `/chat/completions`，toktra 会直接使用该地址，不会重复拼接。

## 开发验证

```bash
cd tools/toktra
npm install
npm test
npm run lint
```

## 发布打包

Chrome Web Store 上传包只需要包含 `extension/` 目录里的扩展文件，不应包含 `node_modules/`、`dist/`、`tmp/` 或本地测试输出。

```bash
cd tools/toktra
mkdir -p dist
cd extension
zip -qr ../dist/toktra-0.4.8-chrome-web-store.zip . -x '*.DS_Store'
```

## 参考逻辑

toktra 借鉴了 TokDoc（原 TokHtml）的同页 HTML 桥接思路：先排除插件自身和不可编辑/不可处理区域，再对页面文本块做标记和处理。不同点是 toktra 不改写原 HTML 文本，而是把译文作为独立节点渲染在原文附近。
