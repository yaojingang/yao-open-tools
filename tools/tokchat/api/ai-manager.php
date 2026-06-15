<?php
/**
 * AI API管理器 - 智能故障转移
 * 功能：
 * 1. 自动检测API响应时间
 * 2. 超时自动切换到备用API
 * 3. 记录API性能统计
 * 4. 支持流式和非流式调用
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

class AIManager {
    private $config;
    private $apis = [];
    private $apiSettings = [];

    public function __construct() {
        $this->config = getConfig();
        $this->apiSettings = getAIAPISettings();
        $this->apis = array_map([$this, 'normalizeAPIConfig'], getEnabledAIAPIConfigs());

        if (empty($this->apis)) {
            $this->apis = $this->getFallbackAPIs();
        }
    }

    /**
     * 智能调用AI（非流式）
     */
    public function call($messages, $options = []) {
        $hasMaxTokensOption = array_key_exists('max_tokens', $options) && $options['max_tokens'] !== null && $options['max_tokens'] !== '';
        $hasTemperatureOption = array_key_exists('temperature', $options) && $options['temperature'] !== null && $options['temperature'] !== '';
        $maxTokens = $hasMaxTokensOption ? max(1, (int)$options['max_tokens']) : $this->config['api_max_tokens'];
        $temperature = $hasTemperatureOption ? (float)$options['temperature'] : $this->config['api_temperature'];

        $errors = [];
        foreach ($this->getAttemptOrder() as $api) {
            $startTime = microtime(true);
            try {
                $apiMaxTokens = $hasMaxTokensOption ? $maxTokens : ($api['max_tokens'] ?: $maxTokens);
                $apiTemperature = $hasTemperatureOption ? $temperature : ($api['temperature'] !== null ? $api['temperature'] : $temperature);
                $result = $this->callAPI($api, $messages, $apiMaxTokens, $apiTemperature);
                $latency = (microtime(true) - $startTime);
                $this->recordStats($api['name'], true, $latency);
                updateAILastAPIId($api['id']);

                if ($latency > $this->config['api_timeout_threshold']) {
                    error_log("⚠️ {$api['name']} API响应较慢: {$latency}秒");
                }

                return [
                    'content' => $result['content'],
                    'usage' => $result['usage'] ?? [],
                    'latency_ms' => round($latency * 1000),
                    'api_used' => $api['name'],
                    'api_id' => $api['id'],
                    'fallback_reason' => empty($errors) ? null : implode('; ', $errors)
                ];
            } catch (Exception $e) {
                $this->recordStats($api['name'], false, 0);
                $errors[] = "{$api['name']}: " . $e->getMessage();
                error_log("❌ {$api['name']} API失败: " . $e->getMessage());
            }
        }

        if (empty($errors)) {
            throw new Exception("未配置可用 API。请先在后台「API 配置」页面添加模型 API。");
        }

        throw new Exception("所有API都失败了。" . implode(' | ', $errors));
    }

    /**
     * 测试单个API连通性
     */
    public function testConnection($apiConfig) {
        $api = $this->normalizeAPIConfig($apiConfig);
        $startTime = microtime(true);
        $result = $this->callAPI($api, [
            ['role' => 'user', 'content' => 'Reply with OK only.']
        ], min((int)($api['max_tokens'] ?: 64), 64), 0);
        $latency = (microtime(true) - $startTime);

        return [
            'success' => true,
            'latency_ms' => round($latency * 1000),
            'content_preview' => mb_substr($result['content'] ?? '', 0, 120)
        ];
    }

    /**
     * 调用单个API
     */
    private function callAPI($api, $messages, $maxTokens, $temperature) {
        $ch = curl_init($api['url']);

        // 根据API类型构建请求体
        if ($api['type'] === 'messages') {
            // Anthropic Messages API格式
            $converted = $this->convertToAnthropicFormat($messages);
            $payload = [
                'model' => $api['model'],
                'max_tokens' => $maxTokens,
                'messages' => $converted['messages']
            ];

            // 添加system消息（如果有）
            if (!empty($converted['system'])) {
                $payload['system'] = $converted['system'];
            }

            if ($temperature !== null) {
                $payload['temperature'] = $temperature;
            }

            $headers = [
                'Content-Type: application/json',
                'x-api-key: ' . $api['key'],
                'anthropic-version: 2023-06-01'
            ];
        } else {
            // OpenAI Chat Completions格式
            $payload = [
                'model' => $api['model'],
                'messages' => $messages,
                'max_tokens' => $maxTokens,
                'temperature' => $temperature
            ];

            $headers = [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $api['key']
            ];
        }

        // 对于主API，使用较短的超时时间以快速故障转移
        // 对于备用API，使用正常的超时时间
        $timeout = max((int)($api['timeout_seconds'] ?? $this->config['api_total_timeout']), 5);
        $connectTimeout = max((int)($api['connect_timeout_seconds'] ?? $this->config['api_connect_timeout']), 1);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => $connectTimeout,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($payload)
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            throw new Exception("API请求失败: " . $error);
        }

        if ($httpCode !== 200) {
            $errorData = json_decode($response, true);
            $errorMsg = $errorData['error']['message'] ?? $response;
            throw new Exception("API错误 ($httpCode): " . $errorMsg);
        }

        $result = json_decode($response, true);

        // 根据API类型解析响应
        if ($api['type'] === 'messages') {
            // Anthropic Messages API响应格式
            if (!isset($result['content'][0]['text'])) {
                throw new Exception("API响应格式错误");
            }
            return [
                'content' => $result['content'][0]['text'],
                'usage' => $result['usage'] ?? []
            ];
        } else {
            // OpenAI Chat Completions响应格式
            if (!isset($result['choices'][0]['message']['content'])) {
                throw new Exception("API响应格式错误");
            }
            return [
                'content' => $result['choices'][0]['message']['content'],
                'usage' => $result['usage'] ?? []
            ];
        }
    }

    /**
     * 将OpenAI格式的消息转换为Anthropic格式
     * 返回: ['messages' => [...], 'system' => '...']
     */
    private function convertToAnthropicFormat($messages) {
        $anthropicMessages = [];
        $systemMessage = '';

        foreach ($messages as $msg) {
            if ($msg['role'] === 'system') {
                // Anthropic将system消息单独处理
                $systemMessage = $msg['content'];
            } else {
                $anthropicMessages[] = [
                    'role' => $msg['role'],
                    'content' => $msg['content']
                ];
            }
        }

        return [
            'messages' => $anthropicMessages,
            'system' => $systemMessage
        ];
    }

    /**
     * 记录API性能统计
     */
    private function recordStats($apiName, $success, $latency) {
        initDatabase();
        $db = getDB();

        try {
            // 插入统计记录
            $stmt = $db->prepare("INSERT INTO api_stats (api_name, success, latency) VALUES (?, ?, ?)");
            $stmt->execute([$apiName, $success ? 1 : 0, $latency]);

        } catch (Exception $e) {
            error_log("记录API统计失败: " . $e->getMessage());
        }
    }

    /**
     * 获取API性能统计
     */
    public function getStats($hours = 24) {
        $db = getDB();

        try {
            $stmt = $db->prepare("
                SELECT
                    api_name,
                    COUNT(*) as total_calls,
                    SUM(success) as successful_calls,
                    AVG(latency) as avg_latency,
                    MIN(latency) as min_latency,
                    MAX(latency) as max_latency
                FROM api_stats
                WHERE created_at >= datetime('now', '-' || ? || ' hours')
                GROUP BY api_name
            ");
            $stmt->execute([$hours]);

            return $stmt->fetchAll(PDO::FETCH_ASSOC);

        } catch (Exception $e) {
            error_log("获取API统计失败: " . $e->getMessage());
            return [];
        }
    }

    /**
     * 流式调用AI（带故障转移）
     */
    public function streamCall($messages, $maxTokens = null, $onChunk = null) {
        $hasMaxTokensArgument = $maxTokens !== null;
        $effectiveMaxTokens = $hasMaxTokensArgument ? max(1, (int)$maxTokens) : $this->config['api_max_tokens'];

        $errors = [];
        foreach ($this->getAttemptOrder() as $api) {
            $startTime = microtime(true);
            try {
                $apiMaxTokens = $hasMaxTokensArgument ? $effectiveMaxTokens : ($api['max_tokens'] ?: $effectiveMaxTokens);
                $result = $this->streamAPI($api, $messages, $apiMaxTokens, $onChunk, $startTime);
                $latency = (microtime(true) - $startTime);
                $this->recordStats($api['name'], true, $latency);
                updateAILastAPIId($api['id']);

                return [
                    'content' => $result,
                    'api_used' => $api['name'],
                    'api_id' => $api['id'],
                    'latency_ms' => round($latency * 1000),
                    'fallback_reason' => empty($errors) ? null : implode('; ', $errors)
                ];
            } catch (Exception $e) {
                $this->recordStats($api['name'], false, 0);
                $errors[] = "{$api['name']}: " . $e->getMessage();
                error_log("❌ {$api['name']} API流式调用失败: " . $e->getMessage());
            }
        }

        throw new Exception("所有API流式调用都失败了。" . implode(' | ', $errors));
    }

    /**
     * 流式调用单个API
     */
    private function streamAPI($api, $messages, $maxTokens, $onChunk, $startTime) {
        $fullContent = '';
        $lastActivityTime = time();
        $maxExecutionTime = 300; // 5分钟，支持长输出
        $hasReceivedData = false;

        $ch = curl_init($api['url']);

        // 根据API类型构建请求
        if ($api['type'] === 'messages') {
            // Anthropic Messages API - 流式
            $converted = $this->convertToAnthropicFormat($messages);
            $payload = [
                'model' => $api['model'],
                'max_tokens' => $maxTokens,
                'messages' => $converted['messages'],
                'stream' => true
            ];

            // 添加system消息（如果有）
            if (!empty($converted['system'])) {
                $payload['system'] = $converted['system'];
            }

            $headers = [
                'Content-Type: application/json',
                'x-api-key: ' . $api['key'],
                'anthropic-version: 2023-06-01'
            ];
        } else {
            // OpenAI Chat Completions - 流式
            $payload = [
                'model' => $api['model'],
                'messages' => $messages,
                'stream' => true,
                'max_tokens' => $maxTokens
            ];

            $headers = [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $api['key']
            ];
        }

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_TIMEOUT => max((int)($api['timeout_seconds'] ?? 300), 5),
            CURLOPT_CONNECTTIMEOUT => max((int)($api['connect_timeout_seconds'] ?? $this->config['api_connect_timeout']), 1),
            CURLOPT_WRITEFUNCTION => function($ch, $data) use (&$fullContent, &$lastActivityTime, &$hasReceivedData, $maxExecutionTime, $onChunk, $api, $startTime) {
                // 检查是否超过初始响应时间阈值
                if (!$hasReceivedData) {
                    $elapsed = microtime(true) - $startTime;
                    if ($elapsed > $this->config['api_timeout_threshold']) {
                        error_log("⚠️ {$api['name']} API初始响应超时: {$elapsed}秒");
                        return 0; // 停止接收，触发故障转移
                    }
                    $hasReceivedData = true;
                }

                // 检查执行时间
                if (time() - $lastActivityTime > $maxExecutionTime) {
                    if ($onChunk) {
                        $onChunk("\n\n⏰ **输出时间过长，已自动停止**");
                    }
                    return 0;
                }

                // 检查客户端连接
                if (connection_aborted()) {
                    return 0;
                }

                // 解析流式数据
                $lines = explode("\n", $data);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (empty($line) || $line === 'data: [DONE]') continue;

                    if (strpos($line, 'data: ') === 0) {
                        $json = json_decode(substr($line, 6), true);

                        $chunk = null;
                        if ($api['type'] === 'messages') {
                            // Anthropic格式
                            if (isset($json['delta']['text'])) {
                                $chunk = $json['delta']['text'];
                            }
                        } else {
                            // OpenAI格式
                            if (isset($json['choices'][0]['delta']['content'])) {
                                $chunk = $json['choices'][0]['delta']['content'];
                            }
                        }

                        if ($chunk !== null) {
                            $fullContent .= $chunk;
                            $lastActivityTime = time();

                            if ($onChunk) {
                                $onChunk($chunk);
                            }
                        }
                    }
                }

                return strlen($data);
            }
        ]);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($result === false || !empty($error)) {
            throw new Exception("流式API调用失败: " . $error);
        }

        if ($httpCode !== 200) {
            throw new Exception("流式API错误，HTTP状态码: " . $httpCode);
        }

        return $fullContent;
    }

    private function getAttemptOrder() {
        $apis = $this->apis;
        $strategy = $this->apiSettings['rotation_strategy'] ?? 'failover';

        if ($strategy === 'random') {
            shuffle($apis);
            return $apis;
        }

        if ($strategy === 'round_robin' && count($apis) > 1) {
            $lastApiId = (int)($this->apiSettings['last_api_id'] ?? 0);
            $nextIndex = 0;
            foreach ($apis as $index => $api) {
                if ((int)$api['id'] === $lastApiId) {
                    $nextIndex = ($index + 1) % count($apis);
                    break;
                }
            }

            return array_merge(array_slice($apis, $nextIndex), array_slice($apis, 0, $nextIndex));
        }

        return $apis;
    }

    private function normalizeAPIConfig($api) {
        return [
            'id' => (int)($api['id'] ?? 0),
            'name' => $api['name'] ?? 'API',
            'url' => $api['url'] ?? $api['api_url'] ?? '',
            'key' => $api['key'] ?? $api['api_key'] ?? '',
            'model' => $api['model'] ?? '',
            'type' => $api['type'] ?? $api['api_type'] ?? 'chat_completions',
            'timeout_seconds' => (int)($api['timeout_seconds'] ?? $this->config['api_total_timeout']),
            'connect_timeout_seconds' => (int)($api['connect_timeout_seconds'] ?? $this->config['api_connect_timeout']),
            'max_tokens' => (int)($api['max_tokens'] ?? $this->config['api_max_tokens']),
            'temperature' => isset($api['temperature']) ? (float)$api['temperature'] : $this->config['api_temperature']
        ];
    }

    private function getFallbackAPIs() {
        $apis = [
            [
                'id' => 0,
                'name' => 'primary',
                'url' => $this->config['tuzi_api_url'],
                'key' => $this->config['tuzi_api_key'],
                'model' => $this->config['tuzi_model'],
                'type' => 'messages',
                'timeout_seconds' => $this->config['api_total_timeout'],
                'connect_timeout_seconds' => $this->config['api_connect_timeout'],
                'max_tokens' => $this->config['api_max_tokens'],
                'temperature' => $this->config['api_temperature']
            ],
            [
                'id' => 0,
                'name' => 'backup',
                'url' => $this->config['tuzi_backup_api_url'],
                'key' => $this->config['tuzi_backup_api_key'],
                'model' => $this->config['tuzi_backup_model'],
                'type' => 'chat_completions',
                'timeout_seconds' => $this->config['api_total_timeout'],
                'connect_timeout_seconds' => $this->config['api_connect_timeout'],
                'max_tokens' => $this->config['api_max_tokens'],
                'temperature' => $this->config['api_temperature']
            ]
        ];

        return array_values(array_filter($apis, function ($api) {
            return trim($api['url']) !== '' && trim($api['key']) !== '' && trim($api['model']) !== '';
        }));
    }
}
