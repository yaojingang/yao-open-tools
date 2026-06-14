# 销售AI支持系统

一个基于PHP的RAG（检索增强生成）AI助手系统，为销售团队提供智能问答和学习支持。

## ✨ 功能特色

### 🎯 前台用户功能
- **智能问答模式**：基于知识库的专业AI回答
- **学习模式**：个性化学习计划和进度跟踪
- **流式响应**：实时显示AI回答，支持停止功能
- **探索建议**：热搜榜和技能提升推荐
- **响应式设计**：完美适配桌面和移动设备

### 🛠️ 后台管理功能
- **数据概览**：实时统计和趋势分析
- **用户管理**：用户账号和权限管理
- **知识库管理**：文档上传、编辑和管理
- **聊天日志**：完整的对话记录和分析
- **系统配置**：Prompt管理和探索建议配置

### 📊 数据分析功能
- **提问趋势分析**：30天数据趋势图表
- **知识库命中率**：RAG使用效果监控
- **用户活跃度**：实时用户行为统计
- **学习完成率**：学习模式使用情况

## 🚀 快速开始

### 方法一：Docker 一键部署（默认推荐）

#### Linux/macOS
```bash
# 进入项目目录
cd "销售AI助手"

# 构建镜像、启动容器并执行健康检查
./deploy.sh

# 或指定端口
./deploy.sh 18085
```

也可以直接使用 Docker Compose：
```bash
docker compose up -d --build
```

Docker 会挂载本地 `data/`、`logs/`、`uploads/`、`cache/`、`temp/`，重建镜像不会清空 SQLite 数据库。更多说明见 `DOCKER_DEPLOYMENT.md`。

### 方法二：快速启动（同样走 Docker）
```bash
./quick_start.sh
```

### 方法三：本机 PHP 开发调试（备用）
```bash
# 自动避开已占用端口，并在后台运行
./start-stable.sh 18084
```

### 方法四：手动部署（备用）
```bash
# 1. 设置权限
chmod 755 data/
chmod 666 data/sales_ai.db
chmod 755 data/uploads/

# 2. 启动服务器
php -S 127.0.0.1:18084 -t "$(pwd)" "$(pwd)/router.php"

# 3. 初始化数据库
php -r "require_once 'api/db.php'; initDatabase();"
```

## 🌐 访问地址

Docker 默认映射到本机 `18084` 端口。

| 功能 | 地址 | 说明 |
|------|------|------|
| 前台聊天 | http://127.0.0.1:18084/ | 用户聊天界面 |
| 用户登录 | http://127.0.0.1:18084/login.php | 用户登录页面 |
| 管理后台 | http://127.0.0.1:18084/admin.php | 管理员界面 |
| 管理员登录 | http://127.0.0.1:18084/admin_login.php | 管理员登录 |
| 健康检查 | http://127.0.0.1:18084/health.php | Docker/服务健康检查 |

## 🔐 默认账号

### 管理员账号
- **用户名**：`admin`
- **密码**：`change-me-now`
- **权限**：超级管理员

可在 `.env` 中通过 `DEFAULT_ADMIN_USERNAME`、`DEFAULT_ADMIN_PASSWORD`、`DEFAULT_ADMIN_NAME` 修改首次初始化账号。生产环境上线后请立即在后台修改默认密码。

### 普通用户账号
默认不初始化普通用户，避免公开部署携带本地数据。需要演示账号时，可在 `.env` 中设置 `SEED_DEMO_USERS=1` 后首次初始化，将创建以下假数据账号：

- **姓名**：`演示用户一`
- **手机**：`19900000001`
- **权限**：销售代表

## 📋 系统要求

### 默认部署环境
- **Docker Desktop / Docker Engine**
- **Docker Compose v2+**

### 本机 PHP 开发环境（备用）
- **PHP 8.0+** （推荐 8.1 或更高）
- **SQLite 3** （PHP内置支持）
- **Web服务器** （Apache/Nginx 或 PHP内置服务器）

