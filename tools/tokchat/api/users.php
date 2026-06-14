<?php
/**
 * 销售AI支持系统 - 用户管理API
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

$action = getParam('action', 'list');

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

switch ($action) {
    case 'list':
        handleList();
        break;
    case 'get':
        handleGet();
        break;
    case 'create':
        handleCreate();
        break;
    case 'update':
        handleUpdate();
        break;
    case 'delete':
        handleDelete();
        break;
    // 管理员相关操作
    case 'list_admins':
        handleListAdmins();
        break;
    case 'create_admin':
        handleCreateAdmin();
        break;
    case 'update_admin':
        handleUpdateAdmin();
        break;
    case 'delete_admin':
        handleDeleteAdmin();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取用户列表
 */
function handleList() {
    $db = getDB();
    $role = getParam('role');
    $status = getParam('status');
    $search = getParam('search');

    $sql = "SELECT id, name, email, phone, company, role, status, avatar, created_at, last_login FROM users WHERE 1=1";
    $params = [];

    if ($role) {
        $sql .= " AND role = ?";
        $params[] = $role;
    }
    if ($status) {
        $sql .= " AND status = ?";
        $params[] = $status;
    }
    if ($search) {
        $sql .= " AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)";
        $searchTerm = "%$search%";
        $params[] = $searchTerm;
        $params[] = $searchTerm;
        $params[] = $searchTerm;
    }

    $sql .= " ORDER BY created_at DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $users = $stmt->fetchAll();

    // 格式化最后登录时间
    foreach ($users as &$user) {
        $user['last_login_formatted'] = formatTimeAgo($user['last_login']);
    }

    jsonSuccess(['users' => $users]);
}

/**
 * 获取单个用户
 */
function handleGet() {
    $id = getParam('id');
    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, email, phone, company, role, status, avatar, created_at, last_login FROM users WHERE id = ?");
    $stmt->execute([$id]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonError('用户不存在');
    }

    jsonSuccess($user);
}

/**
 * 创建用户
 */
function handleCreate() {
    $input = getJsonInput();
    $name = $input['name'] ?? '';
    $phone = $input['phone'] ?? '';
    $email = $input['email'] ?? '';
    $company = $input['company'] ?? '';
    $role = $input['role'] ?? 'sales_rep';
    $password = $input['password'] ?? '';

    if (empty($name) || empty($phone) || empty($company)) {
        jsonError('姓名、手机号和公司简称不能为空');
    }

    // 验证手机号格式
    if (!preg_match('/^1[3-9]\d{9}$/', $phone)) {
        jsonError('手机号格式不正确');
    }

    // 验证邮箱格式（如果填写了）
    if (!empty($email) && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonError('邮箱格式不正确');
    }

    $db = getDB();

    // 检查手机号是否已存在
    $stmt = $db->prepare("SELECT id FROM users WHERE phone = ?");
    $stmt->execute([$phone]);
    if ($stmt->fetch()) {
        jsonError('该手机号已被使用');
    }

    // 检查邮箱是否已存在（如果填写了）
    if (!empty($email)) {
        $stmt = $db->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            jsonError('该邮箱已被使用');
        }
    }

    // 生成头像URL
    $avatar = 'https://ui-avatars.com/api/?name=' . urlencode($name) . '&background=random&color=fff';

    // 密码哈希
    $passwordHash = !empty($password) ? password_hash($password, PASSWORD_DEFAULT) : null;

    $stmt = $db->prepare("INSERT INTO users (name, phone, email, company, role, password_hash, avatar, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')");
    $stmt->execute([$name, $phone, $email ?: null, $company, $role, $passwordHash, $avatar]);

    $userId = $db->lastInsertId();

    jsonSuccess([
        'id' => (int)$userId,
        'name' => $name,
        'phone' => $phone,
        'email' => $email,
        'company' => $company,
        'role' => $role,
        'avatar' => $avatar
    ], '用户创建成功');
}

/**
 * 更新用户
 */
function handleUpdate() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();

    $updates = [];
    $params = [];

    if (isset($input['name'])) {
        $updates[] = "name = ?";
        $params[] = $input['name'];
    }
    if (isset($input['phone'])) {
        // 验证手机号格式
        if (!preg_match('/^1[3-9]\d{9}$/', $input['phone'])) {
            jsonError('手机号格式不正确');
        }
        // 检查手机号是否已被其他用户使用
        $stmt = $db->prepare("SELECT id FROM users WHERE phone = ? AND id != ?");
        $stmt->execute([$input['phone'], $id]);
        if ($stmt->fetch()) {
            jsonError('该手机号已被使用');
        }
        $updates[] = "phone = ?";
        $params[] = $input['phone'];
    }
    if (isset($input['email'])) {
        $updates[] = "email = ?";
        $params[] = $input['email'];
    }
    if (isset($input['company'])) {
        $updates[] = "company = ?";
        $params[] = $input['company'];
    }
    if (isset($input['role'])) {
        $updates[] = "role = ?";
        $params[] = $input['role'];
    }
    if (isset($input['status'])) {
        $updates[] = "status = ?";
        $params[] = $input['status'];
    }

    if (empty($updates)) {
        jsonError('没有要更新的内容');
    }

    $params[] = $id;
    $sql = "UPDATE users SET " . implode(', ', $updates) . " WHERE id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    jsonSuccess([], '用户更新成功');
}

