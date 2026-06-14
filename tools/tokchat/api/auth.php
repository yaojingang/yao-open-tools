<?php
/**
 * 销售AI支持系统 - 认证API
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

// 设置永久session（10年）
ini_set('session.cookie_lifetime', 315360000);
ini_set('session.gc_maxlifetime', 315360000);
session_set_cookie_params([
    'lifetime' => 315360000,
    'path' => '/',
    'secure' => false,
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

// 初始化数据库
initDatabase();

$action = getParam('action', 'check');

switch ($action) {
    case 'login':
        handleLogin();
        break;
    case 'logout':
        handleLogout();
        break;
    case 'admin_logout':
        handleAdminLogout();
        break;
    case 'check':
        handleCheck();
        break;
    case 'current_user':
        handleCurrentUser();
        break;
    case 'update_profile':
        handleUpdateProfile();
        break;
    case 'check_remember':
        handleCheckRemember();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 手机号登录（前台用户，永久保存登录状态）
 */
function handleLogin() {
    $input = getJsonInput();
    $phone = $input['phone'] ?? '';

    if (empty($phone)) {
        jsonError('请输入手机号');
    }

    // 验证手机号格式
    if (!preg_match('/^1[3-9]\d{9}$/', $phone)) {
        jsonError('手机号格式不正确');
    }

    $db = getDB();

    // 查找用户
    $stmt = $db->prepare("SELECT * FROM users WHERE phone = ? AND status = 'active'");
    $stmt->execute([$phone]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('该手机号未注册或已被禁用，请联系管理员');
    }

    // 生成永久记住token
    $rememberToken = bin2hex(random_bytes(32));

    // 更新最后登录时间和remember_token
    $stmt = $db->prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP, remember_token = ? WHERE id = ?");
    $stmt->execute([$rememberToken, $user['id']]);

    // 设置session
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_name'] = $user['name'];
    $_SESSION['user_role'] = $user['role'];
    $_SESSION['user_phone'] = $user['phone'];
    $_SESSION['user_avatar'] = $user['avatar'];
    $_SESSION['login_time'] = time();

    // 设置永久cookie（10年）
    $cookieExpiry = time() + 315360000;
    setcookie('remember_token', $rememberToken, $cookieExpiry, '/', '', false, true);
    setcookie('remember_user_id', $user['id'], $cookieExpiry, '/', '', false, true);

    jsonSuccess([
        'user' => [
            'id' => $user['id'],
            'name' => $user['name'],
            'role' => $user['role'],
            'phone' => $user['phone'],
            'avatar' => $user['avatar']
        ]
    ]);
}

/**
 * 退出登录
 */
function handleLogout() {
    // 清除remember_token
    if (isset($_SESSION['user_id'])) {
        $db = getDB();
        $stmt = $db->prepare("UPDATE users SET remember_token = NULL WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
    }

    // 清除cookies
    setcookie('remember_token', '', time() - 3600, '/');
    setcookie('remember_user_id', '', time() - 3600, '/');

    session_destroy();
    jsonSuccess(['message' => '已退出登录']);
}

/**
 * 后台管理员退出登录
 */
function handleAdminLogout() {
    unset($_SESSION['admin_id']);
    unset($_SESSION['admin_username']);
    unset($_SESSION['admin_name']);
    unset($_SESSION['admin_role']);
    session_destroy();
    jsonSuccess(['message' => '管理员已退出登录']);
}

/**
 * 检查登录状态
 */
function handleCheck() {
    if (isset($_SESSION['user_id'])) {
        jsonSuccess([
            'logged_in' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'name' => $_SESSION['user_name'],
                'role' => $_SESSION['user_role']
            ]
        ]);
    } else {
        jsonSuccess(['logged_in' => false]);
    }
}

/**
 * 检查remember cookie并自动登录
 */
function handleCheckRemember() {
    // 如果已有session，直接返回
    if (isset($_SESSION['user_id'])) {
        jsonSuccess([
            'logged_in' => true,
            'user' => [
                'id' => $_SESSION['user_id'],
                'name' => $_SESSION['user_name'],
                'role' => $_SESSION['user_role'],
                'phone' => $_SESSION['user_phone'] ?? '',
                'avatar' => $_SESSION['user_avatar'] ?? ''
            ]
        ]);
        return;
    }

    // 检查remember cookie
    $rememberToken = $_COOKIE['remember_token'] ?? '';
    $rememberUserId = $_COOKIE['remember_user_id'] ?? '';

    if (empty($rememberToken) || empty($rememberUserId)) {
        jsonSuccess(['logged_in' => false]);
        return;
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM users WHERE id = ? AND remember_token = ? AND status = 'active'");
    $stmt->execute([$rememberUserId, $rememberToken]);
    $user = $stmt->fetch();

    if (!$user) {
        // 无效的token，清除cookie
        setcookie('remember_token', '', time() - 3600, '/');
        setcookie('remember_user_id', '', time() - 3600, '/');
        jsonSuccess(['logged_in' => false]);
        return;
    }

    // 自动登录成功，恢复session
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_name'] = $user['name'];
    $_SESSION['user_role'] = $user['role'];
    $_SESSION['user_phone'] = $user['phone'];
    $_SESSION['user_avatar'] = $user['avatar'];
    $_SESSION['login_time'] = time();

    jsonSuccess([
        'logged_in' => true,
        'user' => [
            'id' => $user['id'],
            'name' => $user['name'],
            'role' => $user['role'],
            'phone' => $user['phone'],
            'avatar' => $user['avatar']
        ]
    ]);
}

/**
 * 获取当前用户信息
 */
function handleCurrentUser() {
    if (!isset($_SESSION['user_id'])) {
        jsonError('未登录', 401);
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, role, phone, avatar, email FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    if (!$user) {
        session_destroy();
        jsonError('用户不存在', 401);
    }

    jsonSuccess(['user' => $user]);
}

/**
 * 更新当前前台用户资料
 */
function handleUpdateProfile() {
    if (!isset($_SESSION['user_id'])) {
        jsonError('未登录', 401);
    }

    $input = getJsonInput();
    $name = trim((string)($input['name'] ?? ''));

    if ($name === '') {
        jsonError('显示名称不能为空');
    }
    if (mb_strlen($name) > 30) {
        jsonError('显示名称不能超过30个字符');
    }

    $db = getDB();
    $stmt = $db->prepare("UPDATE users SET name = ? WHERE id = ?");
    $stmt->execute([$name, $_SESSION['user_id']]);

    $_SESSION['user_name'] = $name;

    $stmt = $db->prepare("SELECT id, name, role, phone, avatar, email FROM users WHERE id = ?");
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    jsonSuccess(['user' => $user], '资料已更新');
}
