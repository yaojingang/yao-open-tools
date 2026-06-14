<?php
/**
 * 销售AI支持系统 - 知识库管理API
 * 支持：文件上传、文本直接提交、预览、编辑、删除、向量匹配检索
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/utils.php';

// 设置API响应头
setApiHeaders();

initDatabase();

$action = getParam('action', 'list');
$publicActions = ['get_version'];
if (!in_array($action, $publicActions, true)) {
    session_start();
    if (!isset($_SESSION['admin_id'])) {
        jsonError('未登录或登录已过期', 401);
    }
}

switch ($action) {
    case 'list':
        handleList();
        break;
    case 'upload':
        handleUpload();
        break;
    case 'add_text':
        handleAddText();
        break;
    case 'update':
        handleUpdate();
        break;
    case 'delete':
        handleDelete();
        break;
    case 'status':
        handleStatus();
        break;
    case 'reindex':
        handleReindex();
        break;
    case 'get':
        handleGet();
        break;
    case 'search':
        handleSearch();
        break;
    case 'chunks':
        handleChunks();
        break;
    case 'chunk':
        handleChunk();
        break;
    case 'embed':
        handleEmbed();
        break;
    case 'rebuild_all_index':
        handleRebuildAllIndex();
        break;
    case 'get_version':
        handleGetVersion();
        break;
    case 'reprocess':
        handleReprocess();
        break;
    default:
        jsonError('未知操作');
}

/**
 * 获取知识库文档列表
 */
