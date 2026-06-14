<?php
/**
 * 销售AI支持系统 - Prompt配置API
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

$action = getParam('action', 'list');

switch ($action) {
    case 'list':
        handleList();
        break;
    case 'scenarios':
        handleScenarios();
        break;
    case 'apply_scenario':
        handleApplyScenario();
        break;
    case 'get':
        handleGet();
        break;
    case 'update':
        handleUpdate();
        break;
    case 'toggle':
        handleToggle();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取所有Prompt配置
 */
function handleList() {
    $db = getDB();
    $stmt = $db->query("SELECT p.*, u.name as updater_name
        FROM prompt_configs p
        LEFT JOIN users u ON p.updated_by = u.id
        ORDER BY p.name ASC");
    $prompts = $stmt->fetchAll();

    jsonSuccess([
        'prompts' => $prompts,
        'scenarios' => getPromptScenariosForResponse($db)
    ]);
}

function handleScenarios() {
    $db = getDB();
    jsonSuccess(['scenarios' => getPromptScenariosForResponse($db)]);
}

function getPromptScenariosForResponse($db) {
    $stmt = $db->query("SELECT
            s.*,
            COUNT(t.id) AS template_count
        FROM prompt_scenarios s
        LEFT JOIN prompt_scenario_templates t ON t.scenario_slug = s.slug
        GROUP BY s.id
        ORDER BY s.sort_order ASC, s.id ASC");
    return $stmt->fetchAll();
}

function handleApplyScenario() {
    $input = getJsonInput();
    $slug = trim((string)($input['slug'] ?? getParam('slug', '')));

    if ($slug === '') {
        jsonError('缺少应用场景');
    }

    $userId = $_SESSION['admin_id'] ?? 1;

    try {
        $scenario = applyPromptScenario($slug, $userId);
        jsonSuccess([
            'scenario' => $scenario,
            'scenarios' => getPromptScenariosForResponse(getDB())
        ], '应用场景已生效');
    } catch (Exception $e) {
        jsonError($e->getMessage());
    }
}

/**
 * 获取单个Prompt
 */
function handleGet() {
    $name = getParam('name');
    if (!$name) {
        jsonError('缺少name参数');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM prompt_configs WHERE name = ?");
    $stmt->execute([$name]);
    $prompt = $stmt->fetch();

    if (!$prompt) {
        jsonError('Prompt不存在');
    }

    jsonSuccess($prompt);
}

/**
 * 更新Prompt内容
 */
function handleUpdate() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;
    $name = $input['name'] ?? null;
    $promptContent = $input['prompt_content'] ?? null;
    $description = $input['description'] ?? null;
    $userId = $input['user_id'] ?? 1;

    if (!$id && !$name) {
        jsonError('缺少id或name参数');
    }

    if (empty($promptContent)) {
        jsonError('Prompt内容不能为空');
    }

    $db = getDB();

    if ($id) {
        $stmt = $db->prepare("UPDATE prompt_configs SET
            prompt_content = ?,
            description = COALESCE(?, description),
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = ?");
        $stmt->execute([$promptContent, $description, $userId, $id]);
    } else {
        // 检查是否存在
        $stmt = $db->prepare("SELECT id FROM prompt_configs WHERE name = ?");
        $stmt->execute([$name]);
        $existing = $stmt->fetch();

        if ($existing) {
            $stmt = $db->prepare("UPDATE prompt_configs SET
                prompt_content = ?,
                description = COALESCE(?, description),
                updated_by = ?,
                updated_at = CURRENT_TIMESTAMP
                WHERE name = ?");
            $stmt->execute([$promptContent, $description, $userId, $name]);
        } else {
            $stmt = $db->prepare("INSERT INTO prompt_configs (name, prompt_content, description, updated_by) VALUES (?, ?, ?, ?)");
            $stmt->execute([$name, $promptContent, $description, $userId]);
        }
    }

    jsonSuccess([], 'Prompt更新成功');
}

/**
 * 切换Prompt启用状态
 */
function handleToggle() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $stmt = $db->prepare("UPDATE prompt_configs SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $stmt->execute([$id]);

    jsonSuccess([], '状态已更新');
}
