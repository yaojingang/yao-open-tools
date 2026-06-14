<?php
/**
 * 销售AI支持系统 - 流式输出API (SSE)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 初始化数据库
initDatabase();

// 设置SSE响应头
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('Access-Control-Allow-Origin: *');
header('X-Accel-Buffering: no'); // 禁用nginx缓冲

// 禁用PHP输出缓冲
if (ob_get_level()) ob_end_clean();

// 设置更长的超时时间 - 修复学习模式超时问题
set_time_limit(300); // 5分钟
ini_set('max_execution_time', 300);
ini_set('memory_limit', '256M'); // 增加内存限制

$action = getParam('action', 'chat');

if ($action === 'chat') {
    handleStreamChat();
} elseif ($action === 'learn_start') {
    handleStreamLearnStart();
} elseif ($action === 'learn_confirm') {
    handleStreamLearnConfirm();
} elseif ($action === 'learn_next') {
    handleStreamLearnNext();
}

function sendSSE($event, $data) {
    echo "event: {$event}\n";
    echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
    flush();
}

function requireStreamFrontendUserId() {
    $userId = getAuthenticatedFrontendUserId();

    // 流式请求会持续很久，读取完登录态后立即释放 session 文件锁。
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    if (!$userId) {
        sendSSE('error', ['message' => '请先登录']);
        exit;
    }

    return $userId;
}

function requireStreamOwnedSession($sessionId, $userId, $mode = null) {
    $session = getOwnedChatSession($sessionId, $userId, $mode);
    if (!$session) {
        sendSSE('error', ['message' => '会话不存在或无权访问']);
        exit;
    }

    return $session;
}

function handleStreamChat() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $message = $input['message'] ?? '';
    $userId = requireStreamFrontendUserId();

    if (empty($message)) {
        sendSSE('error', ['message' => '消息不能为空']);
        exit;
    }

    // 检查输入长度限制
    $maxInputLength = defined('MAX_INPUT_LENGTH') ? MAX_INPUT_LENGTH : 8000;
    if (mb_strlen($message) > $maxInputLength) {
        sendSSE('error', ['message' => "输入内容过长，最多支持 {$maxInputLength} 字符"]);
        exit;
    }

    $db = getDB();

    // 创建或获取会话
    if (!$sessionId) {
        $stmt = $db->prepare("INSERT INTO chat_sessions (user_id, mode, title) VALUES (?, 'qa', ?)");
        $stmt->execute([$userId, mb_substr($message, 0, 30)]);
        $sessionId = $db->lastInsertId();
    } else {
        requireStreamOwnedSession($sessionId, $userId);
    }

    // 保存用户消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
    $stmt->execute([$sessionId, $message]);

    // 发送会话ID
    sendSSE('session', ['session_id' => (int)$sessionId]);

    // 获取RAG结果（增加检索数量，提高召回率）
    $ragResults = searchKnowledge($message, 5); // 从3个增加到5个

    // 调试日志
    error_log("🔍 RAG检索: 问题='$message', 找到" . count($ragResults) . "个文档");
    if (!empty($ragResults)) {
        foreach ($ragResults as $i => $doc) {
            error_log("  文档" . ($i+1) . ": {$doc['doc_name']}, 相关度={$doc['score']}");
        }
    }

    // 构建系统提示词（简化版，要求直接回答）
    $systemPrompt = getSystemPrompt('qa_system');

    // 添加RAG上下文（增加内容长度以提供更完整的信息）
    if (!empty($ragResults)) {
        $ragContext = "\n\n【知识库参考资料】\n请优先使用以下知识库中的信息来回答用户问题：\n\n";
        foreach ($ragResults as $i => $doc) {
            $content = $doc['content'] ?? $doc['snippet'] ?? '';
            // 增加内容长度到2000字符，确保包含足够的信息
            $ragContext .= "【参考资料" . ($i + 1) . "】\n";
            $ragContext .= "来源：{$doc['doc_name']}\n";
            $ragContext .= "相关度：" . round($doc['score'] * 100) . "%\n";
            $ragContext .= "内容：\n" . mb_substr($content, 0, 2000) . "\n";
            $ragContext .= str_repeat("-", 50) . "\n\n";
        }
        $ragContext .= "请基于以上参考资料回答用户问题，如果资料中有相关信息，请直接使用。\n";
        $systemPrompt .= $ragContext;

        error_log("✅ RAG上下文已添加，总长度=" . mb_strlen($systemPrompt) . "字符");
    } else {
        error_log("⚠️ 未找到相关知识库文档");
    }

    // 修改系统提示词，让AI直接回答而不是返回JSON（流式输出时）
    $streamPrompt = str_replace(
        '你必须用以下JSON格式返回，不要输出其他内容',
        '请直接用Markdown格式回答，不要使用JSON格式。回答完成后，在最后一行用 [SUGGESTIONS] 开头，然后用竖线分隔3个推荐问题',
        $systemPrompt
    );

    // 添加输出长度限制指导
    $streamPrompt .= "\n\n【重要】回答要求：\n- 回答要简洁精炼，控制在2000字以内\n- 重点突出，避免冗余内容\n- 如果内容较多，请分点总结核心要点";

    $messages = [
        ['role' => 'system', 'content' => $streamPrompt],
        ['role' => 'user', 'content' => $message]
    ];

    // 调用流式API（使用AIManager进行智能故障转移）
    $startTime = microtime(true);
    $fullContent = '';

    try {
        require_once __DIR__ . '/ai-manager.php';
        $aiManager = new AIManager();

        // 使用AIManager的流式调用（带自动故障转移）
        // max_tokens 使用配置文件中的值，输出长度通过后台 Prompt 控制
        $result = $aiManager->streamCall($messages, API_MAX_TOKENS, function($chunk) use (&$fullContent) {
            $fullContent .= $chunk;
            sendSSE('chunk', ['content' => $chunk]);
        });

        $latencyMs = round((microtime(true) - $startTime) * 1000);

        // 如果发生故障转移，记录实际使用的API
        if (!empty($result['fallback_reason'])) {
            error_log("✅ 流式调用已自动切换到{$result['api_used']}，原因: {$result['fallback_reason']}");
        }

        // 解析推荐问题（兼容多种 AI 输出格式）
        $suggestions = [];

        // 格式1: [SUGGESTIONS] 问题1|问题2|问题3
        if (preg_match('/\[SUGGESTIONS\]\s*(.+)$/m', $fullContent, $matches)) {
            $suggestions = array_map('trim', explode('|', $matches[1]));
            $fullContent = preg_replace('/\[SUGGESTIONS\].*$/ms', '', $fullContent);
        }
        // 格式2: ## 推荐追问|["JSON数组"]
        elseif (preg_match('/##\s*推荐追问\s*\|?\s*(\[.+\])$/m', $fullContent, $matches)) {
            $jsonSuggestions = json_decode($matches[1], true);
            if (is_array($jsonSuggestions)) {
                $suggestions = $jsonSuggestions;
            }
            $fullContent = preg_replace('/##\s*推荐追问.*$/ms', '', $fullContent);
        }
        // 格式3: ### 推荐追问问题： 后面跟着竖线分隔的问题
        elseif (preg_match('/#{2,3}\s*推荐追问问题[:：]?\s*\n+\**\n?(.+?)$/ms', $fullContent, $matches)) {
            // 竖线分隔格式
            $raw = trim($matches[1]);
            // 移除末尾可能的 JSON 残留
            $raw = preg_replace('/\|?\s*\["\*\*"\]\s*$/', '', $raw);
            $suggestions = array_map('trim', explode('|', $raw));
            $fullContent = preg_replace('/#{2,3}\s*推荐追问问题.*$/ms', '', $fullContent);
        }
        // 格式4: ---\n## 推荐追问 列表格式
        elseif (preg_match('/---\s*\n+##?\s*推荐追问/m', $fullContent)) {
            if (preg_match_all('/[-\*]\s*(.+?)(?=\n|$)/m', $fullContent, $listMatches)) {
                $allItems = $listMatches[1];
                $suggestions = array_slice($allItems, -3);
            }
            $fullContent = preg_replace('/---\s*\n+##?\s*推荐追问.*$/ms', '', $fullContent);
        }
        // 格式5: 通用匹配 - 内容末尾的竖线分隔问题（如果以上都没匹配到）
        elseif (preg_match('/[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f]/u', $fullContent)) {
            // 查找最后一段包含3个用竖线分隔的问号结尾的内容
            if (preg_match('/([^\n]*[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f][^\n]*)$/u', $fullContent, $matches)) {
                $suggestions = array_map('trim', explode('|', $matches[1]));
                $fullContent = preg_replace('/[\n\r]*[^\n]*[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f][^\|\n]*\|[^\|\n]*[\?\uff1f][^\n]*$/u', '', $fullContent);
            }
        }

        // 清理内容末尾的空白、分隔线和残留标记
        $fullContent = preg_replace('/\n+---\s*$/m', '', $fullContent);
        $fullContent = preg_replace('/\n+>\s*\*\*.*$/ms', '', $fullContent); // 移除末尾的引用标记
        $fullContent = trim($fullContent);

        // 清理 suggestions 中的特殊字符
        $suggestions = array_map(function($s) {
            $s = trim($s);
            $s = preg_replace('/^\*+|\*+$/', '', $s); // 移除前后的星号
            $s = preg_replace('/^[\-\*]\s*/', '', $s); // 移除列表标记
            return trim($s);
        }, $suggestions);

        // 确保 suggestions 是干净的数组
        $suggestions = array_filter($suggestions, function($s) {
            return !empty($s) && mb_strlen($s) > 5; // 过滤太短的项
        });
        $suggestions = array_values(array_slice($suggestions, 0, 3)); // 最多3个

        // 计算最高 RAG 得分
        $maxRagScore = 0;
        if (!empty($ragResults)) {
            foreach ($ragResults as $doc) {
                if (isset($doc['score']) && $doc['score'] > $maxRagScore) {
                    $maxRagScore = $doc['score'];
                }
            }
        }

        // 保存AI回复
        $stmt = $db->prepare("INSERT INTO chat_messages
            (session_id, role, content, suggestions, rag_sources, rag_score, latency_ms)
            VALUES (?, 'assistant', ?, ?, ?, ?, ?)");
        $stmt->execute([
            $sessionId,
            $fullContent,
            json_encode($suggestions, JSON_UNESCAPED_UNICODE),
            json_encode($ragResults, JSON_UNESCAPED_UNICODE),
            $maxRagScore,
            $latencyMs
        ]);
        $messageId = (int)$db->lastInsertId();

        $stmt = $db->prepare("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?");
        $stmt->execute([$sessionId, $userId]);

        // 发送完成事件
        sendSSE('done', [
            'message_id' => $messageId,
            'suggestions' => $suggestions,
            'rag_sources' => $ragResults,
            'latency_ms' => $latencyMs
        ]);

    } catch (Exception $e) {
        sendSSE('error', ['message' => $e->getMessage()]);
    }
}

