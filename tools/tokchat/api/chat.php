<?php
/**
 * 销售AI支持系统 - 问答API
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

// 初始化数据库
initDatabase();

$action = getParam('action', 'send');

switch ($action) {
    case 'send':
        handleSendMessage();
        break;
    case 'history':
        handleGetHistory();
        break;
    case 'sessions':
        handleGetSessions();
        break;
    case 'messages':
        handleGetMessages();
        break;
    case 'new':
        handleNewSession();
        break;
    case 'feedback':
        handleFeedback();
        break;
    case 'delete_session':
        handleDeleteSession();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 发送消息并获取AI回复
 */
function handleSendMessage() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $message = $input['message'] ?? '';
    $userId = requireAuthenticatedFrontendUserId();

    if (empty($message)) {
        jsonError('消息不能为空');
    }

    // 检查输入长度限制
    $maxInputLength = defined('MAX_INPUT_LENGTH') ? MAX_INPUT_LENGTH : 8000;
    if (mb_strlen($message) > $maxInputLength) {
        jsonError("输入内容过长，最多支持 {$maxInputLength} 字符，当前 " . mb_strlen($message) . " 字符");
    }

    $db = getDB();

    // 如果没有session_id，创建新会话；否则必须属于当前登录用户
    if (!$sessionId) {
        $title = mb_substr($message, 0, 30);
        $stmt = $db->prepare("INSERT INTO chat_sessions (user_id, mode, title) VALUES (?, 'qa', ?)");
        $stmt->execute([$userId, $title]);
        $sessionId = $db->lastInsertId();
    } else {
        requireOwnedChatSession($sessionId, $userId);
    }

    // 保存用户消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
    $stmt->execute([$sessionId, $message]);

    // 获取对话历史
    $history = getConversationHistory($sessionId);

    // RAG检索知识库
    $ragResults = searchKnowledge($message);
    $ragContext = '';
    if (!empty($ragResults)) {
        $ragContext = "\n\n【知识库参考】\n";
        foreach ($ragResults as $idx => $result) {
            $ragContext .= ($idx + 1) . ". 来源：{$result['doc_name']}\n内容：{$result['snippet']}\n\n";
        }
    }

    // 构建消息
    $systemPrompt = getSystemPrompt('qa_system');
    if (!empty($ragContext)) {
        $systemPrompt .= $ragContext;
    }

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt]
    ];

    // 添加历史消息
    foreach ($history as $msg) {
        $messages[] = ['role' => $msg['role'], 'content' => $msg['content']];
    }

    // 添加当前消息
    $messages[] = ['role' => 'user', 'content' => $message];

    try {
        // 调用AI
        $response = callTuziAPI($messages);
        $aiContent = $response['content'];
        $parsed = parseAIResponse($aiContent);

        $answer = $parsed['answer'] ?? $aiContent;
        $suggestions = $parsed['suggestions'] ?? [];

        // 计算RAG得分
        $ragScore = !empty($ragResults) ? $ragResults[0]['score'] : 0;

        // 保存AI回复
        $stmt = $db->prepare("INSERT INTO chat_messages
            (session_id, role, content, suggestions, rag_sources, rag_score, tokens_in, tokens_out, latency_ms)
            VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $sessionId,
            $answer,
            json_encode($suggestions, JSON_UNESCAPED_UNICODE),
            json_encode($ragResults, JSON_UNESCAPED_UNICODE),
            $ragScore,
            $response['usage']['prompt_tokens'] ?? 0,
            $response['usage']['completion_tokens'] ?? 0,
            $response['latency_ms']
        ]);
        $messageId = $db->lastInsertId();

        // 更新会话时间
        $stmt = $db->prepare("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?");
        $stmt->execute([$sessionId, $userId]);

        jsonSuccess([
            'session_id' => (int)$sessionId,
            'message_id' => (int)$messageId,
            'content' => $answer,
            'suggestions' => $suggestions,
            'rag_sources' => $ragResults,
            'latency_ms' => $response['latency_ms']
        ]);

    } catch (Exception $e) {
        logMessage('Chat API Error: ' . $e->getMessage(), 'ERROR');
        jsonError('AI服务暂时不可用: ' . $e->getMessage(), 500);
    }
}

/**
 * 获取对话历史
 */
