<?php
/**
 * 销售AI支持系统 - 工具函数
 */

require_once __DIR__ . '/config.php';

/**
 * 返回JSON成功响应
 */
function jsonSuccess($data = [], $message = 'success') {
    $response = [
        'success' => true,
        'message' => $message,
        'data' => $data
    ];

    $json = json_encode($response, JSON_UNESCAPED_UNICODE);

    if ($json === false) {
        error_log("JSON encode failed: " . json_last_error_msg());
        // 返回错误信息
        echo json_encode([
            'success' => false,
            'error' => 'JSON encoding failed: ' . json_last_error_msg()
        ]);
    } else {
        echo $json;
    }
    exit();
}

/**
 * 返回JSON错误响应
 */
function jsonError($message, $code = 400) {
    http_response_code($code);
    echo json_encode([
        'success' => false,
        'error' => $message
    ], JSON_UNESCAPED_UNICODE);
    exit();
}

/**
 * 获取POST请求的JSON数据
 */
function getJsonInput() {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    return $data ?: [];
}

/**
 * 获取请求参数
 */
function getParam($key, $default = null) {
    // 先检查 GET 和 POST 参数
    if (isset($_GET[$key])) return $_GET[$key];
    if (isset($_POST[$key])) return $_POST[$key];

    // 检查 JSON 输入
    static $jsonData = null;
    if ($jsonData === null) {
        $input = file_get_contents('php://input');
        $jsonData = json_decode($input, true) ?: [];
    }

    return $jsonData[$key] ?? $default;
}

/**
 * 调用兔子API（带智能故障转移）
 */
function callTuziAPI($messages, $options = []) {
    require_once __DIR__ . '/ai-manager.php';

    $aiManager = new AIManager();

    try {
        $result = $aiManager->call($messages, $options);

        // 如果发生故障转移，记录实际使用的API
        if (!empty($result['fallback_reason'])) {
            error_log("✅ 已自动切换到{$result['api_used']}，原因: {$result['fallback_reason']}");
        }

        return $result;

    } catch (Exception $e) {
        error_log("❌ 所有API都失败: " . $e->getMessage());
        throw $e;
    }
}

/**
 * 解析AI返回的JSON内容
 */
function parseAIResponse($content) {
    // 尝试提取JSON部分
    $content = trim($content);

    // 如果整个内容是JSON
    if (substr($content, 0, 1) === '{') {
        $data = json_decode($content, true);
        if ($data !== null) {
            return $data;
        }
    }

    // 尝试从markdown代码块中提取
    if (preg_match('/```(?:json)?\s*(\{[\s\S]*?\})\s*```/', $content, $matches)) {
        $data = json_decode($matches[1], true);
        if ($data !== null) {
            return $data;
        }
    }

    // 尝试提取第一个完整的JSON对象
    if (preg_match('/\{[\s\S]*\}/', $content, $matches)) {
        $data = json_decode($matches[0], true);
        if ($data !== null) {
            return $data;
        }
    }

    // 解析失败，返回原始内容
    return [
        'answer' => $content,
        'suggestions' => []
    ];
}

/**
 * 选择用于检索/切片的文本。结构化结果明显损坏时回退到原文。
 */
function chooseKnowledgeContentForRetrieval($rawContent, $processedContent = null) {
    $rawContent = (string)$rawContent;
    $processedContent = (string)($processedContent ?? '');

    if (trim($processedContent) === '') {
        return $rawContent;
    }

    $rawLength = max(1, mb_strlen($rawContent));
    $processedLength = max(1, mb_strlen($processedContent));
    $replacementCount = mb_substr_count($processedContent, '�');
    $replacementRatio = $replacementCount / $processedLength;
    $headingCount = substr_count($processedContent, '##');
    $bulletCount = substr_count($processedContent, "\n- ");

    if ($replacementCount > 3 || $replacementRatio > 0.002) {
        return $rawContent;
    }

    if (($headingCount > 80 || $bulletCount > 160) && $processedLength > $rawLength * 1.6) {
        return $rawContent;
    }

    if ($processedLength < $rawLength * 0.35) {
        return $rawContent;
    }

    return $processedContent;
}

/**
 * RAG检索：优先检索知识库切片，回退到旧版文档级倒排索引。
 */