/**
 * 流式调用AI的通用函数（带智能故障转移）
 * 注：输出长度通过后台 Prompt 配置控制，此处不做硬编码限制
 */
function streamAICall($messages, $maxTokens = null) {
    // 默认使用配置文件中的 max_tokens
    if ($maxTokens === null) {
        $maxTokens = API_MAX_TOKENS;
    }
    require_once __DIR__ . '/ai-manager.php';

    // 检查客户端是否断开连接
    if (connection_aborted()) {
        return '';
    }

    $aiManager = new AIManager();
    $fullContent = '';

    try {
        // 使用AIManager的流式调用（带自动故障转移）
        // 注：输出长度通过后台 Prompt 配置控制，此处不做硬编码限制
        $result = $aiManager->streamCall($messages, $maxTokens, function($chunk) use (&$fullContent) {
            $fullContent .= $chunk;
            sendSSE('chunk', ['content' => $chunk]);

            // 强制刷新输出缓冲区
            if (ob_get_level()) {
                ob_flush();
            }
            flush();
        });

        // 如果发生故障转移，发送通知
        if (!empty($result['fallback_reason'])) {
            error_log("✅ 流式调用已自动切换到{$result['api_used']}，原因: {$result['fallback_reason']}");
            sendSSE('info', [
                'message' => '已切换到' . $result['api_used'],
                'api_used' => $result['api_used'],
                'latency_ms' => $result['latency_ms']
            ]);
        }

        return $result['content'];

    } catch (Exception $e) {
        error_log("streamAICall error: " . $e->getMessage());
        sendSSE('error', ['message' => '网络连接失败，请重试']);
        return $fullContent;
    }

    if ($httpCode !== 200) {
        error_log("streamAICall HTTP error: " . $httpCode);
        sendSSE('error', ['message' => 'API调用失败，请重试']);
        return $fullContent;
    }

    return $fullContent;
}