function handleList() {
    $db = getDB();
    $stmt = $db->query("SELECT k.*, u.name as uploader_name
        FROM knowledge_docs k
        LEFT JOIN users u ON k.uploaded_by = u.id
        ORDER BY k.created_at DESC");
    $docs = $stmt->fetchAll();

    // 格式化文件大小和处理状态
    foreach ($docs as &$doc) {
        // 移除大字段以减少传输量和避免JSON编码问题
        unset($doc['content']);
        unset($doc['processed_content']);

        $doc['file_size_formatted'] = formatFileSize($doc['file_size']);

        // 处理状态显示
        $doc['processing_status'] = $doc['processing_status'] ?? 'pending';
        $doc['structure_quality'] = (int)($doc['structure_quality'] ?? 0);

        // 状态描述
        switch ($doc['processing_status']) {
            case 'completed':
                $doc['status_text'] = '已优化';
                $doc['status_color'] = 'green';
                break;
            case 'processing':
                $doc['status_text'] = '处理中';
                $doc['status_color'] = 'blue';
                break;
            case 'failed':
                $doc['status_text'] = '处理失败';
                $doc['status_color'] = 'red';
                break;
            default:
                $doc['status_text'] = '待处理';
                $doc['status_color'] = 'gray';
        }

        // 质量等级
        if ($doc['structure_quality'] >= 80) {
            $doc['quality_level'] = '优秀';
            $doc['quality_color'] = 'green';
        } elseif ($doc['structure_quality'] >= 60) {
            $doc['quality_level'] = '良好';
            $doc['quality_color'] = 'blue';
        } elseif ($doc['structure_quality'] >= 40) {
            $doc['quality_level'] = '一般';
            $doc['quality_color'] = 'yellow';
        } else {
            $doc['quality_level'] = '待优化';
            $doc['quality_color'] = 'red';
        }
    }

    jsonSuccess(['docs' => $docs]);
}

/**
 * 上传文档
 */
function handleUpload() {
    $uploadPath = null;
    $filename = null;
    $file = null;
    $ext = null;

    try {
        if (!isset($_FILES['file'])) {
            jsonError('请选择文件');
        }

        $file = $_FILES['file'];

        // 检查上传错误
        if ($file['error'] !== UPLOAD_ERR_OK) {
            $errorMessages = [
                UPLOAD_ERR_INI_SIZE => '文件大小超过PHP配置限制',
                UPLOAD_ERR_FORM_SIZE => '文件大小超过表单限制',
                UPLOAD_ERR_PARTIAL => '文件只有部分被上传',
                UPLOAD_ERR_NO_FILE => '没有文件被上传',
                UPLOAD_ERR_NO_TMP_DIR => '找不到临时文件夹',
                UPLOAD_ERR_CANT_WRITE => '文件写入失败',
                UPLOAD_ERR_EXTENSION => '文件上传被扩展程序阻止'
            ];
            $errorMsg = $errorMessages[$file['error']] ?? '未知上传错误';
            jsonError($errorMsg);
        }

        $config = getConfig();

        // 检查文件大小
        if ($file['size'] > $config['upload_max_size']) {
            jsonError('文件大小超过限制（最大10MB）');
        }

        // 检查文件类型
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, $config['upload_allowed_types'])) {
            jsonError('不支持的文件类型，仅支持：' . implode(', ', $config['upload_allowed_types']));
        }

        // 生成唯一文件名
        $filename = uniqid('doc_') . '.' . $ext;
        $uploadPath = $config['upload_path'] . $filename;

        // 确保上传目录存在
        if (!is_dir($config['upload_path'])) {
            if (!mkdir($config['upload_path'], 0755, true)) {
                jsonError('无法创建上传目录');
            }
        }

        // 移动文件
        if (!move_uploaded_file($file['tmp_name'], $uploadPath)) {
            jsonError('文件移动失败，请检查目录权限');
        }

        // 提取文本内容
        $content = extractTextContent($uploadPath, $ext);

        // 记录提取结果
        error_log("Content extraction for {$file['name']}: " . mb_strlen($content) . " characters");

        if (empty(trim($content)) || strpos($content, '内容提取失败') !== false || strpos($content, '需要安装') !== false) {
            // 如果提取失败，尝试直接读取
            error_log("Content extraction failed, trying raw read for {$file['name']}");
            $rawContent = @file_get_contents($uploadPath);
            if ($rawContent && strlen($rawContent) > 0) {
                $content = $rawContent;
                error_log("Raw content read successful: " . mb_strlen($content) . " characters");
            } else {
                error_log("Raw content read also failed for {$file['name']}");
                jsonError('无法提取文档内容，请检查文件格式');
            }
        }

        // 内容结构化处理
        $processedContent = processDocumentContent($content, $file['name']);
        $structureQuality = calculateStructureQuality($processedContent);

        error_log("Content processing completed. Quality: $structureQuality");

        // 提取关键词和统计 - 使用处理后的内容
        $contentForKeywords = chooseKnowledgeContentForRetrieval($content, $processedContent);
        $keywords = extractKeywords($contentForKeywords);
        $wordCount = mb_strlen(preg_replace('/\s+/', '', $content));

        // 保存到数据库
        $db = getDB();
        $userId = $_POST['user_id'] ?? 1;

        $stmt = $db->prepare("INSERT INTO knowledge_docs
            (filename, original_name, file_type, file_size, content, processed_content, keywords, word_count, structure_quality, processing_status, status, uploaded_by, last_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'indexed', ?, datetime('now'))");

        $result = $stmt->execute([
            $filename,
            $file['name'],
            $ext,
            $file['size'],
            $content,
            $processedContent,
            json_encode($keywords, JSON_UNESCAPED_UNICODE),
            $wordCount,
            $structureQuality,
            $userId
        ]);

        if (!$result) {
            error_log("Database insert failed: " . print_r($stmt->errorInfo(), true));
            jsonError('数据库保存失败');
        }

        $docId = $db->lastInsertId();

        if (!$docId) {
            error_log("Failed to get last insert ID");
            jsonError('获取文档ID失败');
        }

        error_log("Document saved with ID: $docId");

        // 构建倒排索引和语义切片
        buildDocumentIndex($docId, $contentForKeywords);
        $chunkResult = rebuildKnowledgeChunks($docId, $contentForKeywords);

        error_log("Index built for document ID: $docId");

        jsonSuccess([
            'id' => (int)$docId,
            'filename' => $filename,
            'original_name' => $file['name'],
            'file_type' => $ext,
            'file_size' => $file['size'],
            'word_count' => $wordCount,
            'structure_quality' => $structureQuality,
            'chunk_count' => $chunkResult['chunk_count'],
            'chunking_status' => $chunkResult['chunking_status'],
            'embedding_status' => $chunkResult['embedding_status'],
            'processing_status' => 'completed',
            'status' => 'indexed'
        ], '文档上传成功');

    } catch (Exception $e) {
        error_log("Upload exception: " . $e->getMessage() . "\n" . $e->getTraceAsString());
        jsonError('上传处理异常: ' . $e->getMessage());
    }
}

