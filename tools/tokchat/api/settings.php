<?php
/**
 * 销售AI支持系统 - 网站设置API
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

setApiHeaders();

initDatabase();

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

$action = getParam('action', 'get');

switch ($action) {
    case 'get':
        handleGetSettings();
        break;
    case 'update':
        handleUpdateSettings();
        break;
    default:
        jsonError('未知操作');
}

function handleGetSettings() {
    jsonSuccess(['settings' => getSiteSettings()]);
}

function handleUpdateSettings() {
    $input = getJsonInput();
    $settings = $input['settings'] ?? $input;

    if (!is_array($settings)) {
        jsonError('设置数据格式不正确');
    }

    $required = [
        'frontend_site_name' => '前台网站名称',
        'frontend_page_title' => '前台浏览器标题',
        'copyright_text' => '版权说明',
        'login_page_title' => '登录页名称',
        'login_page_description' => '登录页说明',
        'admin_site_name' => '后台名称',
        'admin_page_title' => '后台浏览器标题',
        'admin_login_title' => '后台登录页名称',
        'admin_login_description' => '后台登录页说明'
    ];

    foreach ($required as $key => $label) {
        if (!isset($settings[$key]) || trim((string)$settings[$key]) === '') {
            jsonError($label . '不能为空');
        }
    }

    if (isset($settings['frontend_analytics_code']) && strlen((string)$settings['frontend_analytics_code']) > 20000) {
        jsonError('统计代码不能超过 20000 字符');
    }

    $updated = updateSiteSettings($settings);
    jsonSuccess(['settings' => $updated], '网站设置已保存');
}
