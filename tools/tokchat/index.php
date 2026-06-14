<?php
// 设置永久session（10年）
ini_set('session.cookie_lifetime', 315360000);
ini_set('session.gc_maxlifetime', 315360000);
session_set_cookie_params(315360000, '/');
session_start();

require_once __DIR__ . '/api/db.php';
initDatabase();

// 检查登录状态
if (!isset($_SESSION['user_id'])) {
    // 尝试通过remember cookie自动登录
    if (isset($_COOKIE['remember_token']) && isset($_COOKIE['remember_user_id'])) {
        $db = getDB();
        $stmt = $db->prepare("SELECT id, name, role, phone, status FROM users WHERE id = ? AND remember_token = ? AND status = 'active'");
        $stmt->execute([$_COOKIE['remember_user_id'], $_COOKIE['remember_token']]);
        $user = $stmt->fetch();

        if ($user) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['user_name'] = $user['name'];
            $_SESSION['user_role'] = $user['role'];
            $_SESSION['user_phone'] = $user['phone'];

            // 更新最后登录时间
            $stmt = $db->prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?");
            $stmt->execute([$user['id']]);
        } else {
            header('Location: login.php');
            exit;
        }
    } else {
        header('Location: login.php');
        exit;
    }
}

$currentUser = [
    'id' => $_SESSION['user_id'],
    'name' => $_SESSION['user_name'],
    'role' => $_SESSION['user_role'],
    'phone' => $_SESSION['user_phone'] ?? ''
];

$siteSettings = getSiteSettings();
$frontendAnalyticsCode = trim($siteSettings['frontend_analytics_code'] ?? '');
$welcomeProfile = getFrontendWelcomeProfile();