/**
 * 直接添加文本内容
 */
function handleAddText() {
    $input = getJsonInput();
    $title = $input['title'] ?? '';
    $content = $input['content'] ?? '';
    $userId = $input['user_id'] ?? 1;

    if (empty(trim($title))) {
        jsonError('请输入文档标题');
    }
    if (empty(trim($content))) {
        jsonError('请输入文档内容');
    }

    // 提取关键词和统计
    $keywords = extractKeywords($content);
    $wordCount = mb_strlen(preg_replace('/\s+/', '', $content));

    $db = getDB();
    $stmt = $db->prepare("INSERT INTO knowledge_docs
        (filename, original_name, file_type, file_size, content, keywords, word_count, status, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed', ?)");
    $stmt->execute([
        null,
        $title,
        'text',
        strlen($content),
        $content,
        json_encode($keywords, JSON_UNESCAPED_UNICODE),
        $wordCount,
        $userId
    ]);

    $docId = $db->lastInsertId();

    // 构建倒排索引（加速后续搜索）
    buildDocumentIndex($docId, $content);
    $chunkResult = rebuildKnowledgeChunks($docId, $content);

    jsonSuccess([
        'id' => (int)$docId,
        'original_name' => $title,
        'file_type' => 'text',
        'word_count' => $wordCount,
        'chunk_count' => $chunkResult['chunk_count'],
        'chunking_status' => $chunkResult['chunking_status'],
        'status' => 'indexed'
    ], '文档添加成功');
}

/**
 * 更新文档
 */
function handleUpdate() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;
    $title = $input['title'] ?? '';
    $content = $input['content'] ?? '';

    if (!$id) {
        jsonError('缺少id参数');
    }
    if (empty(trim($content))) {
        jsonError('内容不能为空');
    }

    $db = getDB();

    // 检查文档是否存在
    $stmt = $db->prepare("SELECT * FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        jsonError('文档不存在');
    }

    // 重新提取关键词和统计
    $keywords = extractKeywords($content);
    $wordCount = mb_strlen(preg_replace('/\s+/', '', $content));

    // 更新标题（如果提供）
    $newTitle = !empty($title) ? $title : $doc['original_name'];

    $stmt = $db->prepare("UPDATE knowledge_docs
        SET original_name = ?, content = ?, keywords = ?, word_count = ?,
            file_size = ?, status = 'indexed', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?");
    $stmt->execute([
        $newTitle,
        $content,
        json_encode($keywords, JSON_UNESCAPED_UNICODE),
        $wordCount,
        strlen($content),
        $id
    ]);

    // 重建倒排索引
    buildDocumentIndex($id, $content);
    $chunkResult = rebuildKnowledgeChunks($id, $content);

    jsonSuccess([
        'id' => (int)$id,
        'original_name' => $newTitle,
        'word_count' => $wordCount,
        'chunk_count' => $chunkResult['chunk_count'],
        'chunking_status' => $chunkResult['chunking_status']
    ], '文档更新成功');
}

/**
 * 提取文本内容
 */
function extractTextContent($filePath, $ext) {
    $content = '';

    switch ($ext) {
        case 'txt':
        case 'md':
            $content = file_get_contents($filePath);
            break;
        case 'pdf':
            // PDF解析需要额外库，这里简化处理
            $content = "[PDF文件] 需要安装PDF解析库来提取内容。文件路径：{$filePath}";
            // 如果有pdftotext命令可用
            if (function_exists('shell_exec')) {
                $result = @shell_exec('pdftotext ' . escapeshellarg($filePath) . ' -');
                if ($result) {
                    $content = $result;
                }
            }
            break;
        case 'docx':
            // DOCX解析
            $content = extractDocxContent($filePath);
            break;
        default:
            $content = file_get_contents($filePath);
    }

    return $content;
}

/**
 * 提取DOCX内容
 */
function extractDocxContent($filePath) {
    $content = '';

    // 检查ZipArchive扩展是否可用
    if (!class_exists('ZipArchive')) {
        return '[DOCX文件] 需要安装PHP ZipArchive扩展来提取内容';
    }

    $zip = new ZipArchive();
    $result = $zip->open($filePath);

    if ($result === true) {
        $xml = $zip->getFromName('word/document.xml');
        if ($xml) {
            // 解析XML内容
            $content = strip_tags($xml);
            $content = preg_replace('/\s+/', ' ', $content);
            $content = trim($content);
        }
        $zip->close();
    } else {
        // 记录详细的错误信息
        $errorMessages = [
            ZipArchive::ER_OK => 'No error',
            ZipArchive::ER_MULTIDISK => 'Multi-disk zip archives not supported',
            ZipArchive::ER_RENAME => 'Renaming temporary file failed',
            ZipArchive::ER_CLOSE => 'Closing zip archive failed',
            ZipArchive::ER_SEEK => 'Seek error',
            ZipArchive::ER_READ => 'Read error',
            ZipArchive::ER_WRITE => 'Write error',
            ZipArchive::ER_CRC => 'CRC error',
            ZipArchive::ER_ZIPCLOSED => 'Containing zip archive was closed',
            ZipArchive::ER_NOENT => 'No such file',
            ZipArchive::ER_EXISTS => 'File already exists',
            ZipArchive::ER_OPEN => 'Can not open file',
            ZipArchive::ER_TMPOPEN => 'Failure to create temporary file',
            ZipArchive::ER_ZLIB => 'Zlib error',
            ZipArchive::ER_MEMORY => 'Memory allocation failure',
            ZipArchive::ER_CHANGED => 'Entry has been changed',
            ZipArchive::ER_COMPNOTSUPP => 'Compression method not supported',
            ZipArchive::ER_EOF => 'Premature EOF',
            ZipArchive::ER_INVAL => 'Invalid argument',
            ZipArchive::ER_NOZIP => 'Not a zip archive',
            ZipArchive::ER_INTERNAL => 'Internal error',
            ZipArchive::ER_INCONS => 'Zip archive inconsistent',
            ZipArchive::ER_REMOVE => 'Can not remove file',
            ZipArchive::ER_DELETED => 'Entry has been deleted'
        ];

        $errorMsg = $errorMessages[$result] ?? "Unknown error code: $result";
        error_log("DOCX extraction failed for $filePath: $errorMsg");
        return "[DOCX文件] 内容提取失败: $errorMsg";
    }

    return $content ?: '[DOCX文件] 文档内容为空';
}

/**
 * 删除文档
 */
function handleDelete() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $config = getConfig();

    // 获取文件信息
    $stmt = $db->prepare("SELECT filename FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        jsonError('文档不存在');
    }

    // 删除物理文件
    $filePath = !empty($doc['filename']) ? $config['upload_path'] . $doc['filename'] : '';
    if ($filePath !== '' && is_file($filePath)) {
        unlink($filePath);
    }

    // 删除数据库记录
    $stmt = $db->prepare("DELETE FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);

    jsonSuccess([], '文档已删除');
}

/**
 * 启用或停用知识库文档。
 */
function handleStatus() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonError('请使用POST请求', 405);
    }

    $input = getJsonInput();
    $id = (int)($input['id'] ?? 0);
    $status = (string)($input['status'] ?? '');
    $allowedStatuses = ['indexed', 'disabled'];

    if ($id <= 0) {
        jsonError('缺少id参数');
    }
    if (!in_array($status, $allowedStatuses, true)) {
        jsonError('状态参数无效');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, original_name FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        jsonError('文档不存在');
    }

    $stmt = $db->prepare("UPDATE knowledge_docs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    $stmt->execute([$status, $id]);

    jsonSuccess([
        'id' => $id,
        'status' => $status
    ], $status === 'indexed' ? '文档已启用' : '文档已停用');
}

/**
 * 重新索引文档
 */
function handleReindex() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $config = getConfig();

    // 获取文件信息
    $stmt = $db->prepare("SELECT * FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        jsonError('文档不存在');
    }

    // 获取内容
    $content = $doc['content'];

    // 如果有文件，重新提取内容
    if (!empty($doc['filename'])) {
        $filePath = $config['upload_path'] . $doc['filename'];
        if (file_exists($filePath)) {
            $content = extractTextContent($filePath, $doc['file_type']);
            // 更新数据库内容
            $stmt = $db->prepare("UPDATE knowledge_docs SET content = ?, status = 'indexed' WHERE id = ?");
            $stmt->execute([$content, $id]);
        }
    }

    // 重建倒排索引
    buildDocumentIndex($id, $content);
    $chunkResult = rebuildKnowledgeChunks($id, $content);

    jsonSuccess($chunkResult, '重新索引成功');
}