function searchKnowledge($query, $limit = 3) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    if (empty(trim($query))) {
        return [];
    }

    // 提取查询关键词
    $queryKeywords = extractQueryKeywords($query);

    if (empty($queryKeywords)) {
        return [];
    }

    $chunkResults = searchKnowledgeChunks($query, $queryKeywords, $limit);
    if (!empty($chunkResults)) {
        return $chunkResults;
    }

    $queryTerms = array_keys($queryKeywords);

    // 使用倒排索引快速查找匹配的文档
    $placeholders = implode(',', array_fill(0, count($queryTerms), '?'));
    $sql = "SELECT DISTINCT doc_id FROM knowledge_index WHERE term IN ($placeholders)";
    $stmt = $db->prepare($sql);
    $stmt->execute(array_map('mb_strtolower', $queryTerms));
    $matchedDocIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if (empty($matchedDocIds)) {
        // 回退到传统搜索（兼容未建立索引的文档）
        return searchKnowledgeFallback($query, $queryKeywords, $limit);
    }

    // 只加载匹配的文档
    $docPlaceholders = implode(',', array_fill(0, count($matchedDocIds), '?'));
    $stmt = $db->prepare("SELECT id, original_name, content, keywords FROM knowledge_docs WHERE id IN ($docPlaceholders) AND status = 'indexed'");
    $stmt->execute($matchedDocIds);
    $docs = $stmt->fetchAll();

    if (empty($docs)) {
        return searchKnowledgeFallback($query, $queryKeywords, $limit);
    }

    // 获取总文档数用于IDF计算
    $stmt = $db->query("SELECT COUNT(*) FROM knowledge_docs WHERE status = 'indexed'");
    $totalDocs = max(1, $stmt->fetchColumn());

    // 从索引获取文档频率（加速IDF计算）
    $idf = [];
    foreach ($queryTerms as $term) {
        $termLower = mb_strtolower($term);
        $stmt = $db->prepare("SELECT COUNT(DISTINCT doc_id) FROM knowledge_index WHERE term = ?");
        $stmt->execute([$termLower]);
        $docFreq = $stmt->fetchColumn();
        $idf[$term] = $docFreq > 0 ? log($totalDocs / $docFreq) + 1 : 1;
    }

    $results = [];
    foreach ($docs as $doc) {
        $docKeywords = json_decode($doc['keywords'] ?: '{}', true) ?: [];
        $content = $doc['content'];
        $contentLower = mb_strtolower($content);

        $score = 0;
        $matchedTerms = [];
        $bestSnippet = '';
        $bestSnippetScore = 0;

        foreach ($queryKeywords as $term => $queryTf) {
            $termLower = mb_strtolower($term);

            // 从索引获取词频
            $stmt = $db->prepare("SELECT term_count FROM knowledge_index WHERE doc_id = ? AND term = ?");
            $stmt->execute([$doc['id'], $termLower]);
            $docTf = $stmt->fetchColumn() ?: 0;

            // 如果索引中没有，回退到内容搜索
            if ($docTf == 0) {
                $docTf = mb_substr_count($contentLower, $termLower);
            }

            if ($docTf > 0) {
                $termScore = (1 + log($docTf)) * ($idf[$term] ?? 1);
                $score += $termScore * $queryTf;
                $matchedTerms[] = $term;

                // 提取最佳片段
                $pos = mb_strpos($contentLower, $termLower);
                if ($pos !== false && $termScore > $bestSnippetScore) {
                    $bestSnippetScore = $termScore;
                    $start = max(0, $pos - 80);
                    $bestSnippet = mb_substr($content, $start, 250);
                    if ($start > 0) $bestSnippet = '...' . $bestSnippet;
                    if ($start + 250 < mb_strlen($content)) $bestSnippet .= '...';
                }
            }
        }

        if ($score > 0) {
            $normalizedScore = min(1, $score / (count($queryKeywords) * 3));
            $results[] = [
                'id' => $doc['id'],
                'doc_name' => $doc['original_name'],
                'content' => $content,
                'snippet' => $bestSnippet ?: mb_substr($content, 0, 250) . '...',
                'score' => round($normalizedScore, 3),
                'matched_terms' => array_unique($matchedTerms)
            ];
        }
    }

    usort($results, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($results, 0, $limit);
}

/**
 * 检索知识库切片，支持关键词切片检索和可选向量相似度补强。
 */
