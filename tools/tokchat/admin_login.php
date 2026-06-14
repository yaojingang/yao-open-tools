<?php
session_start();
require_once __DIR__ . '/api/db.php';
initDatabase();

$siteSettings = getSiteSettings();

function esc($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

// 如果已登录管理员，直接跳转到后台
if (isset($_SESSION['admin_id'])) {
    header('Location: admin.php');
    exit;
}

$error = '';

// 处理登录请求
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';

    if (empty($username) || empty($password)) {
        $error = '请输入用户名和密码';
    } else {
        $db = getDB();
        $stmt = $db->prepare("SELECT * FROM admins WHERE username = ? AND status = 'active'");
        $stmt->execute([$username]);
        $admin = $stmt->fetch();

        if ($admin && password_verify($password, $admin['password_hash'])) {
            // 登录成功
            $_SESSION['admin_id'] = $admin['id'];
            $_SESSION['admin_username'] = $admin['username'];
            $_SESSION['admin_name'] = $admin['name'];
            $_SESSION['admin_role'] = $admin['role'];
            $_SESSION['admin_login_time'] = time();

            // 更新最后登录时间
            $stmt = $db->prepare("UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([$admin['id']]);

            header('Location: admin.php');
            exit;
        } else {
            $error = '用户名或密码错误';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理后台登录 - <?php echo esc($siteSettings['admin_login_title']); ?></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
    <div class="w-full max-w-md">
        <!-- Logo区域 -->
        <div class="text-center mb-8">
            <div class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-red-500 to-orange-500 rounded-2xl shadow-lg mb-4">
                <i class="fas fa-shield-alt text-white text-2xl"></i>
            </div>
            <h1 class="text-2xl font-bold text-white"><?php echo esc($siteSettings['admin_login_title']); ?></h1>
            <p class="text-slate-400 mt-2"><?php echo esc($siteSettings['admin_login_description']); ?></p>
        </div>

        <!-- 登录卡片 -->
        <div class="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-white/20">
            <?php if ($error): ?>
            <div class="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl mb-6 flex items-center gap-3">
                <i class="fas fa-exclamation-circle"></i>
                <span><?= htmlspecialchars($error) ?></span>
            </div>
            <?php endif; ?>

            <form method="POST" class="space-y-6">
                <div>
                    <label class="block text-sm font-medium text-slate-300 mb-2">
                        <i class="fas fa-user mr-2"></i>用户名
                    </label>
                    <input type="text" name="username" required
                           class="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition"
                           placeholder="请输入管理员用户名"
                           value="<?= htmlspecialchars($_POST['username'] ?? '') ?>">
                </div>

                <div>
                    <label class="block text-sm font-medium text-slate-300 mb-2">
                        <i class="fas fa-lock mr-2"></i>密码
                    </label>
                    <input type="password" name="password" required
                           class="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition"
                           placeholder="请输入密码">
                </div>

                <button type="submit"
                        class="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-red-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200">
                    <i class="fas fa-sign-in-alt mr-2"></i>登录后台
                </button>
            </form>
        </div>

        <!-- 底部链接 -->
        <div class="text-center mt-6">
            <a href="login.php" class="text-slate-400 hover:text-white transition text-sm">
                <i class="fas fa-arrow-left mr-2"></i>返回前台登录
            </a>
        </div>

        <p class="text-center text-slate-500 text-xs mt-8">
            <?php echo esc($siteSettings['copyright_text']); ?>
        </p>
    </div>
</body>
</html>
