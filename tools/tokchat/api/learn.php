<?php
/**
 * 销售AI支持系统 - 学习模式API
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

// 初始化数据库
initDatabase();

$action = getParam('action', 'start');

switch ($action) {
    case 'start':
        handleStartLearning();
        break;
    case 'confirm':
        handleConfirmOutline();
        break;
    case 'next':
        handleNextStep();
        break;
    case 'progress':
        handleGetProgress();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 开始学习 - 生成大纲
 */
function handleStartLearning() {
    $input = getJsonInput();
    $topic = $input['topic'] ?? '';
    $userId = requireAuthenticatedFrontendUserId();

    if (empty($topic)) {
        jsonError('请输入学习主题');
    }

    // 获取大纲生成提示词
    $systemPrompt = getSystemPrompt('outline_generator');

    // RAG检索知识库 - 获取相关知识用于大纲生成
    $ragResults = searchKnowledge($topic);

    // 如果主题包含GEO，确保包含GEO权威定义
    if (stripos($topic, 'GEO') !== false) {
        $geoResults = searchKnowledge('GEO');
        // 合并结果，确保GEO技术完整介绍文档优先
        $geoDefDoc = null;
        foreach ($geoResults as $result) {
            if ($result['doc_name'] === 'GEO技术完整介绍') {
                $geoDefDoc = $result;
                break;
            }
        }

        if ($geoDefDoc) {
            // 将GEO定义文档放在最前面
            array_unshift($ragResults, $geoDefDoc);
            // 去重，避免重复
            $seen = [];
            $ragResults = array_filter($ragResults, function($item) use (&$seen) {
                $key = $item['doc_name'];
                if (isset($seen[$key])) {
                    return false;
                }
                $seen[$key] = true;
                return true;
            });
        }
    }

    $ragContext = '';
    if (!empty($ragResults)) {
        $ragContext = "\n\n【知识库参考资料】\n";
        foreach ($ragResults as $idx => $result) {
            // 使用完整内容（前2000字符）而不是snippet，确保GEO定义完整
            $content = $result['content'] ?? $result['snippet'] ?? '';
            $ragContext .= ($idx + 1) . ". 来源：{$result['doc_name']}\n内容：" . mb_substr($content, 0, 2000) . "\n\n";
        }
        $ragContext .= "请基于以上知识库内容设计学习大纲，确保概念定义准确。特别注意：GEO是指'Generative Engine Optimization'（生成式引擎优化），不是Gene Expression Omnibus数据库。\n";
    }

    // 添加RAG上下文到系统提示词
    if (!empty($ragContext)) {
        $systemPrompt .= $ragContext;
    }

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => "我想学习：{$topic}"]
    ];

    try {
        $response = callTuziAPI($messages);
        $parsed = parseAIResponse($response['content']);

        $outline = $parsed['outline'] ?? [];
        $estimatedTime = $parsed['estimated_time'] ?? '15分钟';

        // 创建学习会话
        $db = getDB();
        $stmt = $db->prepare("INSERT INTO chat_sessions
            (user_id, mode, title, learning_topic, learning_outline, learning_progress)
            VALUES (?, 'learn', ?, ?, ?, 0)");
        $stmt->execute([
            $userId,
            "学习：" . mb_substr($topic, 0, 20),
            $topic,
            json_encode($outline, JSON_UNESCAPED_UNICODE)
        ]);
        $sessionId = $db->lastInsertId();

        // 保存系统消息
        $outlineText = "我为你设计了以下学习大纲：\n\n";
        foreach ($outline as $item) {
            $outlineText .= "**第{$item['step']}步：{$item['title']}**\n{$item['description']}\n\n";
        }
        $outlineText .= "\n预计学习时间：{$estimatedTime}";

        $stmt = $db->prepare("INSERT INTO chat_messages
            (session_id, role, content, message_type, quick_buttons)
            VALUES (?, 'assistant', ?, 'outline', ?)");
        $stmt->execute([
            $sessionId,
            $outlineText,
            json_encode([
                ['id' => 'confirm', 'label' => '✅ 确认，开始学习'],
                ['id' => 'regenerate', 'label' => '🔄 重新生成大纲']
            ], JSON_UNESCAPED_UNICODE)
        ]);

        jsonSuccess([
            'session_id' => (int)$sessionId,
            'topic' => $topic,
            'outline' => $outline,
            'estimated_time' => $estimatedTime,
            'message' => $outlineText,
            'quick_buttons' => [
                ['id' => 'confirm', 'label' => '✅ 确认，开始学习'],
                ['id' => 'regenerate', 'label' => '🔄 重新生成大纲']
            ]
        ]);

    } catch (Exception $e) {
        logMessage('Learn API Error: ' . $e->getMessage(), 'ERROR');
        jsonError('生成大纲失败: ' . $e->getMessage(), 500);
    }
}

/**
 * 确认大纲，开始第一步学习
 */
function handleConfirmOutline() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $userId = requireAuthenticatedFrontendUserId();

    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();

    $session = requireOwnedChatSession($sessionId, $userId, 'learn');

    $outline = json_decode($session['learning_outline'], true);
    if (empty($outline)) {
        jsonError('大纲数据异常');
    }

    // 保存用户确认消息
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content, message_type) VALUES (?, 'user', '确认大纲，开始学习', 'button_response')");
    $stmt->execute([$sessionId]);

    // 生成第一步学习内容
    $currentStep = $outline[0];
    $response = generateLearningContent($session['learning_topic'], $outline, 0);

    // 保存AI学习内容
    $stmt = $db->prepare("INSERT INTO chat_messages
        (session_id, role, content, message_type, quick_buttons, rag_sources)
        VALUES (?, 'assistant', ?, 'learning', ?, ?)");
    $stmt->execute([
        $sessionId,
        $response['content'] . "\n\n" . $response['question'],
        json_encode($response['quick_buttons'], JSON_UNESCAPED_UNICODE),
        json_encode($response['rag_sources'] ?? [], JSON_UNESCAPED_UNICODE)
    ]);

    // 更新学习进度
    $stmt = $db->prepare("UPDATE chat_sessions SET learning_progress = 1 WHERE id = ? AND user_id = ?");
    $stmt->execute([$sessionId, $userId]);

    // 记录学习进度
    $stmt = $db->prepare("INSERT INTO learning_progress (session_id, step_index, step_title, step_content) VALUES (?, 0, ?, ?)");
    $stmt->execute([$sessionId, $currentStep['title'], $response['content']]);

    jsonSuccess([
        'session_id' => (int)$sessionId,
        'current_step' => 1,
        'total_steps' => count($outline),
        'step_title' => $currentStep['title'],
        'content' => $response['content'],
        'question' => $response['question'],
        'quick_buttons' => $response['quick_buttons'],
        'progress' => ['current' => 1, 'total' => count($outline)]
    ]);
}