function searchKnowledgeChunks($query, $queryKeywords, $limit = 3) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    $resultsByChunk = [];
    $queryTerms = array_keys($queryKeywords);

    if (!empty($queryTerms)) {
        $placeholders = implode(',', array_fill(0, count($queryTerms), '?'));
        $termParams = array_map('mb_strtolower', $queryTerms);

        $stmt = $db->prepare("
            SELECT c.id AS chunk_id, c.doc_id, c.chunk_index, c.heading, c.content, c.keywords,
                   d.original_name AS doc_name
            FROM knowledge_chunk_index i
            JOIN knowledge_chunks c ON c.id = i.chunk_id
            JOIN knowledge_docs d ON d.id = c.doc_id
            WHERE i.term IN ($placeholders)
              AND c.status = 'indexed'
              AND d.status = 'indexed'
            GROUP BY c.id
            ORDER BY SUM(i.term_count) DESC, c.doc_id ASC, c.chunk_index ASC
            LIMIT 80
        ");
        $stmt->execute($termParams);
        $chunks = $stmt->fetchAll();

        if (!empty($chunks)) {
            $totalChunks = max(1, (int)$db->query("SELECT COUNT(*) FROM knowledge_chunks WHERE status = 'indexed'")->fetchColumn());
            $idf = [];
            foreach ($queryTerms as $term) {
                $termLower = mb_strtolower($term);
                $freqStmt = $db->prepare("SELECT COUNT(DISTINCT chunk_id) FROM knowledge_chunk_index WHERE term = ?");
                $freqStmt->execute([$termLower]);
                $chunkFreq = (int)$freqStmt->fetchColumn();
                $idf[$term] = $chunkFreq > 0 ? log($totalChunks / $chunkFreq) + 1 : 1;
            }

            $tfStmt = $db->prepare("SELECT term_count FROM knowledge_chunk_index WHERE chunk_id = ? AND term = ?");
            foreach ($chunks as $chunk) {
                $score = 0;
                $matchedTerms = [];
                $contentLower = mb_strtolower($chunk['content']);

                foreach ($queryKeywords as $term => $queryTf) {
                    $termLower = mb_strtolower($term);
                    $tfStmt->execute([$chunk['chunk_id'], $termLower]);
                    $chunkTf = (int)($tfStmt->fetchColumn() ?: 0);
                    if ($chunkTf === 0) {
                        $chunkTf = mb_substr_count($contentLower, $termLower);
                    }

                    if ($chunkTf > 0) {
                        $score += (1 + log($chunkTf)) * ($idf[$term] ?? 1) * $queryTf;
                        $matchedTerms[] = $term;
                    }
                }

                if ($score <= 0) {
                    continue;
                }

                $normalizedScore = min(1, $score / (max(1, count($queryKeywords)) * 3));
                $chunkId = (int)$chunk['chunk_id'];
                $resultsByChunk[$chunkId] = [
                    'id' => (int)$chunk['doc_id'],
                    'chunk_id' => $chunkId,
                    'chunk_index' => (int)$chunk['chunk_index'],
                    'doc_name' => $chunk['doc_name'],
                    'heading' => $chunk['heading'] ?: '',
                    'content' => $chunk['content'],
                    'snippet' => extractBestChunkSnippet($chunk['content'], $matchedTerms),
                    'score' => round($normalizedScore, 3),
                    'keyword_score' => round($normalizedScore, 3),
                    'embedding_score' => null,
                    'matched_terms' => array_values(array_unique($matchedTerms)),
                    'source_type' => 'chunk'
                ];
            }
        }
    }

    foreach (searchKnowledgeEmbeddingChunks($query, $limit * 8) as $semanticResult) {
        $chunkId = (int)$semanticResult['chunk_id'];
        if (isset($resultsByChunk[$chunkId])) {
            $keywordScore = (float)$resultsByChunk[$chunkId]['score'];
            $embeddingScore = (float)$semanticResult['embedding_score'];
            $resultsByChunk[$chunkId]['embedding_score'] = round($embeddingScore, 3);
            $resultsByChunk[$chunkId]['score'] = round(min(1, ($keywordScore * 0.65) + ($embeddingScore * 0.35)), 3);
        } else {
            $resultsByChunk[$chunkId] = $semanticResult;
        }
    }

    $results = array_values($resultsByChunk);
    usort($results, fn($a, $b) => $b['score'] <=> $a['score']);

    return array_slice($results, 0, $limit);
}

/**
 * 基于已保存的 embedding 向量检索切片。
 */