/**
 * 学习模式 - 开始学习（生成大纲）
 */
function handleStreamLearnStart() {
    $input = getJsonInput();
    $topic = $input['topic'] ?? '';
    $userId = requireStreamFrontendUserId();

    if (empty($topic)) {
        sendSSE('error', ['message' => '请输入学习主题']);
        exit;
    }

    $db = getDB();

    // 创建学习会话 (使用chat_sessions表)
    $stmt = $db->prepare("INSERT INTO chat_sessions (user_id, mode, title, learning_topic, learning_progress) VALUES (?, 'learn', ?, ?, 0)");
    $stmt->execute([$userId, mb_substr($topic, 0, 30), $topic]);
    $sessionId = $db->lastInsertId();

    sendSSE('session', ['session_id' => (int)$sessionId]);

    // 保存用户消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
    $stmt->execute([$sessionId, "我想学习：" . $topic]);

    // 使用数据库中配置的大纲生成 Prompt（包含 GEO 正确定义）
    $systemPrompt = getSystemPrompt('outline_generator');
    // 添加流式输出格式要求（覆盖 JSON 格式要求）
    $systemPrompt = preg_replace('/你必须用以下JSON格式返回[\s\S]*$/m',
        '请用Markdown格式输出大纲，包含7个学习步骤，从基础到进阶。最后估计总学习时间。',
        $systemPrompt);
    // 添加输出长度限制
    $systemPrompt .= "\n\n【重要】大纲要简洁，每个步骤一句话描述，总字数控制在800字以内。";

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => "请为以下主题生成学习大纲：\n\n【{$topic}】"]
    ];

    $fullContent = streamAICall($messages);

    // 保存大纲到chat_sessions
    $stmt = $db->prepare("UPDATE chat_sessions SET learning_outline = ? WHERE id = ?");
    $stmt->execute([$fullContent, $sessionId]);

    // 保存AI回复到chat_messages
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)");
    $stmt->execute([$sessionId, $fullContent]);
    $messageId = (int)$db->lastInsertId();

    // 发送完成事件，包含快捷按钮
    sendSSE('done', [
        'message_id' => $messageId,
        'quick_buttons' => [
            ['id' => 'confirm', 'label' => '✅ 确认，开始学习'],
            ['id' => 'regenerate', 'label' => '🔄 重新生成大纲']
        ]
    ]);
}

