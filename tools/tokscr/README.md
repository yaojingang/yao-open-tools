# tokscr

Chrome MV3 网页截图插件，主打本地优先的网页截图工作流。当前功能：

- 捕捉完整页面：自动滚动并拼接整个网页
- 捕捉可见区域：只保存当前浏览器可见部分
- 捕捉选择区域：在页面上拖拽框选局部截图
- 主体去噪：自动识别正文主体，裁掉导航、侧栏、页脚等噪音
- 结果预览页：保存 PNG、JPEG、PDF，复制到剪贴板，打印截图

## 目录

- `manifest.json`：Chrome MV3 插件清单
- `background.js`、`content.js`、`offscreen.js`：截图、拼接、导出核心逻辑
- `popup.*`：插件弹窗入口
- `result.*`：截图结果预览和导出页
- `icons/`：插件图标
- `store-assets/`：Chrome Web Store 商品详情素材
- `dist/tokscr-0.2.0.zip`：可上传到 Chrome Web Store 的当前打包文件

## 本地加载

1. 打开 Chrome：`chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库中的目录：

   `tools/tokscr`

如果已经加载过旧版本，点扩展卡片上的刷新按钮。

## 打包上传

上传 Chrome Web Store 使用：

`tools/tokscr/dist/tokscr-0.2.0.zip`

zip 根目录包含 `manifest.json`，不要再套一层外部文件夹。

## 使用限制

- Chrome 内置页面、Chrome Web Store、扩展页面等受限页面无法注入脚本，因此完整页面、主体去噪和选择区域可能不可用。
- 超长页面会自动降低导出分辨率，避免浏览器 Canvas 尺寸超限。
- PDF 导出为图片型 PDF，不是可搜索文本 PDF。
- 主体去噪使用本地启发式识别，优先适配文章页、文档页、博客页、内容详情页。复杂 Web App 可能会退化为较大的主体容器。