function esc($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <title><?php echo esc($siteSettings['frontend_page_title']); ?></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script>
        // 当前用户信息（从PHP注入）
        const CURRENT_USER = <?php echo json_encode($currentUser); ?>;
        const INITIAL_WELCOME_PROFILE = <?php echo json_encode($welcomeProfile, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT); ?>;
    </script>
    <style>
        /* 移动端视口高度修复 */
        html, body {
            height: 100%;
            height: -webkit-fill-available;
        }
        body {
            min-height: 100vh;
            min-height: -webkit-fill-available;
        }
        /* 隐藏滚动条但保留功能 */
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        /* 自定义细滚动条 */
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

        /* 移动端侧边栏过渡动画 */
        .sidebar-transition { transition: transform 0.3s ease-in-out; }

        /* 打字机光标 */
        .typing-cursor::after { content: '▊'; animation: blink 0.8s infinite; color: #3b82f6; }
        @keyframes blink { 50% { opacity: 0; } }

        /* 淡入动画 */
        @keyframes fade-in {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .animate-fade-in {
            animation: fade-in 0.3s ease-out;
        }

        /* 玻璃拟态背景 */
        .glass-header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
        }

        /* 去掉输入框的focus边框 */
        textarea:focus, input:focus {
            outline: none !important;
            box-shadow: none !important;
        }

        /* 世界级Markdown排版样式 */
        .markdown-content {
            font-size: 0.9375rem;
            line-height: 1.75;
            color: #374151;
        }

        /* 标题样式 - 清晰的层级关系 */
        .markdown-content h1 {
            font-size: 1.5rem;
            font-weight: 700;
            margin: 1.5rem 0 1rem;
            color: #111827;
            letter-spacing: -0.025em;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 0.5rem;
        }
        .markdown-content h2 {
            font-size: 1.25rem;
            font-weight: 700;
            margin: 1.25rem 0 0.75rem;
            color: #1f2937;
            letter-spacing: -0.02em;
        }
        .markdown-content h3 {
            font-size: 1.125rem;
            font-weight: 600;
            margin: 1rem 0 0.5rem;
            color: #374151;
        }
        .markdown-content h4 {
            font-size: 1rem;
            font-weight: 600;
            margin: 0.875rem 0 0.5rem;
            color: #4b5563;
        }

        /* 段落 */
        .markdown-content p {
            margin: 0.75rem 0;
            line-height: 1.8;
        }
        .markdown-content > *:first-child { margin-top: 0; }
        .markdown-content > *:last-child { margin-bottom: 0; }

        /* 无序列表 - 优雅的缩进和图标 */
        .markdown-content ul {
            margin: 0.75rem 0;
            padding-left: 0;
            list-style: none;
        }
        .markdown-content ul > li {
            position: relative;
            padding-left: 1.5rem;
            margin: 0.5rem 0;
            line-height: 1.7;
        }
        .markdown-content ul > li::before {
            content: '';
            position: absolute;
            left: 0.25rem;
            top: 0.65rem;
            width: 6px;
            height: 6px;
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            border-radius: 50%;
        }

        /* 有序列表 - 漂亮的数字标记 */
        .markdown-content ol {
            margin: 0.75rem 0;
            padding-left: 0;
            list-style: none;
            counter-reset: ol-counter;
        }
        .markdown-content ol > li {
            position: relative;
            padding-left: 2rem;
            margin: 0.625rem 0;
            line-height: 1.7;
            counter-increment: ol-counter;
        }
        .markdown-content ol > li::before {
            content: counter(ol-counter);
            position: absolute;
            left: 0;
            top: 0.1rem;
            width: 1.375rem;
            height: 1.375rem;
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            font-size: 0.75rem;
            font-weight: 600;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* 嵌套列表 - 支持多层级缩进 */
        .markdown-content ul ul, .markdown-content ol ol,
        .markdown-content ul ol, .markdown-content ol ul {
            margin: 0.375rem 0 0.375rem 0.75rem;
        }
        /* 二级无序列表 */
        .markdown-content ul ul > li::before {
            background: #94a3b8;
            width: 5px;
            height: 5px;
            border-radius: 50%;
        }
        /* 三级无序列表 */
        .markdown-content ul ul ul > li::before {
            background: transparent;
            border: 1.5px solid #94a3b8;
            width: 4px;
            height: 4px;
        }
        /* 四级及更深无序列表 */
        .markdown-content ul ul ul ul > li::before {
            background: #cbd5e1;
            border: none;
            width: 4px;
            height: 4px;
            border-radius: 1px;
        }

        /* 加粗 - 醒目但不刺眼 */
        .markdown-content strong {
            font-weight: 600;
            color: #1e40af;
            background: linear-gradient(120deg, #dbeafe 0%, #eff6ff 100%);
            padding: 0.1rem 0.35rem;
            border-radius: 0.25rem;
        }

        /* 斜体 */
        .markdown-content em {
            font-style: italic;
            color: #6b7280;
        }

        /* 行内代码 - 清晰可辨识 */
        .markdown-content code {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            color: #92400e;
            padding: 0.2rem 0.5rem;
            border-radius: 0.375rem;
            font-size: 0.875em;
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
            font-weight: 500;
            border: 1px solid #fcd34d;
        }

        /* 代码块 */
        .markdown-content pre {
            background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
            color: #e2e8f0;
            padding: 1rem 1.25rem;
            border-radius: 0.75rem;
            margin: 1rem 0;
            overflow-x: auto;
            font-size: 0.8125rem;
            line-height: 1.7;
            border: 1px solid #334155;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .markdown-content pre code {
            background: none;
            color: inherit;
            padding: 0;
            border: none;
            font-size: inherit;
        }

        /* 引用块 - 精致的左边框 */
        .markdown-content blockquote {
            position: relative;
            margin: 1rem 0;
            padding: 1rem 1.25rem;
            background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
            border-radius: 0 0.75rem 0.75rem 0;
            border-left: 4px solid;
            border-image: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%) 1;
            color: #475569;
            font-style: italic;
        }
        .markdown-content blockquote::before {
            content: '"';
            position: absolute;
            top: -0.25rem;
            left: 0.75rem;
            font-size: 2.5rem;
            color: #93c5fd;
            font-family: Georgia, serif;
            line-height: 1;
        }
        .markdown-content blockquote p {
            margin: 0;
            padding-left: 1rem;
        }

        /* 表格 - 现代化设计 */
        .markdown-content table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            margin: 1rem 0;
            font-size: 0.875rem;
            border-radius: 0.75rem;
            overflow: hidden;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
        }
        .markdown-content th {
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            font-weight: 600;
            color: #1e293b;
            padding: 0.75rem 1rem;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
        }
        .markdown-content td {
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #f1f5f9;
            color: #475569;
        }
        .markdown-content tr:last-child td {
            border-bottom: none;
        }
        .markdown-content tr:nth-child(even) td {
            background: #fafafa;
        }
        .markdown-content tr:hover td {
            background: #f0f9ff;
        }

        /* 分隔线 */
        .markdown-content hr {
            border: none;
            height: 2px;
            background: linear-gradient(90deg, transparent 0%, #e2e8f0 20%, #e2e8f0 80%, transparent 100%);
            margin: 1.5rem 0;
        }

        /* 链接 */
        .markdown-content a {
            color: #2563eb;
            text-decoration: none;
            border-bottom: 1px dashed #93c5fd;
            transition: all 0.2s;
        }
        .markdown-content a:hover {
            color: #1d4ed8;
            border-bottom-color: #2563eb;
            border-bottom-style: solid;
        }

        /* 移动端安全区域适配（底部刘海屏） */
        .safe-area-bottom {
            padding-bottom: env(safe-area-inset-bottom, 0.75rem);
        }

        /* 移动端输入框容器高度 */
        @media (max-width: 767px) {
            .safe-area-bottom {
                padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem);
            }
        }
    </style>
</head>
<body class="bg-slate-50 h-screen flex flex-col md:flex-row overflow-hidden text-slate-700 font-sans">

    <!-- 移动端顶部导航 (仅在手机显示) -->
    <div class="md:hidden h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-50 flex-shrink-0">
        <button onclick="toggleSidebar('left')" class="text-slate-500 hover:text-blue-600 p-2">
            <i class="fas fa-bars text-lg"></i>
        </button>
        <span class="font-bold text-slate-800"><?php echo esc($siteSettings['frontend_site_name']); ?></span>
        <button onclick="toggleSidebar('right')" class="text-slate-500 hover:text-blue-600 p-2">
            <i class="fas fa-lightbulb text-lg"></i>
        </button>
    </div>

    <!-- 遮罩层 (移动端打开侧边栏时显示) -->
    <div id="overlay" onclick="closeAllSidebars()" class="fixed inset-0 bg-black/30 z-30 hidden md:hidden glass-transition"></div>

    <!-- 左侧栏：历史记录 -->
    <aside id="left-sidebar" class="fixed md:relative inset-y-0 left-0 w-72 bg-white border-r border-slate-200 transform -translate-x-full md:translate-x-0 z-40 sidebar-transition flex flex-col h-full shadow-2xl md:shadow-none">

        <!-- Logo区 -->
        <div class="h-16 flex items-center px-6 border-b border-slate-100 bg-slate-50/50">
            <div class="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white mr-3 shadow-sm">
                <i class="fas fa-rocket"></i>
            </div>
            <h1 class="font-bold text-lg text-slate-800 tracking-tight truncate"><?php echo esc($siteSettings['frontend_site_name']); ?></h1>
        </div>

        <!-- 新建对话按钮 -->
        <div class="p-4">
            <button onclick="window.location.reload()" class="w-full py-2.5 px-4 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-600 rounded-xl shadow-sm hover:shadow transition flex items-center justify-center gap-2 text-sm font-medium">
                <i class="fas fa-plus"></i> 新开启对话
            </button>
        </div>

        <!-- 历史列表 -->
        <div id="history-container" class="flex-1 overflow-y-auto custom-scroll px-3 pb-4">
            <!-- 动态加载历史记录 -->
        </div>

        <!-- 个人中心入口 -->
        <div class="p-4 border-t border-slate-100 bg-slate-50/50">
            <div class="flex items-center gap-3">
                <button onclick="openProfileModal()" class="flex-1 min-w-0 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50/40 transition" title="个人中心">
                    <span class="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm shadow-sm">
                        <i class="fas fa-user"></i>
                    </span>
                    <span class="min-w-0">
                        <span class="block text-sm font-bold text-slate-700">个人中心</span>
                        <span class="block text-xs text-slate-400 truncate">账户资料与显示名称</span>
                    </span>
                </button>
                <button onclick="logout()" class="text-slate-400 hover:text-red-500 transition" title="退出登录">
                    <i class="fas fa-sign-out-alt"></i>
                </button>
            </div>
            <p class="text-[10px] leading-relaxed text-slate-400 mt-3 line-clamp-2"><?php echo esc($siteSettings['copyright_text']); ?></p>
        </div>
    </aside>

    <!-- 个人中心弹窗 -->
    <div id="profile-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-slate-900/45 px-4">
        <div class="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
                <div class="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <i class="fas fa-user-circle text-xl"></i>
                </div>
                <div>
                    <h2 class="text-lg font-bold text-slate-900">个人中心</h2>
                    <p class="text-sm text-slate-500">查看账号信息，修改前台显示名称</p>
                </div>
            </div>
            <div class="space-y-4 px-6 py-5">
                <div>
                    <label class="block text-sm font-medium text-slate-700">显示名称</label>
                    <input id="profile-name-input" type="text" maxlength="30" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="请输入显示名称">
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-700">手机号</label>
                    <input id="profile-phone-input" type="text" readonly class="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500" value="">
                    <p class="mt-1 text-xs text-slate-400">手机号用于登录，如需修改请联系系统管理员。</p>
                </div>
                <div id="profile-error" class="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600"></div>
                <div id="profile-success" class="hidden rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"></div>
            </div>
            <div class="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-4">
                <button onclick="logout()" class="text-sm font-medium text-slate-500 hover:text-red-600">
                    <i class="fas fa-sign-out-alt mr-1"></i> 退出登录
                </button>
                <div class="flex gap-2">
                    <button onclick="closeProfileModal()" class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">取消</button>
                    <button id="profile-save-button" onclick="saveProfile()" class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">保存</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 中间栏：核心对话区 -->
    <main class="flex-1 flex flex-col min-h-0 relative bg-slate-50/30 w-full md:w-auto overflow-hidden">

        <!-- 顶部模式切换 (悬浮式) -->
        <header class="absolute top-0 left-0 right-0 h-16 flex items-center justify-center z-10 glass-header border-b border-slate-200/60 md:border-none md:bg-transparent md:backdrop-filter-none flex-shrink-0">
            <div class="bg-slate-200/80 p-1 rounded-full flex shadow-inner">
                <button onclick="switchMode('qa')" id="btn-qa" class="px-5 py-1.5 rounded-full text-sm font-bold shadow-sm bg-white text-blue-600 transition-all transform hover:scale-105">
                    <i class="fas fa-bolt mr-1"></i> 问答
                </button>
                <button onclick="switchMode('learn')" id="btn-learn" class="px-5 py-1.5 rounded-full text-sm font-medium text-slate-500 hover:text-slate-700 transition-all">
                    <i class="fas fa-book-reader mr-1"></i> 学习
                </button>
            </div>
        </header>

        <!-- 聊天滚动区域 -->
        <div id="chat-container" class="flex-1 overflow-y-auto custom-scroll pt-20 pb-24 md:pb-4 px-4 md:px-8 space-y-6">

            <!-- 欢迎卡片 -->
            <div class="flex flex-col items-center justify-center mt-10 mb-10 text-center opacity-80" id="welcome-card">
                <div class="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-4">
                    <div id="welcome-icon-box" class="w-10 h-10 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm">
                        <i id="welcome-icon" class="fas fa-rocket text-lg"></i>
                    </div>
                </div>
                <h2 class="text-xl font-bold text-slate-800" id="greeting-title"></h2>
                <p class="text-slate-500 text-sm mt-1 max-w-md" id="greeting-subtitle"></p>
                <p class="text-blue-600 text-sm mt-3 font-medium animate-pulse" id="greeting-encourage"></p>
            </div>

            <!-- 系统消息示例 -->
            <div class="flex justify-center">
                <span class="text-xs text-slate-400 bg-slate-200/60 px-3 py-1 rounded-full border border-slate-200" id="knowledge-version">
                    <i class="fas fa-lock text-[10px] mr-1"></i> 知识库已更新至 2025-12-05 版本
                </span>
            </div>

        </div>

        <!-- 底部输入框 - 移动端固定在底部 -->
        <div class="fixed md:relative bottom-0 left-0 right-0 md:bottom-auto p-3 md:p-6 bg-white md:bg-gradient-to-t md:from-slate-50 md:via-slate-50 md:to-transparent border-t md:border-t-0 border-slate-200 z-30 flex-shrink-0 safe-area-bottom">
            <div class="max-w-4xl mx-auto relative bg-white md:bg-white rounded-2xl md:shadow-lg border border-slate-200 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-all">
                <textarea id="user-input" rows="1" class="w-full bg-transparent border-0 rounded-2xl py-3 md:py-4 pl-4 pr-14 text-slate-700 placeholder:text-slate-400 focus:ring-0 resize-none max-h-24 md:max-h-32 text-base" placeholder="问点什么... (Enter 发送)" oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'; updateCharCount();" onkeydown="if(event.keyCode===13 && !event.shiftKey){event.preventDefault(); sendMessage();}"></textarea>

                <!-- 字数统计 -->
                <span id="char-count" class="absolute left-4 bottom-1 text-[10px] text-slate-300 hidden"></span>

                <!-- 发送按钮 -->
                <button id="send-btn" onclick="sendMessage()" class="absolute right-2 bottom-2 w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 transition shadow-md hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0">
                    <i class="fas fa-paper-plane text-sm"></i>
                </button>

                <!-- 停止按钮 (默认隐藏) -->
                <button id="stop-btn" onclick="stopGeneration()" class="absolute right-2 bottom-2 w-10 h-10 bg-red-500 text-white rounded-xl flex items-center justify-center hover:bg-red-600 transition shadow-md hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0 hidden animate-pulse" title="停止AI输出">
                    <i class="fas fa-stop text-sm"></i>
                </button>
            </div>
            <p class="text-center text-[10px] text-slate-400 mt-1 md:mt-2 hidden md:block">AI生成内容可能包含错误，请核对重要信息。</p>
        </div>
    </main>

    <!-- 右侧栏：知识增强与推荐 -->
    <aside id="right-sidebar" class="fixed md:relative inset-y-0 right-0 w-80 bg-white border-l border-slate-200 transform translate-x-full md:translate-x-0 z-40 sidebar-transition h-full shadow-2xl md:shadow-none overflow-y-auto custom-scroll">

        <div class="p-6">
            <h3 class="font-bold text-slate-800 mb-4 flex items-center">
                <i class="far fa-compass text-blue-500 mr-2"></i> 探索建议
            </h3>

            <!-- 模块1：销售热搜榜 (动态加载) -->
            <div class="mb-8">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-slate-400 uppercase">🔥 销售热搜</span>
                    <button class="text-xs text-blue-500 hover:underline" onclick="displayRandomHotSearches()">换一批</button>
                </div>
                <div id="hot-searches" class="space-y-2">
                    <!-- 动态加载的热搜内容 -->
                </div>
            </div>

            <!-- 模块2：技能提升推荐 (动态加载) -->
            <div>
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-slate-400 uppercase">🎓 技能提升</span>
                </div>
                <div id="skill-learning" class="space-y-3">
                    <!-- 动态加载的学习内容 -->
                </div>
            </div>
        </div>
    </aside>

    <!-- JavaScript 逻辑 -->
    <script>
        // 配置
        const API_BASE = './api';
        const MAX_INPUT_LENGTH = 8000; // 与后端保持一致

        // 状态
        let currentMode = 'qa';
        let currentSessionId = null;
        let learningState = 0;
        let isLoading = false;
        let welcomeProfile = INITIAL_WELCOME_PROFILE || {};

        // DOM 元素
        const chatContainer = document.getElementById('chat-container');
        const userInput = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const historyContainer = document.getElementById('history-container');

        // 流式请求控制器
        let currentAbortController = null;

        // 移动端侧边栏切换逻辑
        function toggleSidebar(side) {
            const leftSidebar = document.getElementById('left-sidebar');
            const rightSidebar = document.getElementById('right-sidebar');
            const overlay = document.getElementById('overlay');

            if (side === 'left') {
                const isClosed = leftSidebar.classList.contains('-translate-x-full');
                if (isClosed) {
                    leftSidebar.classList.remove('-translate-x-full');
                    overlay.classList.remove('hidden');
                    rightSidebar.classList.add('translate-x-full');
                } else {
                    leftSidebar.classList.add('-translate-x-full');
                    overlay.classList.add('hidden');
                }
            } else {
                const isClosed = rightSidebar.classList.contains('translate-x-full');
                if (isClosed) {
                    rightSidebar.classList.remove('translate-x-full');
                    overlay.classList.remove('hidden');
                    leftSidebar.classList.add('-translate-x-full');
                } else {
                    rightSidebar.classList.add('translate-x-full');
                    overlay.classList.add('hidden');
                }
            }
        }

        function closeAllSidebars() {
            document.getElementById('left-sidebar').classList.add('-translate-x-full');
            document.getElementById('right-sidebar').classList.add('translate-x-full');
            document.getElementById('overlay').classList.add('hidden');
        }

        // 退出登录
        async function logout() {
            if (!confirm('确定要退出登录吗？')) return;
            try {
                await fetch(`${API_BASE}/auth.php?action=logout`);
            } catch(e) {}
            window.location.href = 'login.php';
        }

        function setProfileNotice(type, message) {
            const errorEl = document.getElementById('profile-error');
            const successEl = document.getElementById('profile-success');
            errorEl.classList.add('hidden');
            successEl.classList.add('hidden');
            if (!message) return;

            const target = type === 'success' ? successEl : errorEl;
            target.textContent = message;
            target.classList.remove('hidden');
        }

        async function openProfileModal() {
            const modal = document.getElementById('profile-modal');
            const nameInput = document.getElementById('profile-name-input');
            const phoneInput = document.getElementById('profile-phone-input');
            setProfileNotice('', '');
            nameInput.value = CURRENT_USER.name || '';
            phoneInput.value = CURRENT_USER.phone || '';
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => nameInput.focus(), 50);

            try {
                const response = await fetch(`${API_BASE}/auth.php?action=current_user`);
                const data = await response.json();
                if (data.success && data.data?.user) {
                    Object.assign(CURRENT_USER, data.data.user);
                    nameInput.value = CURRENT_USER.name || '';
                    phoneInput.value = CURRENT_USER.phone || '';
                }
            } catch (error) {
                console.error('Load profile error:', error);
            }
        }

        function closeProfileModal() {
            const modal = document.getElementById('profile-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            setProfileNotice('', '');
        }

        async function saveProfile() {
            const button = document.getElementById('profile-save-button');
            const nameInput = document.getElementById('profile-name-input');
            const name = nameInput.value.trim();

            if (!name) {
                setProfileNotice('error', '显示名称不能为空');
                nameInput.focus();
                return;
            }

            button.disabled = true;
            button.textContent = '保存中...';
            setProfileNotice('', '');
            try {
                const response = await fetch(`${API_BASE}/auth.php?action=update_profile`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || '保存失败');
                }
                if (data.data?.user) {
                    Object.assign(CURRENT_USER, data.data.user);
                } else {
                    CURRENT_USER.name = name;
                }
                setProfileNotice('success', '显示名称已更新');
                generateGreeting();
                setTimeout(closeProfileModal, 500);
            } catch (error) {
                setProfileNotice('error', error.message || '保存失败');
            } finally {
                button.disabled = false;
                button.textContent = '保存';
            }
        }

        // 切换模式
        function switchMode(mode) {
            currentMode = mode;
            const btnQa = document.getElementById('btn-qa');
            const btnLearn = document.getElementById('btn-learn');

            if (mode === 'qa') {
                btnQa.className = 'px-5 py-1.5 rounded-full text-sm font-bold shadow-sm bg-white text-blue-600 transition-all transform hover:scale-105';
                btnLearn.className = 'px-5 py-1.5 rounded-full text-sm font-medium text-slate-500 hover:text-slate-700 transition-all';
                userInput.placeholder = '问点什么... (Enter 发送)';
            } else {
                btnLearn.className = 'px-5 py-1.5 rounded-full text-sm font-bold shadow-sm bg-white text-green-600 transition-all transform hover:scale-105';
                btnQa.className = 'px-5 py-1.5 rounded-full text-sm font-medium text-slate-500 hover:text-slate-700 transition-all';
                userInput.placeholder = '输入你想学习的主题... (Enter 开始)';
            }

            // 重置会话
            currentSessionId = null;
            learningState = 0;
            generateGreeting();
        }

        // 发送消息
        async function sendMessage() {
            const message = userInput.value.trim();
            if (!message || isLoading) return;

            // 检查输入长度
            if (message.length > MAX_INPUT_LENGTH) {
                alert(`输入内容过长，最多支持 ${MAX_INPUT_LENGTH} 字符，当前 ${message.length} 字符`);
                return;
            }

            isLoading = true;
            userInput.value = '';
            userInput.style.height = '';

            // 显示用户消息
            appendMessage('user', message);

            try {
                if (currentMode === 'qa') {
                    await sendQAMessageStream(message);
                } else {
                    await sendLearnMessage(message);
                }
            } catch (error) {
                console.error('Error:', error);
                appendMessage('assistant', '抱歉，服务暂时不可用，请稍后重试。');
            } finally {
                isLoading = false;
            }
        }

        // 显示/隐藏停止按钮
        function showStopButton() {
            sendBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            stopBtn.classList.add('flex');

            // 在学习模式下显示额外提示
            if (currentMode === 'learning') {
                showStopHint();
            }
        }

        function hideStopButton() {
            stopBtn.classList.add('hidden');
            stopBtn.classList.remove('flex');
            sendBtn.classList.remove('hidden');
            hideStopHint();
        }

        // 显示停止提示
        function showStopHint() {
            const hint = document.createElement('div');
            hint.id = 'stop-hint';
            hint.className = 'fixed bottom-20 right-4 bg-red-500 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-50 animate-fade-in';
            hint.innerHTML = '<i class="fas fa-info-circle mr-1"></i>按 Esc 或 Ctrl+C 可停止输出';
            document.body.appendChild(hint);

            // 3秒后自动隐藏
            setTimeout(() => {
                hideStopHint();
            }, 3000);
        }

        // 隐藏停止提示
        function hideStopHint() {
            const hint = document.getElementById('stop-hint');
            if (hint) {
                hint.remove();
            }
        }

        function showToast(message, type = 'success') {
            const colors = {
                success: 'bg-emerald-600',
                error: 'bg-red-500',
                info: 'bg-slate-800'
            };
            const icons = {
                success: 'fa-check-circle',
                error: 'fa-circle-exclamation',
                info: 'fa-circle-info'
            };
            const toast = document.createElement('div');
            toast.className = `fixed top-4 right-4 ${colors[type] || colors.info} text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in text-sm`;
            toast.innerHTML = `<i class="fas ${icons[type] || icons.info} mr-2"></i>${escapeHtml(message)}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2200);
        }

        async function copyText(text) {
            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (error) {
                // 回退到 execCommand
            }

            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            return copied;
        }

        function buildShareActions(messageId) {
            const id = Number(messageId);
            if (!id || Number.isNaN(id)) return '';

            return `
                <div class="mt-3 flex justify-end">
                    <button type="button" onclick="shareConversation(${id}, this)"
                        class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                        title="生成公开分享链接">
                        <i class="fas fa-share-nodes"></i>
                        <span>分享</span>
                    </button>
                </div>
            `;
        }

        async function shareConversation(messageId, button) {
            if (!messageId || button?.dataset.loading === '1') return;

            const originalHtml = button ? button.innerHTML : '';
            if (button) {
                button.dataset.loading = '1';
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>生成中</span>';
                button.disabled = true;
            }

            try {
                const response = await fetch(`${API_BASE}/shares.php?action=create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message_id: Number(messageId) })
                });
                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || '生成分享链接失败');
                }

                const shareUrl = data.data.share_url;
                const copied = await copyText(shareUrl);

                if (!copied) {
                    window.prompt('复制分享链接', shareUrl);
                    showToast('分享链接已生成', 'success');
                } else {
                    showToast(data.data.reused ? '分享链接已复制' : '分享链接已生成并复制', 'success');
                }

                if (button) {
                    button.innerHTML = '<i class="fas fa-check"></i><span>已复制</span>';
                    button.classList.add('bg-blue-50', 'text-blue-600');
                    setTimeout(() => {
                        button.innerHTML = originalHtml;
                        button.classList.remove('bg-blue-50', 'text-blue-600');
                    }, 1600);
                }
            } catch (error) {
                console.error('Share error:', error);
                showToast(error.message || '生成分享链接失败', 'error');
                if (button) {
                    button.innerHTML = originalHtml;
                }
            } finally {
                if (button) {
                    button.dataset.loading = '0';
                    button.disabled = false;
                }
            }
        }

        // 停止生成
        function stopGeneration() {
            if (currentAbortController) {
                currentAbortController.abort();
                currentAbortController = null;
            }
            hideStopButton();
            isLoading = false;

            // 移除正在输出的光标
            const cursors = document.querySelectorAll('.typing-cursor');
            cursors.forEach(el => el.classList.remove('typing-cursor'));

            // 刷新历史记录
            loadSessions();
        }

        // 问答模式 - 流式输出
        async function sendQAMessageStream(message) {
            // 创建消息容器
            const messageDiv = createStreamingMessage();
            const contentDiv = messageDiv.querySelector('.streaming-content');
            let fullContent = '';

            // 显示停止按钮
            showStopButton();

            // 创建 AbortController
            currentAbortController = new AbortController();

            try {
                const response = await fetch(`${API_BASE}/stream.php?action=chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: currentSessionId,
                        message: message,
                        user_id: CURRENT_USER.id
                    }),
                    signal: currentAbortController.signal
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // 保留未完成的行

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            const event = line.substring(7).trim();
                            continue;
                        }
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));

                                if (data.session_id) {
                                    currentSessionId = data.session_id;
                                }
                                if (data.content) {
                                    // 首次收到内容时，隐藏思考动画
                                    if (fullContent === '') {
                                        startStreamingContent(messageDiv);
                                    }
                                    fullContent += data.content;
                                    contentDiv.innerHTML = renderMarkdown(fullContent);
                                    contentDiv.classList.add('typing-cursor');
                                    chatContainer.scrollTop = chatContainer.scrollHeight;
                                }
                                if (data.suggestions) {
                                    // 流式完成，移除光标，添加推荐问题
                                    contentDiv.classList.remove('typing-cursor');
                                    finishStreamingMessage(messageDiv, fullContent, data.suggestions, data.rag_sources, data.message_id);
                                    // 刷新历史记录
                                    loadSessions();
                                }
                                if (data.message && !data.content) {
                                    // 错误消息
                                    contentDiv.innerHTML = `<span class="text-red-500">${data.message}</span>`;
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('Stream aborted by user');
                    contentDiv.classList.remove('typing-cursor');
                    // 清除思考动画定时器
                    if (messageDiv.thinkingInterval) {
                        clearInterval(messageDiv.thinkingInterval);
                    }
                    startStreamingContent(messageDiv);
                    if (fullContent) {
                        // 显示已生成的内容
                        contentDiv.innerHTML = renderMarkdown(fullContent) + '<p class="text-xs text-slate-400 mt-2 italic">⏹ 已停止生成</p>';
                    } else {
                        contentDiv.innerHTML = '<span class="text-slate-400 italic">⏹ 已停止生成</span>';
                    }
                } else {
                    console.error('Stream error:', error);
                    // 清除思考动画定时器
                    if (messageDiv.thinkingInterval) {
                        clearInterval(messageDiv.thinkingInterval);
                    }
                    startStreamingContent(messageDiv);
                    contentDiv.innerHTML = '<span class="text-red-500">连接失败，请重试</span>';
                }
            } finally {
                hideStopButton();
                currentAbortController = null;
            }
        }

        // 思考中的提示语列表
        const thinkingPhrases = [
            { icon: 'fa-brain', text: '正在思考中...', color: 'text-blue-500' },
            { icon: 'fa-search', text: '正在检索知识库...', color: 'text-blue-500' },
            { icon: 'fa-cogs', text: '正在整理回答...', color: 'text-sky-600' },
            { icon: 'fa-lightbulb', text: '正在组织思路...', color: 'text-amber-500' },
            { icon: 'fa-magic', text: '正在生成回复...', color: 'text-pink-500' }
        ];

        // 创建流式消息容器
        function createStreamingMessage() {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'flex flex-col items-start';

            // 随机选择一个思考提示
            const phrase = thinkingPhrases[Math.floor(Math.random() * thinkingPhrases.length)];

            messageDiv.innerHTML = `
                <div class="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none text-sm text-slate-700 max-w-[90%] shadow-sm leading-relaxed min-w-[200px]">
                    <div class="thinking-indicator flex items-center gap-3">
                        <div class="relative">
                            <div class="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center">
                                <i class="fas ${phrase.icon} ${phrase.color} text-sm animate-pulse"></i>
                            </div>
                            <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-slate-600 font-medium text-sm thinking-text">${phrase.text}</span>
                            <div class="flex gap-1 mt-1">
                                <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                                <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                                <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                            </div>
                        </div>
                    </div>
                    <div class="markdown-content streaming-content hidden"></div>
                </div>
            `;
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            // 每2秒切换一次提示语
            const thinkingTextEl = messageDiv.querySelector('.thinking-text');
            const iconEl = messageDiv.querySelector('.thinking-indicator i');
            let phraseIndex = thinkingPhrases.indexOf(phrase);

            messageDiv.thinkingInterval = setInterval(() => {
                phraseIndex = (phraseIndex + 1) % thinkingPhrases.length;
                const newPhrase = thinkingPhrases[phraseIndex];
                if (thinkingTextEl && iconEl) {
                    thinkingTextEl.textContent = newPhrase.text;
                    iconEl.className = `fas ${newPhrase.icon} ${newPhrase.color} text-sm animate-pulse`;
                }
            }, 2000);

            return messageDiv;
        }

        // 开始显示内容（隐藏思考动画）
        function startStreamingContent(messageDiv) {
            const thinkingIndicator = messageDiv.querySelector('.thinking-indicator');
            const contentDiv = messageDiv.querySelector('.streaming-content');

            // 清除定时器
            if (messageDiv.thinkingInterval) {
                clearInterval(messageDiv.thinkingInterval);
            }

            if (thinkingIndicator) {
                thinkingIndicator.classList.add('hidden');
            }
            if (contentDiv) {
                contentDiv.classList.remove('hidden');
            }
        }

        // 完成流式消息
        function finishStreamingMessage(messageDiv, content, suggestions, ragSources, messageId = null) {
            // 移除 [SUGGESTIONS] 行（AI返回的原始标记）
            let cleanContent = content.replace(/\[SUGGESTIONS\].*$/gm, '').trim();

            // 移除参考来源显示（根据用户要求）
            let ragHtml = '';
            // if (ragSources && ragSources.length > 0) {
            //     ragHtml = `
            //         <div class="mt-3 p-2 bg-green-50 rounded border border-green-100 text-xs text-green-800">
            //             <div class="font-bold mb-1"><i class="fas fa-book-open mr-1"></i> 参考来源</div>
            //             ${ragSources.map(s => `<div class="opacity-75">• ${s.doc_name}</div>`).join('')}
            //         </div>
            //     `;
            // }

            // 推荐问题显示
            let suggestionsHtml = '';
            if (suggestions && suggestions.length > 0) {
                suggestionsHtml = `
                    <div class="mt-4 border-t border-slate-100 pt-3">
                        <div class="text-xs text-slate-400 mb-2">💡 你可能还想问：</div>
                        <div class="space-y-2">
                            ${suggestions.map(s => {
                                // 清理推荐问题中的 Markdown 标记
                                const cleanText = s.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '').replace(/\*\*/g, '').replace(/^##?\s*/, '').trim();
                                return `<button onclick="fillInput(${jsArg(cleanText)})" class="block w-full text-left px-3 py-2 bg-slate-50 rounded-lg text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition whitespace-normal break-words">${escapeHtml(cleanText)}</button>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            const bubbleDiv = messageDiv.querySelector('.bg-white');
            bubbleDiv.innerHTML = `
                <div class="markdown-content">${renderMarkdown(cleanContent)}</div>
                ${ragHtml}
                ${buildShareActions(messageId)}
                ${suggestionsHtml}
            `;
        }

        // 学习模式发送 - 流式输出
        async function sendLearnMessage(message) {
            if (learningState === 0) {
                // 开始学习，生成大纲
                await streamLearnStart(message);
            } else {
                // 继续学习
                await handleLearnNextStream(message, null);
            }
        }

        // 流式开始学习
        async function streamLearnStart(topic) {
            const messageDiv = createStreamingMessage();
            const contentDiv = messageDiv.querySelector('.streaming-content');
            let fullContent = '';
            let quickButtons = [];

            // 显示停止按钮
            showStopButton();
            currentAbortController = new AbortController();

            try {
                const response = await fetch(`${API_BASE}/stream.php?action=learn_start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: topic, user_id: CURRENT_USER.id }),
                    signal: currentAbortController.signal
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.session_id) {
                                    currentSessionId = data.session_id;
                                }
                                if (data.content) {
                                    // 首次收到内容时，隐藏思考动画
                                    if (fullContent === '') {
                                        startStreamingContent(messageDiv);
                                    }
                                    fullContent += data.content;
                                    contentDiv.innerHTML = renderMarkdown(fullContent);
                                    contentDiv.classList.add('typing-cursor');
                                    chatContainer.scrollTop = chatContainer.scrollHeight;
                                }
                                if (data.quick_buttons) {
                                    quickButtons = data.quick_buttons;
                                    contentDiv.classList.remove('typing-cursor');
                                    learningState = 1;
                                    finishStreamingLearnMessage(messageDiv, fullContent, quickButtons, null, data.message_id);
                                    loadSessions();
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    if (messageDiv.thinkingInterval) clearInterval(messageDiv.thinkingInterval);
                    startStreamingContent(messageDiv);
                    contentDiv.classList.remove('typing-cursor');
                    if (fullContent) {
                        contentDiv.innerHTML = renderMarkdown(fullContent) + '<p class="text-xs text-slate-400 mt-2 italic">⏹ 已停止生成</p>';
                    } else {
                        contentDiv.innerHTML = '<span class="text-slate-400 italic">⏹ 已停止生成</span>';
                    }
                } else {
                    if (messageDiv.thinkingInterval) clearInterval(messageDiv.thinkingInterval);
                    startStreamingContent(messageDiv);
                    console.error('Stream error:', error);
                    contentDiv.innerHTML = '<span class="text-red-500">连接失败，请重试</span>';
                }
            } finally {
                hideStopButton();
                currentAbortController = null;
            }
        }

        // 流式处理学习下一步
        async function handleLearnNextStream(userResponse, buttonId) {
            // 特殊按钮处理
            if (buttonId === 'regenerate') {
                learningState = 0;
                currentSessionId = null;
                appendMessage('assistant', '好的，请重新输入你想学习的主题。');
                return;
            }

            if (buttonId === 'new_topic') {
                learningState = 0;
                currentSessionId = null;
                appendMessage('assistant', '请输入新的学习主题。');
                return;
            }

            if (buttonId === 'switch_qa') {
                switchMode('qa');
                appendMessage('assistant', '已切换到问答模式，请随时提问。');
                return;
            }

            // 确定API action
            let action = 'learn_next';
            if (learningState === 1 && buttonId === 'confirm') {
                action = 'learn_confirm';
            }

            const messageDiv = createStreamingMessage();
            const contentDiv = messageDiv.querySelector('.streaming-content');
            let fullContent = '';
            let quickButtons = [];
            let progress = null;
            let completionType = null;

            // 显示停止按钮
            showStopButton();
            currentAbortController = new AbortController();

            try {
                const response = await fetch(`${API_BASE}/stream.php?action=${action}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: currentSessionId,
                        button_id: buttonId,
                        user_response: userResponse
                    }),
                    signal: currentAbortController.signal
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));
                                if (data.content) {
                                    // 首次收到内容时，隐藏思考动画
                                    if (fullContent === '') {
                                        startStreamingContent(messageDiv);
                                    }
                                    fullContent += data.content;
                                    contentDiv.innerHTML = renderMarkdown(fullContent);
                                    contentDiv.classList.add('typing-cursor');
                                    chatContainer.scrollTop = chatContainer.scrollHeight;
                                }
                                if (data.progress) {
                                    progress = data.progress;
                                }
                                if (data.type === 'completion') {
                                    completionType = 'completion';
                                }
                                if (data.quick_buttons) {
                                    quickButtons = data.quick_buttons;
                                    contentDiv.classList.remove('typing-cursor');

                                    if (action === 'learn_confirm') {
                                        learningState = 2;
                                    }
                                    if (completionType === 'completion') {
                                        learningState = 0;
                                    }

                                    finishStreamingLearnMessage(messageDiv, fullContent, quickButtons, progress, data.message_id);
                                    loadSessions();
                                }
                            } catch (e) {}
                        }
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    if (messageDiv.thinkingInterval) clearInterval(messageDiv.thinkingInterval);
                    startStreamingContent(messageDiv);
                    contentDiv.classList.remove('typing-cursor');
                    if (fullContent) {
                        contentDiv.innerHTML = renderMarkdown(fullContent) + '<p class="text-xs text-slate-400 mt-2 italic">⏹ 已停止生成</p>';
                    } else {
                        contentDiv.innerHTML = '<span class="text-slate-400 italic">⏹ 已停止生成</span>';
                    }
                } else {
                    if (messageDiv.thinkingInterval) clearInterval(messageDiv.thinkingInterval);
                    startStreamingContent(messageDiv);
                    console.error('Stream error:', error);
                    contentDiv.innerHTML = '<span class="text-red-500">连接失败，请重试</span>';
                }
            } finally {
                hideStopButton();
                currentAbortController = null;
            }
        }

        // 完成流式学习消息
        function finishStreamingLearnMessage(messageDiv, content, quickButtons, progress, messageId = null) {
            let progressHtml = '';
            if (progress) {
                const percent = (progress.current / progress.total) * 100;
                progressHtml = `
                    <div class="mb-3 p-2 bg-green-50 rounded-lg border border-green-100">
                        <div class="flex items-center justify-between text-xs text-green-700 mb-1">
                            <span><i class="fas fa-book-reader mr-1"></i> 学习进度</span>
                            <span class="font-bold">${progress.current}/${progress.total}</span>
                        </div>
                        <div class="w-full bg-green-200 rounded-full h-2">
                            <div class="bg-green-500 h-2 rounded-full transition-all" style="width: ${percent}%"></div>
                        </div>
                    </div>
                `;
            }

            let buttonsHtml = '';
            if (quickButtons && quickButtons.length > 0) {
                buttonsHtml = `
                    <div class="mt-4 flex flex-wrap gap-2">
                        ${quickButtons.map(btn => `
                            <button onclick="clickQuickButton(${jsArg(btn.id)}, ${jsArg(btn.label)})"
                                class="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm text-slate-700 hover:border-green-400 hover:text-green-600 hover:shadow transition">
                                ${escapeHtml(btn.label)}
                            </button>
                        `).join('')}
                    </div>
                `;
            }

            const bubbleDiv = messageDiv.querySelector('.bg-white');
            bubbleDiv.innerHTML = `
                ${progressHtml}
                <div class="markdown-content">${renderMarkdown(content)}</div>
                ${buildShareActions(messageId)}
                ${buttonsHtml}
            `;
        }

        // 点击快捷按钮
        async function clickQuickButton(buttonId, buttonLabel) {
            if (isLoading) return;

            isLoading = true;
            appendMessage('user', buttonLabel);

            try {
                await handleLearnNextStream(null, buttonId);
            } catch (error) {
                console.error('Error:', error);
                appendMessage('assistant', '抱歉，操作失败，请重试。');
            } finally {
                isLoading = false;
            }
        }

        // 添加消息到聊天区
        function appendMessage(role, content, suggestions = null, ragSources = null, quickButtons = null, progress = null, messageId = null) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'flex flex-col ' + (role === 'user' ? 'items-end' : 'items-start');

            // 进度条
            let progressHtml = '';
            if (progress) {
                const percent = (progress.current / progress.total) * 100;
                progressHtml = `
                    <div class="mb-2 w-full max-w-[85%]">
                        <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
                            <span>学习进度</span>
                            <span>${progress.current}/${progress.total}</span>
                        </div>
                        <div class="w-full bg-slate-200 rounded-full h-1.5">
                            <div class="bg-green-500 h-1.5 rounded-full transition-all" style="width: ${percent}%"></div>
                        </div>
                    </div>
                `;
            }

            if (role === 'user') {
                messageDiv.innerHTML = `
                    <div class="bg-blue-600 text-white px-4 py-3 rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-sm leading-relaxed">
                        ${escapeHtml(content)}
                    </div>
                `;
            } else {
                // 渲染Markdown
                const renderedContent = renderMarkdown(content);
                const shareHtml = buildShareActions(messageId);

                // 移除参考来源显示（根据用户要求）
                let ragHtml = '';
                // if (ragSources && ragSources.length > 0) {
                //     ragHtml = `
                //         <div class="mt-3 p-2 bg-green-50 rounded border border-green-100 text-xs text-green-800">
                //             <div class="font-bold mb-1"><i class="fas fa-book-open mr-1"></i> 参考来源</div>
                //             ${ragSources.map(s => `<div class="opacity-75">• ${s.doc_name}</div>`).join('')}
                //         </div>
                //     `;
                // }

                // 快捷按钮
                let buttonsHtml = '';
                if (quickButtons && quickButtons.length > 0) {
                    buttonsHtml = `
                        <div class="mt-4 flex flex-wrap gap-2">
                            ${quickButtons.map(btn => `
                                <button onclick="clickQuickButton(${jsArg(btn.id)}, ${jsArg(btn.label)})"
                                    class="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm text-slate-700 hover:border-blue-400 hover:text-blue-600 hover:shadow transition">
                                    ${escapeHtml(btn.label)}
                                </button>
                            `).join('')}
                        </div>
                    `;
                }

                // 推荐问题
                let suggestionsHtml = '';
                if (suggestions && suggestions.length > 0) {
                    suggestionsHtml = `
                        <div class="mt-4 border-t border-slate-100 pt-3">
                            <div class="text-xs text-slate-400 mb-2">💡 你可能还想问：</div>
                            <div class="space-y-2">
                                ${suggestions.map(s => {
                                    // 清理推荐问题中的 Markdown 标记
                                    const cleanText = s.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '').replace(/\*\*/g, '').replace(/^##?\s*/, '').trim();
                                    return `<button onclick="fillInput(${jsArg(cleanText)})" class="block w-full text-left px-3 py-2 bg-slate-50 rounded-lg text-sm text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition whitespace-normal break-words">${escapeHtml(cleanText)}</button>`;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }

                messageDiv.innerHTML = `
                    ${progressHtml}
                    <div class="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none text-sm text-slate-700 max-w-[90%] shadow-sm leading-relaxed">
                        <div class="markdown-content">${renderedContent}</div>
                        ${ragHtml}
                        ${shareHtml}
                        ${buttonsHtml}
                        ${suggestionsHtml}
                    </div>
                `;
            }

            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        // 显示加载状态
        function showLoading() {
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'loading-' + Date.now();
            loadingDiv.className = 'flex items-start';
            loadingDiv.innerHTML = `
                <div class="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm">
                    <div class="flex items-center gap-2 text-slate-400">
                        <div class="animate-spin w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full"></div>
                        <span class="text-sm">思考中...</span>
                    </div>
                </div>
            `;
            chatContainer.appendChild(loadingDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            return loadingDiv.id;
        }

        function hideLoading(loadingId) {
            const loadingDiv = document.getElementById(loadingId);
            if (loadingDiv) loadingDiv.remove();
        }

        // 填充输入框
        function fillInput(text) {
            userInput.value = text;
            userInput.focus();
            updateCharCount();
        }

        // 更新字数统计
        function updateCharCount() {
            const count = userInput.value.length;
            const countEl = document.getElementById('char-count');

            if (count > 0) {
                countEl.classList.remove('hidden');
                countEl.textContent = `${count}/${MAX_INPUT_LENGTH}`;

                // 接近限制时变色警告
                if (count > MAX_INPUT_LENGTH * 0.9) {
                    countEl.className = 'absolute left-4 bottom-1 text-[10px] text-red-500';
                } else if (count > MAX_INPUT_LENGTH * 0.7) {
                    countEl.className = 'absolute left-4 bottom-1 text-[10px] text-amber-500';
                } else {
                    countEl.className = 'absolute left-4 bottom-1 text-[10px] text-slate-400';
                }
            } else {
                countEl.classList.add('hidden');
            }
        }

        // 开始学习（从右侧栏卡片点击）
        function startLearning(topic) {
            switchMode('learn');
            userInput.value = topic;
            sendMessage();
        }

        // 更新右侧推荐
        function updateSuggestions(suggestions) {
            // 可以动态更新右侧栏的推荐问题
        }

        // 世界级Markdown渲染
        function renderMarkdown(text) {
            if (!text) return '';
            text = String(text);

            // 保护代码块，防止内部内容被处理
            const codeBlocks = [];
            text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
                const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
                codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
                return placeholder;
            });

            // 保护行内代码
            const inlineCodes = [];
            text = text.replace(/`([^`]+)`/g, (match, code) => {
                const placeholder = `@@INLINECODE${inlineCodes.length}@@`;
                inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
                return placeholder;
            });

            text = escapeHtml(text);

            // 处理表格
            text = text.replace(/^\|(.+)\|\s*\n\|[-:\s|]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (match, header, body) => {
                const headerCells = header.split('|').map(c => c.trim()).filter(c => c);
                const headerRow = `<tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr>`;

                const bodyRows = body.trim().split('\n').map(row => {
                    const cells = row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
                    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
                }).join('');

                return `<table>${headerRow}${bodyRows}</table>`;
            });

            // 处理标题 - 支持行首或行内（如 "文字。## 标题"）
            // 先处理行内标题：将 "。## 标题" 或 "。# 标题" 转换为换行+标题
            text = text.replace(/([。！？\.!?])\s*(#{1,4})\s+([^\n]+)/g, '$1\n$2 $3');
            // 处理标题 - 保持层级
            text = text.replace(/^\s*#{4}\s+(.+)$/gm, '<h4>$1</h4>');
            text = text.replace(/^\s*#{3}\s+(.+)$/gm, '<h3>$1</h3>');
            text = text.replace(/^\s*#{2}\s+(.+)$/gm, '<h2>$1</h2>');
            text = text.replace(/^\s*#{1}\s+(.+)$/gm, '<h1>$1</h1>');

            // 处理引用块 - 支持多行
            text = text.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');
            text = text.replace(/<\/blockquote>\n<blockquote>/g, '');

            // 处理分隔线（支持前后有空格的情况）
            text = text.replace(/^\s*---+\s*$/gm, '<hr>');
            text = text.replace(/^\s*\*\*\*+\s*$/gm, '<hr>');
            text = text.replace(/^\s*___+\s*$/gm, '<hr>');

            // 处理加粗和斜体（注意顺序，支持跨行）
            text = text.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>');
            text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
            text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
            text = text.replace(/___(.+?)___/gs, '<strong><em>$1</em></strong>');
            text = text.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
            text = text.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');

            // 清理未匹配的孤立 ** 或 __ 标记
            // 行首独立的 **
            text = text.replace(/^\*\*\s*$/gm, '');
            text = text.replace(/^__\s*$/gm, '');
            // 移除段落开头或结尾的孤立 **（未闭合的情况）
            text = text.replace(/^\*\*\s+/gm, '');
            text = text.replace(/\s+\*\*$/gm, '');
            // 移除句子中孤立的 **（前后有空格）
            text = text.replace(/\s\*\*\s/g, ' ');

            // 处理有序列表
            text = text.replace(/^(\d+)\. (.+)$/gm, '<oli>$2</oli>');
            text = text.replace(/(<oli>.*<\/oli>\n?)+/g, (match) => {
                return '<ol>' + match.replace(/<\/?oli>/g, (tag) => tag.replace('oli', 'li')) + '</ol>';
            });

            // 处理无序列表（包含嵌套子列表）
            // 先处理嵌套列表（带缩进的 - 或 * ）
            text = text.replace(/^(\s{2,})[-*•]\s+(.+)$/gm, (match, indent, content) => {
                const level = Math.floor(indent.length / 2);
                return `<sli data-level="${level}">${content}</sli>`;
            });
            // 处理一级无序列表
            text = text.replace(/^[-*•]\s+(.+)$/gm, '<uli>$1</uli>');

            // 将连续的列表项组合成列表
            text = text.replace(/(<uli>.*?<\/uli>|<sli[^>]*>.*?<\/sli>)(\n?)/g, (match, item, newline) => {
                return item + newline;
            });

            // 组合列表并处理嵌套
            const listLines = text.split('\n');
            let listResult = [];
            let inList = false;
            let listStack = [];

            for (let line of listLines) {
                if (line.startsWith('<uli>') || line.startsWith('<sli')) {
                    if (!inList) {
                        listResult.push('<ul>');
                        listStack.push(0);
                        inList = true;
                    }

                    if (line.startsWith('<sli')) {
                        // 嵌套列表项
                        const levelMatch = line.match(/data-level="(\d+)"/);
                        const level = levelMatch ? parseInt(levelMatch[1]) : 1;
                        const content = line.replace(/<sli[^>]*>/, '').replace(/<\/sli>/, '');

                        // 进入更深层级
                        while (listStack.length <= level) {
                            listResult.push('<ul>');
                            listStack.push(listStack.length);
                        }
                        // 退出到当前层级
                        while (listStack.length > level + 1) {
                            listResult.push('</ul>');
                            listStack.pop();
                        }
                        listResult.push(`<li>${content}</li>`);
                    } else {
                        // 一级列表项
                        // 先关闭所有嵌套
                        while (listStack.length > 1) {
                            listResult.push('</ul>');
                            listStack.pop();
                        }
                        const content = line.replace(/<uli>/, '').replace(/<\/uli>/, '');
                        listResult.push(`<li>${content}</li>`);
                    }
                } else {
                    // 非列表项，关闭所有列表
                    while (listStack.length > 0) {
                        listResult.push('</ul>');
                        listStack.pop();
                    }
                    inList = false;
                    listResult.push(line);
                }
            }
            // 关闭剩余的列表
            while (listStack.length > 0) {
                listResult.push('</ul>');
                listStack.pop();
            }
            text = listResult.join('\n');

            // 处理链接，仅允许 http/https 和站内路径
            text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
                const decodedUrl = url.replace(/&amp;/g, '&').trim();
                if (!/^(https?:\/\/|\/(?!\/)|#)/i.test(decodedUrl)) {
                    return label;
                }
                return `<a href="${escapeHtml(decodedUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
            });

            // 处理段落 - 更智能的换行处理
            const lines = text.split('\n');
            let result = [];
            let inParagraph = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const isBlockElement = /^<(h[1-4]|ul|ol|li|table|tr|th|td|blockquote|pre|hr)/.test(line);
                const isClosingBlock = /^<\/(ul|ol|table|blockquote)>/.test(line);
                const isEmpty = line.trim() === '';

                if (isEmpty) {
                    if (inParagraph) {
                        result.push('</p>');
                        inParagraph = false;
                    }
                } else if (isBlockElement || isClosingBlock) {
                    if (inParagraph) {
                        result.push('</p>');
                        inParagraph = false;
                    }
                    result.push(line);
                } else {
                    if (!inParagraph) {
                        result.push('<p>');
                        inParagraph = true;
                    } else {
                        result.push('<br>');
                    }
                    result.push(line);
                }
            }
            if (inParagraph) result.push('</p>');

            text = result.join('');

            // 恢复代码块
            codeBlocks.forEach((code, i) => {
                text = text.replace(`@@CODEBLOCK${i}@@`, code);
            });

            // 恢复行内代码
            inlineCodes.forEach((code, i) => {
                text = text.replace(`@@INLINECODE${i}@@`, code);
            });

            // 清理
            text = text.replace(/<p><\/p>/g, '');
            text = text.replace(/<p><br>/g, '<p>');
            text = text.replace(/<br><\/p>/g, '</p>');
            text = text.replace(/<p>(<h[1-4]>)/g, '$1');
            text = text.replace(/(<\/h[1-4]>)<\/p>/g, '$1');
            text = text.replace(/<p>(<ul|<ol|<table|<blockquote|<pre|<hr)/g, '$1');
            text = text.replace(/(<\/ul>|<\/ol>|<\/table>|<\/blockquote>|<\/pre>|<hr>)<\/p>/g, '$1');

            // 清理可能未被恢复的占位符（安全网）
            text = text.replace(/@@CODEBLOCK\d+@@/g, '');
            text = text.replace(/@@INLINECODE\d+@@/g, '');

            return text;
        }

        // HTML转义
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function jsArg(value) {
            return escapeHtml(JSON.stringify(String(value ?? '')));
        }

        // 加载历史会话
        async function loadSessions() {
            try {
                const response = await fetch(`${API_BASE}/chat.php?action=sessions&user_id=${CURRENT_USER.id}`);
                const data = await response.json();

                if (data.success && data.data && data.data.sessions) {
                    renderHistoryList(data.data.sessions);
                }
            } catch (error) {
                console.error('Load sessions error:', error);
            }
        }

        // 渲染历史记录列表
        function renderHistoryList(sessions) {
            if (!sessions || sessions.length === 0) {
                historyContainer.innerHTML = `
                    <div class="text-center text-slate-400 text-sm py-8">
                        <i class="fas fa-comments text-2xl mb-2 opacity-50"></i>
                        <p>暂无对话记录</p>
                    </div>
                `;
                return;
            }

            // 按日期分组
            const today = new Date().toDateString();
            const yesterday = new Date(Date.now() - 86400000).toDateString();

            const groups = {
                today: [],
                yesterday: [],
                earlier: []
            };

            sessions.forEach(session => {
                const sessionDate = new Date(session.updated_at || session.created_at).toDateString();
                if (sessionDate === today) {
                    groups.today.push(session);
                } else if (sessionDate === yesterday) {
                    groups.yesterday.push(session);
                } else {
                    groups.earlier.push(session);
                }
            });

            let html = '';

            if (groups.today.length > 0) {
                html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-2">今天</div>`;
                html += renderSessionGroup(groups.today);
            }

            if (groups.yesterday.length > 0) {
                html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-4">昨天</div>`;
                html += renderSessionGroup(groups.yesterday);
            }

            if (groups.earlier.length > 0) {
                html += `<div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-3 mt-4">更早</div>`;
                html += renderSessionGroup(groups.earlier);
            }

            historyContainer.innerHTML = html;
        }

        // 渲染会话分组
        function renderSessionGroup(sessions) {
            return sessions.map(session => {
                const isLearn = session.mode === 'learn';
                const isActive = session.id === currentSessionId;
                const icon = isLearn ? 'fa-graduation-cap' : 'fa-comments';
                const iconColor = isLearn ? 'text-green-500' : '';
                const title = session.title || (isLearn ? `学习：${session.learning_topic || '未命名'}` : '新对话');

                const activeClass = isActive
                    ? 'bg-blue-50 text-blue-700 border-blue-100'
                    : 'hover:bg-slate-50 text-slate-600 border-transparent hover:border-slate-200';

                return `
                    <a href="javascript:void(0)" onclick="loadSession(${session.id}, '${session.mode || 'qa'}')"
                       class="group flex items-center gap-3 p-3 rounded-xl ${activeClass} mb-1 transition border">
                        <i class="fas ${icon} text-sm ${iconColor}"></i>
                        <div class="flex-1 truncate text-sm ${isActive ? 'font-medium' : ''}">${escapeHtml(title)}</div>
                        <button onclick="event.stopPropagation(); deleteSession(${session.id})"
                                class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition p-1">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </a>
                `;
            }).join('');
        }

        // 加载指定会话
        async function loadSession(sessionId, mode) {
            try {
                // 切换模式
                switchMode(mode);
                currentSessionId = sessionId;

                // 获取会话消息
                const response = await fetch(`${API_BASE}/chat.php?action=messages&session_id=${sessionId}`);
                const data = await response.json();

                if (data.success && data.data && data.data.messages) {
                    // 清空当前聊天区域
                    chatContainer.innerHTML = '';

                    // 渲染历史消息
                    data.data.messages.forEach(msg => {
                        appendMessage(
                            msg.role,
                            msg.content,
                            msg.suggestions || [],
                            msg.rag_sources || [],
                            msg.quick_buttons || [],
                            null,
                            msg.role === 'assistant' ? msg.id : null
                        );
                    });

                    // 更新学习状态
                    if (mode === 'learn' && data.data.session) {
                        if (data.data.session.learning_progress > 0) {
                            learningState = 2;
                        } else if (data.data.session.learning_outline) {
                            learningState = 1;
                        }
                    }

                    // 刷新历史列表高亮
                    loadSessions();
                }
            } catch (error) {
                console.error('Load session error:', error);
            }
        }

        function getWelcomeCardHtml() {
            return `
                <div class="flex flex-col items-center justify-center mt-10 mb-10 text-center opacity-80" id="welcome-card">
                    <div class="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-4">
                        <div id="welcome-icon-box" class="w-10 h-10 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm">
                            <i id="welcome-icon" class="fas fa-rocket text-lg"></i>
                        </div>
                    </div>
                    <h2 class="text-xl font-bold text-slate-800" id="greeting-title"></h2>
                    <p class="text-slate-500 text-sm mt-1 max-w-md" id="greeting-subtitle"></p>
                    <p class="text-blue-600 text-sm mt-3 font-medium" id="greeting-encourage"></p>
                </div>

                <div class="flex justify-center">
                    <span class="text-xs text-slate-400 bg-slate-200/60 px-3 py-1 rounded-full border border-slate-200" id="knowledge-version">
                        <i class="fas fa-lock text-[10px] mr-1"></i> 知识库版本加载中
                    </span>
                </div>
            `;
        }

        function renderEmptyWelcomeState() {
            chatContainer.innerHTML = getWelcomeCardHtml();
            generateGreeting();
            loadKnowledgeVersion();
        }

        // 删除会话
        async function deleteSession(sessionId) {
            if (!confirm('确定删除此对话记录吗？')) return;

            try {
                const response = await fetch(`${API_BASE}/chat.php?action=delete_session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId })
                });
                const data = await response.json();

                if (data.success) {
                    // 如果删除的是当前会话，重置
                    if (sessionId === currentSessionId) {
                        currentSessionId = null;
                        renderEmptyWelcomeState();
                    }
                    loadSessions();
                }
            } catch (error) {
                console.error('Delete session error:', error);
            }
        }

        function interpolateWelcomeLine(line, variables) {
            return String(line || '')
                .replace(/\{user\}/g, variables.userName)
                .replace(/\{time\}/g, variables.timeGreeting)
                .replace(/\{scene\}/g, variables.sceneName);
        }

        function pickWelcomeLine(lines, fallback) {
            const usableLines = Array.isArray(lines) && lines.length > 0 ? lines : [fallback];
            return usableLines[Math.floor(Math.random() * usableLines.length)];
        }

        // 生成个性化问候语
        function generateGreeting() {
            const userName = CURRENT_USER.name || '朋友';
            const hour = new Date().getHours();
            const profile = welcomeProfile || {};

            // 时间段问候
            let timeGreeting;
            if (hour >= 5 && hour < 9) {
                timeGreeting = '早上好';
            } else if (hour >= 9 && hour < 12) {
                timeGreeting = '上午好';
            } else if (hour >= 12 && hour < 14) {
                timeGreeting = '中午好';
            } else if (hour >= 14 && hour < 18) {
                timeGreeting = '下午好';
            } else if (hour >= 18 && hour < 22) {
                timeGreeting = '晚上好';
            } else {
                timeGreeting = '夜深了';
            }

            const sceneName = profile.scenario?.name || profile.role_name || '智能助手';
            const subtitlePool = currentMode === 'learn' && Array.isArray(profile.learn_subtitles) && profile.learn_subtitles.length > 0
                ? profile.learn_subtitles
                : profile.subtitles;
            const variables = { userName, timeGreeting, sceneName };
            const randomSubtitle = interpolateWelcomeLine(
                pickWelcomeLine(subtitlePool, '我是你的智能助手，可以根据当前场景为你提供清晰、具体、可执行的帮助。'),
                variables
            );
            const randomEncourage = interpolateWelcomeLine(
                pickWelcomeLine(profile.encouragements, '{user}，把问题说出来，我们一起把下一步理清楚。'),
                variables
            );

            // 更新DOM
            const titleEl = document.getElementById('greeting-title');
            const subtitleEl = document.getElementById('greeting-subtitle');
            const encourageEl = document.getElementById('greeting-encourage');
            const iconBoxEl = document.getElementById('welcome-icon-box');
            const iconEl = document.getElementById('welcome-icon');

            if (!titleEl || !subtitleEl || !encourageEl) return;

            titleEl.textContent = `${timeGreeting}，${userName}`;
            subtitleEl.textContent = randomSubtitle;
            encourageEl.textContent = randomEncourage;
            encourageEl.className = profile.accent_class || 'text-blue-600 text-sm mt-3 font-medium';

            if (iconBoxEl) {
                iconBoxEl.className = profile.icon_box_class || 'w-10 h-10 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm';
            }
            if (iconEl) {
                iconEl.className = `${profile.icon || 'fas fa-rocket'} text-lg`;
            }
        }

        async function loadWelcomeProfile() {
            try {
                const response = await fetch(`${API_BASE}/frontend.php?action=welcome`);
                const data = await response.json();
                if (data.success && data.data?.welcome) {
                    welcomeProfile = data.data.welcome;
                    generateGreeting();
                }
            } catch (error) {
                console.error('加载欢迎语场景失败:', error);
            }
        }

        // HTML 转义函数
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 存储所有热搜数据
        let allHotSearches = [];
        let currentHotSearchIndex = 0;

        // 加载热搜榜
        async function loadHotSearches() {
            try {
                const response = await fetch(`${API_BASE}/suggestions.php?action=list&type=hot_search`);
                const data = await response.json();

                if (data.success) {
                    allHotSearches = data.data.suggestions;
                    displayRandomHotSearches();
                }
            } catch (error) {
                console.error('加载热搜榜失败:', error);
            }
        }

        // 显示随机3个热搜
        function displayRandomHotSearches() {
            if (allHotSearches.length === 0) return;

            const container = document.getElementById('hot-searches');
            let displayItems = [];

            if (allHotSearches.length <= 3) {
                // 如果总数不超过3个，显示全部
                displayItems = allHotSearches;
            } else {
                // 随机选择3个不重复的项目
                const shuffled = [...allHotSearches].sort(() => 0.5 - Math.random());
                displayItems = shuffled.slice(0, 3);
            }

            container.innerHTML = displayItems.map(item => `
                <button onclick="fillInput('${escapeHtml(item.content)}')"
                    class="w-full text-left p-3 rounded-xl bg-slate-50 hover:bg-white hover:shadow-md border border-slate-100 hover:border-blue-200 transition group">
                    <div class="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition">${escapeHtml(item.title)}</div>
                    <div class="text-xs text-slate-400 mt-1 line-clamp-1">${escapeHtml(item.subtitle || '')}</div>
                </button>
            `).join('');
        }

        // 加载技能提升
        async function loadSkillLearning() {
            try {
                const response = await fetch(`${API_BASE}/suggestions.php?action=list&type=skill_learning`);
                const data = await response.json();

                if (data.success) {
                    const container = document.getElementById('skill-learning');
                    container.innerHTML = data.data.suggestions.map(item => {
                        // 解析颜色类名
                        const colorClasses = item.color_class || 'from-blue-50 to-sky-50 border-blue-100 text-blue-600';
                        const gradientClasses = colorClasses.includes('from-') ? colorClasses : `from-blue-50 to-sky-50 border-blue-100 ${colorClasses}`;

                        return `
                            <div class="bg-gradient-to-br ${gradientClasses} rounded-xl p-4 border relative overflow-hidden group cursor-pointer"
                                onclick="startLearning('${escapeHtml(item.content)}')">
                                <div class="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition">
                                    <i class="${item.icon || 'fas fa-brain'} text-4xl"></i>
                                </div>
                                <span class="text-[10px] font-bold bg-white px-2 py-0.5 rounded shadow-sm mb-2 inline-block">技能提升</span>
                                <h4 class="font-bold text-slate-800 text-sm mb-1">${escapeHtml(item.title)}</h4>
                                <p class="text-xs text-slate-500 mb-3">${escapeHtml(item.subtitle || '')}</p>
                                <div class="flex items-center text-xs font-medium">
                                    点击开始学习 <i class="fas fa-arrow-right ml-1 transition group-hover:translate-x-1"></i>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (error) {
                console.error('加载技能提升失败:', error);
            }
        }

        // 加载知识库版本信息
        async function loadKnowledgeVersion() {
            try {
                const response = await fetch(`${API_BASE}/knowledge.php?action=get_version`);
                const data = await response.json();

                if (data.success && data.data.last_updated) {
                    const versionElement = document.getElementById('knowledge-version');
                    const date = new Date(data.data.last_updated).toLocaleDateString('zh-CN');
                    versionElement.innerHTML = `<i class="fas fa-lock text-[10px] mr-1"></i> 知识库已更新至 ${date} 版本`;
                }
            } catch (error) {
                console.error('加载知识库版本失败:', error);
            }
        }

        // 初始化
        document.addEventListener('DOMContentLoaded', () => {
            generateGreeting();
            loadWelcomeProfile();
            loadSessions();
            loadHotSearches();
            loadSkillLearning();
            loadKnowledgeVersion();

            document.getElementById('profile-modal')?.addEventListener('click', (event) => {
                if (event.target.id === 'profile-modal') {
                    closeProfileModal();
                }
            });
        });

        // 全局键盘快捷键
        document.addEventListener('keydown', function(e) {
            // Ctrl+C 或 Esc 停止AI输出
            if ((e.ctrlKey && e.key === 'c') || e.key === 'Escape') {
                if (currentAbortController && !stopBtn.classList.contains('hidden')) {
                    e.preventDefault();
                    stopGeneration();

                    // 显示提示
                    const toast = document.createElement('div');
                    toast.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in';
                    toast.innerHTML = '<i class="fas fa-stop mr-2"></i>已停止AI输出';
                    document.body.appendChild(toast);

                    setTimeout(() => {
                        toast.remove();
                    }, 2000);
                } else if (e.key === 'Escape' && !document.getElementById('profile-modal')?.classList.contains('hidden')) {
                    closeProfileModal();
                }
            }
        });
    </script>
    <?php if ($frontendAnalyticsCode !== ''): ?>
    <?php echo "\n" . $frontendAnalyticsCode . "\n"; ?>
    <?php endif; ?>
</body>
</html>