/**
 * 处理学习步骤推进
 */
function handleNextStep() {
    $input = getJsonInput();
    $sessionId = $input['session_id'] ?? null;
    $userResponse = $input['user_response'] ?? '';
    $buttonId = $input['button_id'] ?? null;
    $userId = requireAuthenticatedFrontendUserId();

    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();

    $session = requireOwnedChatSession($sessionId, $userId, 'learn');

    $outline = json_decode($session['learning_outline'], true);
    $currentProgress = (int)$session['learning_progress'];

    // 保存用户响应
    $responseText = $buttonId ? "[点击按钮] {$buttonId}" : $userResponse;
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content, message_type) VALUES (?, 'user', ?, 'button_response')");
    $stmt->execute([$sessionId, $responseText]);

    // 更新当前步骤为已完成
    $stmt = $db->prepare("UPDATE learning_progress
        SET is_completed = 1, user_response = ?, completed_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND step_index = ?");
    $stmt->execute([$responseText, $sessionId, $currentProgress - 1]);

    // 检查是否需要先评估用户回答
    if (!$buttonId && !empty($userResponse)) {
        // 用户输入了文字回答，需要评估
        $evaluation = evaluateUserResponse($session['learning_topic'], $outline, $currentProgress - 1, $userResponse);

        // 保存评估反馈
        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content, message_type, quick_buttons) VALUES (?, 'assistant', ?, 'feedback', ?)");
        $feedbackContent = $evaluation['feedback'] . "\n\n" . $evaluation['encouragement'];
        $nextButtons = [
            ['id' => 'continue', 'label' => '👍 继续下一步'],
            ['id' => 'review', 'label' => '🔍 再复习一下这部分']
        ];
        $stmt->execute([$sessionId, $feedbackContent, json_encode($nextButtons, JSON_UNESCAPED_UNICODE)]);

        if (!$evaluation['ready_for_next']) {
            jsonSuccess([
                'type' => 'feedback',
                'content' => $feedbackContent,
                'quick_buttons' => $nextButtons,
                'progress' => ['current' => $currentProgress, 'total' => count($outline)]
            ]);
            return;
        }
    }

    // 检查是否完成所有学习
    if ($currentProgress >= count($outline)) {
        // 学习完成
        $completionMessage = "🎉 **恭喜你完成了本次学习！**\n\n";
        $completionMessage .= "你已经学习了「{$session['learning_topic']}」的全部内容，包括：\n\n";
        foreach ($outline as $item) {
            $completionMessage .= "✅ {$item['title']}\n";
        }
        $completionMessage .= "\n继续保持学习的热情，你会成为更优秀的销售！";

        $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content, message_type, quick_buttons) VALUES (?, 'assistant', ?, 'completion', ?)");
        $stmt->execute([
            $sessionId,
            $completionMessage,
            json_encode([
                ['id' => 'new_topic', 'label' => '📚 学习新主题'],
                ['id' => 'back_qa', 'label' => '💬 切换到问答模式']
            ], JSON_UNESCAPED_UNICODE)
        ]);

        jsonSuccess([
            'type' => 'completion',
            'content' => $completionMessage,
            'quick_buttons' => [
                ['id' => 'new_topic', 'label' => '📚 学习新主题'],
                ['id' => 'back_qa', 'label' => '💬 切换到问答模式']
            ],
            'progress' => ['current' => count($outline), 'total' => count($outline)]
        ]);
        return;
    }

    // 进入下一步
    $nextStep = $outline[$currentProgress];
    $response = generateLearningContent($session['learning_topic'], $outline, $currentProgress);

    // 保存AI学习内容
    $fullContent = $response['content'] . "\n\n" . $response['question'];
    $stmt = $db->prepare("INSERT INTO chat_messages (session_id, role, content, message_type, quick_buttons, rag_sources) VALUES (?, 'assistant', ?, 'learning', ?, ?)");
    $stmt->execute([
        $sessionId,
        $fullContent,
        json_encode($response['quick_buttons'], JSON_UNESCAPED_UNICODE),
        json_encode($response['rag_sources'] ?? [], JSON_UNESCAPED_UNICODE)
    ]);

    // 更新进度
    $newProgress = $currentProgress + 1;
    $stmt = $db->prepare("UPDATE chat_sessions
        SET learning_progress = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?");
    $stmt->execute([$newProgress, $sessionId, $userId]);

    // 记录新步骤
    $stmt = $db->prepare("INSERT INTO learning_progress (session_id, step_index, step_title, step_content) VALUES (?, ?, ?, ?)");
    $stmt->execute([$sessionId, $currentProgress, $nextStep['title'], $response['content']]);

    jsonSuccess([
        'type' => 'learning',
        'current_step' => $newProgress,
        'total_steps' => count($outline),
        'step_title' => $nextStep['title'],
        'content' => $response['content'],
        'question' => $response['question'],
        'quick_buttons' => $response['quick_buttons'],
        'progress' => ['current' => $newProgress, 'total' => count($outline)]
    ]);
}