/**
 * 学习模式 - 确认大纲，开始第一步
 */
function handleStreamLearnConfirm() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $userId = requireStreamFrontendUserId();

    if (!$sessionId) {
        sendSSE('error', ['message' => '会话ID不能为空']);
        exit;
    }

    $db = getDB();

    // 获取当前用户拥有的学习会话
    $session = requireStreamOwnedSession($sessionId, $userId, 'learn');

    // 更新进度为1
    $stmt = $db->prepare("UPDATE chat_sessions SET learning_progress = 1 WHERE id = ?");
    $stmt->execute([$sessionId]);

    // 发送进度
    sendSSE('progress', ['current' => 1, 'total' => 7]);

    // 保存用户确认消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
    $stmt->execute([$sessionId, "确认大纲，开始学习"]);

    // 使用数据库中配置的学习模式 Prompt（包含 GEO 正确定义）
    $systemPrompt = getSystemPrompt('learn_system');
    // 添加流式输出格式要求（覆盖 JSON 格式要求）
    $systemPrompt = preg_replace('/你必须用以下JSON格式返回[\s\S]*$/m',
        '请用Markdown格式输出教学内容，包含理论知识和实际例子。最后提出一个思考问题让学员回答。',
        $systemPrompt);
    // 添加输出长度限制
    $systemPrompt .= "\n\n【重要】每步教学内容控制在1500字以内，重点突出，配合实例说明。";

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => "主题：{$session['learning_topic']}\n\n大纲：\n{$session['learning_outline']}\n\n请详细讲解第1步的内容。"]
    ];

    $fullContent = streamAICall($messages);

    // 保存AI回复
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)");
    $stmt->execute([$sessionId, $fullContent]);
    $messageId = (int)$db->lastInsertId();

    // 发送完成事件
    sendSSE('done', [
        'message_id' => $messageId,
        'progress' => ['current' => 1, 'total' => 7],
        'quick_buttons' => [
            ['id' => 'next', 'label' => '✅ 我理解了，继续'],
            ['id' => 'explain', 'label' => '🤔 再解释一下']
        ]
    ]);
}

/**
 * 学习模式 - 进入下一步
 */