/**
 * 批量重建所有文档的倒排索引
 */
function handleRebuildAllIndex() {
    $db = getDB();

    // 获取所有已索引文档
    $stmt = $db->query("SELECT id, content, processed_content FROM knowledge_docs WHERE status = 'indexed'");
    $docs = $stmt->fetchAll();

    $count = 0;
    foreach ($docs as $doc) {
        if (!empty($doc['content'])) {
            $retrievalContent = chooseKnowledgeContentForRetrieval($doc['content'], $doc['processed_content'] ?? '');
            buildDocumentIndex($doc['id'], $retrievalContent);
            rebuildKnowledgeChunks($doc['id'], $retrievalContent);
            $count++;
        }
    }

    jsonSuccess(['indexed_count' => $count], "成功重建 {$count} 个文档的索引和切片");
}

/**
 * 获取单个文档
 */
function handleGet() {
    $id = getParam('id');

    if (!$id) {
        jsonError('缺少id参数');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        jsonError('文档不存在');
    }

    $doc['file_size_formatted'] = formatFileSize($doc['file_size']);

    // 清理可能包含无效UTF-8字符的字段
    if (isset($doc['content'])) {
        $doc['content'] = cleanUtf8($doc['content']);
    }
    if (isset($doc['processed_content'])) {
        $doc['processed_content'] = cleanUtf8($doc['processed_content']);
    }

    jsonSuccess($doc);
}

