# 直播填空答题系统部署说明

本文档用于把本项目上传到服务器并部署为线上可访问的静态站点。

## 1. 发布包内容

生产包由 `npm run build` 生成，核心目录是：

```text
dist/
  index.html
  assets/
  favicon.svg
  icons.svg
```

服务器只需要部署 `dist/` 目录即可。`src/`、`node_modules/`、测试脚本不需要上传到线上服务器。

## 2. 推荐方案：Nginx 静态部署

适合已有 Linux 服务器、宝塔、1Panel、云服务器、学校机房服务器等场景。

### 2.1 上传文件

把发布包上传到服务器，例如：

```bash
scp live-quiz-interaction-static-*.tar.gz root@服务器IP:/tmp/
```

登录服务器后解压：

```bash
mkdir -p /var/www/live-quiz-interaction
tar -xzf /tmp/live-quiz-interaction-static-*.tar.gz -C /var/www/live-quiz-interaction --strip-components=1
```

解压后目录应类似：

```text
/var/www/live-quiz-interaction/
  dist/
  DEPLOY.md
  nginx-live-quiz-interaction.conf
  Dockerfile
```

### 2.2 配置 Nginx

把 `nginx-live-quiz-interaction.conf` 复制到 Nginx 配置目录：

```bash
cp /var/www/live-quiz-interaction/nginx-live-quiz-interaction.conf /etc/nginx/conf.d/live-quiz-interaction.conf
```

编辑配置中的域名：

```nginx
server_name quiz.example.com;
```

检查配置并重载：

```bash
nginx -t
systemctl reload nginx
```

访问：

```text
http://quiz.example.com
```

## 3. Node 静态服务部署

适合暂时没有 Nginx、只想快速跑起来的场景。

服务器安装 Node.js 18+ 后执行：

```bash
cd /var/www/live-quiz-interaction
npx serve -s dist -l 4173
```

用 PM2 常驻：

```bash
npm install -g pm2 serve
pm2 start "serve -s /var/www/live-quiz-interaction/dist -l 4173" --name live-quiz-interaction
pm2 save
```

访问：

```text
http://服务器IP:4173
```

## 4. Docker 部署

适合 Docker、1Panel、Portainer、云服务器容器环境。

如果是在源码仓库中构建：

```bash
cd yao-open-tools/tools/live-quiz-interaction
npm install
npm run build
docker build -f deploy/Dockerfile -t live-quiz-interaction .
docker run -d --name live-quiz-interaction -p 8080:80 live-quiz-interaction
```

如果是在已经解压好的发布包中构建：

```bash
cd /var/www/live-quiz-interaction
docker build -t live-quiz-interaction .
docker run -d --name live-quiz-interaction -p 8080:80 live-quiz-interaction
```

访问：

```text
http://服务器IP:8080
```

## 5. 部署到子路径

如果不是部署到域名根路径，而是类似：

```text
https://example.com/quiz/
```

需要在本地重新构建：

```bash
npm run build -- --base=/quiz/
```

然后重新打包上传。Nginx 也要把 `location /quiz/` 指向对应 `dist/`。

## 6. 更新与回滚

推荐每次上传前保留上一版：

```bash
mv /var/www/live-quiz-interaction /var/www/live-quiz-interaction.bak.$(date +%Y%m%d%H%M%S)
mkdir -p /var/www/live-quiz-interaction
tar -xzf /tmp/live-quiz-interaction-static-*.tar.gz -C /var/www/live-quiz-interaction --strip-components=1
systemctl reload nginx
```

如果新版异常，切回备份目录后重载 Nginx。

## 7. 上线检查

部署后建议检查：

```bash
curl -I http://你的域名/
curl -I http://你的域名/assets/
```

浏览器侧检查：

- 页面能打开。
- 题目、输入框、提交按钮正常显示。
- 答错后提示模块变浅红。
- 答对后解析模块变浅绿。
- 弹窗和音效正常触发。
- 手机竖屏无横向滚动。