/**
 * 删除用户
 */
function handleDelete() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$id]);

    jsonSuccess([], '用户已删除');
}

/**
 * 格式化时间为"多久之前"
 */
function formatTimeAgo($datetime) {
    if (!$datetime) {
        return '从未登录';
    }

    $timestamp = strtotime($datetime);
    $diff = time() - $timestamp;

    if ($diff < 60) {
        return '刚刚';
    } elseif ($diff < 3600) {
        return floor($diff / 60) . '分钟前';
    } elseif ($diff < 86400) {
        return floor($diff / 3600) . '小时前';
    } elseif ($diff < 604800) {
        return floor($diff / 86400) . '天前';
    } else {
        return date('Y-m-d', $timestamp);
    }
}

// ============ 管理员相关操作 ============

/**
 * 获取管理员列表
 */
function handleListAdmins() {
    // 检查是否是超级管理员
    if (!isset($_SESSION['admin_role']) || $_SESSION['admin_role'] !== 'super_admin') {
        jsonError('无权限访问');
    }

    $db = getDB();
    $stmt = $db->query("SELECT id, username, name, role, status, avatar, created_at, last_login FROM admins ORDER BY id ASC");
    $admins = $stmt->fetchAll();

    jsonSuccess(['admins' => $admins]);
}

/**
 * 创建管理员
 */
function handleCreateAdmin() {
    // 检查是否是超级管理员
    if (!isset($_SESSION['admin_role']) || $_SESSION['admin_role'] !== 'super_admin') {
        jsonError('无权限操作');
    }

    $input = getJsonInput();
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $name = trim($input['name'] ?? '');
    $role = $input['role'] ?? 'admin';

    if (empty($username) || empty($password) || empty($name)) {
        jsonError('用户名、密码和姓名不能为空');
    }

    // 验证用户名格式（字母数字下划线）
    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        jsonError('用户名只能包含字母、数字和下划线，长度3-20位');
    }

    $db = getDB();

    // 检查用户名是否已存在
    $stmt = $db->prepare("SELECT id FROM admins WHERE username = ?");
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        jsonError('该用户名已被使用');
    }

    // 密码哈希
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    $stmt = $db->prepare("INSERT INTO admins (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, 'active')");
    $stmt->execute([$username, $passwordHash, $name, $role]);

    $adminId = $db->lastInsertId();

    jsonSuccess([
        'id' => (int)$adminId,
        'username' => $username,
        'name' => $name,
        'role' => $role
    ], '管理员创建成功');
}

/**
 * 更新管理员
 */
function handleUpdateAdmin() {
    // 检查是否是超级管理员
    if (!isset($_SESSION['admin_role']) || $_SESSION['admin_role'] !== 'super_admin') {
        jsonError('无权限操作');
    }

    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();

    $updates = [];
    $params = [];

    if (isset($input['name']) && !empty(trim($input['name']))) {
        $updates[] = "name = ?";
        $params[] = trim($input['name']);
    }
    if (isset($input['password']) && !empty($input['password'])) {
        $updates[] = "password_hash = ?";
        $params[] = password_hash($input['password'], PASSWORD_DEFAULT);
    }
    if (isset($input['role'])) {
        $updates[] = "role = ?";
        $params[] = $input['role'];
    }

    if (empty($updates)) {
        jsonError('没有要更新的内容');
    }

    $params[] = $id;
    $sql = "UPDATE admins SET " . implode(', ', $updates) . " WHERE id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    jsonSuccess([], '管理员更新成功');
}

/**
 * 删除管理员
 */
function handleDeleteAdmin() {
    // 检查是否是超级管理员
    if (!isset($_SESSION['admin_role']) || $_SESSION['admin_role'] !== 'super_admin') {
        jsonError('无权限操作');
    }

    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();

    // 检查是否是超级管理员账号
    $stmt = $db->prepare("SELECT role FROM admins WHERE id = ?");
    $stmt->execute([$id]);
    $admin = $stmt->fetch();

    if ($admin && $admin['role'] === 'super_admin') {
        jsonError('不能删除超级管理员账号');
    }

    $stmt = $db->prepare("DELETE FROM admins WHERE id = ?");
    $stmt->execute([$id]);

    jsonSuccess([], '管理员已删除');
}
