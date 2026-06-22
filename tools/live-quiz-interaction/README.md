# live-quiz-interaction

`live-quiz-interaction` 是一个面向直播课堂的填空答题互动页。它把“有理数经典 100 题”整理成单题闯关形式，适合老师在直播间输入答案并带着学生一起判断、讲解和累计积分。

它是一个纯前端 Vite / React 应用，构建后可作为静态站点部署到 Nginx、对象存储、Docker 或任意静态 Web 服务。

## 核心能力

- 100 道有理数填空题，题目、答案、提示和解析都在本地数据文件中。
- 单题答题流程：输入答案、提交、上一题、下一题、重置。
- 答对后显示弹窗、加分、音效和绿色解析模块。
- 答错后显示弹窗、扣分、音效和红色提示模块。
- 支持逐次提醒，第三次后公布正确答案和解析。
- 顶部显示总积分，题卡内显示对错统计。
- 桌面和手机竖屏自适应，适合直播推流画面或课堂投屏。

## 快速开始

```bash
cd yao-open-tools/tools/live-quiz-interaction
npm install
npm run dev
```

默认本地访问：

```text
http://127.0.0.1:5173
```

## 常用命令

```bash
npm test       # 运行单元测试
npm run lint   # 运行 ESLint
npm run build  # 构建生产静态文件到 dist/
npm run preview
```

## 目录结构

```text
tools/live-quiz-interaction/
  src/
    App.tsx
    App.css
    data/rationalQuestions.ts
    domain/quizEngine.ts
    utils/sound.ts
  deploy/
    DEPLOY.md
    Dockerfile
    nginx-live-quiz-interaction.conf
  scripts/
    extract_docx_questions.py
    verify_ui.py
  package.json
  vite.config.ts
```

## 题库数据

题库入口：

```text
src/data/rationalQuestions.ts
```

每道题包含：

- `prompt`：题干。
- `answer`：标准答案。
- `guide`：答错时的引导提示。
- `explanation`：答对或公布答案后的解析。

原始 Word 文档解析脚本在：

```text
scripts/extract_docx_questions.py
```

## 部署

生产构建：

```bash
npm run build
```

构建结果位于：

```text
dist/
```

详细部署说明见：

```text
deploy/DEPLOY.md
```

其中包含 Nginx 静态部署、Node 静态服务和 Docker 部署三种方式。

## 隐私边界

本工具默认不上传答题记录，不连接远程数据库，也不调用外部 AI 服务。题目、答案、提示、解析和积分状态都在浏览器本地运行时处理。

如果将页面部署到公网服务器，服务器只负责分发静态文件；直播互动过程中的输入不会被本项目主动保存。