/**
 * 获取文档切片列表
 */
function handleChunks() {
    $id = (int)getParam('id', 0);
    if ($id <= 0) {
        jsonError('缺少文档ID');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, original_name, chunk_count, chunking_status, embedding_status, embedding_model, last_chunked, last_embedded
        FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        jsonError('文档不存在');
    }

    $stmt = $db->prepare("SELECT c.id, c.chunk_index, c.chunk_type, c.heading, c.content,
            c.char_count, c.token_estimate, c.status, c.created_at,
            CASE WHEN e.id IS NULL THEN 0 ELSE 1 END AS has_embedding,
            e.dimensions
        FROM knowledge_chunks c
        LEFT JOIN knowledge_embeddings e ON e.chunk_id = c.id
        WHERE c.doc_id = ?
        ORDER BY c.chunk_index ASC");
    $stmt->execute([$id]);
    $chunks = $stmt->fetchAll();

    foreach ($chunks as &$chunk) {
        $chunk['preview'] = mb_substr($chunk['content'], 0, 220) . (mb_strlen($chunk['content']) > 220 ? '...' : '');
        $chunk['has_embedding'] = (bool)$chunk['has_embedding'];
        unset($chunk['content']);
    }

    jsonSuccess([
        'doc' => $doc,
        'chunks' => $chunks
    ]);
}

/**
 * 手动重建文档切片
 */
function handleChunk() {
    $input = getJsonInput();
    $id = (int)($input['id'] ?? getParam('id', 0));
    if ($id <= 0) {
        jsonError('缺少文档ID');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, content, processed_content FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        jsonError('文档不存在');
    }

    $content = chooseKnowledgeContentForRetrieval($doc['content'], $doc['processed_content'] ?? '');
    if (empty(trim((string)$content))) {
        jsonError('文档内容为空，无法切片');
    }

    try {
        $result = rebuildKnowledgeChunks($id, $content);
        jsonSuccess($result, '知识库切片已生成');
    } catch (Exception $e) {
        jsonError('切片失败: ' . $e->getMessage());
    }
}

/**
 * 手动向量化文档切片
 */
function handleEmbed() {
    $input = getJsonInput();
    $id = (int)($input['id'] ?? getParam('id', 0));
    if ($id <= 0) {
        jsonError('缺少文档ID');
    }

    $db = getDB();
    $stmt = $db->prepare("SELECT id, chunk_count FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();
    if (!$doc) {
        jsonError('文档不存在');
    }

    if ((int)($doc['chunk_count'] ?? 0) <= 0) {
        jsonError('请先为文档生成切片');
    }

    try {
        $result = buildKnowledgeEmbeddings($id);
        if ($result['embedding_status'] === 'not_configured') {
            jsonError($result['message'] ?? '未配置启用的 Embeddings API');
        }
        jsonSuccess($result, '向量化处理完成');
    } catch (Exception $e) {
        jsonError('向量化失败: ' . $e->getMessage());
    }
}

/**
 * 知识库搜索
 */
function handleSearch() {
    $query = getParam('q', '');
    $limit = (int)getParam('limit', 5);

    if (empty(trim($query))) {
        jsonError('请输入搜索内容');
    }

    $results = searchKnowledge($query, max(1, min(20, $limit)));

    jsonSuccess([
        'results' => $results,
        'query' => $query,
        'total' => count($results)
    ]);
}

/**
 * 提取关键词（TF统计）
 */
function extractKeywords($text) {
    if (empty($text) || !is_string($text)) return [];

    // 中文分词（简单按标点和空格分割）
    $text = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $text);
    // 确保preg_replace没有返回null
    if ($text === null || $text === false) {
        return [];
    }

    $textLower = mb_strtolower($text, 'UTF-8');
    if ($textLower === false || $textLower === null) {
        return [];
    }

    $words = preg_split('/\s+/u', $textLower);
    if ($words === false) {
        return [];
    }

    // 停用词列表
    $stopWords = ['的', '是', '在', '了', '和', '与', '或', '等', '及', '为', '对', '到', '有', '被',
        '这', '那', '就', '也', '都', '而', '但', '如', '果', '因', '所', '以', '可', '能',
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
        'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about',
        'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'in', 'on',
        'of', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they'];

    $wordCount = [];
    foreach ($words as $word) {
        $word = trim($word);
        if (mb_strlen($word) < 2) continue;
        if (in_array($word, $stopWords)) continue;
        if (is_numeric($word)) continue;

        if (!isset($wordCount[$word])) {
            $wordCount[$word] = 0;
        }
        $wordCount[$word]++;
    }

    // 按频率排序，取前50个关键词
    arsort($wordCount);
    return array_slice($wordCount, 0, 50, true);
}

/**
 * 格式化文件大小
 */
function formatFileSize($bytes) {
    if ($bytes >= 1073741824) {
        return number_format($bytes / 1073741824, 2) . ' GB';
    } elseif ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 2) . ' MB';
    } elseif ($bytes >= 1024) {
        return number_format($bytes / 1024, 2) . ' KB';
    } else {
        return $bytes . ' bytes';
    }
}

