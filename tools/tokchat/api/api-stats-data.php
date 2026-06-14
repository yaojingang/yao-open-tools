<?php
/**
 * Shared read-only API statistics helpers.
 */

require_once __DIR__ . '/db.php';

function apiStatsEnsureTable() {
    $db = getDB();
    $db->exec("CREATE TABLE IF NOT EXISTS api_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT NOT NULL,
        success INTEGER NOT NULL,
        latency REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
}

function apiStatsFetchRows($hours, $limit = 5000) {
    apiStatsEnsureTable();
    $db = getDB();
    try {
        $stmt = $db->prepare("
            SELECT api_name, success, latency, created_at
            FROM api_stats
            WHERE created_at >= datetime('now', '-' || ? || ' hours')
            ORDER BY created_at DESC
            LIMIT ?
        ");
        $stmt->execute([(int)$hours, (int)$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('Fetch API stats rows failed: ' . $e->getMessage());
        return [];
    }
}

function apiStatsFetchRecentRows($limit = 12) {
    apiStatsEnsureTable();
    $db = getDB();
    try {
        $stmt = $db->prepare("
            SELECT api_name, success, latency, created_at
            FROM api_stats
            ORDER BY created_at DESC
            LIMIT ?
        ");
        $stmt->execute([(int)$limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('Fetch recent API stats failed: ' . $e->getMessage());
        return [];
    }
}

function apiStatsFetchEnabledConfigs() {
    $db = getDB();
    try {
        $stmt = $db->query("
            SELECT name, api_type, model, status, priority
            FROM ai_api_configs
            WHERE status = 'active'
            ORDER BY priority ASC, id ASC
        ");
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('Fetch enabled API configs failed: ' . $e->getMessage());
        return [];
    }
}

function apiStatsNormalizeLabel($name) {
    if ($name === 'primary') return '主 API';
    if ($name === 'backup') return '备用 API';
    return $name ?: '未命名 API';
}

function apiStatsMsFromSeconds($seconds) {
    if ($seconds === null || $seconds === '') {
        return null;
    }
    return (int)round(((float)$seconds) * 1000);
}

function apiStatsFormatMs($milliseconds) {
    if ($milliseconds === null) {
        return '-';
    }
    if ($milliseconds >= 1000) {
        return number_format($milliseconds / 1000, 1) . 's';
    }
    return number_format($milliseconds) . 'ms';
}

function apiStatsFormatPercent($value) {
    if ($value === null) return '-';
    $rounded = round((float)$value, 1);
    $formatted = number_format($rounded, 1, '.', '');
    return rtrim(rtrim($formatted, '0'), '.') . '%';
}

function apiStatsFormatBeijingTime($value) {
    if (!$value) return '-';
    try {
        $dt = new DateTime((string)$value, new DateTimeZone('UTC'));
        $dt->setTimezone(new DateTimeZone('Asia/Shanghai'));
        return $dt->format('m-d H:i:s');
    } catch (Throwable $e) {
        return (string)$value;
    }
}

function apiStatsSummarizeRows($rows) {
    $groups = [];
    $overall = [
        'name' => '整体',
        'total' => 0,
        'success' => 0,
        'failed' => 0,
        'latencies' => [],
        'latest_at' => null
    ];

    foreach ($rows as $row) {
        $name = apiStatsNormalizeLabel($row['api_name'] ?? '');
        if (!isset($groups[$name])) {
            $groups[$name] = [
                'name' => $name,
                'total' => 0,
                'success' => 0,
                'failed' => 0,
                'latencies' => [],
                'latest_at' => null
            ];
        }

        $success = (int)($row['success'] ?? 0) === 1;
        $latencyMs = apiStatsMsFromSeconds($row['latency'] ?? null);
        $createdAt = $row['created_at'] ?? null;

        $groups[$name]['total']++;
        $overall['total']++;

        if ($success) {
            $groups[$name]['success']++;
            $overall['success']++;
            if ($latencyMs !== null && $latencyMs > 0) {
                $groups[$name]['latencies'][] = $latencyMs;
                $overall['latencies'][] = $latencyMs;
            }
        } else {
            $groups[$name]['failed']++;
            $overall['failed']++;
        }

        if ($createdAt && (!$groups[$name]['latest_at'] || strcmp($createdAt, $groups[$name]['latest_at']) > 0)) {
            $groups[$name]['latest_at'] = $createdAt;
        }
        if ($createdAt && (!$overall['latest_at'] || strcmp($createdAt, $overall['latest_at']) > 0)) {
            $overall['latest_at'] = $createdAt;
        }
    }

    $finish = function ($item) {
        $latencies = $item['latencies'];
        sort($latencies);
        $avg = count($latencies) ? (int)round(array_sum($latencies) / count($latencies)) : null;
        $min = count($latencies) ? min($latencies) : null;
        $max = count($latencies) ? max($latencies) : null;
        $p95 = null;
        if (count($latencies)) {
            $index = max(0, (int)ceil(count($latencies) * 0.95) - 1);
            $p95 = $latencies[$index];
        }
        $successRate = $item['total'] > 0 ? ($item['success'] / $item['total']) * 100 : null;

        $status = 'nodata';
        $statusText = '无数据';
        if ($item['total'] > 0) {
            if ($successRate < 80) {
                $status = 'critical';
                $statusText = '异常';
            } elseif ($successRate < 95 || ($avg !== null && $avg > 30000) || ($p95 !== null && $p95 > 30000)) {
                $status = 'warning';
                $statusText = '需关注';
            } else {
                $status = 'healthy';
                $statusText = '正常';
            }
        }

        return array_merge($item, [
            'avg_ms' => $avg,
            'min_ms' => $min,
            'max_ms' => $max,
            'p95_ms' => $p95,
            'success_rate' => $successRate,
            'status' => $status,
            'status_text' => $statusText,
            'avg_text' => apiStatsFormatMs($avg),
            'min_text' => apiStatsFormatMs($min),
            'max_text' => apiStatsFormatMs($max),
            'p95_text' => apiStatsFormatMs($p95),
            'success_rate_text' => apiStatsFormatPercent($successRate),
            'latest_at_text' => apiStatsFormatBeijingTime($item['latest_at'] ?? null),
            'bar_width' => $avg === null ? 0 : min(100, max(8, (int)round($avg / 600)))
        ]);
    };

    $items = array_map($finish, array_values($groups));
    usort($items, function ($a, $b) {
        if ($a['status'] !== $b['status']) {
            $rank = ['critical' => 0, 'warning' => 1, 'healthy' => 2, 'nodata' => 3];
            return ($rank[$a['status']] ?? 9) <=> ($rank[$b['status']] ?? 9);
        }
        return $b['total'] <=> $a['total'];
    });

    return [
        'overall' => $finish($overall),
        'items' => $items
    ];
}

function apiStatsBuildSummary() {
    initDatabase();
    $stats24h = apiStatsSummarizeRows(apiStatsFetchRows(24));
    $stats7d = apiStatsSummarizeRows(apiStatsFetchRows(168));
    $recentRows = array_map(function ($row) {
        $success = (int)($row['success'] ?? 0) === 1;
        return [
            'time' => apiStatsFormatBeijingTime($row['created_at'] ?? null),
            'api_name' => apiStatsNormalizeLabel($row['api_name'] ?? ''),
            'success' => $success,
            'result_text' => $success ? '成功' : '失败',
            'latency_text' => $success ? apiStatsFormatMs(apiStatsMsFromSeconds($row['latency'] ?? null)) : '-'
        ];
    }, apiStatsFetchRecentRows(12));
    $enabledApis = apiStatsFetchEnabledConfigs();
    $apiSettings = getAIAPISettings();
    $strategyLabels = [
        'failover' => '优先级故障转移',
        'round_robin' => '轮询',
        'random' => '随机'
    ];
    $strategy = $apiSettings['rotation_strategy'] ?? 'failover';

    return [
        'overview' => [
            'total_24h' => number_format($stats24h['overall']['total']),
            'success_24h' => number_format($stats24h['overall']['success']),
            'failed_24h' => number_format($stats24h['overall']['failed']),
            'success_rate_24h' => $stats24h['overall']['success_rate_text'],
            'avg_24h' => $stats24h['overall']['avg_text'],
            'p95_24h' => $stats24h['overall']['p95_text'],
            'active_routes' => number_format(count($stats24h['items'])),
            'enabled_apis' => number_format(count($enabledApis)),
            'total_7d' => number_format($stats7d['overall']['total']),
            'latest_call' => $stats24h['overall']['latest_at_text']
        ],
        'status' => [
            'value' => $stats24h['overall']['status'],
            'text' => $stats24h['overall']['status_text']
        ],
        'rotation_strategy' => $strategyLabels[$strategy] ?? $strategy,
        'generated_at' => date('Y-m-d H:i:s'),
        'items_24h' => $stats24h['items'],
        'items_7d' => $stats7d['items'],
        'recent' => $recentRows,
        'enabled_apis' => array_map(function ($api) {
            return [
                'name' => $api['name'] ?? '未命名 API',
                'type' => $api['api_type'] ?? '-',
                'model' => $api['model'] ?? '-',
                'priority' => (int)($api['priority'] ?? 0)
            ];
        }, $enabledApis)
    ];
}
