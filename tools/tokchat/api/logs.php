<?php
/**
 * 销售AI支持系统 - 对话日志API
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

$action = getParam('action', 'list');

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

switch ($action) {
    case 'list':
        handleList();
        break;
    case 'detail':
        handleDetail();
        break;
    case 'clear_all':
        handleClearAll();
        break;
    case 'export':
        handleExport();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取对话日志列表
 */
function handleList() {
    $db = getDB();

    $mode = getParam('mode'); // qa / learn
    $userId = getParam('user_id');
    $startDate = getParam('start_date');
    $endDate = getParam('end_date');
    $limit = getParam('limit', 50);
    $offset = getParam('offset', 0);

    $sql = "SELECT
        m.id,
        m.session_id,
        m.role,
        m.content,
        m.message_type,
        m.rag_score,
        m.feedback,
        m.created_at,
        s.mode,
        s.title as session_title,
        u.name as user_name,
        u.company as user_company,
        u.avatar as user_avatar
    FROM chat_messages m
    JOIN chat_sessions s ON m.session_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE m.role = 'user'";

    $params = [];

    if ($mode) {
        $sql .= " AND s.mode = ?";
        $params[] = $mode;
    }
    if ($userId) {
        $sql .= " AND s.user_id = ?";
        $params[] = $userId;
    }
    // 注：数据库存储的是UTC时间，需要加上8小时转换为北京时间后再比较
    if ($startDate) {
        $sql .= " AND DATE(datetime(m.created_at, '+8 hours')) >= ?";
        $params[] = $startDate;
    }
    if ($endDate) {
        $sql .= " AND DATE(datetime(m.created_at, '+8 hours')) <= ?";
        $params[] = $endDate;
    }

    $sql .= " ORDER BY m.created_at DESC LIMIT ? OFFSET ?";
    $params[] = (int)$limit;
    $params[] = (int)$offset;

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $logs = $stmt->fetchAll();

    // 处理数据
    foreach ($logs as &$log) {
        // 获取对应的AI回复
        $stmt = $db->prepare("SELECT content, suggestions, rag_sources, rag_score, latency_ms
            FROM chat_messages
            WHERE session_id = ? AND role = 'assistant' AND id > ?
            ORDER BY id ASC LIMIT 1");
        $stmt->execute([$log['session_id'], $log['id']]);
        $reply = $stmt->fetch();

        $log['ai_reply'] = $reply ? $reply['content'] : null;
        $log['rag_score'] = $reply ? ($reply['rag_score'] ?? 0) : 0;
        $log['rag_sources'] = ($reply && !empty($reply['rag_sources'])) ? json_decode($reply['rag_sources'], true) : [];
        $log['latency_ms'] = $reply ? ($reply['latency_ms'] ?? 0) : 0;

        // 生成用户首字母
        $log['user_initials'] = mb_substr($log['user_name'], 0, 1);

        // 截断内容预览
        $log['content_preview'] = mb_strlen($log['content']) > 50
            ? mb_substr($log['content'], 0, 50) . '...'
            : $log['content'];

        // 格式化时间（数据库存储的是UTC时间，需要转换为北京时间UTC+8）
        date_default_timezone_set('UTC');
        $utcTimestamp = strtotime($log['created_at']);
        $beijingTimestamp = $utcTimestamp + 8 * 3600; // 加8小时
        $log['time'] = date('H:i:s', $beijingTimestamp);
        $log['date'] = date('Y-m-d', $beijingTimestamp);
        $log['datetime'] = date('Y-m-d H:i:s', $beijingTimestamp);
    }

    // 获取总数（应用所有筛选条件）
    $countSql = "SELECT COUNT(*) as total FROM chat_messages m
        JOIN chat_sessions s ON m.session_id = s.id
        WHERE m.role = 'user'";
    $countParams = [];
    if ($mode) {
        $countSql .= " AND s.mode = ?";
        $countParams[] = $mode;
    }
    if ($userId) {
        $countSql .= " AND s.user_id = ?";
        $countParams[] = $userId;
    }
    if ($startDate) {
        $countSql .= " AND DATE(datetime(m.created_at, '+8 hours')) >= ?";
        $countParams[] = $startDate;
    }
    if ($endDate) {
        $countSql .= " AND DATE(datetime(m.created_at, '+8 hours')) <= ?";
        $countParams[] = $endDate;
    }
    $countStmt = $db->prepare($countSql);
    $countStmt->execute($countParams);
    $total = $countStmt->fetch()['total'];

    jsonSuccess([
        'logs' => $logs,
        'total' => (int)$total,
        'limit' => (int)$limit,
        'offset' => (int)$offset
    ]);
}

/**
 * 获取单条日志详情（完整对话）
 */
function handleDetail() {
    $sessionId = getParam('session_id');
    $messageId = getParam('message_id');

    if (!$sessionId && !$messageId) {
        jsonError('缺少session_id或message_id参数');
    }

    $db = getDB();

    if ($messageId) {
        // 通过消息ID获取会话ID
        $stmt = $db->prepare("SELECT session_id FROM chat_messages WHERE id = ?");
        $stmt->execute([$messageId]);
        $result = $stmt->fetch();
        if (!$result) {
            jsonError('消息不存在');
        }
        $sessionId = $result['session_id'];
    }

    // 获取会话信息
    $stmt = $db->prepare("SELECT s.*, u.name as user_name, u.avatar as user_avatar
        FROM chat_sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ?");
    $stmt->execute([$sessionId]);
    $session = $stmt->fetch();

    if (!$session) {
        jsonError('会话不存在');
    }

    // 获取所有消息
    $stmt = $db->prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC");
    $stmt->execute([$sessionId]);
    $messages = $stmt->fetchAll();

    foreach ($messages as &$msg) {
        $msg['suggestions'] = !empty($msg['suggestions']) ? json_decode($msg['suggestions'], true) : [];
        $msg['quick_buttons'] = !empty($msg['quick_buttons']) ? json_decode($msg['quick_buttons'], true) : [];
        $msg['rag_sources'] = !empty($msg['rag_sources']) ? json_decode($msg['rag_sources'], true) : [];
    }

    jsonSuccess([
        'session' => $session,
        'messages' => $messages
    ]);
}

/**
 * 清空所有前台用户的对话日志（仅超级管理员）。
 */
function handleClearAll() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('请使用POST请求', 405);
    }

    if (!isset($_SESSION['admin_role']) || $_SESSION['admin_role'] !== 'super_admin') {
        jsonError('仅超级管理员可以清空对话日志', 403);
    }

    $input = getJsonInput();
    if (($input['confirm'] ?? '') !== 'CLEAR_ALL_LOGS') {
        jsonError('缺少确认参数，操作已取消');
    }

    $csrfToken = (string)($input['csrf_token'] ?? '');
    $sessionCsrfToken = (string)($_SESSION['admin_csrf_token'] ?? '');
    if ($sessionCsrfToken === '' || $csrfToken === '' || !hash_equals($sessionCsrfToken, $csrfToken)) {
        jsonError('安全校验失败，请刷新后台后重试', 403);
    }

    $db = getDB();
    try {
        $db->beginTransaction();

        $counts = [
            'shared_conversations' => (int)$db->query("SELECT COUNT(*) AS count FROM shared_conversations")->fetch()['count'],
            'learning_progress' => (int)$db->query("SELECT COUNT(*) AS count FROM learning_progress")->fetch()['count'],
            'chat_messages' => (int)$db->query("SELECT COUNT(*) AS count FROM chat_messages")->fetch()['count'],
            'chat_sessions' => (int)$db->query("SELECT COUNT(*) AS count FROM chat_sessions")->fetch()['count'],
        ];

        $db->exec("DELETE FROM shared_conversations");
        $db->exec("DELETE FROM learning_progress");
        $db->exec("DELETE FROM chat_messages");
        $db->exec("DELETE FROM chat_sessions");

        $db->commit();

        logMessage(sprintf(
            'Admin %s cleared all chat logs: sessions=%d, messages=%d, learning_progress=%d, shares=%d',
            $_SESSION['admin_username'] ?? ('#' . ($_SESSION['admin_id'] ?? 'unknown')),
            $counts['chat_sessions'],
            $counts['chat_messages'],
            $counts['learning_progress'],
            $counts['shared_conversations']
        ), 'WARN');

        jsonSuccess([
            'deleted' => [
                'shares' => $counts['shared_conversations'],
                'learning_progress' => $counts['learning_progress'],
                'messages' => $counts['chat_messages'],
                'sessions' => $counts['chat_sessions'],
            ]
        ], '所有前台对话日志已清空');
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        jsonError('清空失败: ' . $e->getMessage(), 500);
    }
}

