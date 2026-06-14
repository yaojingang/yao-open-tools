<?php
/**
 * 销售AI支持系统 - API统计数据
 */

session_start();

require_once __DIR__ . '/utils.php';
require_once __DIR__ . '/api-stats-data.php';

setApiHeaders();

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

$action = getParam('action', 'summary');

switch ($action) {
    case 'summary':
        jsonSuccess(apiStatsBuildSummary());
        break;
    default:
        jsonError('未知操作');
}
