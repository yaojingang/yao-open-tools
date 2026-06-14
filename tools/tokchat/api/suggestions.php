<?php
/**
 * 销售AI支持系统 - 探索建议API
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

$action = getParam('action', 'list');
$publicActions = ['list'];

if (!in_array($action, $publicActions, true)) {
    session_start();
    if (!isset($_SESSION['admin_id'])) {
        jsonError('未登录或登录已过期', 401);
    }
}

switch ($action) {
    case 'list':
        handleList();
        break;
    case 'templates':
        handleTemplates();
        break;
    case 'apply_template':
        handleApplyTemplate();
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
    case 'reorder':
        handleReorder();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取探索建议列表
 */
function handleList() {
    $db = getDB();
    $type = getParam('type'); // 'hot_search' 或 'skill_learning'

    $sql = "SELECT * FROM explore_suggestions WHERE is_active = 1";
    $params = [];

    if ($type) {
        $sql .= " AND type = ?";
        $params[] = $type;
    }

    $sql .= " ORDER BY sort_order ASC, id ASC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $suggestions = $stmt->fetchAll();

    jsonSuccess(['suggestions' => $suggestions]);
}

/**
 * 获取探索建议模板场景列表
 */
function handleTemplates() {
    $db = getDB();
    jsonSuccess([
        'active_scenario_slug' => getActiveExploreSuggestionScenarioSlug($db),
        'scenarios' => getExploreSuggestionScenariosForResponse($db)
    ]);
}

function getExploreSuggestionScenariosForResponse($db) {
    $activeSlug = getActiveExploreSuggestionScenarioSlug($db);
    $stmt = $db->query("SELECT
            s.*,
            COUNT(t.id) AS template_count,
            SUM(CASE WHEN t.type = 'hot_search' THEN 1 ELSE 0 END) AS hot_search_count,
            SUM(CASE WHEN t.type = 'skill_learning' THEN 1 ELSE 0 END) AS skill_learning_count
        FROM prompt_scenarios s
        LEFT JOIN explore_suggestion_templates t ON t.scenario_slug = s.slug
        GROUP BY s.id
        ORDER BY s.sort_order ASC, s.id ASC");
    $scenarios = $stmt->fetchAll();

    foreach ($scenarios as &$scenario) {
        $scenario['is_active'] = $scenario['slug'] === $activeSlug ? 1 : 0;
        $scenario['template_count'] = (int)($scenario['template_count'] ?? 0);
        $scenario['hot_search_count'] = (int)($scenario['hot_search_count'] ?? 0);
        $scenario['skill_learning_count'] = (int)($scenario['skill_learning_count'] ?? 0);
    }

    return $scenarios;
}

/**
 * 应用探索建议模板
 */
function handleApplyTemplate() {
    $input = getJsonInput();
    $slug = trim((string)($input['slug'] ?? getParam('slug', '')));

    if ($slug === '') {
        jsonError('缺少探索建议场景');
    }

    try {
        $scenario = applyExploreSuggestionScenario($slug);
        $db = getDB();
        $stmt = $db->query("SELECT * FROM explore_suggestions WHERE is_active = 1 ORDER BY sort_order ASC, id ASC");
        jsonSuccess([
            'scenario' => $scenario,
            'active_scenario_slug' => $slug,
            'scenarios' => getExploreSuggestionScenariosForResponse($db),
            'suggestions' => $stmt->fetchAll()
        ], '探索建议模板已生效');
    } catch (Exception $e) {
        jsonError($e->getMessage());
    }
}

/**
 * 获取单个建议
 */
function handleGet() {
    $id = getParam('id');
    if (!$id) {
        jsonError('缺少ID参数');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM explore_suggestions WHERE id = ?");
    $stmt->execute([$id]);
    $suggestion = $stmt->fetch();

    if (!$suggestion) {
        jsonError('建议不存在');
    }

    jsonSuccess(['suggestion' => $suggestion]);
}

/**
 * 创建新建议
 */
function handleCreate() {
    $type = getParam('type');
    $title = getParam('title');
    $subtitle = getParam('subtitle');
    $content = getParam('content');
    $icon = getParam('icon', 'fas fa-star');
    $colorClass = getParam('color_class', 'text-blue-700');
    $sortOrder = getParam('sort_order', 0);

    if (!$type || !$title || !$content) {
        jsonError('缺少必要参数');
    }

    if (!in_array($type, ['hot_search', 'skill_learning'])) {
        jsonError('类型参数无效');
    }

    $db = getDB();
    $stmt = $db->prepare("INSERT INTO explore_suggestions
        (type, title, subtitle, content, icon, color_class, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))");

    $result = $stmt->execute([$type, $title, $subtitle, $content, $icon, $colorClass, $sortOrder]);

    if ($result) {
        $id = $db->lastInsertId();
        jsonSuccess(['id' => $id, 'message' => '创建成功']);
    } else {
        jsonError('创建失败');
    }
}

/**
 * 更新建议
 */
function handleUpdate() {
    $id = getParam('id');
    $type = getParam('type');
    $title = getParam('title');
    $subtitle = getParam('subtitle');
    $content = getParam('content');
    $icon = getParam('icon');
    $colorClass = getParam('color_class');
    $sortOrder = getParam('sort_order');
    $isActive = getParam('is_active', 1);

    if (!$id) {
        jsonError('缺少ID参数');
    }

    $db = getDB();

    // 检查记录是否存在
    $stmt = $db->prepare("SELECT id FROM explore_suggestions WHERE id = ?");
    $stmt->execute([$id]);
    if (!$stmt->fetch()) {
        jsonError('记录不存在');
    }

    $stmt = $db->prepare("UPDATE explore_suggestions SET
        type = ?, title = ?, subtitle = ?, content = ?, icon = ?,
        color_class = ?, sort_order = ?, is_active = ?, updated_at = datetime('now')
        WHERE id = ?");

    $result = $stmt->execute([$type, $title, $subtitle, $content, $icon, $colorClass, $sortOrder, $isActive, $id]);

    if ($result) {
        jsonSuccess(['message' => '更新成功']);
    } else {
        jsonError('更新失败');
    }
}

/**
 * 删除建议
 */
function handleDelete() {
    $id = getParam('id');
    if (!$id) {
        jsonError('缺少ID参数');
    }

    $db = getDB();
    $stmt = $db->prepare("DELETE FROM explore_suggestions WHERE id = ?");
    $result = $stmt->execute([$id]);

    if ($result) {
        jsonSuccess(['message' => '删除成功']);
    } else {
        jsonError('删除失败');
    }
}

/**
 * 重新排序
 */
function handleReorder() {
    $items = json_decode(file_get_contents('php://input'), true);

    if (!$items || !is_array($items)) {
        jsonError('无效的排序数据');
    }

    $db = getDB();
    $db->beginTransaction();

    try {
        $stmt = $db->prepare("UPDATE explore_suggestions SET sort_order = ?, updated_at = datetime('now') WHERE id = ?");

        foreach ($items as $index => $item) {
            if (!isset($item['id'])) {
                throw new Exception('缺少ID');
            }
            $stmt->execute([$index + 1, $item['id']]);
        }

        $db->commit();
        jsonSuccess(['message' => '排序更新成功']);
    } catch (Exception $e) {
        $db->rollback();
        jsonError('排序更新失败: ' . $e->getMessage());
    }
}
