<?php
/**
 * 销售AI支持系统 - AI API配置管理
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';
require_once __DIR__ . '/ai-manager.php';

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
    case 'create':
        handleSave(false);
        break;
    case 'update':
        handleSave(true);
        break;
    case 'delete':
        handleDelete();
        break;
    case 'test':
        handleTest();
        break;
    case 'strategy':
        handleStrategy();
        break;
    default:
        jsonError('未知操作');
}

function handleList() {
    $db = getDB();
    $stmt = $db->query("SELECT * FROM ai_api_configs ORDER BY priority ASC, id ASC");
    $apis = array_map('serializeAPIConfig', $stmt->fetchAll());

    jsonSuccess([
        'apis' => $apis,
        'settings' => getAIAPISettings()
    ]);
}

function handleStrategy() {
    $input = getJsonInput();
    $strategy = $input['rotation_strategy'] ?? getParam('rotation_strategy', 'failover');

    if (!in_array($strategy, ['failover', 'round_robin', 'random'], true)) {
        jsonError('轮换策略无效');
    }

    jsonSuccess(['settings' => updateAIAPISettings(['rotation_strategy' => $strategy])], '轮换策略已保存');
}

function handleSave($isUpdate) {
    $input = getJsonInput();
    $db = getDB();

    $id = isset($input['id']) ? (int)$input['id'] : 0;
    if ($isUpdate && $id <= 0) {
        jsonError('缺少API配置ID');
    }

    $name = trim($input['name'] ?? '');
    $apiUrl = trim($input['api_url'] ?? '');
    $apiKey = trim($input['api_key'] ?? '');
    $model = trim($input['model'] ?? '');
    $apiType = trim($input['api_type'] ?? 'chat_completions');
    $status = trim($input['status'] ?? 'active');
    $priority = (int)($input['priority'] ?? 100);
    $timeoutSeconds = max(5, min(600, (int)($input['timeout_seconds'] ?? API_TOTAL_TIMEOUT)));
    $connectTimeoutSeconds = max(1, min(120, (int)($input['connect_timeout_seconds'] ?? API_CONNECT_TIMEOUT)));
    $maxTokens = max(1, min(32000, (int)($input['max_tokens'] ?? API_MAX_TOKENS)));
    $temperature = max(0, min(2, (float)($input['temperature'] ?? API_TEMPERATURE)));

    if ($name === '' || $apiUrl === '' || $model === '') {
        jsonError('名称、API地址和模型不能为空');
    }
    if (!filter_var($apiUrl, FILTER_VALIDATE_URL)) {
        jsonError('API地址格式不正确');
    }
    if (!in_array($apiType, ['messages', 'chat_completions', 'embeddings'], true)) {
        jsonError('API类型无效');
    }
    if (!in_array($status, ['active', 'inactive'], true)) {
        jsonError('状态无效');
    }

    if ($isUpdate) {
        $stmt = $db->prepare("SELECT api_key FROM ai_api_configs WHERE id = ?");
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
        if (!$existing) {
            jsonError('API配置不存在');
        }
        if ($apiKey === '') {
            $apiKey = $existing['api_key'];
        }
    } elseif ($apiKey === '') {
        jsonError('API Key不能为空');
    }

    if ($isUpdate) {
        $stmt = $db->prepare("UPDATE ai_api_configs SET
            name = ?, api_url = ?, api_key = ?, model = ?, api_type = ?, status = ?,
            priority = ?, timeout_seconds = ?, connect_timeout_seconds = ?,
            max_tokens = ?, temperature = ?, updated_at = datetime('now')
            WHERE id = ?");
        $stmt->execute([
            $name, $apiUrl, $apiKey, $model, $apiType, $status,
            $priority, $timeoutSeconds, $connectTimeoutSeconds,
            $maxTokens, $temperature, $id
        ]);
    } else {
        $stmt = $db->prepare("INSERT INTO ai_api_configs (
            name, api_url, api_key, model, api_type, status, priority,
            timeout_seconds, connect_timeout_seconds, max_tokens, temperature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $name, $apiUrl, $apiKey, $model, $apiType, $status,
            $priority, $timeoutSeconds, $connectTimeoutSeconds,
            $maxTokens, $temperature
        ]);
        $id = (int)$db->lastInsertId();
    }

    jsonSuccess(['id' => $id], $isUpdate ? 'API配置已更新' : 'API配置已创建');
}

function handleDelete() {
    $input = getJsonInput();
    $id = isset($input['id']) ? (int)$input['id'] : (int)getParam('id', 0);

    if ($id <= 0) {
        jsonError('缺少API配置ID');
    }

    $db = getDB();
    $stmt = $db->prepare("DELETE FROM ai_api_configs WHERE id = ?");
    $stmt->execute([$id]);

    jsonSuccess([], 'API配置已删除');
}

function handleTest() {
    $input = getJsonInput();
    $db = getDB();

    $id = isset($input['id']) ? (int)$input['id'] : 0;
    $api = $input;

    if ($id > 0) {
        $stmt = $db->prepare("SELECT * FROM ai_api_configs WHERE id = ?");
        $stmt->execute([$id]);
        $stored = $stmt->fetch();
        if (!$stored) {
            jsonError('API配置不存在');
        }
        $api = array_merge($stored, array_filter($input, function($value) {
            return $value !== null && $value !== '';
        }));
        if (empty($input['api_key'])) {
            $api['api_key'] = $stored['api_key'];
        }
    }

    $name = trim($api['name'] ?? '临时API');
    $apiUrl = trim($api['api_url'] ?? '');
    $apiKey = trim($api['api_key'] ?? '');
    $model = trim($api['model'] ?? '');
    $apiType = trim($api['api_type'] ?? 'chat_completions');

    if ($apiUrl === '' || $apiKey === '' || $model === '') {
        jsonError('测试需要API地址、API Key和模型');
    }
    if (!filter_var($apiUrl, FILTER_VALIDATE_URL)) {
        jsonError('API地址格式不正确');
    }
    if (!in_array($apiType, ['messages', 'chat_completions', 'embeddings'], true)) {
        jsonError('API类型无效');
    }

    $testConfig = [
        'id' => $id,
        'name' => $name,
        'api_url' => $apiUrl,
        'api_key' => $apiKey,
        'model' => $model,
        'api_type' => $apiType,
        'timeout_seconds' => max(5, min(60, (int)($api['timeout_seconds'] ?? 15))),
        'connect_timeout_seconds' => max(1, min(30, (int)($api['connect_timeout_seconds'] ?? 10))),
        'max_tokens' => 64,
        'temperature' => 0
    ];

    $status = 'failed';
    $latencyMs = null;
    $message = '';

    try {
        if ($apiType === 'embeddings') {
            $result = testEmbeddingConnection($testConfig);
            $status = 'success';
            $latencyMs = $result['latency_ms'];
            $message = '向量模型连接成功，维度：' . $result['dimensions'];
        } else {
            $manager = new AIManager();
            $result = $manager->testConnection($testConfig);
            $status = 'success';
            $latencyMs = $result['latency_ms'];
            $message = '连接成功，响应：' . ($result['content_preview'] ?: 'OK');
        }
    } catch (Exception $e) {
        $message = $e->getMessage();
    }

    if ($id > 0) {
        $stmt = $db->prepare("UPDATE ai_api_configs SET
            last_test_status = ?,
            last_test_latency_ms = ?,
            last_test_message = ?,
            last_test_at = datetime('now'),
            updated_at = datetime('now')
            WHERE id = ?");
        $stmt->execute([$status, $latencyMs, mb_substr($message, 0, 1000), $id]);
    }

    jsonSuccess([
        'status' => $status,
        'success' => $status === 'success',
        'latency_ms' => $latencyMs,
        'message' => $message
    ], $status === 'success' ? '连接测试成功' : '连接测试失败');
}

function testEmbeddingConnection($api) {
    $startTime = microtime(true);
    $vector = callEmbeddingAPI($api, 'TokChat embedding connectivity test');
    $latencyMs = (int)round((microtime(true) - $startTime) * 1000);

    return [
        'latency_ms' => $latencyMs,
        'dimensions' => count($vector)
    ];
}

function serializeAPIConfig($api) {
    $hasAPIKey = trim((string)($api['api_key'] ?? '')) !== '';
    unset($api['api_key']);
    $api['has_api_key'] = $hasAPIKey;
    $api['masked_api_key'] = $hasAPIKey ? '已保存' : '';
    return $api;
}