function searchKnowledgeEmbeddingChunks($query, $limit = 20) {
    $api = getActiveEmbeddingAPIConfig();
    if (!$api) {
        return [];
    }

    require_once __DIR__ . '/db.php';
    $db = getDB();

    $vectorCount = (int)$db->query("SELECT COUNT(*) FROM knowledge_embeddings")->fetchColumn();
    if ($vectorCount === 0) {
        return [];
    }

    try {
        $queryVector = callEmbeddingAPI($api, $query);
    } catch (Exception $e) {
        error_log('Embedding query failed: ' . $e->getMessage());
        return [];
    }

    $stmt = $db->query("
        SELECT e.chunk_id, e.vector, c.doc_id, c.chunk_index, c.heading, c.content, d.original_name AS doc_name
        FROM knowledge_embeddings e
        JOIN knowledge_chunks c ON c.id = e.chunk_id
        JOIN knowledge_docs d ON d.id = c.doc_id
        WHERE c.status = 'indexed' AND d.status = 'indexed'
    ");

    $results = [];
    foreach ($stmt->fetchAll() as $row) {
        $chunkVector = json_decode($row['vector'], true);
        if (!is_array($chunkVector) || empty($chunkVector)) {
            continue;
        }

        $similarity = cosineSimilarity($queryVector, $chunkVector);
        if ($similarity <= 0.1) {
            continue;
        }

        $score = max(0, min(1, ($similarity + 1) / 2));
        $results[] = [
            'id' => (int)$row['doc_id'],
            'chunk_id' => (int)$row['chunk_id'],
            'chunk_index' => (int)$row['chunk_index'],
            'doc_name' => $row['doc_name'],
            'heading' => $row['heading'] ?: '',
            'content' => $row['content'],
            'snippet' => mb_substr($row['content'], 0, 260) . (mb_strlen($row['content']) > 260 ? '...' : ''),
            'score' => round($score, 3),
            'keyword_score' => null,
            'embedding_score' => round($score, 3),
            'matched_terms' => [],
            'source_type' => 'embedding_chunk'
        ];
    }

    usort($results, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($results, 0, $limit);
}

function extractBestChunkSnippet($content, $matchedTerms, $length = 260) {
    foreach ($matchedTerms as $term) {
        $pos = mb_stripos($content, $term);
        if ($pos !== false) {
            $start = max(0, $pos - 80);
            $snippet = mb_substr($content, $start, $length);
            if ($start > 0) $snippet = '...' . $snippet;
            if ($start + $length < mb_strlen($content)) $snippet .= '...';
            return $snippet;
        }
    }

    return mb_substr($content, 0, $length) . (mb_strlen($content) > $length ? '...' : '');
}

/**
 * 传统搜索（回退方案，用于未建立索引的文档）
 */
function searchKnowledgeFallback($query, $queryKeywords, $limit = 3) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    $stmt = $db->query("SELECT id, original_name, content, keywords FROM knowledge_docs WHERE status = 'indexed'");
    $docs = $stmt->fetchAll();

    if (empty($docs)) return [];

    $totalDocs = count($docs);
    $idf = [];
    foreach ($queryKeywords as $term => $tf) {
        $docFreq = 0;
        foreach ($docs as $doc) {
            if (mb_strpos(mb_strtolower($doc['content']), mb_strtolower($term)) !== false) {
                $docFreq++;
            }
        }
        $idf[$term] = $docFreq > 0 ? log($totalDocs / $docFreq) + 1 : 0;
    }

    $results = [];
    foreach ($docs as $doc) {
        $contentLower = mb_strtolower($doc['content']);
        $score = 0;
        $matchedTerms = [];
        $bestSnippet = '';

        foreach ($queryKeywords as $term => $queryTf) {
            $docTf = mb_substr_count($contentLower, mb_strtolower($term));
            if ($docTf > 0) {
                $score += (1 + log($docTf)) * ($idf[$term] ?? 1) * $queryTf;
                $matchedTerms[] = $term;
                $pos = mb_strpos($contentLower, mb_strtolower($term));
                if ($pos !== false && empty($bestSnippet)) {
                    $start = max(0, $pos - 80);
                    $bestSnippet = mb_substr($doc['content'], $start, 250);
                    if ($start > 0) $bestSnippet = '...' . $bestSnippet;
                    if ($start + 250 < mb_strlen($doc['content'])) $bestSnippet .= '...';
                }
            }
        }

        if ($score > 0) {
            $results[] = [
                'id' => $doc['id'],
                'doc_name' => $doc['original_name'],
                'content' => $doc['content'],
                'snippet' => $bestSnippet ?: mb_substr($doc['content'], 0, 250) . '...',
                'score' => round(min(1, $score / (count($queryKeywords) * 3)), 3),
                'matched_terms' => array_unique($matchedTerms)
            ];
        }
    }

    usort($results, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($results, 0, $limit);
}

/**
 * 为文档建立倒排索引
 */
function buildDocumentIndex($docId, $content) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    // 删除旧索引
    $stmt = $db->prepare("DELETE FROM knowledge_index WHERE doc_id = ?");
    $stmt->execute([$docId]);

    // 提取关键词并建立索引
    $keywords = extractQueryKeywords($content);

    if (empty($keywords)) return;

    $stmt = $db->prepare("INSERT INTO knowledge_index (doc_id, term, term_count) VALUES (?, ?, ?)");

    foreach ($keywords as $term => $count) {
        $termLower = mb_strtolower($term);
        $stmt->execute([$docId, $termLower, $count]);
    }
}

/**
 * 基于标题、段落、问答和句子边界生成语义切片。
 */
function splitKnowledgeIntoSemanticChunks($content, $options = []) {
    $content = cleanUtf8((string)$content);
    $content = str_replace(["\r\n", "\r"], "\n", $content);
    $content = preg_replace("/[ \t]+/u", ' ', $content);
    $content = preg_replace("/\n{3,}/u", "\n\n", $content);
    $content = trim($content);

    if ($content === '') {
        return [];
    }

    $targetChars = (int)($options['target_chars'] ?? 900);
    $minChars = (int)($options['min_chars'] ?? 260);
    $maxChars = (int)($options['max_chars'] ?? 1400);
    $targetChars = max(300, min(2000, $targetChars));
    $minChars = max(120, min($targetChars, $minChars));
    $maxChars = max($targetChars, min(2600, $maxChars));

    $paragraphs = preg_split("/\n{2,}/u", $content) ?: [$content];
    $units = [];
    $currentHeading = '';

    foreach ($paragraphs as $paragraph) {
        $paragraph = trim($paragraph);
        if ($paragraph === '') {
            continue;
        }

        if (isKnowledgeHeading($paragraph)) {
            $currentHeading = trim(preg_replace('/^#+\s*/u', '', $paragraph));
            $units[] = ['heading' => $currentHeading, 'text' => $paragraph];
            continue;
        }

        foreach (splitLongKnowledgeParagraph($paragraph, $maxChars) as $part) {
            $units[] = ['heading' => $currentHeading, 'text' => $part];
        }
    }

    $chunks = [];
    $buffer = '';
    $bufferHeading = '';

    $flush = function() use (&$chunks, &$buffer, &$bufferHeading) {
        $text = trim($buffer);
        if ($text === '') {
            return;
        }
        $chunks[] = [
            'heading' => $bufferHeading,
            'content' => $text
        ];
        $buffer = '';
        $bufferHeading = '';
    };

    foreach ($units as $unit) {
        $text = trim($unit['text']);
        if ($text === '') {
            continue;
        }

        $candidateLength = mb_strlen(trim($buffer . "\n\n" . $text));
        $isNewTopic = $unit['heading'] !== '' && $bufferHeading !== '' && $unit['heading'] !== $bufferHeading;

        if ($buffer !== '' && ($candidateLength > $targetChars || ($isNewTopic && mb_strlen($buffer) >= $minChars))) {
            $flush();
        }

        if ($buffer === '') {
            $bufferHeading = $unit['heading'];
            $buffer = $text;
        } else {
            $buffer .= "\n\n" . $text;
            if ($bufferHeading === '' && $unit['heading'] !== '') {
                $bufferHeading = $unit['heading'];
            }
        }

        if (mb_strlen($buffer) >= $maxChars) {
            $flush();
        }
    }

    $flush();

    if (count($chunks) <= 1 && mb_strlen($content) > $maxChars) {
        $chunks = [];
        foreach (splitLongKnowledgeParagraph($content, $targetChars) as $part) {
            $chunks[] = ['heading' => '', 'content' => $part];
        }
    }

    return $chunks;
}

function isKnowledgeHeading($text) {
    $text = trim($text);
    if ($text === '') return false;
    if (preg_match('/^#{1,6}\s+\S+/u', $text)) return true;
    if (preg_match('/^第[一二三四五六七八九十百\d]+[章节部分篇][：:、\s]/u', $text)) return true;
    if (preg_match('/^[一二三四五六七八九十]+[、.．]\s*\S{2,40}$/u', $text)) return true;
    if (preg_match('/^\d+(\.\d+)*[、.．]\s*\S{2,50}$/u', $text)) return true;
    if (mb_strlen($text) <= 36 && preg_match('/[：:]$/u', $text)) return true;
    return false;
}

function splitLongKnowledgeParagraph($paragraph, $maxChars = 1400) {
    $paragraph = trim($paragraph);
    if (mb_strlen($paragraph) <= $maxChars) {
        return [$paragraph];
    }

    $sentences = preg_split('/(?<=[。！？!?；;])\s*/u', $paragraph, -1, PREG_SPLIT_NO_EMPTY);
    if (!$sentences || count($sentences) <= 1) {
        $parts = [];
        $length = mb_strlen($paragraph);
        for ($start = 0; $start < $length; $start += $maxChars) {
            $parts[] = mb_substr($paragraph, $start, $maxChars);
        }
        return $parts;
    }

    $parts = [];
    $buffer = '';
    foreach ($sentences as $sentence) {
        $sentence = trim($sentence);
        if ($sentence === '') continue;
        if ($buffer !== '' && mb_strlen($buffer . $sentence) > $maxChars) {
            $parts[] = trim($buffer);
            $buffer = '';
        }
        $buffer .= ($buffer === '' ? '' : ' ') . $sentence;
    }
    if (trim($buffer) !== '') {
        $parts[] = trim($buffer);
    }

    return $parts;
}

/**
 * 重建单篇文档的语义切片和切片倒排索引。
 */
function rebuildKnowledgeChunks($docId, $content, $strategy = 'semantic') {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    $docId = (int)$docId;
    if ($docId <= 0) {
        throw new InvalidArgumentException('文档ID无效');
    }

    $chunks = splitKnowledgeIntoSemanticChunks($content, ['strategy' => $strategy]);
    $embeddingStatus = getActiveEmbeddingAPIConfig() ? 'pending' : 'not_configured';

    try {
        $db->beginTransaction();

        $stmt = $db->prepare("DELETE FROM knowledge_embeddings WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)");
        $stmt->execute([$docId]);
        $stmt = $db->prepare("DELETE FROM knowledge_chunk_index WHERE doc_id = ?");
        $stmt->execute([$docId]);
        $stmt = $db->prepare("DELETE FROM knowledge_chunks WHERE doc_id = ?");
        $stmt->execute([$docId]);

        $chunkStmt = $db->prepare("INSERT INTO knowledge_chunks
            (doc_id, chunk_index, chunk_type, heading, content, keywords, char_count, token_estimate, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexed')");
        $indexStmt = $db->prepare("INSERT INTO knowledge_chunk_index (chunk_id, doc_id, term, term_count) VALUES (?, ?, ?, ?)");

        $count = 0;
        foreach ($chunks as $index => $chunk) {
            $chunkContent = trim($chunk['content'] ?? '');
            if ($chunkContent === '') {
                continue;
            }

            $keywords = extractQueryKeywords($chunkContent);
            $chunkStmt->execute([
                $docId,
                $count,
                $strategy,
                $chunk['heading'] ?? '',
                $chunkContent,
                json_encode($keywords, JSON_UNESCAPED_UNICODE),
                mb_strlen($chunkContent),
                estimateTokenCount($chunkContent)
            ]);
            $chunkId = (int)$db->lastInsertId();

            foreach ($keywords as $term => $termCount) {
                $indexStmt->execute([$chunkId, $docId, mb_strtolower($term), (int)$termCount]);
            }
            $count++;
        }

        $status = $count > 0 ? 'completed' : 'failed';
        $updateStmt = $db->prepare("UPDATE knowledge_docs
            SET chunk_count = ?,
                chunking_status = ?,
                embedding_status = ?,
                last_chunked = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?");
        $updateStmt->execute([$count, $status, $embeddingStatus, $docId]);

        $db->commit();
        return [
            'chunk_count' => $count,
            'chunking_status' => $status,
            'embedding_status' => $embeddingStatus
        ];
    } catch (Exception $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        $stmt = $db->prepare("UPDATE knowledge_docs SET chunking_status = 'failed', updated_at = datetime('now') WHERE id = ?");
        $stmt->execute([$docId]);
        throw $e;
    }
}

function estimateTokenCount($text) {
    $text = (string)$text;
    $ascii = preg_match_all('/[A-Za-z0-9_]+/u', $text);
    $chars = mb_strlen(preg_replace('/\s+/u', '', $text));
    return max(1, (int)ceil(($chars - $ascii) / 1.8 + $ascii * 1.3));
}

/**
 * 使用当前启用的 Embeddings API 为单篇文档切片生成向量。
 */
function buildKnowledgeEmbeddings($docId) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    $docId = (int)$docId;
    $api = getActiveEmbeddingAPIConfig();
    if (!$api) {
        $stmt = $db->prepare("UPDATE knowledge_docs SET embedding_status = 'not_configured', updated_at = datetime('now') WHERE id = ?");
        $stmt->execute([$docId]);
        return [
            'embedding_status' => 'not_configured',
            'embedded_count' => 0,
            'failed_count' => 0,
            'message' => '未配置启用的 Embeddings API'
        ];
    }

    $stmt = $db->prepare("SELECT id, content FROM knowledge_chunks WHERE doc_id = ? AND status = 'indexed' ORDER BY chunk_index ASC");
    $stmt->execute([$docId]);
    $chunks = $stmt->fetchAll();
    if (empty($chunks)) {
        $stmt = $db->prepare("DELETE FROM knowledge_embeddings WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)");
        $stmt->execute([$docId]);
        $stmt = $db->prepare("UPDATE knowledge_docs SET embedding_status = 'failed', updated_at = datetime('now') WHERE id = ?");
        $stmt->execute([$docId]);
        return [
            'embedding_status' => 'failed',
            'embedded_count' => 0,
            'failed_count' => 0,
            'message' => '当前文档还没有可向量化的切片'
        ];
    }

    $clearStmt = $db->prepare("DELETE FROM knowledge_embeddings WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)");
    $clearStmt->execute([$docId]);

    $deleteStmt = $db->prepare("DELETE FROM knowledge_embeddings WHERE chunk_id = ?");
    $insertStmt = $db->prepare("INSERT INTO knowledge_embeddings
        (chunk_id, api_config_id, model, vector, dimensions, status, updated_at)
        VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))");

    $embedded = 0;
    $failed = 0;
    $lastError = '';

    foreach ($chunks as $chunk) {
        try {
            $vector = callEmbeddingAPI($api, $chunk['content']);
            $deleteStmt->execute([$chunk['id']]);
            $insertStmt->execute([
                $chunk['id'],
                (int)$api['id'],
                $api['model'],
                json_encode(array_values($vector)),
                count($vector)
            ]);
            $embedded++;
        } catch (Exception $e) {
            $failed++;
            $lastError = $e->getMessage();
            error_log("Embedding chunk {$chunk['id']} failed: " . $lastError);
        }
    }

    $status = 'completed';
    if ($embedded === 0) {
        $status = 'failed';
    } elseif ($failed > 0) {
        $status = 'partial';
    }

    $stmt = $db->prepare("UPDATE knowledge_docs
        SET embedding_status = ?,
            embedding_model = ?,
            last_embedded = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?");
    $stmt->execute([$status, $api['model'], $docId]);

    return [
        'embedding_status' => $status,
        'embedded_count' => $embedded,
        'failed_count' => $failed,
        'model' => $api['model'],
        'message' => $lastError
    ];
}

function getActiveEmbeddingAPIConfig() {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    try {
        $stmt = $db->query("SELECT * FROM ai_api_configs
            WHERE status = 'active' AND api_type = 'embeddings'
            ORDER BY priority ASC, id ASC
            LIMIT 1");
        $api = $stmt->fetch();
        return $api ?: null;
    } catch (Exception $e) {
        return null;
    }
}

function callEmbeddingAPI($api, $input) {
    $apiUrl = trim($api['api_url'] ?? $api['url'] ?? '');
    $apiKey = trim($api['api_key'] ?? $api['key'] ?? '');
    $model = trim($api['model'] ?? '');

    if ($apiUrl === '' || $apiKey === '' || $model === '') {
        throw new InvalidArgumentException('Embedding API 配置不完整');
    }

    $payload = json_encode([
        'model' => $model,
        'input' => $input
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($apiUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey
        ],
        CURLOPT_CONNECTTIMEOUT => max(1, min(30, (int)($api['connect_timeout_seconds'] ?? 10))),
        CURLOPT_TIMEOUT => max(5, min(120, (int)($api['timeout_seconds'] ?? 30)))
    ]);

    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false || $curlError) {
        throw new RuntimeException('Embedding API 请求失败: ' . $curlError);
    }
    if ($httpCode < 200 || $httpCode >= 300) {
        throw new RuntimeException("Embedding API HTTP {$httpCode}: " . mb_substr($response, 0, 300));
    }

    $data = json_decode($response, true);
    if (!is_array($data)) {
        throw new RuntimeException('Embedding API 返回不是有效 JSON');
    }

    $vector = $data['data'][0]['embedding'] ?? $data['embedding'] ?? null;
    if (!is_array($vector) || empty($vector)) {
        throw new RuntimeException('Embedding API 返回缺少 embedding 向量');
    }

    return array_map('floatval', $vector);
}

function cosineSimilarity($a, $b) {
    $length = min(count($a), count($b));
    if ($length === 0) {
        return 0;
    }

    $dot = 0.0;
    $normA = 0.0;
    $normB = 0.0;
    for ($i = 0; $i < $length; $i++) {
        $av = (float)$a[$i];
        $bv = (float)$b[$i];
        $dot += $av * $bv;
        $normA += $av * $av;
        $normB += $bv * $bv;
    }

    if ($normA <= 0 || $normB <= 0) {
        return 0;
    }

    return $dot / (sqrt($normA) * sqrt($normB));
}

/**
 * 提取查询关键词（增强版 - 支持更智能的语义分词）
 */
function extractQueryKeywords($text) {
    if (empty($text)) return [];

    // 改进的中文分词逻辑
    $text = mb_strtolower($text);

    // 1. 提取完整的中文词组（2-6个字符，增加长度以捕获更多语义）
    $chineseWords = [];

    // 优先提取4-6字的长词组（更具语义价值）
    preg_match_all('/[\p{Han}]{4,6}/u', $text, $matches);
    if (!empty($matches[0])) {
        foreach ($matches[0] as $word) {
            $chineseWords[] = $word;
        }
    }

    // 再提取2-3字的短词组
    preg_match_all('/[\p{Han}]{2,3}/u', $text, $matches);
    if (!empty($matches[0])) {
        foreach ($matches[0] as $word) {
            $chineseWords[] = $word;
        }
    }

    // 2. 提取英文单词和数字组合
    preg_match_all('/[a-z0-9]+/u', $text, $matches);
    if (!empty($matches[0])) {
        foreach ($matches[0] as $word) {
            if (mb_strlen($word) >= 2) {
                $chineseWords[] = $word;
            }
        }
    }

    // 3. 按标点和空格分割处理其他词
    $text = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $text);
    $words = preg_split('/\s+/u', $text);

    // 合并所有词
    $allWords = array_merge($chineseWords, $words);

    // 停用词列表（扩展版）
    $stopWords = ['的', '是', '在', '了', '和', '与', '或', '等', '及', '为', '对', '到', '有', '被',
        '这', '那', '就', '也', '都', '而', '但', '如', '果', '因', '所', '以', '可', '能', '什么', '怎么', '如何', '为什么',
        '吗', '呢', '吧', '啊', '哦', '哪', '哪些', '那些', '这些', '一个', '一些', '怎么样', '怎样', '样', '不', '没', '很', '太',
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
        'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about',
        'what', 'how', 'why', 'where', 'which', 'who', 'whom',
        'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'in', 'on',
        'of', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they'];

    $wordCount = [];
    foreach ($allWords as $word) {
        $word = trim($word);
        if (mb_strlen($word) < 2) continue;
        if (in_array($word, $stopWords)) continue;
        if (is_numeric($word) && mb_strlen($word) < 4) continue; // 忽略短数字

        if (!isset($wordCount[$word])) {
            $wordCount[$word] = 0;
        }
        $wordCount[$word]++;
    }

    return $wordCount;
}

/**
 * 提取文本片段
 */
function extractSnippet($text, $keyword, $length = 200) {
    $pos = mb_stripos($text, $keyword);
    if ($pos === false) {
        return mb_substr($text, 0, $length) . '...';
    }

    $start = max(0, $pos - 50);
    $snippet = mb_substr($text, $start, $length);

    if ($start > 0) {
        $snippet = '...' . $snippet;
    }
    if ($start + $length < mb_strlen($text)) {
        $snippet .= '...';
    }

    return $snippet;
}

/**
 * 清理字符串中的无效UTF-8字符
 */
function cleanUtf8($string) {
    if (!is_string($string)) {
        return $string;
    }

    // 方法1: 使用mb_convert_encoding清理无效字符
    $cleaned = mb_convert_encoding($string, 'UTF-8', 'UTF-8');

    // 方法2: 如果方法1失败，使用iconv
    if ($cleaned === false || !mb_check_encoding($cleaned, 'UTF-8')) {
        $cleaned = iconv('UTF-8', 'UTF-8//IGNORE', $string);
    }

    // 方法3: 如果还是失败，使用正则替换
    if ($cleaned === false) {
        $cleaned = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $string);
    }

    return $cleaned ?: $string; // 如果所有方法都失败，返回原字符串
}

/**
 * 获取系统Prompt
 */
function getSystemPrompt($name) {
    require_once __DIR__ . '/db.php';
    $db = getDB();

    $stmt = $db->prepare("SELECT prompt_content FROM prompt_configs WHERE name = ? AND is_active = 1");
    $stmt->execute([$name]);
    $result = $stmt->fetch();

    return $result ? $result['prompt_content'] : '';
}

/**
 * 记录日志
 */
function logMessage($message, $level = 'INFO') {
    $logFile = __DIR__ . '/../data/app.log';
    $timestamp = date('Y-m-d H:i:s');
    $logEntry = "[{$timestamp}] [{$level}] {$message}" . PHP_EOL;
    file_put_contents($logFile, $logEntry, FILE_APPEND);
}

/**
 * 启动前台持久登录 Session。
 */
function startFrontendSessionIfNeeded() {
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }

    ini_set('session.cookie_lifetime', 315360000);
    ini_set('session.gc_maxlifetime', 315360000);
    session_set_cookie_params([
        'lifetime' => 315360000,
        'path' => '/',
        'secure' => false,
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    session_start();
}

/**
 * 获取当前已认证前台用户 ID，支持 remember cookie 自动恢复。
 */
function getAuthenticatedFrontendUserId() {
    startFrontendSessionIfNeeded();

    if (isset($_SESSION['user_id'])) {
        return (int)$_SESSION['user_id'];
    }

    $rememberToken = $_COOKIE['remember_token'] ?? '';
    $rememberUserId = $_COOKIE['remember_user_id'] ?? '';

    if ($rememberToken === '' || $rememberUserId === '') {
        return null;
    }

    require_once __DIR__ . '/db.php';
    $db = getDB();
    $stmt = $db->prepare("SELECT id, name, role, phone, avatar FROM users
        WHERE id = ? AND remember_token = ? AND status = 'active'");
    $stmt->execute([$rememberUserId, $rememberToken]);
    $user = $stmt->fetch();

    if (!$user) {
        return null;
    }

    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_name'] = $user['name'];
    $_SESSION['user_role'] = $user['role'];
    $_SESSION['user_phone'] = $user['phone'];
    $_SESSION['user_avatar'] = $user['avatar'];
    $_SESSION['login_time'] = time();

    return (int)$user['id'];
}

/**
 * JSON API 使用的前台登录校验。
 */
function requireAuthenticatedFrontendUserId() {
    $userId = getAuthenticatedFrontendUserId();
    if (!$userId) {
        jsonError('未登录', 401);
    }

    return $userId;
}

/**
 * 获取当前用户拥有的会话；不存在和无权访问统一返回 null，避免泄露会话 ID。
 */
function getOwnedChatSession($sessionId, $userId, $mode = null) {
    require_once __DIR__ . '/db.php';
    $db = getDB();
    $sessionId = (int)$sessionId;
    $userId = (int)$userId;

    if ($sessionId <= 0 || $userId <= 0) {
        return null;
    }

    $sql = "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?";
    $params = [$sessionId, $userId];

    if ($mode !== null) {
        $sql .= " AND mode = ?";
        $params[] = $mode;
    }

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $session = $stmt->fetch();

    return $session ?: null;
}

function requireOwnedChatSession($sessionId, $userId, $mode = null) {
    $session = getOwnedChatSession($sessionId, $userId, $mode);
    if (!$session) {
        jsonError('会话不存在或无权访问', 404);
    }

    return $session;
}
