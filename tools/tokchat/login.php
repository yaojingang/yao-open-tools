<?php
// 设置永久session（10年）
ini_set('session.cookie_lifetime', 315360000);
ini_set('session.gc_maxlifetime', 315360000);
session_set_cookie_params(315360000, '/');
session_start();

require_once __DIR__ . '/api/db.php';
initDatabase();

$siteSettings = getSiteSettings();
$frontendAnalyticsCode = trim($siteSettings['frontend_analytics_code'] ?? '');

function esc($value) {
    return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

// 如果已登录，跳转到首页
if (isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit;
}

// 检查remember cookie自动登录
if (isset($_COOKIE['remember_token']) && isset($_COOKIE['remember_user_id'])) {
    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, role, status FROM users WHERE id = ? AND remember_token = ? AND status = 'active'");
    $stmt->execute([$_COOKIE['remember_user_id'], $_COOKIE['remember_token']]);
    $user = $stmt->fetch();

    if ($user) {
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_name'] = $user['name'];
        $_SESSION['user_role'] = $user['role'];

        // 更新最后登录时间
        $stmt = $db->prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?");
        $stmt->execute([$user['id']]);

        header('Location: index.php');
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 - <?php echo esc($siteSettings['login_page_title']); ?></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; }
        .login-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        }
        .input-focus:focus {
            outline: none;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
            border-color: #2563eb;
        }
    </style>
</head>
<body class="min-h-screen bg-white flex items-center justify-center p-4 text-slate-900">
    <div class="login-card rounded-2xl w-full max-w-md p-8 relative z-10">
        <!-- Logo -->
        <div class="text-center mb-8">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-sm mb-4">
                <i class="fas fa-message text-xl"></i>
            </div>
            <h1 class="text-2xl font-bold text-slate-950"><?php echo esc($siteSettings['login_page_title']); ?></h1>
            <p class="text-slate-500 mt-2"><?php echo esc($siteSettings['login_page_description']); ?></p>
        </div>

        <!-- 登录表单 -->
        <form id="loginForm" class="space-y-6">
            <div>
                <label class="block text-sm font-medium text-slate-700 mb-2">
                    <i class="fas fa-mobile-alt mr-2 text-blue-600"></i>手机号
                </label>
                <input
                    type="tel"
                    id="phone"
                    name="phone"
                    placeholder="请输入您的手机号"
                    maxlength="11"
                    class="w-full px-4 py-3 rounded-xl border border-slate-200 text-lg tracking-wider input-focus transition-all"
                    autocomplete="tel"
                    required
                >
            </div>

            <div id="errorMsg" class="hidden bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100">
                <i class="fas fa-exclamation-circle mr-2"></i>
                <span id="errorText"></span>
            </div>

            <button
                type="submit"
                id="submitBtn"
                class="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2"
            >
                <span id="btnText">登录</span>
                <i id="btnIcon" class="fas fa-arrow-right"></i>
            </button>
        </form>

        <!-- 提示 -->
        <div class="mt-6 text-center text-sm text-slate-500">
            <i class="fas fa-info-circle mr-1"></i>
            没有账号？请联系管理员添加
        </div>

        <!-- 底部装饰 -->
        <div class="mt-8 pt-6 border-t border-slate-100 text-center text-xs text-slate-400">
            <i class="fas fa-shield-alt mr-1"></i> 安全登录 · 数据加密传输
            <p class="mt-2 leading-relaxed"><?php echo esc($siteSettings['copyright_text']); ?></p>
        </div>
    </div>

    <script>
        const form = document.getElementById('loginForm');
        const phoneInput = document.getElementById('phone');
        const errorMsg = document.getElementById('errorMsg');
        const errorText = document.getElementById('errorText');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const btnIcon = document.getElementById('btnIcon');

        // 只允许输入数字
        phoneInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const phone = phoneInput.value.trim();

            if (!/^1[3-9]\d{9}$/.test(phone)) {
                showError('请输入正确的11位手机号');
                return;
            }

            // Loading状态
            setLoading(true);
            hideError();

            try {
                const res = await fetch('api/auth.php?action=login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const data = await res.json();

                if (data.success) {
                    btnText.textContent = '登录成功';
                    btnIcon.className = 'fas fa-check';
                    setTimeout(() => {
                        window.location.href = 'index.php';
                    }, 500);
                } else {
                    showError(data.error || '登录失败');
                    setLoading(false);
                }
            } catch (err) {
                showError('网络错误，请重试');
                setLoading(false);
            }
        });

        function showError(msg) { errorText.textContent = msg; errorMsg.classList.remove('hidden'); }
        function hideError() { errorMsg.classList.add('hidden'); }
        function setLoading(loading) {
            submitBtn.disabled = loading;
            if (loading) { btnText.textContent = '登录中...'; btnIcon.className = 'fas fa-spinner fa-spin'; }
            else { btnText.textContent = '登录'; btnIcon.className = 'fas fa-arrow-right'; }
        }
    </script>
    <?php if ($frontendAnalyticsCode !== ''): ?>
    <?php echo "\n" . $frontendAnalyticsCode . "\n"; ?>
    <?php endif; ?>
</body>
</html>