/**
 * 导出日志为CSV或Markdown
 */
function handleExport() {
    $db = getDB();
    $mode = getParam('mode');
    $startDate = getParam('start_date');
    $endDate = getParam('end_date');
    $format = getParam('format', 'csv'); // csv 或 markdown

    // 获取详细的对话数据
    $sql = "SELECT
        m.created_at,
        u.name as user_name,
        s.mode,
        m.content as user_message,
        (SELECT content FROM chat_messages WHERE session_id = m.session_id AND role = 'assistant' AND id > m.id ORDER BY id ASC LIMIT 1) as ai_reply,
        (SELECT rag_sources FROM chat_messages WHERE session_id = m.session_id AND role = 'assistant' AND id > m.id ORDER BY id ASC LIMIT 1) as rag_sources,
        m.feedback
    FROM chat_messages m
    JOIN chat_sessions s ON m.session_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE m.role = 'user'";

    $params = [];
    if ($mode) {
        $sql .= " AND s.mode = ?";
        $params[] = $mode;
    }
    if ($startDate) {
        $sql .= " AND DATE(m.created_at) >= ?";
        $params[] = $startDate;
    }
    if ($endDate) {
        $sql .= " AND DATE(m.created_at) <= ?";
        $params[] = $endDate;
    }

    $sql .= " ORDER BY m.created_at DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $logs = $stmt->fetchAll();

    if ($format === 'markdown') {
        exportMarkdown($logs, $startDate, $endDate, $mode);
    } else {
        exportCSV($logs);
    }
}