/**
 * 获取知识库版本信息
 */
function handleGetVersion() {
    $db = getDB();

    // 获取最新的知识库更新时间
    $stmt = $db->prepare("SELECT MAX(updated_at) as last_updated FROM knowledge_docs WHERE status = 'indexed'");
    $stmt->execute();
    $result = $stmt->fetch();

    $lastUpdated = $result['last_updated'] ?? null;

    jsonSuccess([
        'last_updated' => $lastUpdated,
        'total_docs' => $db->query("SELECT COUNT(*) FROM knowledge_docs WHERE status = 'indexed'")->fetchColumn()
    ]);
}

/**
 * 文档内容结构化处理
 */
function processDocumentContent($content, $filename) {
    // 检查输入内容
    if (empty($content) || !is_string($content)) {
        return $content; // 返回原内容，避免null
    }

    // 如果内容已经比较结构化，直接返回
    if (isContentWellStructured($content)) {
        return $content;
    }

    // 规则化处理：快速改善内容结构
    $processed = quickFormatContent($content);

    // 如果配置了AI处理，可以进一步优化
    if (defined('ENABLE_AI_CONTENT_PROCESSING') && ENABLE_AI_CONTENT_PROCESSING) {
        $processed = aiProcessContent($processed, $filename);
    }

    return $processed ?: $content; // 确保不返回空值
}