function getConversationHistory($sessionId, $limit = null) {
    $db = getDB();
    $limit = $limit ?? getConfig()['max_context_messages'];

    $stmt = $db->prepare("SELECT role, content FROM chat_messages
        WHERE session_id = ? ORDER BY id DESC LIMIT ?");
    $stmt->execute([$sessionId, $limit]);
    $messages = $stmt->fetchAll();

    return array_reverse($messages);
}

/**
 * 获取会话历史消息
 */
function handleGetHistory() {
    $userId = requireAuthenticatedFrontendUserId();
    $sessionId = getParam('session_id');
    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();
    requireOwnedChatSession($sessionId, $userId);

    $stmt = $db->prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC");
    $stmt->execute([$sessionId]);
    $messages = $stmt->fetchAll();

    // 处理JSON字段
    foreach ($messages as &$msg) {
        $msg['suggestions'] = $msg['suggestions'] ? json_decode($msg['suggestions'], true) : [];
        $msg['quick_buttons'] = $msg['quick_buttons'] ? json_decode($msg['quick_buttons'], true) : [];
        $msg['rag_sources'] = $msg['rag_sources'] ? json_decode($msg['rag_sources'], true) : [];
    }

    jsonSuccess(['messages' => $messages]);
}

/**
 * 获取用户所有会话列表
 */
function handleGetSessions() {
    $userId = requireAuthenticatedFrontendUserId();

    $db = getDB();
    $stmt = $db->prepare("SELECT s.*,
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
        FROM chat_sessions s
        WHERE s.user_id = ?
        ORDER BY s.updated_at DESC
        LIMIT 50");
    $stmt->execute([$userId]);
    $sessions = $stmt->fetchAll();

    jsonSuccess(['sessions' => $sessions]);
}

/**
 * 获取指定会话的所有消息
 */
function handleGetMessages() {
    $userId = requireAuthenticatedFrontendUserId();
    $sessionId = getParam('session_id');
    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();
    $session = requireOwnedChatSession($sessionId, $userId);

    // 获取消息
    $stmt = $db->prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC");
    $stmt->execute([$sessionId]);
    $messages = $stmt->fetchAll();

    // 处理JSON字段
    foreach ($messages as &$msg) {
        $msg['suggestions'] = $msg['suggestions'] ? json_decode($msg['suggestions'], true) : [];
        $msg['quick_buttons'] = $msg['quick_buttons'] ? json_decode($msg['quick_buttons'], true) : [];
        $msg['rag_sources'] = $msg['rag_sources'] ? json_decode($msg['rag_sources'], true) : [];
    }

    jsonSuccess([
        'session' => $session,
        'messages' => $messages
    ]);
}

/**
 * 删除会话
 */
function handleDeleteSession() {
    $userId = requireAuthenticatedFrontendUserId();
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;

    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();
    requireOwnedChatSession($sessionId, $userId);

    // 删除公开分享快照
    $stmt = $db->prepare("DELETE FROM shared_conversations WHERE session_id = ?");
    $stmt->execute([$sessionId]);

    // 删除消息
    $stmt = $db->prepare("DELETE FROM chat_messages WHERE session_id = ?");
    $stmt->execute([$sessionId]);

    // 删除会话
    $stmt = $db->prepare("DELETE FROM chat_sessions WHERE id = ?");
    $stmt->execute([$sessionId]);

    jsonSuccess(['message' => '会话已删除']);
}

/**
 * 创建新会话
 */
function handleNewSession() {
    $userId = requireAuthenticatedFrontendUserId();
    $input = getJsonInput();
    $mode = $input['mode'] ?? 'qa';
    $title = $input['title'] ?? '新对话';

    $db = getDB();
    $stmt = $db->prepare("INSERT INTO chat_sessions (user_id, mode, title) VALUES (?, ?, ?)");
    $stmt->execute([$userId, $mode, $title]);
    $sessionId = $db->lastInsertId();

    jsonSuccess([
        'session_id' => (int)$sessionId,
        'mode' => $mode,
        'title' => $title
    ]);
}

/**
 * 提交消息反馈
 */
function handleFeedback() {
    $userId = requireAuthenticatedFrontendUserId();
    $input = getJsonInput();
    $messageId = $input['message_id'] ?? null;
    $feedback = $input['feedback'] ?? null;

    if (!$messageId || !in_array($feedback, ['good', 'bad'])) {
        jsonError('参数错误');
    }

    $db = getDB();
    $stmt = $db->prepare("UPDATE chat_messages
        SET feedback = ?
        WHERE id = ?
          AND session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)");
    $stmt->execute([$feedback, $messageId, $userId]);

    if ($stmt->rowCount() === 0) {
        jsonError('消息不存在或无权访问', 404);
    }

    jsonSuccess(['message' => '反馈已记录']);
}