### PHP扩展
- `pdo_sqlite` - 数据库支持
- `curl` - API调用
- `json` - JSON处理
- `mbstring` - 多字节字符串
- `fileinfo` - 文件类型检测

### 检查 Docker 环境
```bash
# 检查 Docker
docker --version

# 检查 Compose
docker compose version

# 部署并执行健康检查
./deploy.sh
```

## 📁 项目结构

```
销售AI支持系统/
├── 📄 README.md              # 项目说明
├── 🐳 Dockerfile             # Docker 镜像定义
├── 🐳 docker-compose.yml     # Docker Compose 服务定义
├── 📄 DOCKER_DEPLOYMENT.md   # Docker 部署说明
├── 🚀 deploy.sh              # 默认 Docker 部署脚本
├── ⚡ quick_start.sh         # Docker 快速启动脚本
├── 🧭 router.php             # PHP内置服务器路由与公开入口保护
├── 🔍 check-local.sh         # 本地环境检查脚本
├── 🏠 index.php              # 前台聊天界面
├── 🔑 login.php              # 用户登录页面
├── 🛠️ admin.php              # 后台管理界面
├── 🔑 admin_login.php        # 管理员登录页面
├── 📂 api/                   # API接口目录
│   ├── ⚙️ config.php         # 系统配置
│   ├── 🗄️ db.php             # 数据库管理
│   ├── 🔐 auth.php           # 认证接口
│   ├── 💬 chat.php           # 聊天接口
│   ├── 🌊 stream.php         # 流式响应
│   ├── 📚 knowledge.php      # 知识库管理
│   ├── 👥 users.php          # 用户管理
│   ├── 📊 stats.php          # 数据统计
│   └── ...
└── 📂 data/                  # 数据目录
    ├── 🗄️ sales_ai.db        # SQLite数据库
    └── 📁 uploads/           # 文件上传目录
```

## 🛠️ 管理命令

### 启动和停止
```bash
# 启动 / 更新 Docker 服务
./deploy.sh

# 停止 Docker 服务
./stop-server.sh

# 重启 Docker 服务
./restart-server.sh

# 查看 Docker 日志
docker compose logs -f sales-ai
```

### 数据库管理
```bash
# 初始化数据库
docker compose exec sales-ai php -r "require_once '/var/www/html/api/db.php'; initDatabase();"
```

## 🔧 配置说明

### API 配置

推荐在后台「API 配置」页面维护 API。默认不会初始化任何第三方 API，避免公开部署暴露服务商地址或历史配置。

也可以复制 `.env.docker.example` 为 `.env` 后填写完整配置，并显式开启环境变量初始化：

```env
SEED_DEFAULT_API_CONFIGS=1
TUZI_API_URL=https://api.example.com/v1/chat/completions
TUZI_API_KEY=your-api-key
TUZI_MODEL=your-model-id

TUZI_BACKUP_API_URL=
TUZI_BACKUP_API_KEY=
TUZI_BACKUP_MODEL=
```

## 🎨 主要特性

### 🤖 AI功能
- **RAG检索**：基于知识库的智能回答
- **流式响应**：实时显示AI生成内容
- **上下文记忆**：保持对话连续性
- **多模式支持**：问答模式和学习模式

### 📊 数据分析
- **实时统计**：用户活跃度、对话次数
- **趋势分析**：30天提问趋势图表
- **点击交互**：图表数据点详情查看
- **知识库命中率**：RAG使用效果监控

### 🎯 用户体验
- **响应式设计**：适配各种设备
- **现代化UI**：Tailwind CSS + Alpine.js
- **流畅动画**：平滑的交互效果
- **键盘快捷键**：提升操作效率

## 📞 技术支持

如遇到问题，请检查：
1. **Docker环境**：Docker Desktop 是否已启动，`docker compose version` 是否可用
2. **文件权限**：数据目录可写权限
3. **API配置**：AI API密钥是否有效
4. **端口占用**：确保端口未被占用

更多详细信息请查看 [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)

---

🎉 **部署完成后即可开始使用完整的销售AI支持功能！**