/**
 * 检查内容是否已经结构化
 */
function isContentWellStructured($content) {
    // 检查输入
    if (empty($content) || !is_string($content)) {
        return false;
    }

    $indicators = 0;

    // 检查是否有标题标记
    if (preg_match('/^#+\s+/m', $content)) $indicators++;
    if (preg_match('/^##\s+/m', $content)) $indicators++;

    // 检查是否有段落分隔
    if (substr_count($content, "\n\n") > 2) $indicators++;

    // 检查是否有列表
    if (preg_match('/^[-*]\s+/m', $content)) $indicators++;

    // 检查是否有合理的句子分隔
    $sentences = preg_split('/[。！？]/', $content);
    if (count($sentences) > 3) $indicators++;

    return $indicators >= 3;
}

/**
 * 快速格式化内容
 */
function quickFormatContent($content) {
    // 检查输入
    if (empty($content) || !is_string($content)) {
        return $content;
    }

    $original = $content; // 保存原始内容作为备份

    // 1. 清理多余空白
    $content = preg_replace('/\s+/', ' ', $content);
    if ($content === null || $content === false) return $original;
    $content = trim($content);

    // 2. 段落分隔：在句号、感叹号、问号后添加段落分隔
    $temp = preg_replace('/([。！？])\s*([^\s\n])/', "$1\n\n$2", $content);
    if ($temp !== null && $temp !== false) $content = $temp;

    // 3. 识别并格式化标题（基于常见模式）
    // 匹配类似 "XXX介绍："、"关于XXX："等模式
    $temp = preg_replace('/^([^。]{8,30}[：:])\s*/m', "## $1\n\n", $content);
    if ($temp !== null && $temp !== false) $content = $temp;

    // 4. 识别并格式化要点（基于顿号、逗号分隔的列表）
    $temp = preg_replace('/([，、])\s*([^，、。]{10,50}[，、。])/m', "$1\n- $2", $content);
    if ($temp !== null && $temp !== false) $content = $temp;

    // 5. 强调重要词汇
    $importantTerms = ['GEO', '生成式引擎优化', '移山科技', 'AI', '人工智能', '优化', '算法'];
    foreach ($importantTerms as $term) {
        $temp = preg_replace('/(?<![*])(' . preg_quote($term, '/') . ')(?![*])/', '**$1**', $content);
        if ($temp !== null && $temp !== false) $content = $temp;
    }

    // 6. 清理多余的换行
    $temp = preg_replace('/\n{3,}/', "\n\n", $content);
    if ($temp !== null && $temp !== false) $content = $temp;

    // 7. 添加文档标题（如果没有的话）
    if (!preg_match('/^#/', $content)) {
        $title = extractDocumentTitle($content);
        if ($title) {
            $content = "# $title\n\n" . $content;
        }
    }

    return $content ?: $original; // 确保返回有效内容
}