/**
 * 生成学习内容
 */
function generateLearningContent($topic, $outline, $stepIndex) {
    $currentStep = $outline[$stepIndex];
    $systemPrompt = getSystemPrompt('learn_system');

    // RAG检索知识库 - 获取相关知识
    $ragResults = searchKnowledge($topic . ' ' . $currentStep['title']);

    // 如果主题包含GEO，确保包含GEO权威定义
    if (stripos($topic, 'GEO') !== false || stripos($currentStep['title'], 'GEO') !== false) {
        $geoResults = searchKnowledge('GEO');
        // 合并结果，确保GEO技术完整介绍文档优先
        $geoDefDoc = null;
        foreach ($geoResults as $result) {
            if ($result['doc_name'] === 'GEO技术完整介绍') {
                $geoDefDoc = $result;
                break;
            }
        }

        if ($geoDefDoc) {
            // 将GEO定义文档放在最前面
            array_unshift($ragResults, $geoDefDoc);
            // 去重，避免重复
            $seen = [];
            $ragResults = array_filter($ragResults, function($item) use (&$seen) {
                $key = $item['doc_name'];
                if (isset($seen[$key])) {
                    return false;
                }
                $seen[$key] = true;
                return true;
            });
        }
    }

    $ragContext = '';
    if (!empty($ragResults)) {
        $ragContext = "\n\n【知识库参考资料】\n";
        foreach ($ragResults as $idx => $result) {
            // 使用完整内容（前2000字符）而不是snippet，确保GEO定义完整
            $content = $result['content'] ?? $result['snippet'] ?? '';
            $ragContext .= ($idx + 1) . ". 来源：{$result['doc_name']}\n内容：" . mb_substr($content, 0, 2000) . "\n\n";
        }
        $ragContext .= "请优先使用以上知识库内容进行教学，确保信息准确性。特别注意：GEO是指'Generative Engine Optimization'（生成式引擎优化），不是Gene Expression Omnibus数据库。\n";
    }

    // 构建上下文
    $outlineText = json_encode($outline, JSON_UNESCAPED_UNICODE);
    $contextPrompt = str_replace(
        ['{{topic}}', '{{outline}}', '{{current_step}}'],
        [$topic, $outlineText, json_encode($currentStep, JSON_UNESCAPED_UNICODE)],
        $systemPrompt
    );

    // 添加RAG上下文到系统提示词
    if (!empty($ragContext)) {
        $contextPrompt .= $ragContext;
    }

    $messages = [
        ['role' => 'system', 'content' => $contextPrompt],
        ['role' => 'user', 'content' => "请开始讲解第" . ($stepIndex + 1) . "步：{$currentStep['title']}"]
    ];

    try {
        $response = callTuziAPI($messages);
        $parsed = parseAIResponse($response['content']);

        return [
            'content' => $parsed['content'] ?? $response['content'],
            'question' => $parsed['question'] ?? '你理解了吗？',
            'quick_buttons' => $parsed['quick_buttons'] ?? [
                ['id' => 'understood', 'label' => '👍 我理解了，继续'],
                ['id' => 'example', 'label' => '🤔 能举个例子吗？'],
                ['id' => 'repeat', 'label' => '😅 再解释一下']
            ],
            'rag_sources' => $ragResults ?? []
        ];
    } catch (Exception $e) {
        logMessage('Generate Learning Content Error: ' . $e->getMessage(), 'ERROR');
        return [
            'content' => "【第{$stepIndex}步：{$currentStep['title']}】\n\n{$currentStep['description']}\n\n（详细内容生成中遇到问题，请点击继续）",
            'question' => '准备好继续下一步了吗？',
            'quick_buttons' => [
                ['id' => 'continue', 'label' => '继续'],
                ['id' => 'retry', 'label' => '重试']
            ],
            'rag_sources' => []
        ];
    }
}