/**
 * 导出CSV格式
 */
function exportCSV($logs) {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="chat_logs_' . date('Y-m-d') . '.csv"');

    $output = fopen('php://output', 'w');

    // 写入BOM以支持Excel中文
    fprintf($output, chr(0xEF).chr(0xBB).chr(0xBF));

    // 写入表头
    $headers = ['时间', '用户', '模式', '用户消息', 'AI回复', 'RAG来源数量', '反馈'];
    fputcsv($output, $headers);

    // 写入数据
    foreach ($logs as $log) {
        $ragSources = !empty($log['rag_sources']) ? json_decode($log['rag_sources'], true) : [];
        $ragCount = is_array($ragSources) ? count($ragSources) : 0;

        $row = [
            $log['created_at'],
            $log['user_name'],
            $log['mode'] === 'qa' ? 'QA问答' : '学习模式',
            $log['user_message'],
            $log['ai_reply'] ?? '',
            $ragCount,
            $log['feedback'] ?? ''
        ];
        fputcsv($output, $row);
    }

    fclose($output);
    exit();
}

/**
 * 导出Markdown格式
 */
function exportMarkdown($logs, $startDate, $endDate, $mode) {
    header('Content-Type: text/markdown; charset=utf-8');
    header('Content-Disposition: attachment; filename="chat_logs_' . date('Y-m-d') . '.md"');

    // 生成标题
    echo "# 销售AI支持系统 - 对话日志导出\n\n";

    // 导出信息
    echo "**导出时间**: " . date('Y-m-d H:i:s') . "\n";
    if ($startDate || $endDate) {
        echo "**时间范围**: ";
        if ($startDate) echo $startDate;
        if ($startDate && $endDate) echo " 至 ";
        if ($endDate) echo $endDate;
        echo "\n";
    }
    if ($mode) {
        $modeText = $mode === 'qa' ? 'QA问答' : '学习模式';
        echo "**筛选模式**: {$modeText}\n";
    }
    echo "**记录总数**: " . count($logs) . "\n\n";

    echo "---\n\n";

    // 按日期分组
    $groupedLogs = [];
    foreach ($logs as $log) {
        $date = date('Y-m-d', strtotime($log['created_at']));
        if (!isset($groupedLogs[$date])) {
            $groupedLogs[$date] = [];
        }
        $groupedLogs[$date][] = $log;
    }

    // 输出每日对话
    foreach ($groupedLogs as $date => $dayLogs) {
        echo "## 📅 {$date}\n\n";

        foreach ($dayLogs as $index => $log) {
            $time = date('H:i:s', strtotime($log['created_at']));
            $modeIcon = $log['mode'] === 'qa' ? '❓' : '📚';
            $modeText = $log['mode'] === 'qa' ? 'QA问答' : '学习模式';

            echo "### {$modeIcon} 对话 " . ($index + 1) . " - {$time}\n\n";
            echo "**用户**: {$log['user_name']} | **模式**: {$modeText}\n\n";

            // 用户消息
            echo "**👤 用户提问**:\n";
            echo "> {$log['user_message']}\n\n";

            // AI回复
            if (!empty($log['ai_reply'])) {
                echo "**🤖 AI回复**:\n";
                echo "{$log['ai_reply']}\n\n";

                // RAG来源
                if (!empty($log['rag_sources'])) {
                    $ragSources = json_decode($log['rag_sources'], true);
                    if (is_array($ragSources) && count($ragSources) > 0) {
                        echo "**📚 知识库来源** (" . count($ragSources) . "个):\n";
                        foreach ($ragSources as $i => $source) {
                            $docName = $source['doc_name'] ?? '未知文档';
                            $score = isset($source['score']) ? number_format($source['score'], 2) : '0.00';
                            echo "- " . ($i + 1) . ". {$docName} (相关度: {$score})\n";
                        }
                        echo "\n";
                    }
                }
            }

            // 用户反馈
            if (!empty($log['feedback'])) {
                $feedbackIcon = $log['feedback'] === 'good' ? '👍' : '👎';
                $feedbackText = $log['feedback'] === 'good' ? '满意' : '不满意';
                echo "**{$feedbackIcon} 用户反馈**: {$feedbackText}\n\n";
            }

            echo "---\n\n";
        }
    }

    echo "\n*导出完成 - 销售AI支持系统*\n";
    exit();
}