/**
 * 提取文档标题
 */
function extractDocumentTitle($content) {
    // 尝试从内容开头提取标题
    $lines = explode("\n", $content);
    $firstLine = trim($lines[0]);

    // 如果第一行比较短且包含关键词，作为标题
    if (mb_strlen($firstLine) < 50 && mb_strlen($firstLine) > 5) {
        $keywords = ['介绍', '说明', '指南', '手册', '文档', 'GEO', '移山', '技术'];
        foreach ($keywords as $keyword) {
            if (strpos($firstLine, $keyword) !== false) {
                return $firstLine;
            }
        }
    }

    // 默认标题
    return '知识库文档';
}

/**
 * 计算结构化质量评分
 */
function calculateStructureQuality($content) {
    // 检查输入
    if (empty($content) || !is_string($content)) {
        return 0;
    }

    $score = 0;

    // 标题结构 (30分)
    if (preg_match('/^#\s+/m', $content)) $score += 15;
    if (preg_match('/^##\s+/m', $content)) $score += 15;

    // 段落结构 (25分)
    $paragraphs = explode("\n\n", $content);
    if (count($paragraphs) >= 3) $score += 15;
    if (count($paragraphs) >= 5) $score += 10;

    // 列表结构 (20分)
    if (preg_match('/^[-*]\s+/m', $content)) $score += 20;

    // 强调标记 (15分)
    if (preg_match('/\*\*[^*]+\*\*/', $content)) $score += 15;

    // 内容长度合理性 (10分)
    $length = mb_strlen($content);
    if ($length > 100 && $length < 5000) $score += 10;

    return min(100, $score);
}

/**
 * 重新处理单个文档
 */
function handleReprocess() {
    $input = getJsonInput();
    $id = $input['id'] ?? null;

    if (!$id) {
        jsonError('缺少文档ID');
    }

    $db = getDB();

    // 获取文档信息
    $stmt = $db->prepare("SELECT * FROM knowledge_docs WHERE id = ?");
    $stmt->execute([$id]);
    $doc = $stmt->fetch();

    if (!$doc) {
        jsonError('文档不存在');
    }

    try {
        // 更新状态为处理中
        $updateStmt = $db->prepare("UPDATE knowledge_docs SET processing_status = 'processing' WHERE id = ?");
        $updateStmt->execute([$id]);

        // 重新处理内容
        $processedContent = processDocumentContent($doc['content'], $doc['original_name']);
        $structureQuality = calculateStructureQuality($processedContent);

        $retrievalContent = chooseKnowledgeContentForRetrieval($doc['content'], $processedContent);

        // 重新提取关键词
        $keywords = extractKeywords($retrievalContent);

        // 更新数据库
        $updateStmt = $db->prepare("
            UPDATE knowledge_docs
            SET processed_content = ?,
                structure_quality = ?,
                keywords = ?,
                processing_status = 'completed',
                last_processed = datetime('now')
            WHERE id = ?
        ");
        $updateStmt->execute([
            $processedContent,
            $structureQuality,
            json_encode($keywords, JSON_UNESCAPED_UNICODE),
            $id
        ]);

        // 重建索引
        $deleteStmt = $db->prepare("DELETE FROM knowledge_index WHERE doc_id = ?");
        $deleteStmt->execute([$id]);
        buildDocumentIndex($id, $retrievalContent);
        $chunkResult = rebuildKnowledgeChunks($id, $retrievalContent);

        jsonSuccess([
            'message' => '文档重新处理完成',
            'structure_quality' => $structureQuality,
            'chunk_count' => $chunkResult['chunk_count'],
            'chunking_status' => $chunkResult['chunking_status'],
            'processing_status' => 'completed'
        ]);

    } catch (Exception $e) {
        // 更新状态为失败
        $updateStmt = $db->prepare("UPDATE knowledge_docs SET processing_status = 'failed' WHERE id = ?");
        $updateStmt->execute([$id]);

        jsonError('重新处理失败: ' . $e->getMessage());
    }
}