/**
 * 评估用户回答
 */
function evaluateUserResponse($topic, $outline, $stepIndex, $userResponse) {
    $currentStep = $outline[$stepIndex];
    $systemPrompt = getSystemPrompt('learn_evaluation');

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => "学习主题：{$topic}\n当前步骤：{$currentStep['title']}\n用户回答：{$userResponse}"]
    ];

    try {
        $response = callTuziAPI($messages);
        $parsed = parseAIResponse($response['content']);

        return [
            'feedback' => $parsed['feedback'] ?? '感谢你的回答！',
            'is_correct' => $parsed['is_correct'] ?? true,
            'encouragement' => $parsed['encouragement'] ?? '继续加油！',
            'ready_for_next' => $parsed['ready_for_next'] ?? true
        ];
    } catch (Exception $e) {
        return [
            'feedback' => '感谢你的思考和回答！',
            'is_correct' => true,
            'encouragement' => '让我们继续学习下一部分吧！',
            'ready_for_next' => true
        ];
    }
}

/**
 * 获取学习进度
 */
function handleGetProgress() {
    $userId = requireAuthenticatedFrontendUserId();
    $sessionId = getParam('session_id');

    if (!$sessionId) {
        jsonError('缺少session_id');
    }

    $db = getDB();

    $session = requireOwnedChatSession($sessionId, $userId, 'learn');

    // 获取学习进度详情
    $stmt = $db->prepare("SELECT * FROM learning_progress WHERE session_id = ? ORDER BY step_index ASC");
    $stmt->execute([$sessionId]);
    $progress = $stmt->fetchAll();

    $outline = json_decode($session['learning_outline'], true);

    jsonSuccess([
        'session_id' => (int)$sessionId,
        'topic' => $session['learning_topic'],
        'outline' => $outline,
        'current_step' => (int)$session['learning_progress'],
        'total_steps' => count($outline),
        'progress_details' => $progress,
        'is_completed' => $session['learning_progress'] >= count($outline)
    ]);
}
