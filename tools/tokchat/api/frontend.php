<?php
/**
 * TokChat frontend public configuration API.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

setApiHeaders();
initDatabase();

$action = getParam('action', 'welcome');

switch ($action) {
    case 'welcome':
        jsonSuccess(['welcome' => getFrontendWelcomeProfile()]);
        break;
    default:
        jsonError('未知操作');
}
