<?php
session_start();
require_once __DIR__ . '/api/db.php';
initDatabase();

// 检查管理员登录状态（使用admin_id，不是user_id）
if (!isset($_SESSION['admin_id'])) {
    header('Location: admin_login.php');
    exit;
}

// 获取管理员信息
$currentAdmin = [
    'id' => $_SESSION['admin_id'],
    'username' => $_SESSION['admin_username'],
    'name' => $_SESSION['admin_name'],
    'role' => $_SESSION['admin_role']  // super_admin 或 admin
];

// 权限定义
$isSuperAdmin = ($currentAdmin['role'] === 'super_admin');
if (empty($_SESSION['admin_csrf_token'])) {
    $_SESSION['admin_csrf_token'] = bin2hex(random_bytes(32));
}
$adminCsrfToken = $_SESSION['admin_csrf_token'];
$siteSettings = getSiteSettings();

function esc($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo esc($siteSettings['admin_page_title']); ?></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>
    <style>
        body { font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
        [x-cloak] { display: none !important; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #D1D5DB; }
        .fade-enter { animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    </style>
</head>
<body class="bg-[#F9FAFB] text-gray-900 h-screen flex overflow-hidden" x-data="adminSystem()" x-init="init()">

    <!-- 侧边栏 -->
    <aside class="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-20">
        <div class="h-16 flex items-center px-6 border-b border-gray-100">
            <a href="#" @click.prevent="switchTab('dashboard')" class="min-w-0 select-none" aria-label="返回数据概览">
                <div class="flex items-center gap-2 min-w-0 leading-none" :title="siteSettings.admin_site_name">
                    <span class="max-w-[150px] truncate text-[22px] font-extrabold text-slate-950" x-text="brandMainName()">TokChat</span>
                    <span x-show="brandSuffixName()" x-cloak class="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600" x-text="brandSuffixName()">Admin</span>
                </div>
                <div class="mt-1.5 h-[2px] w-11 rounded-full bg-slate-950"></div>
            </a>
        </div>

        <nav class="flex-1 overflow-y-auto px-4 py-4">
            <div class="space-y-4">
                <section class="space-y-1">
                    <div class="px-3 pb-0.5 text-[11px] font-semibold text-gray-400 tracking-wide">工作台</div>
                    <a href="#" @click.prevent="switchTab('dashboard')" :class="tabClass('dashboard')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('dashboard', 'fa-chart-pie')" class="w-5 text-center mr-3 transition-colors"></i>
                        数据概览
                    </a>
                </section>

                <section class="space-y-1">
                    <div class="px-3 pb-0.5 text-[11px] font-semibold text-gray-400 tracking-wide">业务运营</div>
                    <a href="#" @click.prevent="switchTab('users')" :class="tabClass('users')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('users', 'fa-users')" class="w-5 text-center mr-3 transition-colors"></i>
                        用户管理
                    </a>

                    <a href="#" @click.prevent="switchTab('knowledge')" :class="tabClass('knowledge')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('knowledge', 'fa-book')" class="w-5 text-center mr-3 transition-colors"></i>
                        知识库
                    </a>

                    <a href="#" @click.prevent="switchTab('suggestions')" :class="tabClass('suggestions')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('suggestions', 'fa-compass')" class="w-5 text-center mr-3 transition-colors"></i>
                        探索建议
                    </a>
                </section>

                <section class="space-y-1">
                    <div class="px-3 pb-0.5 text-[11px] font-semibold text-gray-400 tracking-wide">AI 服务</div>
                    <a href="#" @click.prevent="switchTab('prompts')" :class="tabClass('prompts')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('prompts', 'fa-sliders-h')" class="w-5 text-center mr-3 transition-colors"></i>
                        Prompt 设置
                    </a>

                    <a href="#" @click.prevent="switchTab('api_config')" :class="tabClass('api_config')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('api_config', 'fa-plug')" class="w-5 text-center mr-3 transition-colors"></i>
                        API 配置
                    </a>

                    <a href="#" @click.prevent="switchTab('api_stats')" :class="tabClass('api_stats')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('api_stats', 'fa-chart-line')" class="w-5 text-center mr-3 transition-colors"></i>
                        API 统计
                    </a>
                </section>

                <section class="space-y-1">
                    <div class="px-3 pb-0.5 text-[11px] font-semibold text-gray-400 tracking-wide">系统与审计</div>
                    <?php if ($isSuperAdmin): ?>
                    <a href="#" @click.prevent="switchTab('admins')" :class="tabClass('admins')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('admins', 'fa-user-shield')" class="w-5 text-center mr-3 transition-colors"></i>
                        管理员管理
                    </a>
                    <?php endif; ?>

                    <a href="#" @click.prevent="switchTab('logs')" :class="tabClass('logs')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('logs', 'fa-list-ul')" class="w-5 text-center mr-3 transition-colors"></i>
                        对话日志
                    </a>

                    <a href="#" @click.prevent="switchTab('settings')" :class="tabClass('settings')" class="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-150 group">
                        <i :class="iconClass('settings', 'fa-gear')" class="w-5 text-center mr-3 transition-colors"></i>
                        网站设置
                    </a>
                </section>
            </div>
        </nav>

        <!-- 底部用户信息 -->
        <div class="p-4 border-t border-gray-100">
            <div class="flex items-center w-full p-2 rounded-lg">
                <div class="w-9 h-9 rounded-full bg-gradient-to-br <?php echo $isSuperAdmin ? 'from-red-500 to-orange-500' : 'from-indigo-500 to-purple-600'; ?> flex items-center justify-center text-white text-sm font-bold">
                    <?php echo mb_substr($currentAdmin['name'], 0, 1); ?>
                </div>
                <div class="ml-3 text-left flex-1">
                    <p class="text-sm font-medium text-gray-900"><?php echo htmlspecialchars($currentAdmin['name']); ?></p>
                    <p class="text-xs text-gray-500"><?php echo $isSuperAdmin ? '超级管理员' : '管理员'; ?></p>
                </div>
                <button @click="logout()" class="text-gray-400 hover:text-red-500 transition" title="退出登录">
                    <i class="fas fa-sign-out-alt"></i>
                </button>
            </div>
            <div class="mt-3 border-t border-gray-100 pt-3 text-[11px] leading-5 text-gray-400">
                <p class="truncate" x-text="siteSettings.copyright_text"><?php echo esc($siteSettings['copyright_text']); ?></p>
                <a href="https://x.com/yaojingang" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-gray-400 hover:text-indigo-600 transition">
                    <i class="fa-brands fa-x-twitter"></i>
                    <span>作者主页</span>
                </a>
            </div>
        </div>
    </aside>

    <!-- 主内容区 -->
    <main class="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#F9FAFB]">
        <header class="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-8 flex-shrink-0">
            <div>
                <h1 class="text-xl font-semibold text-gray-900 whitespace-nowrap" x-text="pageTitle"></h1>
            </div>
            <div class="flex items-center space-x-4">
                <button class="text-gray-400 hover:text-gray-600 transition">
                    <i class="far fa-bell text-lg"></i>
                </button>
            </div>
        </header>

        <div class="flex-1 overflow-auto p-8">
            <!-- Dashboard -->
            <div x-show="currentTab === 'dashboard'" class="fade-enter space-y-6">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <template x-for="stat in stats" :key="stat.label">
                        <div class="bg-white p-6 rounded-xl border border-gray-200/60 shadow-sm hover:shadow-md transition-shadow group cursor-default" :title="stat.detail || ''">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-sm font-medium text-gray-500" x-text="stat.label"></h3>
                                <span :class="stat.trendUp ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'" class="text-xs px-2 py-0.5 rounded-full font-medium" x-text="stat.trend"></span>
                            </div>
                            <div class="text-3xl font-bold text-gray-900 tracking-tight mb-2" x-text="stat.value"></div>
                            <div class="text-xs text-gray-400" x-text="stat.detail || ''"></div>
                        </div>
                    </template>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-96 flex flex-col">
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-base font-semibold text-gray-900">提问趋势分析 (近30天)</h3>
                            <div class="text-xs text-gray-500 bg-gray-50 px-3 py-1 rounded-full flex items-center">
                                <i class="fas fa-hand-pointer mr-1"></i>
                                点击数据点查看详情
                            </div>
                        </div>
                        <div id="trend-chart" class="flex-1 w-full"></div>
                    </div>
                    <div class="lg:col-span-1 bg-white p-6 rounded-xl border border-gray-200 shadow-sm h-96 flex flex-col">
                        <h3 class="text-base font-semibold text-gray-900 mb-1">热门话题 <span class="text-xs text-gray-400 font-normal">TOP 6</span></h3>
                        <p class="text-xs text-gray-400 mb-3">基于真实用户提问和学习主题统计</p>
                        <div class="space-y-2 flex-1">
                            <template x-for="(topic, index) in topTopics.slice(0, 6)" :key="index">
                                <div class="flex items-center gap-3 py-2.5 min-w-0">
                                    <span :class="index < 3 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'" class="w-6 h-6 rounded text-xs font-bold flex items-center justify-center flex-shrink-0" x-text="index + 1"></span>
                                    <span class="min-w-0 flex-1 truncate text-sm text-gray-700 font-medium leading-6" x-text="topic.name" :title="topic.name"></span>
                                    <span class="w-12 flex-shrink-0 text-right text-sm text-gray-500 font-medium tabular-nums" x-text="topic.count + '次'"></span>
                                </div>
                            </template>
                            <template x-if="topTopics.length === 0">
                                <div class="text-center text-gray-400 py-10">
                                    <i class="fas fa-comments text-2xl mb-2"></i>
                                    <p class="text-sm">暂无真实热门话题</p>
                                    <p class="text-xs mt-1">产生有效对话后自动统计</p>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 管理员管理（仅超级管理员可见） -->
            <?php if ($isSuperAdmin): ?>
            <div x-show="currentTab === 'admins'" class="fade-enter" x-cloak>
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
                        <div class="text-sm text-gray-500">
                            <i class="fas fa-shield-alt mr-2"></i>管理后台管理员账号
                        </div>
                        <button @click="openAdminModal()" class="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center shadow-sm">
                            <i class="fas fa-plus mr-2"></i> 添加管理员
                        </button>
                    </div>
                    <table class="w-full text-left">
                        <thead class="bg-gray-50 text-xs uppercase font-semibold text-gray-500">
                            <tr>
                                <th class="px-6 py-4">管理员信息</th>
                                <th class="px-6 py-4">用户名</th>
                                <th class="px-6 py-4">角色</th>
                                <th class="px-6 py-4">最后登录</th>
                                <th class="px-6 py-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 text-sm">
                            <template x-for="admin in admins" :key="admin.id">
                                <tr class="hover:bg-gray-50 transition">
                                    <td class="px-6 py-4">
                                        <div class="flex items-center">
                                            <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold mr-3" :class="admin.role === 'super_admin' ? 'bg-gradient-to-br from-red-500 to-orange-500' : 'bg-gradient-to-br from-indigo-500 to-purple-600'" x-text="admin.name.charAt(0)"></div>
                                            <span class="font-medium text-gray-900" x-text="admin.name"></span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4 text-gray-600" x-text="admin.username"></td>
                                    <td class="px-6 py-4">
                                        <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="admin.role === 'super_admin' ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'" x-text="admin.role === 'super_admin' ? '超级管理员' : '普通管理员'"></span>
                                    </td>
                                    <td class="px-6 py-4 text-gray-500 text-xs" x-text="admin.last_login || '从未登录'"></td>
                                    <td class="px-6 py-4 text-right">
                                        <button @click="editAdmin(admin)" class="text-gray-400 hover:text-indigo-600 mr-3" title="编辑"><i class="fas fa-edit"></i></button>
                                        <button x-show="admin.role !== 'super_admin'" @click="deleteAdmin(admin)" class="text-gray-400 hover:text-red-500" title="删除"><i class="fas fa-trash-alt"></i></button>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>
            </div>
            <?php endif; ?>

            <!-- 用户管理 -->
            <div x-show="currentTab === 'users'" class="fade-enter" x-cloak>
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white">
                        <div class="relative w-64">
                            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
                            <input type="text" x-model="searchUser" @input.debounce.300ms="loadUsers()" placeholder="搜索姓名/手机号..." class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition">
                        </div>
                        <button @click="openUserModal()" class="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center shadow-sm">
                            <i class="fas fa-plus mr-2"></i> 添加用户
                        </button>
                    </div>
                    <table class="w-full text-left">
                        <thead class="bg-gray-50 text-xs uppercase font-semibold text-gray-500">
                            <tr>
                                <th class="px-6 py-4">用户信息</th>
                                <th class="px-6 py-4">公司简称</th>
                                <th class="px-6 py-4">手机号</th>
                                <th class="px-6 py-4">角色</th>
                                <th class="px-6 py-4">状态</th>
                                <th class="px-6 py-4">最后登录</th>
                                <th class="px-6 py-4 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            <template x-for="user in users" :key="user.id">
                                <tr class="hover:bg-gray-50/50 transition-colors group">
                                    <td class="px-6 py-4">
                                        <div class="flex items-center">
                                            <div class="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold mr-3" x-text="user.name.charAt(0)"></div>
                                            <div>
                                                <div class="text-sm font-medium text-gray-900" x-text="user.name"></div>
                                                <div class="text-xs text-gray-500" x-text="user.email || '-'"></div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <span class="text-sm text-gray-600" x-text="user.company || '-'"></span>
                                    </td>
                                    <td class="px-6 py-4">
                                        <span class="text-sm text-gray-600 font-mono" x-text="user.phone || '-'"></span>
                                    </td>
                                    <td class="px-6 py-4">
                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
                                              :class="user.role === 'admin' ? 'bg-purple-50 text-purple-700 border-purple-100' : (user.role === 'sales_manager' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-gray-50 text-gray-700 border-gray-100')"
                                              x-text="formatRole(user.role)"></span>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="flex items-center">
                                            <div class="h-2 w-2 rounded-full mr-2" :class="user.status === 'active' ? 'bg-green-500' : 'bg-gray-300'"></div>
                                            <span class="text-sm text-gray-600" x-text="user.status === 'active' ? '正常' : '禁用'"></span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4 text-sm text-gray-500" x-text="user.last_login_formatted"></td>
                                    <td class="px-6 py-4 text-right">
                                        <button @click="editUser(user)" class="text-gray-400 hover:text-indigo-600 transition mr-3" title="编辑"><i class="fas fa-edit"></i></button>
                                        <button @click="toggleUserStatus(user)" class="text-gray-400 hover:text-amber-600 transition mr-3" :title="user.status === 'active' ? '禁用' : '启用'">
                                            <i :class="user.status === 'active' ? 'fas fa-ban' : 'fas fa-check-circle'"></i>
                                        </button>
                                        <button @click="deleteUser(user)" class="text-gray-400 hover:text-red-600 transition" title="删除"><i class="fas fa-trash-alt"></i></button>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                    <div x-show="users.length === 0" class="px-6 py-12 text-center text-gray-400">
                        <i class="fas fa-users text-4xl mb-3"></i>
                        <p>暂无用户数据</p>
                    </div>
                </div>
            </div>

            <!-- 知识库 -->
            <div x-show="currentTab === 'knowledge'" class="fade-enter" x-cloak>
                <div class="space-y-6 min-w-[980px]">
                    <!-- 上传知识库 -->
                    <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 class="text-lg font-semibold text-gray-900">上传知识库</h2>
                                <p class="text-sm text-gray-500 mt-1">上传后会自动解析、索引并生成语义切片。</p>
                            </div>
                            <button @click="openTextModal()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center gap-2">
                                <i class="fas fa-plus"></i> 添加文本
                            </button>
                        </div>
                        <div class="p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] gap-6">
                            <div
                                @dragover.prevent
                                @drop.prevent="uploadDroppedFile($event)"
                                class="border-2 border-dashed rounded-xl p-6 min-h-[210px] flex flex-col justify-center transition"
                                :class="uploadState === 'uploading' ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300 bg-gray-50/40 hover:border-blue-400 hover:bg-blue-50/30'">
                                <div class="flex flex-col md:flex-row md:items-center gap-5">
                                    <div class="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
                                        :class="uploadState === 'success' ? 'bg-emerald-50 text-emerald-600' : (uploadState === 'error' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600')">
                                        <i class="fas text-xl" :class="uploadState === 'uploading' ? 'fa-spinner animate-spin' : (uploadState === 'success' ? 'fa-check' : (uploadState === 'error' ? 'fa-exclamation-triangle' : 'fa-cloud-upload-alt'))"></i>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <h3 class="text-base font-semibold text-gray-900" x-text="uploadTitle()"></h3>
                                        <p class="text-sm text-gray-500 mt-1" x-text="uploadSubtitle()"></p>
                                        <div x-show="uploadFileName" class="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs text-gray-600">
                                            <i class="fas fa-file text-gray-400"></i>
                                            <span class="truncate" x-text="uploadFileName"></span>
                                        </div>
                                    </div>
                                    <label class="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition cursor-pointer" :class="uploadState === 'uploading' ? 'opacity-60 pointer-events-none' : ''">
                                        <i class="fas fa-upload"></i>
                                        选择文件
                                        <input x-ref="knowledgeFileInput" type="file" class="hidden" @change="uploadFile($event)" accept=".pdf,.md,.txt,.docx">
                                    </label>
                                </div>

                                <div x-show="uploadState === 'uploading'" class="mt-6">
                                    <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
                                        <span x-text="uploadMessage || '正在上传和解析...'"></span>
                                        <span x-text="uploadProgress + '%'"></span>
                                    </div>
                                    <div class="h-2 rounded-full bg-blue-100 overflow-hidden">
                                        <div class="h-full rounded-full bg-blue-600 transition-all duration-300" :style="`width: ${uploadProgress}%`"></div>
                                    </div>
                                    <div class="mt-3 flex items-center gap-2 text-xs text-blue-700">
                                        <span class="inline-flex h-2 w-2 rounded-full bg-blue-600 animate-pulse"></span>
                                        <span>上传完成后会继续解析内容、生成索引和语义切片。</span>
                                    </div>
                                </div>

                                <div x-show="uploadState === 'error'" class="mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" x-text="uploadError"></div>
                            </div>

                            <div class="grid grid-cols-2 gap-3">
                                <div class="rounded-lg border border-gray-200 bg-white p-4">
                                    <div class="text-xs text-gray-500">文档总数</div>
                                    <div class="mt-2 text-2xl font-semibold text-gray-900" x-text="files.length"></div>
                                </div>
                                <div class="rounded-lg border border-gray-200 bg-white p-4">
                                    <div class="text-xs text-gray-500">启用文档</div>
                                    <div class="mt-2 text-2xl font-semibold text-emerald-700" x-text="activeFileCount()"></div>
                                </div>
                                <div class="rounded-lg border border-gray-200 bg-white p-4">
                                    <div class="text-xs text-gray-500">语义切片</div>
                                    <div class="mt-2 text-2xl font-semibold text-purple-700" x-text="totalChunkCount()"></div>
                                </div>
                                <div class="rounded-lg border border-gray-200 bg-white p-4">
                                    <div class="text-xs text-gray-500">停用文档</div>
                                    <div class="mt-2 text-2xl font-semibold text-gray-700" x-text="disabledFileCount()"></div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- 知识库列表 -->
                    <section x-ref="knowledgeList" class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 class="text-lg font-semibold text-gray-900">知识库列表</h2>
                                <p class="text-sm text-gray-500 mt-1">管理文档内容、启用状态、语义切片和向量化。</p>
                            </div>
                            <div class="text-sm text-gray-500">
                                共 <span class="font-medium text-gray-900" x-text="files.length"></span> 个文档
                                <span class="mx-2 text-gray-300">/</span>
                                切片 <span class="font-medium text-gray-900" x-text="totalChunkCount()"></span> 个
                            </div>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead class="bg-gray-50 text-xs font-semibold text-gray-500 border-b border-gray-200">
                                    <tr>
                                        <th class="px-6 py-3 min-w-[300px]">文档</th>
                                        <th class="px-4 py-3 min-w-[120px]">状态</th>
                                        <th class="px-4 py-3 min-w-[170px]">切片与向量</th>
                                        <th class="px-4 py-3 min-w-[110px]">更新时间</th>
                                        <th class="px-5 py-3 text-right min-w-[210px]">操作</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100">
                                    <template x-for="file in files" :key="file.id">
                                        <tr class="hover:bg-gray-50/80 transition" :class="file.status === 'disabled' ? 'bg-gray-50/70' : ''">
                                            <td class="px-6 py-4">
                                                <div class="flex items-center min-w-0">
                                                    <button @click="previewFile(file.id)" class="w-10 h-10 rounded-lg flex items-center justify-center mr-3 shrink-0"
                                                        :class="file.type === 'pdf' ? 'bg-red-50 text-red-500' : (file.type === 'docx' || file.type === 'doc' ? 'bg-blue-50 text-blue-500' : (file.type === 'text' ? 'bg-green-50 text-green-500' : 'bg-purple-50 text-purple-500'))"
                                                        title="编辑文档">
                                                        <i :class="file.type === 'pdf' ? 'fas fa-file-pdf' : (file.type === 'docx' || file.type === 'doc' ? 'fas fa-file-word' : (file.type === 'text' ? 'fas fa-file-alt' : 'fas fa-file-code'))" class="text-lg"></i>
                                                    </button>
                                                    <div class="min-w-0">
                                                        <button @click="previewFile(file.id)" class="block text-sm font-medium text-gray-900 truncate hover:text-blue-700 max-w-[360px]" x-text="file.name"></button>
                                                        <div class="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                                            <span x-text="file.size"></span>
                                                            <span>·</span>
                                                            <span x-text="(file.wordCount || 0) + ' 字'"></span>
                                                            <span>·</span>
                                                            <span x-text="file.type"></span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td class="px-4 py-4">
                                                <div class="flex flex-col gap-2">
                                                    <span :class="docStatusClass(file.status)" class="inline-flex w-fit items-center px-2.5 py-1 rounded text-xs font-medium border" x-text="formatDocStatus(file.status)"></span>
                                                    <button @click="toggleFileStatus(file)" class="inline-flex w-fit items-center gap-1 text-xs font-medium"
                                                        :class="file.status === 'indexed' ? 'text-gray-500 hover:text-red-600' : 'text-emerald-700 hover:text-emerald-800'">
                                                        <i class="fas" :class="file.status === 'indexed' ? 'fa-toggle-on' : 'fa-toggle-off'"></i>
                                                        <span x-text="file.status === 'indexed' ? '停用' : '启用'"></span>
                                                    </button>
                                                </div>
                                            </td>
                                            <td class="px-4 py-4">
                                                <div class="flex flex-wrap gap-2">
                                                    <span :class="chunkStatusClass(file.chunkingStatus)" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border" x-text="formatChunkStatus(file.chunkingStatus)"></span>
                                                    <span :class="embeddingStatusClass(file.embeddingStatus)" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border" x-text="formatEmbeddingStatus(file.embeddingStatus)"></span>
                                                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-gray-50 text-gray-600 border-gray-100" x-text="'切片 ' + (file.chunkCount || 0)"></span>
                                                </div>
                                            </td>
                                            <td class="px-4 py-4 text-xs text-gray-500 whitespace-nowrap" x-text="file.date"></td>
                                            <td class="px-5 py-4">
                                                <div class="flex items-center justify-end gap-0.5">
                                                    <button @click.stop="previewFile(file.id)" class="p-1.5 text-gray-400 hover:text-blue-600 transition rounded-lg hover:bg-blue-50" title="编辑">
                                                        <i class="fas fa-pen"></i>
                                                    </button>
                                                    <button @click.stop="viewChunks(file)" class="p-1.5 text-gray-400 hover:text-indigo-600 transition rounded-lg hover:bg-indigo-50" title="查看切片">
                                                        <i class="fas fa-list"></i>
                                                    </button>
                                                    <button @click.stop="chunkFile(file.id)" class="p-1.5 text-gray-400 hover:text-purple-600 transition rounded-lg hover:bg-purple-50" title="重新切片">
                                                        <i class="fas fa-layer-group"></i>
                                                    </button>
                                                    <button @click.stop="embedFile(file.id)" class="p-1.5 text-gray-400 hover:text-emerald-600 transition rounded-lg hover:bg-emerald-50" title="向量化">
                                                        <i class="fas fa-vector-square"></i>
                                                    </button>
                                                    <button @click.stop="deleteFile(file)" class="p-1.5 text-gray-400 hover:text-red-600 transition rounded-lg hover:bg-red-50" title="删除">
                                                        <i class="fas fa-trash-alt"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                            <div x-show="files.length === 0" class="px-6 py-16 text-center text-gray-400">
                                <i class="fas fa-folder-open text-4xl mb-3"></i>
                                <p>暂无文档，请先上传文件或添加文本。</p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            <!-- 上传结果确认弹窗 -->
            <div x-show="isUploadResultModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" x-cloak @click.self="confirmUploadResult()">
                <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" @click.stop>
                    <div class="px-6 py-5 border-b border-gray-100 flex items-start gap-4">
                        <div class="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                            :class="uploadState === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'">
                            <i class="fas text-lg" :class="uploadState === 'success' ? 'fa-check' : 'fa-exclamation-triangle'"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="text-lg font-semibold text-gray-900" x-text="uploadState === 'success' ? '上传完成' : '上传失败'"></h3>
                            <p class="text-sm text-gray-500 mt-1 truncate" x-text="uploadFileName || '知识库文件'"></p>
                        </div>
                    </div>
                    <div class="p-6">
                        <template x-if="uploadState === 'success'">
                            <div class="grid grid-cols-3 gap-3">
                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                    <div class="text-xs text-gray-500">字数</div>
                                    <div class="mt-1 text-lg font-semibold text-gray-900" x-text="uploadResult?.word_count || 0"></div>
                                </div>
                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                    <div class="text-xs text-gray-500">切片</div>
                                    <div class="mt-1 text-lg font-semibold text-purple-700" x-text="uploadResult?.chunk_count || 0"></div>
                                </div>
                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                    <div class="text-xs text-gray-500">索引</div>
                                    <div class="mt-1 text-lg font-semibold text-emerald-700">完成</div>
                                </div>
                            </div>
                        </template>
                        <template x-if="uploadState === 'error'">
                            <div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" x-text="uploadError"></div>
                        </template>
                    </div>
                    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                        <button @click="confirmUploadResult()" class="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800">
                            确认
                        </button>
                    </div>
                </div>
            </div>

            <!-- 文档预览/编辑弹窗 -->
            <div x-show="isDocModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" x-cloak @click.self="isDocModalOpen = false">
                <div class="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" @click.stop>
                    <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                <i class="fas fa-file-alt"></i>
                            </div>
                            <div>
                                <input x-model="docForm.title" class="font-semibold text-gray-900 bg-transparent border-0 p-0 focus:ring-0 w-full" placeholder="文档标题">
                                <div class="text-xs text-gray-500" x-text="(docForm.wordCount || 0) + ' 字'"></div>
                            </div>
                        </div>
                        <button @click="isDocModalOpen = false" class="text-gray-400 hover:text-gray-600">
                            <i class="fas fa-times text-lg"></i>
                        </button>
                    </div>
                    <div class="flex-1 overflow-hidden p-6">
                        <textarea x-model="docForm.content" class="w-full h-full min-h-[400px] p-4 border border-gray-200 rounded-xl text-sm text-gray-700 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none" placeholder="请输入文档内容..."></textarea>
                    </div>
                    <div class="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-gray-50">
                        <div class="text-xs text-gray-500" x-show="docForm.id">
                            文档ID: <span x-text="docForm.id"></span>
                        </div>
                        <div class="flex gap-3">
                            <button @click="isDocModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                            <button @click="saveDoc()" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700" :disabled="isLoading">
                                <span x-show="!isLoading">保存</span>
                                <span x-show="isLoading"><i class="fas fa-spinner animate-spin mr-1"></i> 保存中...</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 对话日志 -->
            <div x-show="isChunkModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" x-cloak @click.self="isChunkModalOpen = false">
                <div class="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" @click.stop>
                    <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                                <i class="fas fa-layer-group"></i>
                            </div>
                            <div>
                                <h3 class="font-semibold text-gray-900" x-text="chunkDoc.name || '知识库切片'"></h3>
                                <p class="text-xs text-gray-500">
                                    <span x-text="'共 ' + chunks.length + ' 个切片'"></span>
                                    <span x-show="chunkDoc.embeddingStatus"> · </span>
                                    <span x-show="chunkDoc.embeddingStatus" x-text="'向量状态：' + formatEmbeddingStatus(chunkDoc.embeddingStatus)"></span>
                                </p>
                            </div>
                        </div>
                        <button @click="isChunkModalOpen = false" class="text-gray-400 hover:text-gray-600">
                            <i class="fas fa-times text-lg"></i>
                        </button>
                    </div>
                    <div class="flex-1 overflow-y-auto p-6 bg-gray-50">
                        <div class="space-y-3">
                            <template x-for="chunk in chunks" :key="chunk.id">
                                <div class="bg-white border border-gray-200 rounded-lg p-4">
                                    <div class="flex items-center justify-between gap-4 mb-2">
                                        <div class="flex items-center gap-2 min-w-0">
                                            <span class="inline-flex items-center justify-center w-7 h-7 rounded bg-indigo-50 text-indigo-700 text-xs font-semibold" x-text="chunk.chunk_index + 1"></span>
                                            <div class="min-w-0">
                                                <div class="text-sm font-medium text-gray-900 truncate" x-text="chunk.heading || '语义片段'"></div>
                                                <div class="text-xs text-gray-500">
                                                    <span x-text="(chunk.char_count || 0) + ' 字符'"></span>
                                                    <span> · </span>
                                                    <span x-text="'约 ' + (chunk.token_estimate || 0) + ' tokens'"></span>
                                                </div>
                                            </div>
                                        </div>
                                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border" :class="chunk.has_embedding ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-500 border-gray-100'" x-text="chunk.has_embedding ? '已向量化' : '未向量化'"></span>
                                    </div>
                                    <p class="text-sm text-gray-700 leading-6 whitespace-pre-wrap" x-text="chunk.preview"></p>
                                </div>
                            </template>
                            <div x-show="chunks.length === 0" class="py-14 text-center text-gray-400">
                                <i class="fas fa-layer-group text-4xl mb-3"></i>
                                <p>暂无切片，请先执行重新切片</p>
                            </div>
                        </div>
                    </div>
                    <div class="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-white">
                        <div class="text-xs text-gray-500">切片会用于前台问答和学习模式的知识库检索。</div>
                        <div class="flex gap-3">
                            <button @click="chunkFile(chunkDoc.id)" class="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100">
                                <i class="fas fa-layer-group mr-2"></i>重新切片
                            </button>
                            <button @click="embedFile(chunkDoc.id)" class="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100">
                                <i class="fas fa-vector-square mr-2"></i>向量化
                            </button>
                            <button @click="isChunkModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">关闭</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 对话日志 -->
            <div x-show="currentTab === 'logs'" class="fade-enter" x-cloak>
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div class="px-6 py-4 border-b border-gray-100 bg-white">
                        <!-- 筛选区域 -->
                        <div class="flex flex-wrap gap-4 items-center mb-4">
                            <select x-model="logFilter" @change="loadLogs()" class="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                                <option value="">所有模式</option>
                                <option value="qa">QA 问答</option>
                                <option value="learn">学习模式</option>
                            </select>

                            <div class="flex items-center gap-2">
                                <label class="text-sm text-gray-600">开始日期:</label>
                                <input type="date" x-model="logStartDate" @change="loadLogs()" class="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                            </div>

                            <div class="flex items-center gap-2">
                                <label class="text-sm text-gray-600">结束日期:</label>
                                <input type="date" x-model="logEndDate" @change="loadLogs()" class="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                            </div>

                            <button @click="clearDateFilter()" class="text-gray-400 hover:text-gray-600 text-sm">
                                <i class="fas fa-times mr-1"></i>清除日期
                            </button>
                        </div>

                        <!-- 导出按钮区域 -->
                        <div class="flex gap-2 items-center">
                            <div class="flex-1"></div>
                            <?php if ($isSuperAdmin): ?>
                            <button
                                x-show="isSuperAdmin"
                                x-cloak
                                @click="clearAllLogs()"
                                :disabled="isClearingLogs"
                                class="inline-flex items-center gap-2 px-4 py-2 border border-red-200 bg-white text-red-600 rounded-lg hover:bg-red-50 hover:border-red-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                                title="慎用：清空所有前台用户的对话日志和公开分享页">
                                <i class="fas" :class="isClearingLogs ? 'fa-spinner animate-spin' : 'fa-trash-alt'"></i>
                                <span x-text="isClearingLogs ? '清空中...' : '清空对话日志'"></span>
                            </button>
                            <?php endif; ?>
                            <div class="relative" x-data="{ exportOpen: false }">
                                <button @click="exportOpen = !exportOpen" class="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium">
                                    <i class="fas fa-download"></i>
                                    导出数据
                                    <i class="fas fa-chevron-down text-xs"></i>
                                </button>

                                <div x-show="exportOpen" @click.away="exportOpen = false" x-transition class="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                                    <button @click="exportLogs('csv'); exportOpen = false" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                        <i class="fas fa-file-csv text-green-500"></i>
                                        导出为 CSV
                                    </button>
                                    <button @click="exportLogs('markdown'); exportOpen = false" class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                        <i class="fab fa-markdown text-blue-500"></i>
                                        导出为 Markdown
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <table class="w-full text-left text-sm">
                        <thead class="bg-gray-50 text-xs uppercase font-semibold text-gray-500 border-b border-gray-200">
                            <tr>
                                <th class="px-6 py-3">时间</th>
                                <th class="px-6 py-3">用户</th>
                                <th class="px-6 py-3">公司简称</th>
                                <th class="px-6 py-3">问题摘要</th>
                                <th class="px-6 py-3 text-center">模式</th>
                                <th class="px-6 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            <template x-for="log in logs" :key="log.id">
                                <tr class="hover:bg-gray-50/80 transition-colors cursor-pointer" @click="openLogDrawer(log)">
                                    <td class="px-6 py-4 text-gray-500 font-mono text-xs whitespace-nowrap" x-text="log.datetime"></td>
                                    <td class="px-6 py-4">
                                        <div class="flex items-center">
                                            <div class="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center mr-2" x-text="log.userInitials"></div>
                                            <span class="text-gray-900 font-medium" x-text="log.userName"></span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <span class="text-gray-600 text-sm" x-text="log.userCompany || '-'"></span>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="text-gray-700 truncate max-w-xs" x-text="log.query"></div>
                                    </td>
                                    <td class="px-6 py-4 text-center">
                                        <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border" :class="log.mode === 'learn' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'" x-text="log.mode === 'learn' ? '学习' : '问答'"></span>
                                    </td>
                                    <td class="px-6 py-4 text-right">
                                        <i class="fas fa-chevron-right text-gray-300"></i>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                    <!-- 分页控件 -->
                    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                        <div class="text-sm text-gray-500">
                            共 <span class="font-medium text-gray-900" x-text="logTotal"></span> 条记录，
                            第 <span class="font-medium text-gray-900" x-text="logPage"></span> / <span x-text="logTotalPages"></span> 页
                        </div>
                        <div class="flex items-center gap-2">
                            <button @click="goToLogPage(1)" :disabled="logPage === 1" class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                <i class="fas fa-angle-double-left"></i>
                            </button>
                            <button @click="goToLogPage(logPage - 1)" :disabled="logPage === 1" class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                <i class="fas fa-angle-left"></i> 上一页
                            </button>
                            <span class="px-3 py-1.5 text-sm text-gray-600">
                                <input type="number" x-model.number="logPage" @change="goToLogPage(logPage)" min="1" :max="logTotalPages" class="w-16 text-center border border-gray-200 rounded-lg py-1 px-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                            </span>
                            <button @click="goToLogPage(logPage + 1)" :disabled="logPage >= logTotalPages" class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                下一页 <i class="fas fa-angle-right"></i>
                            </button>
                            <button @click="goToLogPage(logTotalPages)" :disabled="logPage >= logTotalPages" class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                <i class="fas fa-angle-double-right"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 探索建议管理 -->
            <div x-show="currentTab === 'suggestions'" class="fade-enter" x-cloak>
                <div class="space-y-5">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-5 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                        <i class="fas fa-compass text-sm"></i>
                                    </span>
                                    <h3 class="font-semibold text-gray-900">探索建议模板</h3>
                                </div>
                                <p class="text-sm text-gray-500 mt-2">选择一个场景后，前台右侧栏的热搜榜和技能提升推荐会整体切换。</p>
                            </div>
                            <button @click="applySuggestionTemplate()" :disabled="isApplyingSuggestionTemplate || !selectedSuggestionScenarioSlug" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                <i class="fas mr-2" :class="isApplyingSuggestionTemplate ? 'fa-spinner fa-spin' : 'fa-check'"></i>
                                <span x-text="isApplyingSuggestionTemplate ? '应用中...' : (selectedSuggestionScenarioSlug === activeSuggestionScenarioSlug ? '重新应用模板' : '应用所选模板')"></span>
                            </button>
                        </div>

                        <div class="px-6 py-5 bg-slate-50 border-b border-gray-100">
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                                <template x-for="scenario in suggestionScenarios" :key="scenario.slug">
                                    <button @click="selectedSuggestionScenarioSlug = scenario.slug" class="text-left rounded-xl border bg-white p-4 transition hover:border-blue-200 hover:shadow-sm" :class="selectedSuggestionScenarioSlug === scenario.slug ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'">
                                        <div class="flex items-start justify-between gap-3">
                                            <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg border" :class="scenario.color_class">
                                                <i :class="scenario.icon || 'fas fa-layer-group'"></i>
                                            </span>
                                            <span x-show="Number(scenario.is_active) === 1" class="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">当前</span>
                                        </div>
                                        <div class="mt-3">
                                            <h4 class="text-sm font-semibold text-gray-900" x-text="scenario.name"></h4>
                                            <p class="text-xs text-gray-500 mt-1 leading-5 line-clamp-2" x-text="scenario.description"></p>
                                        </div>
                                        <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                            <span class="rounded-full bg-white border border-gray-200 px-2 py-0.5">
                                                热搜 <span x-text="scenario.hot_search_count || 0"></span>
                                            </span>
                                            <span class="rounded-full bg-white border border-gray-200 px-2 py-0.5">
                                                技能 <span x-text="scenario.skill_learning_count || 0"></span>
                                            </span>
                                        </div>
                                    </button>
                                </template>
                            </div>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <div>
                                <h3 class="font-medium text-gray-900">当前前台建议</h3>
                                <p class="text-sm text-gray-500 mt-1">
                                    当前模板：<span class="font-medium text-gray-700" x-text="activeSuggestionScenarioName"></span>，应用模板后可继续手工微调单条建议。
                                </p>
                            </div>
                            <button @click="openSuggestionModal()" class="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
                                <i class="fas fa-plus mr-2"></i>添加建议
                            </button>
                        </div>

                        <!-- 标签页 -->
                        <div class="border-b border-gray-100">
                            <nav class="flex space-x-8 px-6">
                                <button @click="suggestionTab = 'hot_search'" :class="suggestionTab === 'hot_search' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition">
                                    <i class="fas fa-fire mr-2"></i>热搜榜
                                </button>
                                <button @click="suggestionTab = 'skill_learning'" :class="suggestionTab === 'skill_learning' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'" class="whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition">
                                    <i class="fas fa-graduation-cap mr-2"></i>技能提升
                                </button>
                            </nav>
                        </div>

                        <!-- 建议列表 -->
                        <div class="divide-y divide-gray-100">
                            <template x-for="(suggestion, index) in filteredSuggestions" :key="suggestion.id">
                                <div class="px-6 py-4 hover:bg-gray-50 transition">
                                    <div class="flex items-center justify-between gap-4">
                                        <div class="flex items-center space-x-4 flex-1 min-w-0">
                                            <div class="flex-shrink-0">
                                                <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 border border-gray-100">
                                                    <i :class="suggestion.icon || 'fas fa-star'" class="text-base text-gray-500"></i>
                                                </span>
                                            </div>
                                            <div class="flex-1 min-w-0">
                                                <div class="flex items-center gap-2">
                                                    <h4 class="text-sm font-medium text-gray-900 truncate" x-text="suggestion.title"></h4>
                                                    <span class="text-xs text-gray-500" x-text="'#' + suggestion.sort_order"></span>
                                                </div>
                                                <p class="text-sm text-gray-500 truncate mt-1" x-text="suggestion.subtitle"></p>
                                                <p class="text-xs text-gray-400 truncate mt-1" x-text="suggestion.content"></p>
                                            </div>
                                        </div>
                                        <div class="flex items-center space-x-2">
                                            <button @click="editSuggestion(suggestion)" class="h-9 w-9 rounded-lg text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition" title="编辑">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                            <button @click="deleteSuggestion(suggestion.id)" class="h-9 w-9 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition" title="删除">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </template>

                            <!-- 空状态 -->
                            <template x-if="filteredSuggestions.length === 0">
                                <div class="px-6 py-12 text-center">
                                    <i class="fas fa-compass text-4xl text-gray-300 mb-4"></i>
                                    <h3 class="text-sm font-medium text-gray-900 mb-2">暂无建议</h3>
                                    <p class="text-sm text-gray-500">点击上方“添加建议”按钮创建第一个建议</p>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Prompt设置 -->
            <div x-show="currentTab === 'prompts'" class="fade-enter" x-cloak>
                <div class="space-y-5">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-5 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                        <i class="fas fa-layer-group text-sm"></i>
                                    </span>
                                    <h3 class="font-semibold text-gray-900">应用场景配置</h3>
                                </div>
                                <p class="text-sm text-gray-500 mt-2">选择一个应用场景后，问答、学习、大纲和评估等细分 Prompt 会整体切换。</p>
                            </div>
                            <button @click="applyPromptScenario()" :disabled="isApplyingPromptScenario || !selectedPromptScenarioSlug || selectedPromptScenarioSlug === activePromptScenarioSlug" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                                <i class="fas mr-2" :class="isApplyingPromptScenario ? 'fa-spinner fa-spin' : 'fa-check'"></i>
                                <span x-text="isApplyingPromptScenario ? '应用中...' : '应用所选场景'"></span>
                            </button>
                        </div>

                        <div class="px-6 py-5 bg-slate-50 border-b border-gray-100">
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                                <template x-for="scenario in promptScenarios" :key="scenario.slug">
                                    <button @click="selectedPromptScenarioSlug = scenario.slug" class="text-left rounded-xl border bg-white p-4 transition hover:border-blue-200 hover:shadow-sm" :class="selectedPromptScenarioSlug === scenario.slug ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'">
                                        <div class="flex items-start justify-between gap-3">
                                            <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg border" :class="scenario.color_class">
                                                <i :class="scenario.icon || 'fas fa-layer-group'"></i>
                                            </span>
                                            <span x-show="scenario.is_active == 1" class="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">当前</span>
                                        </div>
                                        <div class="mt-3 text-sm font-semibold text-gray-900" x-text="scenario.name"></div>
                                        <p class="mt-1 line-clamp-3 text-xs leading-5 text-gray-500" x-text="scenario.description"></p>
                                        <p class="mt-3 text-[11px] text-gray-400"><span x-text="scenario.template_count || 0"></span> 个细分 Prompt</p>
                                    </button>
                                </template>
                            </div>
                            <div class="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                <i class="fas fa-info-circle mr-2"></i>
                                通用助手场景适用于任何行业；销售、学习方法、客服和知识库专家会让全部细分提示词跟随对应角色定位变化。
                            </div>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div>
                                <h3 class="font-medium text-gray-900">细分 Prompt 配置</h3>
                                <p class="text-sm text-gray-500 mt-1">当前场景：<span class="font-medium text-gray-700" x-text="activePromptScenarioName"></span>。也可以单独编辑某个细分 Prompt。</p>
                            </div>
                        </div>
                        <div class="divide-y divide-gray-100">
                            <template x-for="prompt in prompts" :key="prompt.id">
                                <div class="px-6 py-4 hover:bg-gray-50 transition">
                                    <div class="flex items-center justify-between">
                                        <div class="flex-1">
                                            <div class="flex items-center gap-3">
                                                <span class="text-sm font-medium text-gray-900" x-text="prompt.name"></span>
                                                <span :class="prompt.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" x-text="prompt.is_active ? '启用' : '禁用'"></span>
                                            </div>
                                            <p class="text-sm text-gray-500 mt-1" x-text="prompt.description"></p>
                                            <p class="text-xs text-gray-400 mt-2">最后更新: <span x-text="prompt.updated_at"></span></p>
                                        </div>
                                        <button @click="editPrompt(prompt)" class="ml-4 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                            <i class="fas fa-edit mr-2"></i>编辑
                                        </button>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            </div>

            <!-- API配置 -->
            <div x-show="currentTab === 'api_config'" class="fade-enter" x-cloak>
                <div class="space-y-5">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-5 border-b border-gray-100 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                                        <i class="fas fa-sliders text-sm"></i>
                                    </span>
                                    <h3 class="font-semibold text-gray-900">通用模型 API</h3>
                                </div>
                                <p class="text-sm text-gray-500 mt-2">用于前台对话、后台测试和多线路故障转移，支持通用 OpenAI 兼容接口与 Anthropic Messages。</p>
                            </div>
                            <button @click="openAPIConfigModal('chat_completions')" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition">
                                <i class="fas fa-plus mr-2"></i>添加通用 API
                            </button>
                        </div>

                        <div class="px-6 py-5 bg-slate-50 border-b border-gray-100">
                            <div class="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-4 xl:items-end">
                                <div>
                                    <div class="flex items-center justify-between gap-3 mb-3">
                                        <label class="block text-sm font-semibold text-gray-900">通用调用策略</label>
                                        <span class="text-xs text-gray-500">仅作用于通用模型 API，不影响向量化接口。</span>
                                    </div>
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <label class="flex items-start gap-3 p-3 bg-white border rounded-lg cursor-pointer transition" :class="apiStrategy === 'failover' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'">
                                            <input type="radio" value="failover" x-model="apiStrategy" class="mt-1">
                                            <span>
                                                <span class="block text-sm font-semibold text-gray-900">优先级故障转移</span>
                                                <span class="block text-xs text-gray-500 mt-1">按优先级顺序调用，失败后切到下一条。</span>
                                            </span>
                                        </label>
                                        <label class="flex items-start gap-3 p-3 bg-white border rounded-lg cursor-pointer transition" :class="apiStrategy === 'round_robin' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'">
                                            <input type="radio" value="round_robin" x-model="apiStrategy" class="mt-1">
                                            <span>
                                                <span class="block text-sm font-semibold text-gray-900">轮询</span>
                                                <span class="block text-xs text-gray-500 mt-1">每次从下一条启用 API 开始尝试。</span>
                                            </span>
                                        </label>
                                        <label class="flex items-start gap-3 p-3 bg-white border rounded-lg cursor-pointer transition" :class="apiStrategy === 'random' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-200 hover:border-gray-300'">
                                            <input type="radio" value="random" x-model="apiStrategy" class="mt-1">
                                            <span>
                                                <span class="block text-sm font-semibold text-gray-900">随机</span>
                                                <span class="block text-xs text-gray-500 mt-1">每次随机排列启用 API 并逐个尝试。</span>
                                            </span>
                                        </label>
                                    </div>
                                </div>
                                <button @click="saveAPIStrategy()" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                    <i class="fas fa-save mr-2"></i>保存策略
                                </button>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-left">
                                <thead class="bg-white text-xs uppercase font-semibold text-gray-500 border-b border-gray-100">
                                    <tr>
                                        <th class="px-6 py-4">API</th>
                                        <th class="px-6 py-4">类型</th>
                                        <th class="px-6 py-4">模型</th>
                                        <th class="px-6 py-4">状态</th>
                                        <th class="px-6 py-4">优先级</th>
                                        <th class="px-6 py-4">测试结果</th>
                                        <th class="px-6 py-4 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100 text-sm">
                                    <template x-for="api in chatAPIConfigs" :key="api.id">
                                        <tr class="hover:bg-gray-50 transition">
                                            <td class="px-6 py-4 min-w-[280px]">
                                                <div class="font-medium text-gray-900" x-text="api.name"></div>
                                                <div class="text-xs text-gray-500 mt-1 truncate max-w-md" x-text="api.api_url"></div>
                                            </td>
                                            <td class="px-6 py-4">
                                                <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="apiTypeBadgeClass(api.api_type)" x-text="formatAPIType(api.api_type)"></span>
                                            </td>
                                            <td class="px-6 py-4 text-gray-700 font-mono text-xs" x-text="api.model"></td>
                                            <td class="px-6 py-4">
                                                <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="api.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'" x-text="api.status === 'active' ? '启用' : '停用'"></span>
                                            </td>
                                            <td class="px-6 py-4 text-gray-600" x-text="api.priority"></td>
                                            <td class="px-6 py-4 min-w-[220px]">
                                                <div class="flex items-center gap-2">
                                                    <span class="w-2 h-2 rounded-full" :class="api.last_test_status === 'success' ? 'bg-green-500' : (api.last_test_status === 'failed' ? 'bg-red-500' : 'bg-gray-300')"></span>
                                                    <span class="text-xs text-gray-700" x-text="formatAPITest(api)"></span>
                                                </div>
                                                <div class="text-xs text-gray-400 mt-1 truncate max-w-xs" x-text="api.last_test_message || '尚未测试'"></div>
                                            </td>
                                            <td class="px-6 py-4 text-right whitespace-nowrap">
                                                <button @click="testAPIConfig(api)" class="text-gray-400 hover:text-emerald-600 mr-3" title="测试连通">
                                                    <i class="fas" :class="testingAPIId === api.id ? 'fa-spinner fa-spin' : 'fa-vial'"></i>
                                                </button>
                                                <button @click="editAPIConfig(api)" class="text-gray-400 hover:text-indigo-600 mr-3" title="编辑"><i class="fas fa-edit"></i></button>
                                                <button @click="deleteAPIConfig(api)" class="text-gray-400 hover:text-red-500" title="删除"><i class="fas fa-trash-alt"></i></button>
                                            </td>
                                        </tr>
                                    </template>
                                    <template x-if="chatAPIConfigs.length === 0">
                                        <tr>
                                            <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                                                <i class="fas fa-plug text-3xl text-gray-300 mb-3"></i>
                                                <p class="text-sm font-medium">暂无通用模型 API</p>
                                                <p class="text-xs text-gray-400 mt-1">添加一个 OpenAI 兼容接口后即可用于前台对话。</p>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-5 border-b border-gray-100 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                                        <i class="fas fa-fingerprint text-sm"></i>
                                    </span>
                                    <h3 class="font-semibold text-gray-900">向量化模型 API</h3>
                                </div>
                                <p class="text-sm text-gray-500 mt-2">用于知识库语义切片、Embedding 生成和语义检索，不参与前台对话模型轮换。</p>
                            </div>
                            <button @click="openAPIConfigModal('embeddings')" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition">
                                <i class="fas fa-plus mr-2"></i>添加向量化 API
                            </button>
                        </div>

                        <div class="px-6 py-4 bg-emerald-50/60 border-b border-emerald-100">
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                <div>
                                    <div class="font-semibold text-emerald-900">调用方式</div>
                                    <p class="text-emerald-700 mt-1">默认按优先级选择启用的第一个向量化接口。</p>
                                </div>
                                <div>
                                    <div class="font-semibold text-emerald-900">推荐接口</div>
                                    <p class="text-emerald-700 mt-1">OpenAI 兼容 Embeddings，例如 `/v1/embeddings`。</p>
                                </div>
                                <div>
                                    <div class="font-semibold text-emerald-900">生效位置</div>
                                    <p class="text-emerald-700 mt-1">知识库文档点击“向量化”后生成语义检索向量。</p>
                                </div>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-left">
                                <thead class="bg-white text-xs uppercase font-semibold text-gray-500 border-b border-gray-100">
                                    <tr>
                                        <th class="px-6 py-4">API</th>
                                        <th class="px-6 py-4">类型</th>
                                        <th class="px-6 py-4">模型</th>
                                        <th class="px-6 py-4">状态</th>
                                        <th class="px-6 py-4">优先级</th>
                                        <th class="px-6 py-4">测试结果</th>
                                        <th class="px-6 py-4 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-100 text-sm">
                                    <template x-for="api in embeddingAPIConfigs" :key="api.id">
                                        <tr class="hover:bg-gray-50 transition">
                                            <td class="px-6 py-4 min-w-[280px]">
                                                <div class="font-medium text-gray-900" x-text="api.name"></div>
                                                <div class="text-xs text-gray-500 mt-1 truncate max-w-md" x-text="api.api_url"></div>
                                            </td>
                                            <td class="px-6 py-4">
                                                <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="apiTypeBadgeClass(api.api_type)" x-text="formatAPIType(api.api_type)"></span>
                                            </td>
                                            <td class="px-6 py-4 text-gray-700 font-mono text-xs" x-text="api.model"></td>
                                            <td class="px-6 py-4">
                                                <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="api.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'" x-text="api.status === 'active' ? '启用' : '停用'"></span>
                                            </td>
                                            <td class="px-6 py-4 text-gray-600" x-text="api.priority"></td>
                                            <td class="px-6 py-4 min-w-[220px]">
                                                <div class="flex items-center gap-2">
                                                    <span class="w-2 h-2 rounded-full" :class="api.last_test_status === 'success' ? 'bg-green-500' : (api.last_test_status === 'failed' ? 'bg-red-500' : 'bg-gray-300')"></span>
                                                    <span class="text-xs text-gray-700" x-text="formatAPITest(api)"></span>
                                                </div>
                                                <div class="text-xs text-gray-400 mt-1 truncate max-w-xs" x-text="api.last_test_message || '尚未测试'"></div>
                                            </td>
                                            <td class="px-6 py-4 text-right whitespace-nowrap">
                                                <button @click="testAPIConfig(api)" class="text-gray-400 hover:text-emerald-600 mr-3" title="测试连通">
                                                    <i class="fas" :class="testingAPIId === api.id ? 'fa-spinner fa-spin' : 'fa-vial'"></i>
                                                </button>
                                                <button @click="editAPIConfig(api)" class="text-gray-400 hover:text-indigo-600 mr-3" title="编辑"><i class="fas fa-edit"></i></button>
                                                <button @click="deleteAPIConfig(api)" class="text-gray-400 hover:text-red-500" title="删除"><i class="fas fa-trash-alt"></i></button>
                                            </td>
                                        </tr>
                                    </template>
                                    <template x-if="embeddingAPIConfigs.length === 0">
                                        <tr>
                                            <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                                                <i class="fas fa-fingerprint text-3xl text-emerald-200 mb-3"></i>
                                                <p class="text-sm font-medium">暂无向量化模型 API</p>
                                                <p class="text-xs text-gray-400 mt-1">配置后可在知识库中生成 Embeddings，提升语义召回能力。</p>
                                            </td>
                                        </tr>
                                    </template>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <!-- API统计 -->
            <div x-show="currentTab === 'api_stats'" class="fade-enter" x-cloak>
                <div class="space-y-6">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-5 border-b border-gray-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                                        <i class="fas fa-chart-line text-sm"></i>
                                    </span>
                                    <h3 class="font-semibold text-gray-900">API 性能统计</h3>
                                </div>
                                <p class="text-sm text-gray-500 mt-2">监控通用模型 API 的调用量、成功率和响应时间，平均响应只统计成功调用。</p>
                            </div>
                            <button @click="loadAPIStats()" :disabled="apiStats.isLoading" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition">
                                <i class="fas mr-2" :class="apiStats.isLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right'"></i>
                                <span x-text="apiStats.isLoading ? '刷新中...' : '刷新数据'"></span>
                            </button>
                        </div>

                        <div x-show="apiStats.error" class="mx-6 mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" x-text="apiStats.error"></div>

                        <div class="p-6">
                            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <div class="text-xs font-semibold text-gray-500">24 小时调用</div>
                                    <div class="mt-3 text-3xl font-bold text-gray-900 tabular-nums" x-text="apiStats.overview.total_24h"></div>
                                    <div class="mt-2 text-xs text-gray-500">成功 <span x-text="apiStats.overview.success_24h"></span>，失败 <span x-text="apiStats.overview.failed_24h"></span></div>
                                </div>
                                <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <div class="text-xs font-semibold text-gray-500">24 小时成功率</div>
                                    <div class="mt-3 text-3xl font-bold text-gray-900 tabular-nums" x-text="apiStats.overview.success_rate_24h"></div>
                                    <div class="mt-2 text-xs text-gray-500">低于 95% 会标记需关注</div>
                                </div>
                                <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <div class="text-xs font-semibold text-gray-500">平均响应</div>
                                    <div class="mt-3 text-3xl font-bold text-gray-900 tabular-nums" x-text="apiStats.overview.avg_24h"></div>
                                    <div class="mt-2 text-xs text-gray-500">P95 <span x-text="apiStats.overview.p95_24h"></span></div>
                                </div>
                                <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <div class="text-xs font-semibold text-gray-500">活跃线路</div>
                                    <div class="mt-3 text-3xl font-bold text-gray-900 tabular-nums" x-text="apiStats.overview.active_routes"></div>
                                    <div class="mt-2 text-xs text-gray-500">已启用 <span x-text="apiStats.overview.enabled_apis"></span> 条 API</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div class="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
                                <div>
                                    <h3 class="font-semibold text-gray-900">最近 24 小时</h3>
                                    <p class="text-sm text-gray-500 mt-1">按 API 线路拆分，优先关注异常和慢响应。</p>
                                </div>
                            </div>
                            <div class="p-6">
                                <template x-if="apiStats.isLoading && apiStats.items_24h.length === 0">
                                    <div class="py-14 text-center text-gray-400">
                                        <i class="fas fa-spinner fa-spin text-2xl mb-3"></i>
                                        <p class="text-sm">正在加载统计数据...</p>
                                    </div>
                                </template>
                                <template x-if="!apiStats.isLoading && apiStats.items_24h.length === 0">
                                    <div class="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center text-gray-500">
                                        <i class="fas fa-chart-line text-3xl text-gray-300 mb-3"></i>
                                        <p class="text-sm font-medium text-gray-700">暂无 24 小时调用数据</p>
                                        <p class="text-xs text-gray-400 mt-1">开始对话或在后台测试 API 后会自动记录。</p>
                                    </div>
                                </template>
                                <div x-show="apiStats.items_24h.length > 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <template x-for="item in apiStats.items_24h" :key="item.name">
                                        <article class="rounded-xl border border-gray-200 bg-white p-4">
                                            <div class="flex items-start justify-between gap-3 mb-4">
                                                <div class="min-w-0">
                                                    <h4 class="truncate text-base font-semibold text-gray-900" x-text="item.name" :title="item.name"></h4>
                                                    <p class="mt-1 text-xs text-gray-400">最近调用 <span x-text="item.latest_at_text"></span></p>
                                                </div>
                                                <span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap" :class="apiStatsStatusClass(item.status)">
                                                    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                                                    <span x-text="item.status_text"></span>
                                                </span>
                                            </div>
                                            <div class="grid grid-cols-2 gap-3">
                                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                                    <div class="text-xs font-medium text-gray-400">总调用</div>
                                                    <div class="mt-1 text-lg font-semibold text-gray-900 tabular-nums" x-text="item.total"></div>
                                                </div>
                                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                                    <div class="text-xs font-medium text-gray-400">成功率</div>
                                                    <div class="mt-1 text-lg font-semibold text-gray-900 tabular-nums" x-text="item.success_rate_text"></div>
                                                </div>
                                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                                    <div class="text-xs font-medium text-gray-400">平均响应</div>
                                                    <div class="mt-1 text-lg font-semibold text-gray-900 tabular-nums" x-text="item.avg_text"></div>
                                                </div>
                                                <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
                                                    <div class="text-xs font-medium text-gray-400">P95 响应</div>
                                                    <div class="mt-1 text-lg font-semibold text-gray-900 tabular-nums" x-text="item.p95_text"></div>
                                                </div>
                                            </div>
                                            <div class="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                                                <div class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-blue-600" :style="`width: ${item.bar_width || 0}%`"></div>
                                            </div>
                                        </article>
                                    </template>
                                </div>
                            </div>
                        </div>

                        <aside class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div class="px-6 py-4 border-b border-gray-100">
                                <h3 class="font-semibold text-gray-900">当前状态</h3>
                                <p class="text-sm text-gray-500 mt-1">线路策略与最近调用状态。</p>
                            </div>
                            <div class="p-6 space-y-4">
                                <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                                    <span class="text-sm text-gray-500">整体状态</span>
                                    <span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" :class="apiStatsStatusClass(apiStats.status.value)">
                                        <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                                        <span x-text="apiStats.status.text"></span>
                                    </span>
                                </div>
                                <div class="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                                    <div class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                                        <span class="text-gray-500">调用策略</span>
                                        <strong class="text-right text-gray-900" x-text="apiStats.rotation_strategy"></strong>
                                    </div>
                                    <div class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                                        <span class="text-gray-500">最近调用</span>
                                        <strong class="text-right text-gray-900 tabular-nums" x-text="apiStats.overview.latest_call"></strong>
                                    </div>
                                    <div class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                                        <span class="text-gray-500">7 天总调用</span>
                                        <strong class="text-right text-gray-900 tabular-nums" x-text="apiStats.overview.total_7d"></strong>
                                    </div>
                                    <div class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                                        <span class="text-gray-500">刷新时间</span>
                                        <strong class="text-right text-gray-900 tabular-nums" x-text="apiStats.generated_at"></strong>
                                    </div>
                                </div>
                                <div>
                                    <h4 class="text-sm font-semibold text-gray-900 mb-3">启用 API</h4>
                                    <div class="space-y-2">
                                        <template x-for="api in apiStats.enabled_apis" :key="api.name + api.priority">
                                            <div class="rounded-lg border border-gray-200 px-3 py-2">
                                                <div class="flex items-center justify-between gap-3">
                                                    <span class="min-w-0 truncate text-sm font-medium text-gray-800" x-text="api.name"></span>
                                                    <span class="text-xs text-gray-400 tabular-nums" x-text="'#' + api.priority"></span>
                                                </div>
                                                <p class="mt-1 truncate font-mono text-xs text-gray-400" x-text="api.model"></p>
                                            </div>
                                        </template>
                                        <template x-if="apiStats.enabled_apis.length === 0">
                                            <p class="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-400">暂无启用 API</p>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </div>

                    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div class="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div class="px-6 py-4 border-b border-gray-100">
                                <h3 class="font-semibold text-gray-900">最近 7 天汇总</h3>
                                <p class="text-sm text-gray-500 mt-1">用于判断线路稳定性和长期延迟水平。</p>
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left">
                                    <thead class="bg-gray-50 text-xs uppercase font-semibold text-gray-500">
                                        <tr>
                                            <th class="px-6 py-4">API</th>
                                            <th class="px-6 py-4">状态</th>
                                            <th class="px-6 py-4">总调用</th>
                                            <th class="px-6 py-4">成功率</th>
                                            <th class="px-6 py-4">失败</th>
                                            <th class="px-6 py-4">平均响应</th>
                                            <th class="px-6 py-4">P95</th>
                                            <th class="px-6 py-4">响应范围</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-100 text-sm">
                                        <template x-for="item in apiStats.items_7d" :key="item.name">
                                            <tr class="hover:bg-gray-50">
                                                <td class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap" x-text="item.name"></td>
                                                <td class="px-6 py-4 whitespace-nowrap">
                                                    <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold" :class="apiStatsStatusClass(item.status)" x-text="item.status_text"></span>
                                                </td>
                                                <td class="px-6 py-4 text-gray-600 tabular-nums" x-text="item.total"></td>
                                                <td class="px-6 py-4 text-gray-600 tabular-nums" x-text="item.success_rate_text"></td>
                                                <td class="px-6 py-4 text-gray-600 tabular-nums" x-text="item.failed"></td>
                                                <td class="px-6 py-4 text-gray-600 tabular-nums" x-text="item.avg_text"></td>
                                                <td class="px-6 py-4 text-gray-600 tabular-nums" x-text="item.p95_text"></td>
                                                <td class="px-6 py-4 text-gray-600 whitespace-nowrap"><span x-text="item.min_text"></span> 至 <span x-text="item.max_text"></span></td>
                                            </tr>
                                        </template>
                                        <template x-if="apiStats.items_7d.length === 0">
                                            <tr>
                                                <td colspan="8" class="px-6 py-10 text-center text-sm text-gray-400">暂无 7 天统计数据</td>
                                            </tr>
                                        </template>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div class="px-6 py-4 border-b border-gray-100">
                                <h3 class="font-semibold text-gray-900">最近调用记录</h3>
                                <p class="text-sm text-gray-500 mt-1">用于排查刚刚发生的慢调用或失败调用。</p>
                            </div>
                            <div class="divide-y divide-gray-100">
                                <template x-for="row in apiStats.recent" :key="row.time + row.api_name + row.latency_text">
                                    <div class="px-6 py-4">
                                        <div class="flex items-start justify-between gap-3">
                                            <div class="min-w-0">
                                                <div class="truncate text-sm font-medium text-gray-900" x-text="row.api_name"></div>
                                                <div class="mt-1 text-xs text-gray-400 tabular-nums" x-text="row.time"></div>
                                            </div>
                                            <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold" :class="row.success ? 'border-green-100 bg-green-50 text-green-700' : 'border-red-100 bg-red-50 text-red-700'" x-text="row.result_text"></span>
                                        </div>
                                        <div class="mt-2 text-xs text-gray-500">响应时间 <span class="font-semibold tabular-nums text-gray-700" x-text="row.latency_text"></span></div>
                                    </div>
                                </template>
                                <template x-if="apiStats.recent.length === 0">
                                    <div class="px-6 py-10 text-center text-sm text-gray-400">暂无调用记录</div>
                                </template>
                            </div>
                        </div>
                    </div>

                    <p class="text-xs leading-6 text-gray-400">说明：成功率包含失败调用，平均响应、P95 和响应范围只统计成功调用。阈值：成功率低于 95%、平均响应或 P95 超过 30 秒会标记为需关注。</p>
                </div>
            </div>

            <!-- 网站设置 -->
            <div x-show="currentTab === 'settings'" class="fade-enter" x-cloak>
                <div class="space-y-6">
                    <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div class="px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h3 class="font-medium text-gray-900">网站设置</h3>
                                <p class="text-sm text-gray-500 mt-1">统一管理前台名称、登录页文案、后台名称和前台统计代码</p>
                            </div>
                            <button @click="saveSettings()" :disabled="isSettingsSaving" class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 transition">
                                <i class="fas fa-save mr-2"></i>
                                <span x-text="isSettingsSaving ? '保存中...' : '保存设置'"></span>
                            </button>
                        </div>

                        <div class="p-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <section class="space-y-4">
                                <div>
                                    <h4 class="text-sm font-semibold text-gray-900 flex items-center">
                                        <i class="fas fa-desktop text-indigo-500 mr-2"></i>前台展示
                                    </h4>
                                    <p class="text-xs text-gray-500 mt-1">控制已登录前台左上角名称、浏览器标题和版权说明。</p>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">前台左上角网站名称</label>
                                    <input type="text" x-model="siteSettings.frontend_site_name" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" placeholder="例如：TokChat">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">前台浏览器标题</label>
                                    <input type="text" x-model="siteSettings.frontend_page_title" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" placeholder="例如：TokChat">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">版权说明</label>
                                    <textarea x-model="siteSettings.copyright_text" rows="3" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" placeholder="例如：© 2026 TokChat. 保留所有权利。"></textarea>
                                </div>
                            </section>

                            <section class="space-y-4">
                                <div>
                                    <h4 class="text-sm font-semibold text-gray-900 flex items-center">
                                        <i class="fas fa-right-to-bracket text-blue-500 mr-2"></i>登录页
                                    </h4>
                                    <p class="text-xs text-gray-500 mt-1">控制前台手机号登录页的主标题和副说明。</p>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">登录页面名称</label>
                                    <input type="text" x-model="siteSettings.login_page_title" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="例如：TokChat">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">登录页面说明</label>
                                    <input type="text" x-model="siteSettings.login_page_description" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm" placeholder="例如：输入手机号快速登录 TokChat">
                                </div>
                            </section>

                            <section class="space-y-4">
                                <div>
                                    <h4 class="text-sm font-semibold text-gray-900 flex items-center">
                                        <i class="fas fa-shield-halved text-red-500 mr-2"></i>后台展示
                                    </h4>
                                    <p class="text-xs text-gray-500 mt-1">控制后台侧边栏名称、后台浏览器标题和后台登录页说明。</p>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">后台名称</label>
                                    <input type="text" x-model="siteSettings.admin_site_name" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500 text-sm" placeholder="例如：TokChat Admin">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">后台浏览器标题</label>
                                    <input type="text" x-model="siteSettings.admin_page_title" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500 text-sm" placeholder="例如：TokChat 管理后台">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">后台登录页名称</label>
                                    <input type="text" x-model="siteSettings.admin_login_title" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500 text-sm" placeholder="例如：TokChat 管理后台">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">后台登录页说明</label>
                                    <input type="text" x-model="siteSettings.admin_login_description" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-red-500 focus:border-red-500 text-sm" placeholder="例如：TokChat 管理员专用登录入口">
                                </div>
                            </section>

                            <section class="space-y-4">
                                <div>
                                    <h4 class="text-sm font-semibold text-gray-900 flex items-center">
                                        <i class="fas fa-chart-simple text-emerald-500 mr-2"></i>前台统计代码
                                    </h4>
                                    <p class="text-xs text-gray-500 mt-1">代码会输出到前台登录页和已登录聊天页，不会输出到后台页面。</p>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">统计代码</label>
                                    <textarea x-model="siteSettings.frontend_analytics_code" rows="12" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 text-sm font-mono leading-relaxed" placeholder="粘贴统计平台提供的 <script>...</script> 代码"></textarea>
                                    <p class="text-xs text-amber-600 mt-2">
                                        <i class="fas fa-triangle-exclamation mr-1"></i>仅粘贴可信统计平台代码。保存后会在前台页面执行。
                                    </p>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    </main>

    <!-- 添加/编辑用户弹窗 -->
    <div x-show="isUserModalOpen" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="isUserModalOpen" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-30 backdrop-blur-sm" @click="isUserModalOpen = false"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="isUserModalOpen" x-transition.scale class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform sm:my-8 sm:align-middle sm:max-w-lg w-full">
                <div class="bg-white px-6 pt-5 pb-4">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-indigo-100">
                            <i class="fas fa-user-plus text-indigo-600"></i>
                        </div>
                        <h3 class="text-lg font-medium text-gray-900" x-text="editingUser ? '编辑用户' : '添加新成员'"></h3>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700">姓名 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="userForm.name" placeholder="请输入姓名" class="mt-1 block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">公司简称 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="userForm.company" placeholder="请输入公司简称" class="mt-1 block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">手机号 <span class="text-red-500">*</span></label>
                            <input type="tel" x-model="userForm.phone" placeholder="请输入11位手机号" maxlength="11" class="mt-1 block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">邮箱 (选填)</label>
                            <input type="email" x-model="userForm.email" placeholder="email@example.com" class="mt-1 block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">角色权限</label>
                            <select x-model="userForm.role" class="mt-1 block w-full border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                                <option value="sales_rep">销售代表</option>
                                <option value="sales_manager">销售经理</option>
                                <option value="admin">系统管理员</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-6 py-3 flex justify-end gap-3 border-t border-gray-100">
                    <button @click="isUserModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                    <button @click="saveUser()" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">确认保存</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 添加/编辑管理员弹窗（仅超级管理员可见） -->
    <?php if ($isSuperAdmin): ?>
    <div x-show="isAdminModalOpen" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="isAdminModalOpen" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-30 backdrop-blur-sm" @click="isAdminModalOpen = false"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="isAdminModalOpen" x-transition.scale class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform sm:my-8 sm:align-middle sm:max-w-lg w-full">
                <div class="bg-white px-6 pt-5 pb-4">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-red-100">
                            <i class="fas fa-user-shield text-red-600"></i>
                        </div>
                        <h3 class="text-lg font-medium text-gray-900" x-text="editingAdmin ? '编辑管理员' : '添加管理员'"></h3>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">用户名 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="adminForm.username" :readonly="editingAdmin" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" :class="editingAdmin ? 'bg-gray-100' : ''" placeholder="登录用户名">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">密码 <span class="text-red-500" x-show="!editingAdmin">*</span></label>
                            <input type="password" x-model="adminForm.password" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" :placeholder="editingAdmin ? '留空表示不修改密码' : '设置登录密码'">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">姓名 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="adminForm.name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="管理员显示名称">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">角色</label>
                            <select x-model="adminForm.role" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                                <option value="admin">普通管理员</option>
                                <option value="super_admin">超级管理员</option>
                            </select>
                            <p class="text-xs text-gray-500 mt-1">超级管理员可管理其他管理员，普通管理员可管理用户、知识库、Prompt</p>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-6 py-3 flex justify-end gap-3 border-t border-gray-100">
                    <button @click="isAdminModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                    <button @click="saveAdmin()" class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">确认保存</button>
                </div>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <!-- 编辑探索建议弹窗 -->
    <div x-show="isSuggestionModalOpen" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="isSuggestionModalOpen" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-30 backdrop-blur-sm" @click="isSuggestionModalOpen = false"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="isSuggestionModalOpen" x-transition.scale class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform sm:my-8 sm:align-middle sm:max-w-2xl w-full">
                <div class="bg-white px-6 pt-5 pb-4">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-indigo-100">
                            <i class="fas fa-compass text-indigo-600"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-medium text-gray-900" x-text="editingSuggestion ? '编辑建议' : '添加建议'"></h3>
                            <p class="text-sm text-gray-500">配置前台探索建议内容</p>
                        </div>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">类型</label>
                            <select x-model="suggestionForm.type" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                                <option value="hot_search">🔥 销售热搜榜</option>
                                <option value="skill_learning">🎓 技能提升</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">标题</label>
                            <input type="text" x-model="suggestionForm.title" placeholder="如：GEO ROI 计算公式" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">副标题</label>
                            <input type="text" x-model="suggestionForm.subtitle" placeholder="如：如何向客户证明投资回报率？" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">内容</label>
                            <textarea x-model="suggestionForm.content" rows="3" placeholder="热搜榜：用户点击后填入的问题内容&#10;技能提升：学习主题名称" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"></textarea>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">图标</label>
                                <input type="text" x-model="suggestionForm.icon" placeholder="如：fas fa-calculator" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">排序</label>
                                <input type="number" x-model="suggestionForm.sort_order" min="1" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                            </div>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">颜色样式</label>
                            <input type="text" x-model="suggestionForm.color_class" placeholder="如：text-blue-700 或 from-blue-50 to-sky-50 border-blue-100 text-blue-600" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                            <p class="text-xs text-gray-500 mt-1">热搜榜使用简单颜色类，技能提升使用渐变背景类</p>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-6 py-3 flex justify-end gap-3 border-t border-gray-100">
                    <button @click="isSuggestionModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                    <button @click="saveSuggestion()" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">保存</button>
                </div>
            </div>
        </div>
    </div>

    <!-- API测试结果弹窗 -->
    <div x-show="isAPITestResultModalOpen" class="fixed inset-0 z-[70] flex items-center justify-center p-4" x-cloak>
        <div x-show="isAPITestResultModalOpen" x-transition.opacity class="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" @click="isAPITestResultModalOpen = false"></div>
        <div x-show="isAPITestResultModalOpen" x-transition.scale class="relative w-full max-w-2xl overflow-hidden rounded-xl bg-white text-left shadow-2xl ring-1 ring-slate-900/10">
            <div class="border-b border-slate-100 px-6 py-5">
                <div class="flex items-start justify-between gap-4">
                    <div class="flex items-start gap-3">
                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="apiTestResult.status === 'success' ? 'bg-emerald-50 text-emerald-600' : (apiTestResult.status === 'testing' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600')">
                            <i class="fas" :class="apiTestResult.status === 'testing' ? 'fa-spinner fa-spin' : (apiTestResult.status === 'success' ? 'fa-check' : 'fa-triangle-exclamation')"></i>
                        </div>
                        <div>
                            <h3 class="text-base font-semibold text-slate-950">API 连通测试</h3>
                            <p class="mt-1 text-sm text-slate-500" x-text="apiTestResult.name || '临时 API 配置'"></p>
                        </div>
                    </div>
                    <button @click="isAPITestResultModalOpen = false" class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="关闭">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>

            <div class="space-y-4 px-6 py-5">
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div class="text-xs font-medium text-slate-400">状态</div>
                        <div class="mt-1 text-sm font-semibold" :class="apiTestResult.status === 'success' ? 'text-emerald-700' : (apiTestResult.status === 'testing' ? 'text-blue-700' : 'text-red-700')" x-text="apiTestResult.statusText"></div>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div class="text-xs font-medium text-slate-400">耗时</div>
                        <div class="mt-1 text-sm font-semibold text-slate-800" x-text="apiTestResult.latencyText"></div>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div class="text-xs font-medium text-slate-400">类型</div>
                        <div class="mt-1 text-sm font-semibold text-slate-800" x-text="apiTestResult.type"></div>
                    </div>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                        <label class="mb-1 block text-xs font-medium text-slate-400">模型</label>
                        <div class="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700" x-text="apiTestResult.model || '-'"></div>
                    </div>
                    <div>
                        <label class="mb-1 block text-xs font-medium text-slate-400">测试时间</label>
                        <div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" x-text="apiTestResult.finishedAt || apiTestResult.startedAt || '-'"></div>
                    </div>
                    <div class="sm:col-span-2">
                        <label class="mb-1 block text-xs font-medium text-slate-400">API 地址</label>
                        <div class="break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-600" x-text="apiTestResult.apiUrl || '-'"></div>
                    </div>
                </div>

                <div>
                    <label class="mb-1 block text-xs font-medium text-slate-400">响应信息</label>
                    <div class="min-h-[44px] whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm leading-6" :class="apiTestResult.status === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : (apiTestResult.status === 'testing' ? 'border-blue-100 bg-blue-50 text-blue-800' : 'border-red-100 bg-red-50 text-red-800')" x-text="apiTestResult.message"></div>
                </div>

                <div>
                    <label class="mb-1 block text-xs font-medium text-slate-400">测试数据</label>
                    <textarea readonly rows="8" class="w-full resize-none rounded-lg border border-slate-200 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none" x-model="apiTestResult.raw"></textarea>
                </div>
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-3">
                <button @click="copyAPITestResult()" class="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                    <i class="fas fa-copy mr-2"></i>复制数据
                </button>
                <button @click="isAPITestResultModalOpen = false" class="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">
                    知道了
                </button>
            </div>
        </div>
    </div>

    <!-- 添加/编辑API配置弹窗 -->
    <div x-show="isAPIConfigModalOpen" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="isAPIConfigModalOpen" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-30 backdrop-blur-sm" @click="isAPIConfigModalOpen = false"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="isAPIConfigModalOpen" x-transition.scale class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform sm:my-8 sm:align-middle sm:max-w-3xl w-full">
                <div class="bg-white px-6 pt-5 pb-4">
                    <div class="flex items-center gap-3 mb-5">
                        <div class="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full" :class="isEmbeddingAPIForm() ? 'bg-emerald-100' : 'bg-indigo-100'">
                            <i class="fas" :class="isEmbeddingAPIForm() ? 'fa-fingerprint text-emerald-600' : 'fa-plug text-indigo-600'"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-medium text-gray-900" x-text="apiModalTitle()"></h3>
                            <p class="text-sm text-gray-500" x-text="apiModalDescription()"></p>
                        </div>
                    </div>

                    <div class="mb-5 rounded-lg border px-4 py-3 text-sm" :class="isEmbeddingAPIForm() ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-700'">
                        <div class="flex items-start gap-2">
                            <i class="fas mt-0.5" :class="isEmbeddingAPIForm() ? 'fa-circle-nodes text-emerald-600' : 'fa-route text-slate-500'"></i>
                            <p x-text="isEmbeddingAPIForm() ? '向量化 API 只用于知识库语义检索。配置后，到知识库文档中点击“向量化”即可生成 Embeddings。' : '通用 API 会参与前台对话调用，并受上方轮换策略控制。OpenAI 兼容接口优先选择 Chat Completions。'"></p>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">名称 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="apiForm.name" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" :placeholder="isEmbeddingAPIForm() ? '例如：向量化主线路' : '例如：OpenAI 主线路'">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">接口类型</label>
                            <select x-model="apiForm.api_type" @change="normalizeAPIFormForType()" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                                <option value="chat_completions">通用 OpenAI 兼容</option>
                                <option value="messages">Anthropic Messages</option>
                                <option value="embeddings">向量化 Embeddings</option>
                            </select>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-medium text-gray-700 mb-1">API 地址 <span class="text-red-500">*</span></label>
                            <input type="url" x-model="apiForm.api_url" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono" :placeholder="apiURLPlaceholder()">
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-medium text-gray-700 mb-1">API Key <span class="text-red-500" x-show="!editingAPIConfig">*</span></label>
                            <input type="password" x-model="apiForm.api_key" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono" :placeholder="editingAPIConfig ? '留空表示不修改已保存的 Key' : '请输入 API Key'">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">模型 <span class="text-red-500">*</span></label>
                            <input type="text" x-model="apiForm.model" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono" :placeholder="apiModelPlaceholder()">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">状态</label>
                            <select x-model="apiForm.status" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm">
                                <option value="active">启用</option>
                                <option value="inactive">停用</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">优先级</label>
                            <input type="number" x-model.number="apiForm.priority" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" min="1">
                            <p class="text-xs text-gray-500 mt-1" x-text="isEmbeddingAPIForm() ? '数值越小越优先，当前会选用最靠前的启用配置。' : '数值越小优先级越高，故障转移会按此顺序调用。'"></p>
                        </div>
                        <div x-show="!isEmbeddingAPIForm()">
                            <label class="block text-sm font-medium text-gray-700 mb-1">最大输出 Token</label>
                            <input type="number" x-model.number="apiForm.max_tokens" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" min="1" max="32000">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">总超时秒数</label>
                            <input type="number" x-model.number="apiForm.timeout_seconds" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" min="5" max="600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">连接超时秒数</label>
                            <input type="number" x-model.number="apiForm.connect_timeout_seconds" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" min="1" max="120">
                        </div>
                        <div x-show="!isEmbeddingAPIForm()">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Temperature</label>
                            <input type="number" x-model.number="apiForm.temperature" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm" min="0" max="2" step="0.1">
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-6 py-3 flex flex-col sm:flex-row sm:justify-between gap-3 border-t border-gray-100">
                    <button @click="testAPIConfig(apiForm)" class="px-4 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50">
                        <i class="fas mr-2" :class="testingAPIId === 'form' ? 'fa-spinner fa-spin' : 'fa-vial'"></i><span x-text="apiTestButtonLabel()"></span>
                    </button>
                    <div class="flex justify-end gap-3">
                        <button @click="isAPIConfigModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                        <button @click="saveAPIConfig()" :disabled="isAPISaving" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                            <span x-text="isAPISaving ? '保存中...' : '保存'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 编辑Prompt弹窗 -->
    <div x-show="isPromptModalOpen" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="isPromptModalOpen" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-30 backdrop-blur-sm" @click="isPromptModalOpen = false"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="isPromptModalOpen" x-transition.scale class="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-xl transform sm:my-8 sm:align-middle sm:max-w-2xl w-full">
                <div class="bg-white px-6 pt-5 pb-4">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-purple-100">
                            <i class="fas fa-code text-purple-600"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-medium text-gray-900">编辑 Prompt</h3>
                            <p class="text-sm text-gray-500" x-text="activePrompt?.name"></p>
                        </div>
                    </div>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">描述</label>
                            <input type="text" x-model="activePrompt.description" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 text-sm">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Prompt 内容</label>
                            <textarea x-model="activePrompt.prompt_content" rows="12" class="block w-full border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-purple-500 focus:border-purple-500 text-sm font-mono leading-relaxed"></textarea>
                        </div>
                    </div>
                </div>
                <div class="bg-gray-50 px-6 py-3 flex justify-end gap-3 border-t border-gray-100">
                    <button @click="isPromptModalOpen = false" class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                    <button @click="savePrompt()" class="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700">保存更改</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 趋势详情模态框 -->
    <div x-show="trendDetailModal" class="fixed inset-0 z-50 overflow-y-auto" x-cloak>
        <div class="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div x-show="trendDetailModal" x-transition.opacity class="fixed inset-0 bg-gray-900 bg-opacity-50 backdrop-blur-sm" @click="closeTrendDetail()"></div>
            <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>
            <div x-show="trendDetailModal" x-transition.scale class="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-2xl transform sm:my-8 sm:align-middle sm:max-w-md w-full">
                <template x-if="trendDetailData">
                    <div>
                        <!-- 头部 -->
                        <div class="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-5 text-white">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl" x-text="trendDetailData.statusIcon"></div>
                                    <div>
                                        <h3 class="text-lg font-semibold">提问数据详情</h3>
                                        <p class="text-indigo-100 text-sm" x-text="trendDetailData.date"></p>
                                    </div>
                                </div>
                                <button @click="closeTrendDetail()" class="text-white/80 hover:text-white transition">
                                    <i class="fas fa-times text-xl"></i>
                                </button>
                            </div>
                        </div>

                        <!-- 内容 -->
                        <div class="px-6 py-6">
                            <!-- 主要数据 -->
                            <div class="text-center mb-6">
                                <div class="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4" :style="`background: ${trendDetailData.statusColor}20; border: 3px solid ${trendDetailData.statusColor}30;`">
                                    <span class="text-3xl font-bold" :style="`color: ${trendDetailData.statusColor}`" x-text="trendDetailData.count"></span>
                                </div>
                                <h4 class="text-2xl font-bold text-gray-900 mb-2">
                                    <span x-text="trendDetailData.count"></span> 次提问
                                </h4>
                                <div class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium" :style="`background: ${trendDetailData.statusColor}20; color: ${trendDetailData.statusColor}`">
                                    <span x-text="trendDetailData.statusIcon" class="mr-2"></span>
                                    <span x-text="trendDetailData.status"></span>
                                </div>
                            </div>

                            <!-- 统计信息 -->
                            <div class="grid grid-cols-2 gap-4 mb-6">
                                <div class="bg-gray-50 rounded-lg p-4 text-center">
                                    <div class="text-2xl font-bold text-gray-900" x-text="trendDetailData.count"></div>
                                    <div class="text-sm text-gray-500">总提问数</div>
                                </div>
                                <div class="bg-gray-50 rounded-lg p-4 text-center">
                                    <div class="text-2xl font-bold text-gray-900" x-text="trendDetailData.rawDate"></div>
                                    <div class="text-sm text-gray-500">日期</div>
                                </div>
                            </div>

                            <!-- 状态说明 -->
                            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <h5 class="font-medium text-blue-900 mb-2 flex items-center">
                                    <i class="fas fa-info-circle mr-2"></i>
                                    活跃度说明
                                </h5>
                                <div class="text-sm text-blue-700 space-y-1">
                                    <div class="flex items-center justify-between">
                                        <span>😴 无提问</span>
                                        <span class="text-gray-500">0次</span>
                                    </div>
                                    <div class="flex items-center justify-between">
                                        <span>📊 较少</span>
                                        <span class="text-gray-500">1-4次</span>
                                    </div>
                                    <div class="flex items-center justify-between">
                                        <span>📈 正常</span>
                                        <span class="text-gray-500">5-9次</span>
                                    </div>
                                    <div class="flex items-center justify-between">
                                        <span>🔥 活跃</span>
                                        <span class="text-gray-500">10次以上</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 底部 -->
                        <div class="bg-gray-50 px-6 py-4 flex justify-end border-t border-gray-100">
                            <button @click="closeTrendDetail()" class="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                                关闭
                            </button>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>

    <!-- 日志详情抽屉 -->
    <div x-show="isLogDrawerOpen" class="fixed inset-0 z-50 overflow-hidden" x-cloak>
        <div class="absolute inset-0 overflow-hidden">
            <div x-show="isLogDrawerOpen" x-transition.opacity class="absolute inset-0 bg-gray-500 bg-opacity-30 backdrop-blur-sm" @click="isLogDrawerOpen = false"></div>
            <div class="fixed inset-y-0 right-0 pl-10 max-w-full flex pointer-events-none">
                <div x-show="isLogDrawerOpen" x-transition:enter="transform transition ease-in-out duration-300" x-transition:enter-start="translate-x-full" x-transition:enter-end="translate-x-0" x-transition:leave="transform transition ease-in-out duration-300" x-transition:leave-start="translate-x-0" x-transition:leave-end="translate-x-full" class="pointer-events-auto w-screen max-w-2xl">
                    <div class="h-full flex flex-col bg-white shadow-2xl">
                        <div class="px-6 py-5 border-b border-gray-100 bg-white flex-shrink-0">
                            <div class="flex items-center justify-between">
                                <div>
                                    <h2 class="text-lg font-bold text-gray-900">对话详情</h2>
                                    <div class="mt-1 flex items-center gap-3 text-sm text-gray-500">
                                        <span class="font-mono text-xs" x-text="activeLog?.date + ' ' + activeLog?.time"></span>
                                        <span>•</span>
                                        <span x-text="activeLog?.userName"></span>
                                        <span :class="activeLog?.mode === 'learn' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'" class="px-1.5 py-0.5 rounded text-[10px] font-semibold border" x-text="activeLog?.mode === 'learn' ? '学习模式' : '问答模式'"></span>
                                    </div>
                                </div>
                                <button @click="isLogDrawerOpen = false" class="text-gray-400 hover:text-gray-500 p-2"><i class="fas fa-times text-lg"></i></button>
                            </div>
                        </div>
                        <div class="flex-1 overflow-y-auto p-6 bg-gray-50">
                            <!-- 加载中 -->
                            <div x-show="isLogLoading" class="flex items-center justify-center py-12">
                                <div class="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent"></div>
                            </div>
                            <!-- 对话内容 -->
                            <div x-show="!isLogLoading" class="space-y-4">
                                <template x-for="(msg, index) in activeLogMessages" :key="index">
                                    <div>
                                        <!-- 用户消息 -->
                                        <template x-if="msg.role === 'user'">
                                            <div class="flex flex-col items-end">
                                                <div class="bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-none text-sm max-w-[85%] shadow-sm leading-relaxed whitespace-pre-wrap" x-text="msg.content"></div>
                                                <span class="text-[10px] text-gray-400 mt-1" x-text="formatMsgTime(msg.created_at)"></span>
                                            </div>
                                        </template>
                                        <!-- AI消息 -->
                                        <template x-if="msg.role === 'assistant'">
                                            <div class="flex flex-col items-start">
                                                <div class="flex items-start gap-3 max-w-[90%]">
                                                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                                                        <i class="fas fa-robot text-white text-xs"></i>
                                                    </div>
                                                    <div class="flex-1 bg-white px-4 py-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
                                                        <div class="prose prose-sm max-w-none text-gray-700 leading-relaxed" x-html="renderMarkdownSimple(msg.content)"></div>
                                                    </div>
                                                </div>
                                                <span class="text-[10px] text-gray-400 mt-1 ml-11" x-text="formatMsgTime(msg.created_at)"></span>
                                            </div>
                                        </template>
                                    </div>
                                </template>
                                <!-- 无消息 -->
                                <template x-if="activeLogMessages.length === 0 && !isLogLoading">
                                    <div class="text-center text-gray-400 py-12">
                                        <i class="fas fa-comments text-3xl mb-3"></i>
                                        <p>暂无对话记录</p>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>



    <!-- Alpine.js 逻辑 -->
    <script>
        const API_BASE = './api';

        function adminSystem() {
            return {
                currentTab: (new URLSearchParams(window.location.search).get('tab') || window.location.hash.replace('#', '') || 'dashboard'),
                pageTitle: '数据概览',
                isUserModalOpen: false,
                isLogDrawerOpen: false,
                isPromptModalOpen: false,
                activeLog: null,
                activeLogMessages: [],
                isLogLoading: false,
                activePrompt: {},
                editingUser: null,
                isLoading: false,
                searchUser: '',
                logFilter: '',
                logStartDate: '',
                logEndDate: '',
                logPage: 1,
                logPageSize: 50,
                logTotal: 0,
                isClearingLogs: false,
                isSuperAdmin: <?php echo $isSuperAdmin ? 'true' : 'false'; ?>,
                adminCsrfToken: <?php echo json_encode($adminCsrfToken, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT); ?>,

                stats: [],
                topTopics: [],
                admins: [],
                users: [],
                logs: [],
                files: [],
                prompts: [],
                promptScenarios: [],
                selectedPromptScenarioSlug: '',
                isApplyingPromptScenario: false,
                siteSettings: <?php echo json_encode($siteSettings, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT); ?>,
                isSettingsSaving: false,
                apiConfigs: [],
                apiStrategy: 'failover',
                isAPIConfigModalOpen: false,
                editingAPIConfig: null,
                isAPISaving: false,
                testingAPIId: null,
                isAPITestResultModalOpen: false,
                apiTestResult: {
                    status: 'testing',
                    statusText: '测试中',
                    name: '',
                    type: '',
                    model: '',
                    apiUrl: '',
                    latencyText: '-',
                    message: '',
                    startedAt: '',
                    finishedAt: '',
                    raw: ''
                },
                apiForm: {
                    name: '',
                    api_url: '',
                    api_key: '',
                    model: '',
                    api_type: 'chat_completions',
                    status: 'active',
                    priority: 100,
                    timeout_seconds: 300,
                    connect_timeout_seconds: 30,
                    max_tokens: 2500,
                    temperature: 0.7
                },
                apiStats: {
                    isLoading: false,
                    error: '',
                    overview: {
                        total_24h: '0',
                        success_24h: '0',
                        failed_24h: '0',
                        success_rate_24h: '-',
                        avg_24h: '-',
                        p95_24h: '-',
                        active_routes: '0',
                        enabled_apis: '0',
                        total_7d: '0',
                        latest_call: '-'
                    },
                    status: { value: 'nodata', text: '无数据' },
                    rotation_strategy: '-',
                    generated_at: '-',
                    items_24h: [],
                    items_7d: [],
                    recent: [],
                    enabled_apis: []
                },

                userForm: { name: '', company: '', phone: '', email: '', role: 'sales_rep' },
                adminForm: { username: '', password: '', name: '', role: 'admin' },
                isAdminModalOpen: false,
                editingAdmin: null,

                // 知识库相关
                isDocModalOpen: false,
                docForm: { id: null, title: '', content: '', wordCount: 0 },
                isChunkModalOpen: false,
                chunkDoc: { id: null, name: '', embeddingStatus: '' },
                chunks: [],
                uploadState: 'idle',
                uploadProgress: 0,
                uploadFileName: '',
                uploadMessage: '',
                uploadError: '',
                uploadResult: null,
                isUploadResultModalOpen: false,

                // 探索建议相关
                isSuggestionModalOpen: false,
                suggestionTab: 'hot_search',
                suggestions: [],
                suggestionScenarios: [],
                selectedSuggestionScenarioSlug: '',
                isApplyingSuggestionTemplate: false,
                editingSuggestion: null,
                suggestionForm: {
                    type: 'hot_search',
                    title: '',
                    subtitle: '',
                    content: '',
                    icon: 'fas fa-star',
                    color_class: 'text-blue-700',
                    sort_order: 1
                },

                // 计算属性
                brandParts() {
                    const rawName = String(this.siteSettings.admin_site_name || 'TokChat Admin').replace(/\s+/g, ' ').trim();
                    const fullName = rawName || 'TokChat Admin';
                    const match = fullName.match(/\s*(Admin|管理后台)$/i);
                    const suffix = match ? match[1] : '';
                    const main = match ? fullName.slice(0, match.index).trim() : fullName;

                    return {
                        main: main || fullName,
                        suffix: suffix.toLowerCase() === 'admin' ? 'Admin' : suffix
                    };
                },

                brandMainName() {
                    return this.brandParts().main;
                },

                brandSuffixName() {
                    return this.brandParts().suffix;
                },

                get chatAPIConfigs() {
                    return this.apiConfigs.filter(api => api.api_type !== 'embeddings');
                },

                get embeddingAPIConfigs() {
                    return this.apiConfigs.filter(api => api.api_type === 'embeddings');
                },

                get activePromptScenario() {
                    return this.promptScenarios.find(s => Number(s.is_active) === 1) || null;
                },

                get activePromptScenarioSlug() {
                    return this.activePromptScenario?.slug || '';
                },

                get activePromptScenarioName() {
                    return this.activePromptScenario?.name || '未选择';
                },

                get activeSuggestionScenario() {
                    return this.suggestionScenarios.find(s => Number(s.is_active) === 1) || null;
                },

                get activeSuggestionScenarioSlug() {
                    return this.activeSuggestionScenario?.slug || '';
                },

                get activeSuggestionScenarioName() {
                    return this.activeSuggestionScenario?.name || '未选择';
                },

                get filteredSuggestions() {
                    return this.suggestions.filter(s => s.type === this.suggestionTab).sort((a, b) => a.sort_order - b.sort_order);
                },

                pageTitleFor(tab) {
                    const titles = {
                        dashboard: '数据概览',
                        admins: '管理员管理',
                        users: '用户管理',
                        logs: '对话日志',
                        knowledge: '知识库',
                        suggestions: '探索建议',
                        prompts: 'Prompt 设置',
                        api_config: 'API 配置',
                        api_stats: 'API 统计',
                        settings: '网站设置'
                    };
                    return titles[tab] || titles.dashboard;
                },

                normalizeTab(tab) {
                    const allowed = ['dashboard', 'admins', 'users', 'logs', 'knowledge', 'suggestions', 'prompts', 'api_config', 'api_stats', 'settings'];
                    if (tab === 'admins' && !this.isSuperAdmin) return 'dashboard';
                    return allowed.includes(tab) ? tab : 'dashboard';
                },

                async init() {
                    this.currentTab = this.normalizeTab(this.currentTab);
                    this.pageTitle = this.pageTitleFor(this.currentTab);
                    const loads = [
                        this.loadDashboard(),
                        this.loadUsers(),
                        this.loadLogs(),
                        this.loadFiles(),
                        this.loadPrompts(),
                        this.loadSuggestions(),
                        this.loadSettings(),
                        this.loadAPIConfigs()
                    ];
                    if (this.isSuperAdmin) loads.push(this.loadAdmins());
                    if (this.currentTab === 'api_stats') loads.push(this.loadAPIStats());
                    await Promise.all(loads);
                },

                trendChart: null,
                trendData: [],
                trendDetailModal: false,
                trendDetailData: null,

                async loadDashboard() {
                    try {
                        const [statsRes, topicsRes, trendRes] = await Promise.all([
                            fetch(`${API_BASE}/stats.php?action=dashboard`),
                            fetch(`${API_BASE}/stats.php?action=topics`),
                            fetch(`${API_BASE}/stats.php?action=trend`)
                        ]);
                        const statsData = await statsRes.json();
                        const topicsData = await topicsRes.json();
                        const trendData = await trendRes.json();

                        if (statsData.success) this.stats = statsData.data.stats;
                        if (topicsData.success) this.topTopics = topicsData.data.topics;
                        if (trendData.success) {
                            this.trendData = trendData.data.trend;
                            this.$nextTick(() => this.renderTrendChart());
                        }
                    } catch (e) { console.error('Load dashboard error:', e); }
                },

                renderTrendChart() {
                    const chartDom = document.getElementById('trend-chart');
                    if (!chartDom) return;

                    if (this.trendChart) {
                        this.trendChart.dispose();
                    }

                    this.trendChart = echarts.init(chartDom);

                    const labels = this.trendData.map(d => d.label);
                    const counts = this.trendData.map(d => d.count);
                    const maxCount = Math.max(...counts, 1);

                    // 保存 trendData 的引用供 tooltip 使用
                    const trendData = this.trendData;

                    const option = {
                        tooltip: {
                            trigger: 'axis',
                            backgroundColor: 'rgba(255, 255, 255, 0.98)',
                            borderColor: '#E5E7EB',
                            borderWidth: 1,
                            borderRadius: 12,
                            padding: [16, 20],
                            textStyle: { color: '#374151', fontSize: 13 },
                            shadowBlur: 20,
                            shadowColor: 'rgba(0, 0, 0, 0.1)',
                            shadowOffsetY: 4,
                            formatter: function(params) {
                                const data = params[0];
                                const dataIndex = data.dataIndex;
                                const trendItem = trendData[dataIndex];
                                const fullDate = trendItem.date;
                                const count = data.value;

                                // 格式化完整日期
                                const dateObj = new Date(fullDate);
                                const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                                const weekday = weekdays[dateObj.getDay()];
                                const formattedDate = `${dateObj.getFullYear()}年${(dateObj.getMonth() + 1).toString().padStart(2, '0')}月${dateObj.getDate().toString().padStart(2, '0')}日 ${weekday}`;

                                // 根据数量显示不同的状态
                                let statusText = '';
                                let statusColor = '#6366F1';
                                if (count === 0) {
                                    statusText = '无提问';
                                    statusColor = '#9CA3AF';
                                } else if (count >= 10) {
                                    statusText = '活跃';
                                    statusColor = '#10B981';
                                } else if (count >= 5) {
                                    statusText = '正常';
                                    statusColor = '#F59E0B';
                                } else {
                                    statusText = '较少';
                                    statusColor = '#6366F1';
                                }

                                return `
                                    <div style="font-weight: 600; color: #1F2937; margin-bottom: 12px; font-size: 15px; line-height: 1.2;">
                                        ${formattedDate}
                                    </div>
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <div style="width: 10px; height: 10px; background: ${statusColor}; border-radius: 50%; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);"></div>
                                            <span style="color: ${statusColor}; font-weight: 700; font-size: 18px;">${count}</span>
                                            <span style="color: #6B7280; font-size: 14px;">次提问</span>
                                        </div>
                                        <div style="background: ${statusColor}20; color: ${statusColor}; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                                            ${statusText}
                                        </div>
                                    </div>
                                `;
                            }
                        },
                        grid: {
                            left: '3%',
                            right: '4%',
                            bottom: '3%',
                            top: '10%',
                            containLabel: true
                        },
                        xAxis: {
                            type: 'category',
                            data: labels,
                            boundaryGap: false,
                            axisLine: { lineStyle: { color: '#E5E7EB' } },
                            axisLabel: {
                                color: '#6B7280',
                                fontSize: 11,
                                interval: 'auto',
                                rotate: 0,
                                formatter: function(value, index) {
                                    // 30天数据，每隔几天显示一个标签
                                    if (labels.length > 15) {
                                        return index % Math.ceil(labels.length / 8) === 0 ? value : '';
                                    }
                                    return value;
                                }
                            },
                            axisTick: { show: false }
                        },
                        yAxis: {
                            type: 'value',
                            min: 0,
                            max: maxCount < 5 ? 5 : undefined,
                            axisLine: { show: false },
                            axisLabel: { color: '#9CA3AF', fontSize: 11 },
                            splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } }
                        },
                        series: [{
                            name: '提问数',
                            type: 'line',
                            smooth: true,
                            symbol: 'circle',
                            symbolSize: 8,
                            lineStyle: {
                                color: '#6366F1',
                                width: 3
                            },
                            itemStyle: {
                                color: '#6366F1',
                                borderColor: '#fff',
                                borderWidth: 2
                            },
                            areaStyle: {
                                color: {
                                    type: 'linear',
                                    x: 0, y: 0, x2: 0, y2: 1,
                                    colorStops: [
                                        { offset: 0, color: 'rgba(99, 102, 241, 0.3)' },
                                        { offset: 1, color: 'rgba(99, 102, 241, 0.05)' }
                                    ]
                                }
                            },
                            data: counts
                        }]
                    };

                    this.trendChart.setOption(option);

                    // 添加点击事件
                    this.trendChart.on('click', (params) => {
                        if (params.componentType === 'series') {
                            const dataIndex = params.dataIndex;
                            const trendItem = trendData[dataIndex];
                            const count = params.value;

                            // 格式化日期
                            const dateObj = new Date(trendItem.date);
                            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                            const weekday = weekdays[dateObj.getDay()];
                            const formattedDate = `${dateObj.getFullYear()}年${(dateObj.getMonth() + 1).toString().padStart(2, '0')}月${dateObj.getDate().toString().padStart(2, '0')}日 ${weekday}`;

                            // 根据数量显示不同的状态
                            let statusText = '';
                            let statusColor = '#6366F1';
                            let statusIcon = '📊';
                            if (count === 0) {
                                statusText = '无提问';
                                statusColor = '#9CA3AF';
                                statusIcon = '😴';
                            } else if (count >= 10) {
                                statusText = '活跃';
                                statusColor = '#10B981';
                                statusIcon = '🔥';
                            } else if (count >= 5) {
                                statusText = '正常';
                                statusColor = '#F59E0B';
                                statusIcon = '📈';
                            } else {
                                statusText = '较少';
                                statusColor = '#6366F1';
                                statusIcon = '📊';
                            }

                            // 显示详细信息弹窗
                            this.showTrendDetail({
                                date: formattedDate,
                                count: count,
                                status: statusText,
                                statusColor: statusColor,
                                statusIcon: statusIcon,
                                rawDate: trendItem.date
                            });
                        }
                    });

                    // 响应式调整
                    window.addEventListener('resize', () => {
                        if (this.trendChart) this.trendChart.resize();
                    });
                },

                showTrendDetail(data) {
                    this.trendDetailData = data;
                    this.trendDetailModal = true;
                },

                closeTrendDetail() {
                    this.trendDetailModal = false;
                    this.trendDetailData = null;
                },

                async loadAdmins() {
                    if (!this.isSuperAdmin) return;
                    try {
                        const res = await fetch(`${API_BASE}/users.php?action=list_admins`);
                        const data = await res.json();
                        if (data.success) this.admins = data.data.admins;
                    } catch (e) { console.error('Load admins error:', e); }
                },

                async loadUsers() {
                    try {
                        let url = `${API_BASE}/users.php?action=list`;
                        if (this.searchUser) url += `&search=${encodeURIComponent(this.searchUser)}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        if (data.success) this.users = data.data.users;
                    } catch (e) { console.error('Load users error:', e); }
                },

                async loadLogs(resetPage = true) {
                    if (resetPage) this.logPage = 1;
                    try {
                        const offset = (this.logPage - 1) * this.logPageSize;
                        let url = `${API_BASE}/logs.php?action=list&limit=${this.logPageSize}&offset=${offset}`;
                        if (this.logFilter) url += `&mode=${this.logFilter}`;
                        if (this.logStartDate) url += `&start_date=${this.logStartDate}`;
                        if (this.logEndDate) url += `&end_date=${this.logEndDate}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        if (data.success) {
                            this.logs = data.data.logs.map(l => ({
                                id: l.id,
                                sessionId: l.session_id,
                                time: l.time,
                                date: l.date,
                                datetime: l.datetime,
                                userName: l.user_name,
                                userCompany: l.user_company,
                                userInitials: l.user_initials,
                                mode: l.mode,
                                query: l.content_preview
                            }));
                            this.logTotal = data.data.total || 0;
                        }
                    } catch (e) { console.error('Load logs error:', e); }
                },

                get logTotalPages() {
                    return Math.ceil(this.logTotal / this.logPageSize) || 1;
                },

                async goToLogPage(page) {
                    if (page < 1 || page > this.logTotalPages) return;
                    this.logPage = page;
                    await this.loadLogs(false);
                },

                async loadFiles() {
                    try {
                        const res = await fetch(`${API_BASE}/knowledge.php?action=list`);
                        const data = await res.json();

                        if (data.success) {
                            if (data.data && data.data.docs) {
                                this.files = data.data.docs.map(d => ({
                                    id: d.id,
                                    name: d.original_name,
                                    type: d.file_type || 'text',
                                    size: d.file_size_formatted,
                                    wordCount: d.word_count || 0,
                                    chunkCount: Number(d.chunk_count || 0),
                                    chunkingStatus: d.chunking_status || 'pending',
                                    embeddingStatus: d.embedding_status || 'not_configured',
                                    embeddingModel: d.embedding_model || '',
                                    date: (d.updated_at || d.created_at || '').split(' ')[0] || '',
                                    status: d.status || 'indexed',
                                    processingStatus: d.processing_status || 'completed'
                                }));
                            } else {
                                this.files = [];
                            }
                        } else {
                            this.files = [];
                        }
                    } catch (e) {
                        console.error('Load files error:', e);
                        this.files = [];
                    }
                },

                totalChunkCount() {
                    return this.files.reduce((sum, file) => sum + Number(file.chunkCount || 0), 0);
                },

                activeFileCount() {
                    return this.files.filter(file => file.status === 'indexed').length;
                },

                disabledFileCount() {
                    return this.files.filter(file => file.status === 'disabled').length;
                },

                uploadTitle() {
                    const titles = {
                        idle: '拖拽文件到这里，或选择文件上传',
                        uploading: '正在上传并处理知识库',
                        success: '上传完成，等待确认',
                        error: '上传失败，请检查文件'
                    };
                    return titles[this.uploadState] || titles.idle;
                },

                uploadSubtitle() {
                    if (this.uploadState === 'uploading') return '系统正在上传、解析内容、建立索引并生成语义切片。';
                    if (this.uploadState === 'success') return '已生成索引和切片，确认后可在下方列表继续管理。';
                    if (this.uploadState === 'error') return '支持 PDF、Word DOCX、TXT、Markdown，单个文件最大 10MB。';
                    return '支持 PDF、Word DOCX、TXT、Markdown，单个文件最大 10MB。';
                },

                resetUploadState() {
                    this.uploadState = 'idle';
                    this.uploadProgress = 0;
                    this.uploadFileName = '';
                    this.uploadMessage = '';
                    this.uploadError = '';
                    this.uploadResult = null;
                },

                validateKnowledgeFile(file) {
                    const allowed = ['pdf', 'md', 'txt', 'docx'];
                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    if (!allowed.includes(ext)) {
                        return '不支持该文件类型，请上传 PDF、Word DOCX、TXT 或 Markdown 文件。';
                    }
                    if (file.size > 10 * 1024 * 1024) {
                        return '文件大小超过限制，单个文件最大 10MB。';
                    }
                    return '';
                },

                formatDocStatus(status) {
                    const map = {
                        indexed: '启用',
                        disabled: '停用',
                        processing: '处理中'
                    };
                    return map[status] || '未知';
                },

                docStatusClass(status) {
                    const map = {
                        indexed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        disabled: 'bg-gray-50 text-gray-500 border-gray-100',
                        processing: 'bg-blue-50 text-blue-700 border-blue-100'
                    };
                    return map[status] || 'bg-yellow-50 text-yellow-700 border-yellow-100';
                },

                formatChunkStatus(status) {
                    const map = {
                        completed: '已切片',
                        processing: '切片中',
                        failed: '切片失败',
                        pending: '待切片'
                    };
                    return map[status] || '待切片';
                },

                chunkStatusClass(status) {
                    const map = {
                        completed: 'bg-purple-50 text-purple-700 border-purple-100',
                        processing: 'bg-blue-50 text-blue-700 border-blue-100',
                        failed: 'bg-red-50 text-red-700 border-red-100',
                        pending: 'bg-gray-50 text-gray-500 border-gray-100'
                    };
                    return map[status] || map.pending;
                },

                formatEmbeddingStatus(status) {
                    const map = {
                        completed: '已向量化',
                        partial: '部分向量化',
                        pending: '待向量化',
                        failed: '向量失败',
                        not_configured: '未配置向量'
                    };
                    return map[status] || '未配置向量';
                },

                embeddingStatusClass(status) {
                    const map = {
                        completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        partial: 'bg-yellow-50 text-yellow-700 border-yellow-100',
                        pending: 'bg-blue-50 text-blue-700 border-blue-100',
                        failed: 'bg-red-50 text-red-700 border-red-100',
                        not_configured: 'bg-gray-50 text-gray-500 border-gray-100'
                    };
                    return map[status] || map.not_configured;
                },

                async loadPrompts() {
                    try {
                        const res = await fetch(`${API_BASE}/prompts.php?action=list`);
                        const data = await res.json();
                        if (data.success) {
                            this.prompts = data.data.prompts || [];
                            this.promptScenarios = data.data.scenarios || [];
                            const active = this.promptScenarios.find(s => Number(s.is_active) === 1);
                            if (!this.selectedPromptScenarioSlug) {
                                this.selectedPromptScenarioSlug = active?.slug || this.promptScenarios[0]?.slug || '';
                            }
                        }
                    } catch (e) { console.error('Load prompts error:', e); }
                },

                async loadSettings() {
                    try {
                        const res = await fetch(`${API_BASE}/settings.php?action=get`);
                        const data = await res.json();
                        if (data.success) {
                            this.siteSettings = { ...this.siteSettings, ...data.data.settings };
                        }
                    } catch (e) { console.error('Load settings error:', e); }
                },

                async loadAPIConfigs() {
                    try {
                        const res = await fetch(`${API_BASE}/api-configs.php?action=list`);
                        const data = await res.json();
                        if (data.success) {
                            this.apiConfigs = data.data.apis || [];
                            this.apiStrategy = data.data.settings?.rotation_strategy || 'failover';
                        }
                    } catch (e) { console.error('Load API configs error:', e); }
                },

                async loadAPIStats() {
                    this.apiStats.isLoading = true;
                    this.apiStats.error = '';
                    try {
                        const res = await fetch(`${API_BASE}/api-stats.php?action=summary`);
                        const data = await res.json();
                        if (data.success) {
                            this.apiStats = {
                                ...this.apiStats,
                                ...data.data,
                                isLoading: false,
                                error: ''
                            };
                        } else {
                            this.apiStats.error = data.error || 'API统计数据加载失败';
                        }
                    } catch (e) {
                        console.error('Load API stats error:', e);
                        this.apiStats.error = 'API统计数据加载失败，请稍后重试';
                    } finally {
                        this.apiStats.isLoading = false;
                    }
                },

                async switchTab(tab) {
                    tab = this.normalizeTab(tab);
                    this.currentTab = tab;
                    this.pageTitle = this.pageTitleFor(tab);
                    if (tab === 'dashboard') {
                        await this.loadDashboard();
                    }
                    if (tab === 'admins') await this.loadAdmins();
                    if (tab === 'users') await this.loadUsers();
                    if (tab === 'logs') await this.loadLogs();
                    if (tab === 'knowledge') await this.loadFiles();
                    if (tab === 'suggestions') await this.loadSuggestions();
                    if (tab === 'api_config') await this.loadAPIConfigs();
                    if (tab === 'api_stats') await this.loadAPIStats();
                    if (tab === 'settings') await this.loadSettings();
                },

                openUserModal() {
                    this.editingUser = null;
                    this.userForm = { name: '', company: '', phone: '', email: '', role: 'sales_rep' };
                    this.isUserModalOpen = true;
                },

                editUser(user) {
                    this.editingUser = user;
                    this.userForm = { name: user.name, company: user.company || '', phone: user.phone || '', email: user.email || '', role: user.role };
                    this.isUserModalOpen = true;
                },

                async saveUser() {
                    if (!this.userForm.name || !this.userForm.company || !this.userForm.phone) {
                        alert('请填写姓名、公司简称和手机号');
                        return;
                    }
                    if (!/^1[3-9]\d{9}$/.test(this.userForm.phone)) {
                        alert('手机号格式不正确');
                        return;
                    }
                    try {
                        const action = this.editingUser ? 'update' : 'create';
                        const body = this.editingUser ? { ...this.userForm, id: this.editingUser.id } : this.userForm;
                        const res = await fetch(`${API_BASE}/users.php?action=${action}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.isUserModalOpen = false;
                            await this.loadUsers();
                            alert(this.editingUser ? '用户更新成功' : '用户添加成功');
                        } else {
                            alert(data.error || '操作失败');
                        }
                    } catch (e) { alert('操作失败'); }
                },

                async toggleUserStatus(user) {
                    const newStatus = user.status === 'active' ? 'inactive' : 'active';
                    if (!confirm(`确定要${newStatus === 'active' ? '启用' : '禁用'}该用户吗？`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/users.php?action=update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: user.id, status: newStatus })
                        });
                        const data = await res.json();
                        if (data.success) await this.loadUsers();
                        else alert(data.error || '操作失败');
                    } catch (e) { alert('操作失败'); }
                },

                async deleteUser(user) {
                    if (!confirm(`确定要删除用户 "${user.name}" 吗？此操作不可恢复！`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/users.php?action=delete`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: user.id })
                        });
                        const data = await res.json();
                        if (data.success) await this.loadUsers();
                        else alert(data.error || '删除失败');
                    } catch (e) { alert('删除失败'); }
                },

                // 管理员管理方法（仅超级管理员可用）
                openAdminModal() {
                    this.editingAdmin = null;
                    this.adminForm = { username: '', password: '', name: '', role: 'admin' };
                    this.isAdminModalOpen = true;
                },

                editAdmin(admin) {
                    this.editingAdmin = admin;
                    this.adminForm = { username: admin.username, password: '', name: admin.name, role: admin.role };
                    this.isAdminModalOpen = true;
                },

                async saveAdmin() {
                    if (!this.adminForm.username || !this.adminForm.name) {
                        alert('请填写用户名和姓名');
                        return;
                    }
                    if (!this.editingAdmin && !this.adminForm.password) {
                        alert('请设置密码');
                        return;
                    }
                    try {
                        const action = this.editingAdmin ? 'update_admin' : 'create_admin';
                        const body = this.editingAdmin ? { ...this.adminForm, id: this.editingAdmin.id } : this.adminForm;
                        const res = await fetch(`${API_BASE}/users.php?action=${action}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.isAdminModalOpen = false;
                            await this.loadAdmins();
                            alert(this.editingAdmin ? '管理员更新成功' : '管理员添加成功');
                        } else {
                            alert(data.error || '操作失败');
                        }
                    } catch (e) { alert('操作失败'); }
                },

                async deleteAdmin(admin) {
                    if (admin.role === 'super_admin') {
                        alert('不能删除超级管理员');
                        return;
                    }
                    if (!confirm(`确定要删除管理员 "${admin.name}" 吗？`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/users.php?action=delete_admin`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: admin.id })
                        });
                        const data = await res.json();
                        if (data.success) await this.loadAdmins();
                        else alert(data.error || '删除失败');
                    } catch (e) { alert('删除失败'); }
                },

                async uploadFile(event) {
                    const file = event.target.files[0];
                    if (file) {
                        await this.startKnowledgeUpload(file);
                    }
                    event.target.value = '';
                },

                async uploadDroppedFile(event) {
                    const file = event.dataTransfer?.files?.[0];
                    if (file) {
                        await this.startKnowledgeUpload(file);
                    }
                },

                async startKnowledgeUpload(file) {
                    if (this.isLoading || this.uploadState === 'uploading') {
                        return;
                    }

                    this.uploadFileName = file.name;
                    const validationError = this.validateKnowledgeFile(file);
                    if (validationError) {
                        this.uploadState = 'error';
                        this.uploadProgress = 0;
                        this.uploadMessage = '';
                        this.uploadError = validationError;
                        this.uploadResult = null;
                        this.isUploadResultModalOpen = true;
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('user_id', 1);

                    this.isLoading = true;
                    this.uploadState = 'uploading';
                    this.uploadProgress = 0;
                    this.uploadMessage = '正在上传文件...';
                    this.uploadError = '';
                    this.uploadResult = null;

                    try {
                        const data = await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('POST', `${API_BASE}/knowledge.php?action=upload`);
                            xhr.upload.onprogress = (event) => {
                                if (!event.lengthComputable) return;
                                const progress = Math.max(5, Math.min(92, Math.round((event.loaded / event.total) * 85)));
                                this.uploadProgress = progress;
                                this.uploadMessage = progress >= 85 ? '上传完成，正在解析内容...' : '正在上传文件...';
                            };
                            xhr.onload = () => {
                                let response = {};
                                try {
                                    response = JSON.parse(xhr.responseText || '{}');
                                } catch (e) {
                                    reject(new Error('服务器响应格式异常'));
                                    return;
                                }
                                if (xhr.status >= 200 && xhr.status < 300) {
                                    resolve(response);
                                } else {
                                    reject(new Error(response.error || `上传失败 (${xhr.status})`));
                                }
                            };
                            xhr.onerror = () => reject(new Error('网络异常，上传失败'));
                            xhr.send(formData);
                        });

                        if (data.success) {
                            this.uploadProgress = 100;
                            this.uploadState = 'success';
                            this.uploadMessage = '上传完成';
                            this.uploadResult = data.data || {};
                            await this.loadFiles();
                            this.isUploadResultModalOpen = true;
                        } else {
                            throw new Error(data.error || '未知错误');
                        }
                    } catch (e) {
                        console.error('Upload exception:', e);
                        this.uploadState = 'error';
                        this.uploadProgress = 0;
                        this.uploadError = e.message || '上传失败';
                        this.isUploadResultModalOpen = true;
                    } finally {
                        this.isLoading = false;
                    }
                },

                confirmUploadResult() {
                    const wasSuccessful = this.uploadState === 'success';
                    this.isUploadResultModalOpen = false;
                    if (wasSuccessful) {
                        this.$nextTick(() => this.$refs.knowledgeList?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }
                    this.resetUploadState();
                },

                async toggleFileStatus(file) {
                    const nextStatus = file.status === 'indexed' ? 'disabled' : 'indexed';
                    const actionText = nextStatus === 'indexed' ? '启用' : '停用';
                    const message = nextStatus === 'indexed'
                        ? `确定要启用 "${file.name}" 吗？`
                        : `确定要停用 "${file.name}" 吗？停用后前台检索不会引用该文档。`;
                    if (!confirm(message)) return;
                    try {
                        const res = await fetch(`${API_BASE}/knowledge.php?action=status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: file.id, status: nextStatus })
                        });
                        const data = await res.json();
                        if (data.success) await this.loadFiles();
                        else alert(`${actionText}失败: ` + (data.error || '未知错误'));
                    } catch (e) {
                        console.error('Toggle file status error:', e);
                        alert(`${actionText}失败`);
                    }
                },

                async deleteFile(file) {
                    const fileId = typeof file === 'object' ? file.id : file;
                    const fileName = typeof file === 'object' ? file.name : '这个文件';
                    if (!confirm(`确定要删除 "${fileName}" 吗？此操作会同步删除索引、切片和向量数据。`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/knowledge.php?action=delete`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: fileId })
                        });
                        const data = await res.json();
                        if (data.success) await this.loadFiles();
                        else alert('删除失败: ' + data.error);
                    } catch (e) { alert('删除失败'); }
                },

                async chunkFile(fileId) {
                    if (!fileId) return;
                    try {
                        this.isLoading = true;
                        const res = await fetch(`${API_BASE}/knowledge.php?action=chunk`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: fileId })
                        });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadFiles();
                            if (this.isChunkModalOpen && this.chunkDoc.id === fileId) {
                                await this.loadChunks(fileId);
                            }
                            alert(`切片完成，共生成 ${data.data.chunk_count || 0} 个切片`);
                        } else {
                            alert('切片失败: ' + (data.error || '未知错误'));
                        }
                    } catch (e) {
                        console.error('Chunk file error:', e);
                        alert('切片失败');
                    } finally {
                        this.isLoading = false;
                    }
                },

                async viewChunks(file) {
                    this.chunkDoc = {
                        id: file.id,
                        name: file.name,
                        embeddingStatus: file.embeddingStatus || ''
                    };
                    this.chunks = [];
                    this.isChunkModalOpen = true;
                    await this.loadChunks(file.id);
                },

                async loadChunks(fileId) {
                    try {
                        const res = await fetch(`${API_BASE}/knowledge.php?action=chunks&id=${fileId}`);
                        const data = await res.json();
                        if (data.success) {
                            this.chunkDoc = {
                                id: data.data.doc.id,
                                name: data.data.doc.original_name,
                                embeddingStatus: data.data.doc.embedding_status || ''
                            };
                            this.chunks = data.data.chunks || [];
                        } else {
                            alert('获取切片失败: ' + (data.error || '未知错误'));
                        }
                    } catch (e) {
                        console.error('Load chunks error:', e);
                        alert('获取切片失败');
                    }
                },

                async embedFile(fileId) {
                    if (!fileId) return;
                    try {
                        this.isLoading = true;
                        const res = await fetch(`${API_BASE}/knowledge.php?action=embed`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: fileId })
                        });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadFiles();
                            if (this.isChunkModalOpen && this.chunkDoc.id === fileId) {
                                await this.loadChunks(fileId);
                            }
                            const embedded = data.data.embedded_count || 0;
                            const failed = data.data.failed_count || 0;
                            alert(`向量化完成：成功 ${embedded} 个，失败 ${failed} 个`);
                        } else {
                            alert('向量化失败: ' + (data.error || '请先在 API 配置中添加 Embeddings 类型'));
                        }
                    } catch (e) {
                        console.error('Embed file error:', e);
                        alert('向量化失败');
                    } finally {
                        this.isLoading = false;
                    }
                },

                // 打开添加文本弹窗
                openTextModal() {
                    this.docForm = { id: null, title: '', content: '', wordCount: 0 };
                    this.isDocModalOpen = true;
                },

                // 预览/编辑文档
                async previewFile(fileId) {
                    try {
                        const res = await fetch(`${API_BASE}/knowledge.php?action=get&id=${fileId}`);
                        const data = await res.json();

                        if (data.success) {
                            this.docForm = {
                                id: data.data.id,
                                title: data.data.original_name,
                                content: data.data.content || '',
                                wordCount: data.data.word_count || 0
                            };
                            this.isDocModalOpen = true;
                        } else {
                            alert('获取文档失败: ' + (data.error || data.message || '未知错误'));
                        }
                    } catch (e) {
                        console.error('Preview file error:', e);
                        alert('获取文档失败: ' + e.message);
                    }
                },

                // 保存文档（新增或更新）
                async saveDoc() {
                    if (!this.docForm.title.trim()) {
                        alert('请输入文档标题');
                        return;
                    }
                    if (!this.docForm.content.trim()) {
                        alert('请输入文档内容');
                        return;
                    }

                    try {
                        this.isLoading = true;
                        const action = this.docForm.id ? 'update' : 'add_text';
                        const res = await fetch(`${API_BASE}/knowledge.php?action=${action}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: this.docForm.id,
                                title: this.docForm.title,
                                content: this.docForm.content,
                                user_id: 1
                            })
                        });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadFiles();
                            this.isDocModalOpen = false;
                            alert(this.docForm.id ? '文档更新成功' : '文档添加成功');
                        } else {
                            alert('保存失败: ' + data.error);
                        }
                    } catch (e) {
                        console.error('Save doc error:', e);
                        alert('保存失败');
                    } finally {
                        this.isLoading = false;
                    }
                },

                async openLogDrawer(log) {
                    this.activeLog = log;
                    this.activeLogMessages = [];
                    this.isLogLoading = true;
                    this.isLogDrawerOpen = true;

                    try {
                        const res = await fetch(`${API_BASE}/logs.php?action=detail&session_id=${log.sessionId}`);
                        const data = await res.json();
                        if (data.success) {
                            this.activeLogMessages = data.data.messages || [];
                        }
                    } catch (e) {
                        console.error('Load log detail error:', e);
                    } finally {
                        this.isLogLoading = false;
                    }
                },

                formatMsgTime(datetime) {
                    if (!datetime) return '';
                    const date = new Date(datetime);
                    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                },

                renderMarkdownSimple(text) {
                    if (!text) return '';
                    // 简单的 Markdown 渲染
                    let html = text
                        // 转义HTML
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        // 标题
                        .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-gray-800 mt-3 mb-2">$1</h3>')
                        .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-gray-800 mt-4 mb-2">$1</h2>')
                        .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-4 mb-3">$1</h1>')
                        // 加粗和斜体
                        .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
                        .replace(/\*(.+?)\*/g, '<em>$1</em>')
                        // 代码块
                        .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
                        // 列表
                        .replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
                        .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
                        // 链接
                        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-indigo-600 hover:underline" target="_blank">$1</a>')
                        // 换行
                        .replace(/\n\n/g, '</p><p class="mt-2">')
                        .replace(/\n/g, '<br>');

                    // 清理孤立的 ** 和 ##
                    html = html.replace(/\*\*\s*/g, '').replace(/\s*\*\*/g, '');
                    html = html.replace(/##\s*/g, '');

                    return '<p>' + html + '</p>';
                },

                async applyPromptScenario() {
                    if (!this.selectedPromptScenarioSlug) {
                        alert('请选择应用场景');
                        return;
                    }

                    const scenario = this.promptScenarios.find(s => s.slug === this.selectedPromptScenarioSlug);
                    if (!scenario) {
                        alert('应用场景不存在');
                        return;
                    }

                    if (!confirm(`确定应用「${scenario.name}」场景吗？当前所有细分 Prompt 将切换为该场景模板。`)) {
                        return;
                    }

                    try {
                        this.isApplyingPromptScenario = true;
                        const res = await fetch(`${API_BASE}/prompts.php?action=apply_scenario`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ slug: this.selectedPromptScenarioSlug })
                        });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadPrompts();
                            this.selectedPromptScenarioSlug = data.data.scenario.slug;
                            alert('应用场景已生效');
                        } else {
                            alert(data.error || '应用场景失败');
                        }
                    } catch (e) {
                        console.error('Apply prompt scenario error:', e);
                        alert('应用场景失败');
                    } finally {
                        this.isApplyingPromptScenario = false;
                    }
                },

                editPrompt(prompt) {
                    this.activePrompt = { ...prompt };
                    this.isPromptModalOpen = true;
                },

                async savePrompt() {
                    try {
                        const res = await fetch(`${API_BASE}/prompts.php?action=update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: this.activePrompt.id,
                                prompt_content: this.activePrompt.prompt_content,
                                description: this.activePrompt.description
                            })
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.isPromptModalOpen = false;
                            await this.loadPrompts();
                            alert('Prompt 保存成功');
                        } else alert('保存失败: ' + data.error);
                    } catch (e) { alert('保存失败'); }
                },

                async saveSettings() {
                    const requiredFields = {
                        frontend_site_name: '前台左上角网站名称',
                        frontend_page_title: '前台浏览器标题',
                        copyright_text: '版权说明',
                        login_page_title: '登录页面名称',
                        login_page_description: '登录页面说明',
                        admin_site_name: '后台名称',
                        admin_page_title: '后台浏览器标题',
                        admin_login_title: '后台登录页名称',
                        admin_login_description: '后台登录页说明'
                    };

                    for (const [key, label] of Object.entries(requiredFields)) {
                        if (!String(this.siteSettings[key] || '').trim()) {
                            alert(`${label}不能为空`);
                            return;
                        }
                    }

                    if (String(this.siteSettings.frontend_analytics_code || '').length > 20000) {
                        alert('统计代码不能超过 20000 字符');
                        return;
                    }

                    try {
                        this.isSettingsSaving = true;
                        const res = await fetch(`${API_BASE}/settings.php?action=update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ settings: this.siteSettings })
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.siteSettings = { ...this.siteSettings, ...data.data.settings };
                            document.title = this.siteSettings.admin_page_title;
                            alert('网站设置已保存');
                        } else {
                            alert(data.error || '保存失败');
                        }
                    } catch (e) {
                        console.error('Save settings error:', e);
                        alert('保存失败');
                    } finally {
                        this.isSettingsSaving = false;
                    }
                },

                openAPIConfigModal(apiType = 'chat_completions') {
                    this.editingAPIConfig = null;
                    this.apiForm = {
                        name: '',
                        api_url: '',
                        api_key: '',
                        model: apiType === 'embeddings' ? 'text-embedding-3-small' : '',
                        api_type: apiType,
                        status: 'active',
                        priority: this.nextAPIPriority(apiType),
                        timeout_seconds: 300,
                        connect_timeout_seconds: 30,
                        max_tokens: 2500,
                        temperature: 0.7
                    };
                    this.isAPIConfigModalOpen = true;
                },

                nextAPIPriority(apiType) {
                    const list = apiType === 'embeddings' ? this.embeddingAPIConfigs : this.chatAPIConfigs;
                    if (list.length === 0) return 10;
                    return Math.max(...list.map(api => Number(api.priority || 0))) + 10;
                },

                isEmbeddingAPIForm() {
                    return this.apiForm.api_type === 'embeddings';
                },

                apiModalTitle() {
                    if (this.editingAPIConfig) return '编辑 API 配置';
                    return this.isEmbeddingAPIForm() ? '添加向量化 API' : '添加通用 API';
                },

                apiModalDescription() {
                    if (this.isEmbeddingAPIForm()) {
                        return '用于知识库 Embeddings 生成和语义检索，请填写 OpenAI 兼容的 Embeddings 接口。';
                    }
                    return '用于前台对话和后台 AI 调用，支持通用 OpenAI 兼容接口与 Anthropic Messages。';
                },

                apiURLPlaceholder() {
                    if (this.isEmbeddingAPIForm()) return 'https://api.example.com/v1/embeddings';
                    if (this.apiForm.api_type === 'messages') return 'https://api.example.com/v1/messages';
                    return 'https://api.example.com/v1/chat/completions';
                },

                apiModelPlaceholder() {
                    if (this.isEmbeddingAPIForm()) return '例如：text-embedding-3-small';
                    if (this.apiForm.api_type === 'messages') return '例如：claude-sonnet-4-5-20250929';
                    return '例如：gpt-4o-mini';
                },

                apiTestButtonLabel() {
                    return this.isEmbeddingAPIForm() ? '测试向量化接口' : '测试当前配置';
                },

                normalizeAPIFormForType() {
                    if (this.apiForm.api_type === 'embeddings') {
                        if (!this.apiForm.model || this.apiForm.model === 'gpt-4o-mini' || this.apiForm.model.includes('claude')) {
                            this.apiForm.model = 'text-embedding-3-small';
                        }
                        if (!String(this.apiForm.api_url || '').trim() || this.apiForm.api_url.endsWith('/chat/completions') || this.apiForm.api_url.endsWith('/messages')) {
                            this.apiForm.api_url = '';
                        }
                        return;
                    }

                    if (this.apiForm.model === 'text-embedding-3-small') {
                        this.apiForm.model = '';
                    }
                    if (this.apiForm.api_url && this.apiForm.api_url.endsWith('/embeddings')) {
                        this.apiForm.api_url = '';
                    }
                },

                editAPIConfig(api) {
                    this.editingAPIConfig = api;
                    this.apiForm = {
                        id: api.id,
                        name: api.name,
                        api_url: api.api_url,
                        api_key: '',
                        model: api.model,
                        api_type: api.api_type,
                        status: api.status,
                        priority: Number(api.priority || 100),
                        timeout_seconds: Number(api.timeout_seconds || 300),
                        connect_timeout_seconds: Number(api.connect_timeout_seconds || 30),
                        max_tokens: Number(api.max_tokens || 2500),
                        temperature: Number(api.temperature ?? 0.7)
                    };
                    this.isAPIConfigModalOpen = true;
                },

                validateAPIForm(form) {
                    if (!String(form.name || '').trim()) return '请填写API名称';
                    if (!String(form.api_url || '').trim()) return '请填写API地址';
                    if (!String(form.model || '').trim()) return '请填写模型';
                    if (!this.editingAPIConfig && !String(form.api_key || '').trim()) return '请填写API Key';
                    return '';
                },

                async saveAPIConfig() {
                    const error = this.validateAPIForm(this.apiForm);
                    if (error) {
                        alert(error);
                        return;
                    }

                    try {
                        this.isAPISaving = true;
                        const action = this.editingAPIConfig ? 'update' : 'create';
                        const res = await fetch(`${API_BASE}/api-configs.php?action=${action}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.apiForm)
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.isAPIConfigModalOpen = false;
                            await this.loadAPIConfigs();
                            alert(this.editingAPIConfig ? 'API配置已更新' : 'API配置已创建');
                        } else {
                            alert(data.error || '保存失败');
                        }
                    } catch (e) {
                        console.error('Save API config error:', e);
                        alert('保存失败');
                    } finally {
                        this.isAPISaving = false;
                    }
                },

                async deleteAPIConfig(api) {
                    if (!confirm(`确定要删除 API "${api.name}" 吗？`)) return;
                    try {
                        const res = await fetch(`${API_BASE}/api-configs.php?action=delete`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: api.id })
                        });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadAPIConfigs();
                        } else {
                            alert(data.error || '删除失败');
                        }
                    } catch (e) {
                        console.error('Delete API config error:', e);
                        alert('删除失败');
                    }
                },

                formatDateTimeForUI(date = new Date()) {
                    return date.toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                },

                setAPITestResult(api, status, detail = {}) {
                    const statusTextMap = {
                        testing: '测试中',
                        success: '连接成功',
                        failed: '连接失败',
                        error: '请求异常'
                    };
                    const nowText = this.formatDateTimeForUI();
                    const rawPayload = {
                        api_name: String(api?.name || '临时 API 配置'),
                        api_type: this.formatAPIType(api?.api_type || 'chat_completions'),
                        api_url: String(api?.api_url || ''),
                        model: String(api?.model || ''),
                        status,
                        success: status === 'success',
                        latency_ms: detail.latency_ms ?? null,
                        message: detail.message || '',
                        started_at: detail.startedAt || nowText,
                        finished_at: status === 'testing' ? null : nowText,
                        response: detail.response || null
                    };

                    this.apiTestResult = {
                        status,
                        statusText: statusTextMap[status] || statusTextMap.failed,
                        name: rawPayload.api_name,
                        type: rawPayload.api_type,
                        model: rawPayload.model,
                        apiUrl: rawPayload.api_url,
                        latencyText: detail.latency_ms ? `${detail.latency_ms}ms` : (status === 'testing' ? '等待响应' : '-'),
                        message: detail.message || (status === 'testing' ? '正在发送测试请求，请稍候...' : '未返回详细信息'),
                        startedAt: rawPayload.started_at,
                        finishedAt: rawPayload.finished_at || '',
                        raw: JSON.stringify(rawPayload, null, 2)
                    };
                    this.isAPITestResultModalOpen = true;
                },

                async copyAPITestResult() {
                    const text = this.apiTestResult.raw || '';
                    try {
                        if (navigator.clipboard) {
                            await navigator.clipboard.writeText(text);
                            return;
                        }
                    } catch (e) {}

                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.setAttribute('readonly', '');
                    textarea.style.position = 'fixed';
                    textarea.style.left = '-9999px';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                },

                async testAPIConfig(api) {
                    const isForm = api === this.apiForm;
                    if (isForm) {
                        const error = this.validateAPIForm(api);
                        if (error) {
                            this.setAPITestResult(api, 'failed', { message: error });
                            return;
                        }
                    }

                    this.testingAPIId = isForm ? 'form' : api.id;
                    const startedAt = this.formatDateTimeForUI();
                    this.setAPITestResult(api, 'testing', {
                        startedAt,
                        message: '正在发送测试请求，请稍候...'
                    });

                    try {
                        const res = await fetch(`${API_BASE}/api-configs.php?action=test`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(api)
                        });
                        const data = await res.json();
                        if (data.success) {
                            const result = data.data;
                            this.setAPITestResult(api, result.success ? 'success' : 'failed', {
                                startedAt,
                                latency_ms: result.latency_ms,
                                message: result.message || (result.success ? '连接成功' : '连接失败'),
                                response: result
                            });
                            await this.loadAPIConfigs();
                        } else {
                            this.setAPITestResult(api, 'failed', {
                                startedAt,
                                message: data.error || '测试失败',
                                response: data
                            });
                        }
                    } catch (e) {
                        console.error('Test API config error:', e);
                        this.setAPITestResult(api, 'error', {
                            startedAt,
                            message: e?.message || '测试请求异常',
                            response: { error: e?.message || String(e) }
                        });
                    } finally {
                        this.testingAPIId = null;
                    }
                },

                async saveAPIStrategy() {
                    try {
                        const res = await fetch(`${API_BASE}/api-configs.php?action=strategy`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ rotation_strategy: this.apiStrategy })
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.apiStrategy = data.data.settings.rotation_strategy;
                            alert('轮换策略已保存');
                        } else {
                            alert(data.error || '保存失败');
                        }
                    } catch (e) {
                        console.error('Save API strategy error:', e);
                        alert('保存失败');
                    }
                },

                formatAPIType(type) {
                    if (type === 'messages') return 'Anthropic Messages';
                    if (type === 'embeddings') return '向量化 Embeddings';
                    return '通用 OpenAI 兼容';
                },

                apiTypeBadgeClass(type) {
                    if (type === 'messages') return 'bg-violet-50 text-violet-700';
                    if (type === 'embeddings') return 'bg-emerald-50 text-emerald-700';
                    return 'bg-slate-100 text-slate-700';
                },

                formatAPITest(api) {
                    if (api.last_test_status === 'success') {
                        return `成功 ${api.last_test_latency_ms || 0}ms`;
                    }
                    if (api.last_test_status === 'failed') {
                        return '失败';
                    }
                    return '未测试';
                },

                exportLogs(format = 'csv') {
                    let url = `${API_BASE}/logs.php?action=export&format=${format}`;
                    if (this.logFilter) url += `&mode=${this.logFilter}`;
                    if (this.logStartDate) url += `&start_date=${this.logStartDate}`;
                    if (this.logEndDate) url += `&end_date=${this.logEndDate}`;
                    window.open(url, '_blank');
                },

                async clearAllLogs() {
                    if (!this.isSuperAdmin || this.isClearingLogs) return;

                    const firstConfirm = confirm('确定要清空所有前台用户的对话日志吗？公开分享页也会一并失效，此操作不可恢复。');
                    if (!firstConfirm) return;

                    const confirmText = prompt('请输入“清空对话日志”确认执行。');
                    if (confirmText !== '清空对话日志') {
                        alert('确认文字不一致，已取消清空操作。');
                        return;
                    }

                    this.isClearingLogs = true;
                    try {
                        const res = await fetch(`${API_BASE}/logs.php?action=clear_all`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                confirm: 'CLEAR_ALL_LOGS',
                                csrf_token: this.adminCsrfToken
                            })
                        });
                        const data = await res.json();
                        if (!data.success) {
                            alert(data.error || '清空失败');
                            return;
                        }

                        const deleted = data.data?.deleted || {};
                        this.isLogDrawerOpen = false;
                        this.activeLog = null;
                        this.activeLogMessages = [];
                        this.logPage = 1;
                        this.logs = [];
                        this.logTotal = 0;
                        await Promise.all([this.loadLogs(), this.loadDashboard()]);
                        alert(`已清空对话日志：${deleted.sessions || 0} 个会话，${deleted.messages || 0} 条消息，${deleted.shares || 0} 个分享链接。`);
                    } catch (e) {
                        console.error('Clear logs error:', e);
                        alert('清空失败，请稍后重试');
                    } finally {
                        this.isClearingLogs = false;
                    }
                },

                clearDateFilter() {
                    this.logStartDate = '';
                    this.logEndDate = '';
                    this.loadLogs();
                },

                async logout() {
                    if (!confirm('确定要退出登录吗？')) return;
                    try { await fetch(`${API_BASE}/auth.php?action=admin_logout`); } catch(e) {}
                    window.location.href = 'admin_login.php';
                },

                formatRole(role) {
                    const roles = { 'super_admin': '超级管理员', 'admin': '管理员', 'sales_manager': '销售经理', 'sales_rep': '销售代表' };
                    return roles[role] || role;
                },

                apiStatsStatusClass(status) {
                    const map = {
                        healthy: 'border-green-100 bg-green-50 text-green-700',
                        warning: 'border-amber-100 bg-amber-50 text-amber-700',
                        critical: 'border-red-100 bg-red-50 text-red-700',
                        nodata: 'border-gray-200 bg-gray-50 text-gray-500'
                    };
                    return map[status] || map.nodata;
                },

                tabClass(tab) {
                    return this.currentTab === tab ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900';
                },

                iconClass(tab, icon) {
                    const iconName = String(icon || '').trim();
                    const iconClass = iconName.startsWith('fa-') ? iconName : `fa-${iconName}`;
                    return `fas ${iconClass}${this.currentTab === tab ? ' text-gray-900' : ' text-gray-400 group-hover:text-gray-500'}`;
                },

                // 探索建议管理方法
                async loadSuggestionTemplates() {
                    try {
                        const res = await fetch(`${API_BASE}/suggestions.php?action=templates`);
                        const data = await res.json();
                        if (data.success) {
                            this.suggestionScenarios = data.data.scenarios || [];
                            const active = this.suggestionScenarios.find(s => Number(s.is_active) === 1);
                            if (!this.selectedSuggestionScenarioSlug) {
                                this.selectedSuggestionScenarioSlug = active?.slug || this.suggestionScenarios[0]?.slug || '';
                            }
                        }
                    } catch (e) {
                        console.error('Load suggestion templates error:', e);
                    }
                },

                async loadSuggestions() {
                    try {
                        const res = await fetch(`${API_BASE}/suggestions.php?action=list`);
                        const data = await res.json();
                        if (data.success) this.suggestions = data.data.suggestions;
                        await this.loadSuggestionTemplates();
                    } catch (e) { console.error('Load suggestions error:', e); }
                },

                async applySuggestionTemplate() {
                    if (!this.selectedSuggestionScenarioSlug) {
                        alert('请选择探索建议模板');
                        return;
                    }

                    const scenario = this.suggestionScenarios.find(s => s.slug === this.selectedSuggestionScenarioSlug);
                    if (!scenario) {
                        alert('探索建议模板不存在');
                        return;
                    }

                    if (!confirm(`确定应用「${scenario.name}」探索建议模板吗？当前热搜榜和技能提升内容将被模板覆盖。`)) {
                        return;
                    }

                    try {
                        this.isApplyingSuggestionTemplate = true;
                        const res = await fetch(`${API_BASE}/suggestions.php?action=apply_template`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ slug: this.selectedSuggestionScenarioSlug })
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.suggestions = data.data.suggestions || [];
                            this.suggestionScenarios = data.data.scenarios || this.suggestionScenarios;
                            this.selectedSuggestionScenarioSlug = data.data.active_scenario_slug || scenario.slug;
                            alert('探索建议模板已生效');
                        } else {
                            alert(data.error || '应用模板失败');
                        }
                    } catch (e) {
                        console.error('Apply suggestion template error:', e);
                        alert('应用模板失败');
                    } finally {
                        this.isApplyingSuggestionTemplate = false;
                    }
                },

                openSuggestionModal() {
                    this.editingSuggestion = null;
                    this.suggestionForm = {
                        type: this.suggestionTab,
                        title: '',
                        subtitle: '',
                        content: '',
                        icon: this.suggestionTab === 'hot_search' ? 'fas fa-fire' : 'fas fa-brain',
                        color_class: this.suggestionTab === 'hot_search' ? 'text-blue-700' : 'from-blue-50 to-sky-50 border-blue-100 text-blue-600',
                        sort_order: this.filteredSuggestions.length + 1
                    };
                    this.isSuggestionModalOpen = true;
                },

                editSuggestion(suggestion) {
                    this.editingSuggestion = suggestion;
                    this.suggestionForm = { ...suggestion };
                    this.isSuggestionModalOpen = true;
                },

                async saveSuggestion() {
                    if (!this.suggestionForm.title || !this.suggestionForm.content) {
                        alert('请填写标题和内容');
                        return;
                    }
                    try {
                        const action = this.editingSuggestion ? 'update' : 'create';
                        const body = this.editingSuggestion ? { ...this.suggestionForm, id: this.editingSuggestion.id } : this.suggestionForm;
                        const res = await fetch(`${API_BASE}/suggestions.php?action=${action}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.isSuggestionModalOpen = false;
                            await this.loadSuggestions();
                        } else {
                            alert(data.error || '保存失败');
                        }
                    } catch (e) {
                        console.error('Save suggestion error:', e);
                        alert('保存失败');
                    }
                },

                async deleteSuggestion(id) {
                    if (!confirm('确定要删除这个建议吗？')) return;
                    try {
                        const res = await fetch(`${API_BASE}/suggestions.php?action=delete&id=${id}`, { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadSuggestions();
                        } else {
                            alert(data.error || '删除失败');
                        }
                    } catch (e) {
                        console.error('Delete suggestion error:', e);
                        alert('删除失败');
                    }
                }
            }
        }
    </script>
</body>
</html>
