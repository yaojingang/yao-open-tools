<?php
/**
 * Sales AI Assistant - container health check.
 *
 * This endpoint is intentionally read-only. It does not initialize or migrate
 * the database; the container entrypoint is responsible for first-run setup.
 */

require_once __DIR__ . '/api/config.php';

header('Content-Type: application/json; charset=utf-8');

function iniSizeToBytes($value) {
    $value = trim((string)$value);
    if ($value === '') {
        return 0;
    }

    if ($value === '-1') {
        return PHP_INT_MAX;
    }

    $unit = strtolower($value[strlen($value) - 1]);
    $number = (float)$value;

    switch ($unit) {
        case 'g':
            return (int)($number * 1024 * 1024 * 1024);
        case 'm':
            return (int)($number * 1024 * 1024);
        case 'k':
            return (int)($number * 1024);
        default:
            return (int)$number;
    }
}

$checks = [];

$requiredExtensions = ['pdo_sqlite', 'sqlite3', 'curl', 'json', 'mbstring', 'openssl', 'zip', 'fileinfo'];
foreach ($requiredExtensions as $extension) {
    $checks['extension_' . $extension] = extension_loaded($extension);
}

$checks['php_upload_max_filesize_ok'] = iniSizeToBytes(ini_get('upload_max_filesize')) >= UPLOAD_MAX_SIZE;
$checks['php_post_max_size_ok'] = iniSizeToBytes(ini_get('post_max_size')) >= UPLOAD_MAX_SIZE;

$checks['data_dir_writable'] = is_dir(dirname(DB_PATH)) && is_writable(dirname(DB_PATH));
$checks['upload_dir_writable'] = is_dir(UPLOAD_PATH) && is_writable(UPLOAD_PATH);
$checks['log_dir_writable'] = is_dir(__DIR__ . '/logs') && is_writable(__DIR__ . '/logs');
$checks['database_exists'] = is_file(DB_PATH);
$checks['database_readable'] = is_file(DB_PATH) && is_readable(DB_PATH);
$checks['database_writable'] = is_file(DB_PATH) && is_writable(DB_PATH);

if ($checks['database_readable']) {
    try {
        $db = new PDO('sqlite:' . DB_PATH);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->query("SELECT name FROM sqlite_master LIMIT 1");
        $checks['database_query'] = true;
    } catch (Throwable $e) {
        $checks['database_query'] = false;
    }
} else {
    $checks['database_query'] = false;
}

$healthy = !in_array(false, $checks, true);
http_response_code($healthy ? 200 : 503);

echo json_encode([
    'success' => $healthy,
    'status' => $healthy ? 'ok' : 'failed',
    'checks' => $checks
], JSON_UNESCAPED_UNICODE);