function handleStreamLearnNext() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $buttonId = $input['button_id'] ?? 'next';
    $userResponse = $input['user_response'] ?? '';
    $userId = requireStreamFrontendUserId();

    if (!$sessionId) {
        sendSSE('error', ['message' => '会话ID不能为空']);
        exit;
    }

    $db = getDB();

    // 获取当前用户拥有的学习会话
    $session = requireStreamOwnedSession($sessionId, $userId, 'learn');

    $currentStep = (int)$session['learning_progress'];

    // 如果是"再解释一下"
    if ($buttonId === 'explain') {
        // 保存用户请求
        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
        $stmt->execute([$sessionId, "请再解释一下第{$currentStep}步"]);

        // 使用数据库中配置的学习模式 Prompt（包含 GEO 正确定义）
        $systemPrompt = getSystemPrompt('learn_system');
        $systemPrompt = preg_replace('/你必须用以下JSON格式返回[\s\S]*$/m',
            '请用更简单的方式解释，多用生活化的例子。用Markdown格式输出。内容控制在1000字以内。',
            $systemPrompt);

        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => "主题：{$session['learning_topic']}\n\n大纲：\n{$session['learning_outline']}\n\n请用更简单易懂的方式重新解释第{$currentStep}步的内容，多举一些实际例子。"]
        ];

        $fullContent = streamAICall($messages);

        // 保存AI回复
        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)");
        $stmt->execute([$sessionId, $fullContent]);
        $messageId = (int)$db->lastInsertId();

        sendSSE('done', [
            'message_id' => $messageId,
            'progress' => ['current' => $currentStep, 'total' => 7],
            'quick_buttons' => [
                ['id' => 'next', 'label' => '✅ 我理解了，继续'],
                ['id' => 'explain', 'label' => '🤔 再解释一下']
            ]
        ]);
        return;
    }

    // 进入下一步
    $nextStep = $currentStep + 1;

    // 检查是否已完成全部学习
    if ($nextStep > 7) {
        // 保存用户完成消息
        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
        $stmt->execute([$sessionId, "完成学习"]);

        // 学习完成
        $stmt = $db->prepare("UPDATE chat_sessions SET learning_progress = 7 WHERE id = ?");
        $stmt->execute([$sessionId]);

        // 使用数据库中配置的学习模式 Prompt（包含 GEO 正确定义）
        $systemPrompt = getSystemPrompt('learn_system');
        $systemPrompt = preg_replace('/你必须用以下JSON格式返回[\s\S]*$/m',
            '请用Markdown格式输出学习总结，内容控制在800字以内。',
            $systemPrompt);

        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user', 'content' => "主题：{$session['learning_topic']}\n\n大纲：\n{$session['learning_outline']}\n\n请生成一份学习完成总结，包含：\n1. 恭喜完成学习\n2. 本次学习的核心要点回顾（3-5点）\n3. 推荐的后续学习方向"]
        ];

        $fullContent = streamAICall($messages);

        // 保存AI回复
        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)");
        $stmt->execute([$sessionId, $fullContent]);
        $messageId = (int)$db->lastInsertId();

        sendSSE('done', [
            'message_id' => $messageId,
            'type' => 'completion',
            'quick_buttons' => [
                ['id' => 'new_topic', 'label' => '🎓 开始新主题学习'],
                ['id' => 'switch_qa', 'label' => '💬 切换到问答模式']
            ]
        ]);
        return;
    }

    // 保存用户继续消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)");
    $stmt->execute([$sessionId, "继续学习第{$nextStep}步"]);

    // 更新进度
    $stmt = $db->prepare("UPDATE chat_sessions SET learning_progress = ? WHERE id = ?");
    $stmt->execute([$nextStep, $sessionId]);

    // 发送进度
    sendSSE('progress', ['current' => $nextStep, 'total' => 7]);

    // 使用数据库中配置的学习模式 Prompt（包含 GEO 正确定义）
    $systemPrompt = getSystemPrompt('learn_system');
    $systemPrompt = preg_replace('/你必须用以下JSON格式返回[\s\S]*$/m',
        '请用Markdown格式输出教学内容，包含理论知识和实际例子。最后提出一个思考问题让学员回答。',
        $systemPrompt);

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => "主题：{$session['learning_topic']}\n\n大纲：\n{$session['learning_outline']}\n\n请详细讲解第{$nextStep}步的内容。"]
    ];

    $fullContent = streamAICall($messages);

    // 保存AI回复
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)");
    $stmt->execute([$sessionId, $fullContent]);
    $messageId = (int)$db->lastInsertId();

    // 发送完成事件
    sendSSE('done', [
        'message_id' => $messageId,
        'progress' => ['current' => $nextStep, 'total' => 7],
        'quick_buttons' => [
            ['id' => 'next', 'label' => '✅ 我理解了，继续'],
            ['id' => 'explain', 'label' => '🤔 再解释一下']
        ]
    ]);
}
