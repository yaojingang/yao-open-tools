<?php
/**
 * 销售AI支持系统 - 统计数据API
 */

session_start();

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

$action = getParam('action', 'dashboard');

if (!isset($_SESSION['admin_id'])) {
    jsonError('未登录或登录已过期', 401);
}

switch ($action) {
    case 'dashboard':
        handleDashboard();
        break;
    case 'trend':
        handleTrend();
        break;
    case 'topics':
        handleTopics();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取Dashboard统计数据
 */
function handleDashboard() {
    $db = getDB();

    // 注：数据库存储的是UTC时间，需要加8小时转换为北京时间后再比较
    // 今日活跃销售（有对话或消息的用户）
    $todayActiveUsers = $db->query("SELECT COUNT(DISTINCT user_id) as count
        FROM chat_sessions
        WHERE DATE(datetime(updated_at, '+8 hours')) = DATE('now', '+8 hours')")->fetch()['count'] ?: 0;

    // 昨日活跃销售
    $yesterdayActiveUsers = $db->query("SELECT COUNT(DISTINCT user_id) as count
        FROM chat_sessions
        WHERE DATE(datetime(updated_at, '+8 hours')) = DATE('now', '+8 hours', '-1 day')")->fetch()['count'] ?: 0;

    // 今日对话次数（用户消息数）
    $todayMessages = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'user' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours')")->fetch()['count'] ?: 0;

    // 昨日对话次数
    $yesterdayMessages = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'user' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours', '-1 day')")->fetch()['count'] ?: 0;

    // 总对话次数
    $totalMessages = $db->query("SELECT COUNT(*) as count FROM chat_messages WHERE role = 'user'")->fetch()['count'] ?: 0;

    // 对话趋势
    $msgTrend = $todayMessages - $yesterdayMessages;

    // GEO学习完成率（学习模式下有 learning_progress > 0 表示已开始学习）
    $totalLearnSessions = $db->query("SELECT COUNT(*) as count FROM chat_sessions WHERE mode = 'learn'")->fetch()['count'] ?: 0;
    // 完成的学习：learning_progress >= 3 表示完成（假设每个学习有3个章节）
    $completedLearnSessions = $db->query("SELECT COUNT(*) as count FROM chat_sessions
        WHERE mode = 'learn' AND learning_progress >= 3")->fetch()['count'] ?: 0;
    // 进行中的学习
    $inProgressLearnSessions = $db->query("SELECT COUNT(*) as count FROM chat_sessions
        WHERE mode = 'learn' AND learning_progress > 0")->fetch()['count'] ?: 0;
    $learnRate = $totalLearnSessions > 0 ? round(($completedLearnSessions / $totalLearnSessions) * 100) : 0;

    // 今日新增学习会话 vs 昨日新增
    $todayLearn = $db->query("SELECT COUNT(*) as count FROM chat_sessions
        WHERE mode = 'learn' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours')")->fetch()['count'] ?: 0;
    $yesterdayLearn = $db->query("SELECT COUNT(*) as count FROM chat_sessions
        WHERE mode = 'learn' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours', '-1 day')")->fetch()['count'] ?: 0;
    $learnRateTrend = $todayLearn - $yesterdayLearn;

    // 知识库命中率（RAG使用率）
    $todayTotalAI = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'assistant' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours')")->fetch()['count'] ?: 0;
    $todayRAGUsed = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'assistant' AND rag_sources IS NOT NULL AND rag_sources != ''
        AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours')")->fetch()['count'] ?: 0;

    $yesterdayTotalAI = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'assistant' AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours', '-1 day')")->fetch()['count'] ?: 0;
    $yesterdayRAGUsed = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'assistant' AND rag_sources IS NOT NULL AND rag_sources != ''
        AND DATE(datetime(created_at, '+8 hours')) = DATE('now', '+8 hours', '-1 day')")->fetch()['count'] ?: 0;

    // 计算命中率
    $todayRAGRate = $todayTotalAI > 0 ? round(($todayRAGUsed / $todayTotalAI) * 100) : 0;
    $yesterdayRAGRate = $yesterdayTotalAI > 0 ? round(($yesterdayRAGUsed / $yesterdayTotalAI) * 100) : 0;

    // 总体命中率
    $totalAI = $db->query("SELECT COUNT(*) as count FROM chat_messages WHERE role = 'assistant'")->fetch()['count'] ?: 0;
    $totalRAGUsed = $db->query("SELECT COUNT(*) as count FROM chat_messages
        WHERE role = 'assistant' AND rag_sources IS NOT NULL AND rag_sources != ''")->fetch()['count'] ?: 0;
    $overallRAGRate = $totalAI > 0 ? round(($totalRAGUsed / $totalAI) * 100) : 0;

    // 计算趋势
    $userTrend = $yesterdayActiveUsers > 0
        ? round((($todayActiveUsers - $yesterdayActiveUsers) / $yesterdayActiveUsers) * 100)
        : ($todayActiveUsers > 0 ? 100 : 0);

    $ragTrend = $todayRAGRate - $yesterdayRAGRate;

    jsonSuccess([
        'stats' => [
            [
                'label' => '今日活跃销售',
                'value' => (string)$todayActiveUsers,
                'trend' => ($userTrend >= 0 ? '+' : '') . $userTrend . '%',
                'trendUp' => $userTrend >= 0,
                'detail' => '昨日: ' . $yesterdayActiveUsers
            ],
            [
                'label' => '对话次数',
                'value' => number_format($totalMessages),
                'trend' => ($msgTrend >= 0 ? '+' : '') . $msgTrend . ' 今日',
                'trendUp' => $msgTrend >= 0,
                'detail' => '今日: ' . $todayMessages
            ],
            [
                'label' => 'GEO 学习完成率',
                'value' => $learnRate . '%',
                'trend' => ($learnRateTrend >= 0 ? '+' : '') . $learnRateTrend . '%',
                'trendUp' => $learnRateTrend >= 0,
                'detail' => $completedLearnSessions . '/' . $totalLearnSessions . ' 完成'
            ],
            [
                'label' => '知识库命中率',
                'value' => $overallRAGRate . '%',
                'trend' => ($ragTrend >= 0 ? '+' : '') . $ragTrend . '% 今日',
                'trendUp' => $ragTrend >= 0,  // 命中率提升是好事
                'detail' => '今日命中率: ' . $todayRAGRate . '%'
            ]
        ]
    ]);
}

/**
 * 获取提问趋势（近30天，北京时间）
 */
function handleTrend() {
    $db = getDB();

    // 设置北京时区
    date_default_timezone_set('Asia/Shanghai');

    $trend = [];
    for ($i = 29; $i >= 0; $i--) {
        // 使用北京时间计算日期
        $beijingDate = date('Y-m-d', strtotime("-{$i} days"));

        // 查询该日期的消息数量（数据库存储UTC时间，加8小时转北京时间）
        $stmt = $db->prepare("SELECT COUNT(*) as count FROM chat_messages
            WHERE role = 'user' AND DATE(datetime(created_at, '+8 hours')) = ?");
        $stmt->execute([$beijingDate]);
        $count = $stmt->fetch()['count'];

        $trend[] = [
            'date' => $beijingDate,
            'label' => date('m/d', strtotime($beijingDate)),
            'count' => (int)$count
        ];
    }

    jsonSuccess(['trend' => $trend]);
}

/**
 * 获取热门话题
 */
function handleTopics() {
    $db = getDB();

    $stmt = $db->query("
        SELECT content AS text, created_at
        FROM chat_messages
        WHERE role = 'user' AND TRIM(COALESCE(content, '')) != ''
        UNION ALL
        SELECT learning_topic AS text, created_at
        FROM chat_sessions
        WHERE mode = 'learn' AND TRIM(COALESCE(learning_topic, '')) != ''
        ORDER BY created_at DESC
        LIMIT 300
    ");
    $rows = $stmt->fetchAll();

    $topics = [];
    foreach ($rows as $row) {
        $label = buildActualTopicLabel((string)$row['text']);
        if ($label === '') {
            continue;
        }

        $key = mb_strtolower($label, 'UTF-8');
        if (!isset($topics[$key])) {
            $topics[$key] = [
                'name' => $label,
                'count' => 0,
                'latest_at' => $row['created_at']
            ];
        }

        $topics[$key]['count']++;
        if (strcmp((string)$row['created_at'], (string)$topics[$key]['latest_at']) > 0) {
            $topics[$key]['latest_at'] = $row['created_at'];
        }
    }

    $result = array_values($topics);
    usort($result, function ($a, $b) {
        if ($a['count'] !== $b['count']) {
            return $b['count'] <=> $a['count'];
        }
        return strcmp((string)$b['latest_at'], (string)$a['latest_at']);
    });

    $result = array_map(function ($topic) {
        return [
            'name' => $topic['name'],
            'count' => (int)$topic['count']
        ];
    }, array_slice($result, 0, 6));

    jsonSuccess(['topics' => $result]);
}

function buildActualTopicLabel($text) {
    $text = trim(preg_replace('/\s+/u', ' ', $text));
    if ($text === '') {
        return '';
    }

    $text = preg_replace('/^我想学习[:：\s]*/u', '', $text);
    $text = preg_replace('/^(请问|请帮我|帮我|麻烦|能不能|可以|我想|我需要|请你)\s*/u', '', $text);
    $text = preg_replace('/(吗|呢|么|呀|啊|吧)[?？。！!]*$/u', '', $text);
    $text = trim($text, " \t\n\r\0\x0B,，.。?？!！:：;；");
    $text = preg_replace('/\b(hi|hello|test)\b/iu', '', $text);

    $meaningless = ['你好', '您好', '测试', 'test', 'hi', 'hello', '在吗'];
    if ($text === '' || in_array(mb_strtolower($text, 'UTF-8'), $meaningless, true)) {
        return '';
    }

    if (mb_strlen($text, 'UTF-8') < 4) {
        return '';
    }

    $text = preg_replace('/^(我现在|现在|那么现在|就是|这个|那个)\s*/u', '', $text);
    $text = str_replace(['，那么现在', '，然后', '，呃'], ['，', '，', '，'], $text);

    $maxLength = 28;
    if (mb_strlen($text, 'UTF-8') > $maxLength) {
        $text = mb_substr($text, 0, $maxLength, 'UTF-8') . '...';
    }

    return $text;
}
