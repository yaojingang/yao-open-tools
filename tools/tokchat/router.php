<?php
/**
 * PHP built-in server router.
 *
 * Only public application pages and API front controllers should be reachable
 * over HTTP. Maintenance scripts in the project root are intentionally blocked.
 */

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

$publicPages = [
    '/',
    '/index.php',
    '/login.php',
    '/admin.php',
    '/admin_login.php',
    '/api-stats.php',
    '/share.php',
    '/health.php',
];

$publicApi = [
    '/api/auth.php',
    '/api/users.php',
    '/api/stats.php',
    '/api/api-stats.php',
    '/api/stream.php',
    '/api/logs.php',
    '/api/api-configs.php',
    '/api/frontend.php',
    '/api/prompts.php',
    '/api/suggestions.php',
    '/api/settings.php',
    '/api/knowledge.php',
    '/api/chat.php',
    '/api/learn.php',
    '/api/shares.php',
];

if ($path === '/favicon.ico') {
    http_response_code(204);
    return true;
}

if (in_array($path, $publicPages, true) || in_array($path, $publicApi, true)) {
    return false;
}

if (str_starts_with($path, '/data/') || str_starts_with($path, '/logs/') ||
    str_starts_with($path, '/uploads/') || str_starts_with($path, '/cache/') ||
    str_starts_with($path, '/temp/')) {
    http_response_code(404);
    echo 'Not Found';
    return true;
}

if (str_starts_with($path, '/api/')) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => '接口不存在'], JSON_UNESCAPED_UNICODE);
    return true;
}

http_response_code(404);
echo 'Not Found';
return true;
