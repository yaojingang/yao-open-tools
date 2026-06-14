<?php
/**
 * 销售AI支持系统 - 对话分享API
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

setApiHeaders();

initDatabase();

$action = getParam('action', 'get');

switch ($action) {
    case 'create':
        handleCreateShare();
        break;
    case 'get':
        handleGetShare();
        break;
    default:
        jsonError('未知操作');
}

function handleCreateShare() {
    $userId = requireAuthenticatedFrontendUserId();
    $input = getJsonInput();
    $messageId = isset($input['message_id']) ? (int)$input['message_id'] : 0;

    if ($messageId <= 0) {
        jsonError('缺少要分享的消息ID');
    }

    $db = getDB();

    $stmt = $db->prepare("SELECT m.*, s.user_id, s.title AS session_title
        FROM chat_messages m
        JOIN chat_sessions s ON s.id = m.session_id
        WHERE m.id = ? AND m.role = 'assistant'");
    $stmt->execute([$messageId]);
    $assistantMessage = $stmt->fetch();

    if (!$assistantMessage) {
        jsonError('只能分享已生成完成的助手回复', 404);
    }

    if ((int)$assistantMessage['user_id'] !== $userId) {
        jsonError('无权分享该对话', 403);
    }

    $existing = getShareByAssistantMessageId($db, $messageId);
    if ($existing) {
        jsonSuccess([
            'token' => $existing['token'],
            'share_url' => buildShareUrl($existing['token']),
            'reused' => true
        ]);
    }

    $stmt = $db->prepare("SELECT id, content FROM chat_messages
        WHERE session_id = ? AND role = 'user' AND id < ?
        ORDER BY id DESC LIMIT 1");
    $stmt->execute([$assistantMessage['session_id'], $messageId]);
    $userMessage = $stmt->fetch();

    $titleSource = trim((string)($assistantMessage['session_title'] ?? ''));
    if ($titleSource === '' && $userMessage) {
        $titleSource = trim((string)$userMessage['content']);
    }
    if ($titleSource === '') {
        $titleSource = '分享的对话';
    }

    $title = mb_substr($titleSource, 0, 80);
    $token = null;

    for ($i = 0; $i < 5; $i++) {
        $candidate = bin2hex(random_bytes(16));

        try {
            $stmt = $db->prepare("INSERT INTO shared_conversations
                (token, session_id, assistant_message_id, user_message_id, title, user_content, assistant_content, suggestions, rag_sources, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $candidate,
                $assistantMessage['session_id'],
                $messageId,
                $userMessage['id'] ?? null,
                $title,
                $userMessage['content'] ?? null,
                $assistantMessage['content'],
                $assistantMessage['suggestions'] ?? null,
                $assistantMessage['rag_sources'] ?? null,
                $userId
            ]);
            $token = $candidate;
            break;
        } catch (PDOException $e) {
            $existing = getShareByAssistantMessageId($db, $messageId);
            if ($existing) {
                jsonSuccess([
                    'token' => $existing['token'],
                    'share_url' => buildShareUrl($existing['token']),
                    'reused' => true
                ]);
            }
        }
    }

    if ($token === null) {
        jsonError('生成分享链接失败，请重试', 500);
    }

    jsonSuccess([
        'token' => $token,
        'share_url' => buildShareUrl($token),
        'reused' => false
    ]);
}

function handleGetShare() {
    $token = trim((string)getParam('token', getParam('t', '')));
    if ($token === '') {
        jsonError('缺少分享链接参数');
    }

    $db = getDB();
    $share = getShareByToken($db, $token);

    if (!$share) {
        jsonError('分享不存在或已被删除', 404);
    }

    $stmt = $db->prepare("UPDATE shared_conversations
        SET view_count = view_count + 1, updated_at = datetime('now')
        WHERE id = ?");
    $stmt->execute([$share['id']]);
    $share['view_count'] = (int)$share['view_count'] + 1;

    jsonSuccess(['share' => formatPublicSharePayload($share)]);
}

function getShareByAssistantMessageId($db, $messageId) {
    $stmt = $db->prepare("SELECT * FROM shared_conversations WHERE assistant_message_id = ? LIMIT 1");
    $stmt->execute([$messageId]);
    return $stmt->fetch();
}

function getShareByToken($db, $token) {
    $stmt = $db->prepare("SELECT * FROM shared_conversations WHERE token = ? LIMIT 1");
    $stmt->execute([$token]);
    return $stmt->fetch();
}

function buildShareUrl($token) {
    $protoHeader = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    $proto = trim(explode(',', $protoHeader)[0] ?? '');

    if (!in_array($proto, ['http', 'https'], true)) {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');
        $proto = $isHttps ? 'https' : 'http';
    }

    $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
    $host = trim(explode(',', $host)[0]);
    $host = preg_replace('/[^A-Za-z0-9\\.\\-:\\[\\]]/', '', $host);
    if ($host === '') {
        $host = '127.0.0.1';
    }

    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/api/shares.php';
    $basePath = rtrim(dirname(dirname($scriptName)), '/\\');
    if ($basePath === '.' || $basePath === '/') {
        $basePath = '';
    }

    return $proto . '://' . $host . $basePath . '/share.php?t=' . rawurlencode($token);
}

function formatPublicSharePayload($share) {
    return [
        'token' => $share['token'],
        'title' => $share['title'],
        'user_content' => $share['user_content'],
        'assistant_content' => $share['assistant_content'],
        'suggestions' => decodeJsonList($share['suggestions'] ?? null),
        'rag_sources' => decodeJsonList($share['rag_sources'] ?? null),
        'view_count' => (int)$share['view_count'],
        'created_at' => $share['created_at']
    ];
}

function decodeJsonList($value) {
    if ($value === null || $value === '') {
        return [];
    }

    $decoded = json_decode($value, true);
    return is_array($decoded) ? $decoded : [];
}
