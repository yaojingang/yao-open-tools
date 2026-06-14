<?php
/**
 * 销售AI支持系统 - 配置文件
 */

// 防止直接访问
if (!defined('SALES_AI_SYSTEM')) {
    define('SALES_AI_SYSTEM', true);
}

function envValue($key, $default = '') {
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : $value;
}

function envInt($key, $default) {
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : (int)$value;
}

function envFloat($key, $default) {
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : (float)$value;
}

function envBool($key, $default = false) {
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }
    return in_array(strtolower((string)$value), ['1', 'true', 'yes', 'on'], true);
}

// 错误报告设置 (开发环境开启，生产环境关闭)
$appDebug = envBool('APP_DEBUG', true);
error_reporting(E_ALL);
ini_set('display_errors', $appDebug ? '1' : '0');
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../logs/php_errors.log');

// 设置更高的执行时间和内存限制
ini_set('max_execution_time', (string)envInt('PHP_MAX_EXECUTION_TIME', 300)); // 默认5分钟
ini_set('memory_limit', envValue('PHP_MEMORY_LIMIT', '256M'));

// 时区设置
date_default_timezone_set(envValue('TZ', 'Asia/Shanghai'));

// 首次初始化账号配置。生产环境上线后请立即在后台修改默认密码。
define('DEFAULT_ADMIN_USERNAME', envValue('DEFAULT_ADMIN_USERNAME', 'admin'));
define('DEFAULT_ADMIN_PASSWORD', envValue('DEFAULT_ADMIN_PASSWORD', 'change-me-now'));
define('DEFAULT_ADMIN_NAME', envValue('DEFAULT_ADMIN_NAME', '超级管理员'));
define('SEED_DEMO_USERS', envBool('SEED_DEMO_USERS', false));

// 兔子API配置 - 主API（更快更稳定的API）
define('TUZI_API_URL', envValue('TUZI_API_URL', 'https://api.tu-zi.com/v1/messages'));
define('TUZI_API_KEY', envValue('TUZI_API_KEY', ''));
define('TUZI_MODEL', envValue('TUZI_MODEL', 'claude-sonnet-4-5-20250929'));

// 兔子API配置 - 备用API（原主API，响应较慢）
define('TUZI_BACKUP_API_URL', envValue('TUZI_BACKUP_API_URL', 'https://apicdn.tu-zi.com/v1/chat/completions'));
define('TUZI_BACKUP_API_KEY', envValue('TUZI_BACKUP_API_KEY', ''));
define('TUZI_BACKUP_MODEL', envValue('TUZI_BACKUP_MODEL', 'claude-sonnet-4-20250514'));

// API故障转移配置
define('API_TIMEOUT_THRESHOLD', envInt('API_TIMEOUT_THRESHOLD', 30)); // 超时阈值（秒），超过此时间自动切换到备用API
define('API_CONNECT_TIMEOUT', envInt('API_CONNECT_TIMEOUT', 30)); // 连接超时（秒）
define('API_TOTAL_TIMEOUT', envInt('API_TOTAL_TIMEOUT', 300)); // 总超时（秒）- 5分钟，支持长输出
define('API_RETRY_COUNT', envInt('API_RETRY_COUNT', 1)); // 主API失败后重试次数

// 输入限制配置
define('MAX_INPUT_LENGTH', envInt('MAX_INPUT_LENGTH', 8000)); // 用户输入最大字符数（约2000-3000 tokens）

// 数据库配置
define('DB_PATH', envValue('DB_PATH', __DIR__ . '/../data/sales_ai.db'));

// 上传目录配置
define('UPLOAD_PATH', rtrim(envValue('UPLOAD_PATH', __DIR__ . '/../data/uploads/'), '/') . '/');
define('UPLOAD_MAX_SIZE', envInt('UPLOAD_MAX_SIZE', 10 * 1024 * 1024)); // 默认10MB
define('UPLOAD_ALLOWED_TYPES', ['pdf', 'md', 'txt', 'docx']);

// API输出配置
define('API_MAX_TOKENS', envInt('API_MAX_TOKENS', 2500)); // AI输出最大token数（降低以提高稳定性，约4000-6000字符）
define('API_TEMPERATURE', envFloat('API_TEMPERATURE', 0.7));

// 会话配置
define('MAX_CONTEXT_MESSAGES', envInt('MAX_CONTEXT_MESSAGES', 10)); // 最大上下文消息数

/**
 * 设置API响应头 (仅API端点调用)
 */
function setApiHeaders() {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Content-Type: application/json; charset=utf-8');

    // 处理OPTIONS预检请求
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

/**
 * 获取配置数组
 */
function getConfig() {
    return [
        // 主API配置
        'tuzi_api_url' => TUZI_API_URL,
        'tuzi_api_key' => TUZI_API_KEY,
        'tuzi_model' => TUZI_MODEL,

        // 备用API配置
        'tuzi_backup_api_url' => TUZI_BACKUP_API_URL,
        'tuzi_backup_api_key' => TUZI_BACKUP_API_KEY,
        'tuzi_backup_model' => TUZI_BACKUP_MODEL,

        // 故障转移配置
        'api_timeout_threshold' => API_TIMEOUT_THRESHOLD,
        'api_connect_timeout' => API_CONNECT_TIMEOUT,
        'api_total_timeout' => API_TOTAL_TIMEOUT,
        'api_retry_count' => API_RETRY_COUNT,

        // 其他配置
        'db_path' => DB_PATH,
        'upload_path' => UPLOAD_PATH,
        'upload_max_size' => UPLOAD_MAX_SIZE,
        'upload_allowed_types' => UPLOAD_ALLOWED_TYPES,
        'api_max_tokens' => API_MAX_TOKENS,
        'api_temperature' => API_TEMPERATURE,
        'max_context_messages' => MAX_CONTEXT_MESSAGES
    ];
}
