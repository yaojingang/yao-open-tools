<?php
/**
 * 销售AI支持系统 - 数据库管理
 */

require_once __DIR__ . '/config.php';

const TOKCHAT_DB_SCHEMA_VERSION = 2026061502;

/**
 * 获取数据库连接
 */
function getDB() {
    static $db = null;

    if ($db === null) {
        try {
            $db = new PDO('sqlite:' . DB_PATH);
            $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            // 后台页面会并发加载多个 API，给 SQLite 写锁留出等待时间。
            $db->exec('PRAGMA busy_timeout = 5000');
            // 开启外键支持
            $db->exec('PRAGMA foreign_keys = ON');
        } catch (PDOException $e) {
            die(json_encode(['success' => false, 'error' => '数据库连接失败: ' . $e->getMessage()]));
        }
    }

    return $db;
}

function getDatabaseSchemaVersion($db) {
    try {
        return (int)$db->query('PRAGMA user_version')->fetchColumn();
    } catch (Throwable $e) {
        return 0;
    }
}

function setDatabaseSchemaVersion($db, $version = TOKCHAT_DB_SCHEMA_VERSION) {
    $db->exec('PRAGMA user_version = ' . (int)$version);
}

function acquireDatabaseInitLock() {
    $lockPath = dirname(DB_PATH) . '/.db-init.lock';
    $lockDir = dirname($lockPath);
    if (!is_dir($lockDir)) {
        @mkdir($lockDir, 0775, true);
    }

    $lock = @fopen($lockPath, 'c');
    if (!$lock) {
        return null;
    }

    flock($lock, LOCK_EX);
    return $lock;
}

function releaseDatabaseInitLock($lock) {
    if (is_resource($lock)) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * 初始化数据库表结构
 */
function initDatabase() {
    static $initialized = false;

    if ($initialized) {
        return true;
    }

    $db = getDB();

    if (getDatabaseSchemaVersion($db) >= TOKCHAT_DB_SCHEMA_VERSION) {
        $initialized = true;
        return true;
    }

    $initLock = acquireDatabaseInitLock();
    try {
        if (getDatabaseSchemaVersion($db) >= TOKCHAT_DB_SCHEMA_VERSION) {
            $initialized = true;
            return true;
        }

    // 管理员表（后台登录用）
    $db->exec("CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        status TEXT DEFAULT 'active',
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
    )");

    // 用户表（前台普通用户）
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT UNIQUE,
        password_hash TEXT,
        role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'active',
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME,
        remember_token TEXT
    )");

    // 检查并添加 phone 字段（兼容已有数据库）
    try {
        $db->exec("ALTER TABLE users ADD COLUMN phone TEXT UNIQUE");
    } catch (PDOException $e) {
        // 字段已存在，忽略
    }

    // 检查并添加 remember_token 字段（兼容已有数据库）
    try {
        $db->exec("ALTER TABLE users ADD COLUMN remember_token TEXT");
    } catch (PDOException $e) {
        // 字段已存在，忽略
    }

    normalizeLegacyUserRoles($db);

    // 检查并添加 company 字段（公司简称）
    try {
        $db->exec("ALTER TABLE users ADD COLUMN company TEXT");
    } catch (PDOException $e) {
        // 字段已存在，忽略
    }

    // 知识库文档表
    $db->exec("CREATE TABLE IF NOT EXISTS knowledge_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        original_name TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        content TEXT,
        processed_content TEXT,
        keywords TEXT,
        word_count INTEGER DEFAULT 0,
        structure_quality INTEGER DEFAULT 0,
        processing_status TEXT DEFAULT 'pending',
        chunk_count INTEGER DEFAULT 0,
        chunking_status TEXT DEFAULT 'pending',
        embedding_status TEXT DEFAULT 'not_configured',
        embedding_model TEXT,
        status TEXT DEFAULT 'indexed',
        uploaded_by INTEGER,
        last_processed DATETIME,
        last_chunked DATETIME,
        last_embedded DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )");

    // 兼容已有数据库，补齐知识库处理、切片和向量化相关字段。
    $knowledgeDocColumns = [
        'processed_content' => 'TEXT',
        'processing_status' => "TEXT DEFAULT 'pending'",
        'structure_quality' => 'INTEGER DEFAULT 0',
        'last_processed' => 'DATETIME',
        'chunk_count' => 'INTEGER DEFAULT 0',
        'chunking_status' => "TEXT DEFAULT 'pending'",
        'embedding_status' => "TEXT DEFAULT 'not_configured'",
        'embedding_model' => 'TEXT',
        'last_chunked' => 'DATETIME',
        'last_embedded' => 'DATETIME'
    ];
    foreach ($knowledgeDocColumns as $columnName => $columnDef) {
        try {
            $db->exec("ALTER TABLE knowledge_docs ADD COLUMN {$columnName} {$columnDef}");
        } catch (PDOException $e) {
            // 字段已存在，忽略
        }
    }

    // 知识库倒排索引表（加速搜索）
    $db->exec("CREATE TABLE IF NOT EXISTS knowledge_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        term TEXT NOT NULL,
        term_count INTEGER DEFAULT 1,
        positions TEXT,
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
    )");

    // 创建索引加速查询
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_index_term ON knowledge_index(term)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_index_doc ON knowledge_index(doc_id)");

    // 知识库语义切片表
    $db->exec("CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_type TEXT DEFAULT 'semantic',
        heading TEXT,
        content TEXT NOT NULL,
        keywords TEXT,
        char_count INTEGER DEFAULT 0,
        token_estimate INTEGER DEFAULT 0,
        status TEXT DEFAULT 'indexed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
    )");

    // 知识库切片倒排索引表
    $db->exec("CREATE TABLE IF NOT EXISTS knowledge_chunk_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL,
        doc_id INTEGER NOT NULL,
        term TEXT NOT NULL,
        term_count INTEGER DEFAULT 1,
        FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        FOREIGN KEY (doc_id) REFERENCES knowledge_docs(id) ON DELETE CASCADE
    )");

    // 可选向量表：仅在配置 Embeddings API 后填充
    $db->exec("CREATE TABLE IF NOT EXISTS knowledge_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL UNIQUE,
        api_config_id INTEGER,
        model TEXT,
        vector TEXT NOT NULL,
        dimensions INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        FOREIGN KEY (api_config_id) REFERENCES ai_api_configs(id) ON DELETE SET NULL
    )");

    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_status ON knowledge_chunks(status)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_index_term ON knowledge_chunk_index(term)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_index_doc ON knowledge_chunk_index(doc_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_index_chunk ON knowledge_chunk_index(chunk_id)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_chunk ON knowledge_embeddings(chunk_id)");

    // 对话会话表
    $db->exec("CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        mode TEXT DEFAULT 'qa',
        title TEXT,
        learning_topic TEXT,
        learning_outline TEXT,
        learning_progress INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )");

    // 对话消息表
    $db->exec("CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text',
        suggestions TEXT,
        quick_buttons TEXT,
        rag_sources TEXT,
        rag_score REAL,
        feedback TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        latency_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )");

    // 公开分享的对话快照表
    $db->exec("CREATE TABLE IF NOT EXISTS shared_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        session_id INTEGER NOT NULL,
        assistant_message_id INTEGER NOT NULL UNIQUE,
        user_message_id INTEGER,
        title TEXT,
        user_content TEXT,
        assistant_content TEXT NOT NULL,
        suggestions TEXT,
        rag_sources TEXT,
        created_by INTEGER,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (assistant_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id)
    )");

    $db->exec("CREATE INDEX IF NOT EXISTS idx_shared_conversations_token ON shared_conversations(token)");
    $db->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_conversations_message ON shared_conversations(assistant_message_id)");

    // 系统Prompt配置表
    $db->exec("CREATE TABLE IF NOT EXISTS prompt_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        prompt_content TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id)
    )");

    // Prompt应用场景配置表
    $db->exec("CREATE TABLE IF NOT EXISTS prompt_scenarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT 'fas fa-layer-group',
        color_class TEXT DEFAULT 'bg-blue-50 text-blue-700 border-blue-100',
        is_active INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // Prompt应用场景模板表
    $db->exec("CREATE TABLE IF NOT EXISTS prompt_scenario_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_slug TEXT NOT NULL,
        prompt_name TEXT NOT NULL,
        description TEXT,
        prompt_content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scenario_slug, prompt_name),
        FOREIGN KEY (scenario_slug) REFERENCES prompt_scenarios(slug)
    )");

    // 学习进度追踪表
    $db->exec("CREATE TABLE IF NOT EXISTS learning_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        step_index INTEGER NOT NULL,
        step_title TEXT,
        step_content TEXT,
        user_response TEXT,
        is_completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
    )");

    // 创建探索建议配置表
    $db->exec("CREATE TABLE IF NOT EXISTS explore_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'hot_search' 或 'skill_learning'
        title TEXT NOT NULL,
        subtitle TEXT,
        content TEXT, -- 对于热搜榜是问题内容，对于技能提升是学习内容
        icon TEXT,
        color_class TEXT, -- CSS颜色类名
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // 探索建议应用场景模板表，复用 prompt_scenarios 的场景定义
    $db->exec("CREATE TABLE IF NOT EXISTS explore_suggestion_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scenario_slug TEXT NOT NULL,
        type TEXT NOT NULL, -- 'hot_search' 或 'skill_learning'
        title TEXT NOT NULL,
        subtitle TEXT,
        content TEXT,
        icon TEXT,
        color_class TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(scenario_slug, type, sort_order),
        FOREIGN KEY (scenario_slug) REFERENCES prompt_scenarios(slug)
    )");

    // 探索建议模板设置
    $db->exec("CREATE TABLE IF NOT EXISTS explore_suggestion_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // 网站设置表
    $db->exec("CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        setting_group TEXT DEFAULT 'general',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // AI API配置表
    $db->exec("CREATE TABLE IF NOT EXISTS ai_api_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        api_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        api_type TEXT NOT NULL DEFAULT 'chat_completions',
        status TEXT NOT NULL DEFAULT 'active',
        priority INTEGER DEFAULT 100,
        timeout_seconds INTEGER DEFAULT 300,
        connect_timeout_seconds INTEGER DEFAULT 30,
        max_tokens INTEGER DEFAULT 2500,
        temperature REAL DEFAULT 0.7,
        last_test_status TEXT,
        last_test_latency_ms INTEGER,
        last_test_message TEXT,
        last_test_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // API性能统计表
    $db->exec("CREATE TABLE IF NOT EXISTS api_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_name TEXT NOT NULL,
        success INTEGER NOT NULL,
        latency REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // AI API轮换策略配置
    $db->exec("CREATE TABLE IF NOT EXISTS ai_api_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");

    // 插入默认数据
    insertDefaultData($db);
    setDatabaseSchemaVersion($db);
    $initialized = true;

    return true;
    } finally {
        releaseDatabaseInitLock($initLock);
    }
}

/**
 * 插入默认数据
 */
function insertDefaultData($db) {
    // 检查是否已有超级管理员
    $stmt = $db->query("SELECT COUNT(*) as count FROM admins");
    $result = $stmt->fetch();

    if ($result['count'] == 0) {
        // 插入初始超级管理员。生产环境请通过 .env 覆盖密码，并上线后立即修改。
        $adminUsername = DEFAULT_ADMIN_USERNAME ?: 'admin';
        $adminPassword = DEFAULT_ADMIN_PASSWORD ?: 'change-me-now';
        $adminName = DEFAULT_ADMIN_NAME ?: '超级管理员';
        $passwordHash = password_hash($adminPassword, PASSWORD_DEFAULT);
        $stmt = $db->prepare("INSERT INTO admins (username, password_hash, name, role, status, avatar) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $adminUsername,
            $passwordHash,
            $adminName,
            'super_admin',
            'active',
            'https://ui-avatars.com/api/?name=' . rawurlencode($adminName) . '&background=dc2626&color=fff'
        ]);
    }

    // 检查是否已有默认用户
    $stmt = $db->query("SELECT COUNT(*) as count FROM users");
    $result = $stmt->fetch();

    if ($result['count'] == 0 && SEED_DEMO_USERS) {
        // 插入可选演示前台用户（手机号登录）。默认不初始化，避免公开部署携带本地数据。
        $db->exec("INSERT INTO users (name, email, phone, role, status, avatar) VALUES
            ('演示用户一', 'demo1@example.com', '19900000001', 'user', 'active', 'https://ui-avatars.com/api/?name=Demo+User+1&background=0D8ABC&color=fff'),
            ('演示用户二', 'demo2@example.com', '19900000002', 'user', 'active', 'https://ui-avatars.com/api/?name=Demo+User+2&background=7e22ce&color=fff')
        ");
    }

    // 检查是否已有默认Prompt
    $stmt = $db->query("SELECT COUNT(*) as count FROM prompt_configs");
    $result = $stmt->fetch();

    if ($result['count'] == 0) {
        insertDefaultPrompts($db);
    }

    insertDefaultPromptScenarios($db);
    insertDefaultExploreSuggestionTemplates($db);

    insertDefaultSiteSettings($db);
    insertDefaultAIAPIConfigs($db);
}

function normalizeLegacyUserRoles($db) {
    $db->exec("UPDATE users SET role = 'user' WHERE role IN ('sales_rep', 'sales_manager') OR role IS NULL OR TRIM(role) = ''");
}

/**
 * 网站设置默认值
 */
function getDefaultSiteSettings() {
    return [
        'frontend_site_name' => 'TokChat',
        'frontend_page_title' => 'TokChat',
        'copyright_text' => '© 2026 TokChat. 保留所有权利。',
        'login_page_title' => 'TokChat',
        'login_page_description' => '输入手机号快速登录 TokChat',
        'admin_site_name' => 'TokChat Admin',
        'admin_page_title' => 'TokChat 管理后台',
        'admin_login_title' => 'TokChat 管理后台',
        'admin_login_description' => 'TokChat 管理员专用登录入口',
        'frontend_analytics_code' => ''
    ];
}

/**
 * 旧版本网站设置默认值，用于把未自定义过的站点自动升级到 TokChat 品牌。
 */
function getLegacySiteSettingsDefaults() {
    return [
        'frontend_site_name' => 'Yishan Sales Copilot',
        'frontend_page_title' => '销售智能助手 Pro',
        'copyright_text' => '© 2024 Sales AI Support System. 保留所有权利。',
        'login_page_title' => 'Sales AI 助手',
        'login_page_description' => '输入手机号快速登录',
        'admin_site_name' => 'Sales AI Admin',
        'admin_page_title' => 'Sales AI 管理后台',
        'admin_login_title' => 'Sales AI 管理后台',
        'admin_login_description' => '管理员专用登录入口',
        'frontend_analytics_code' => ''
    ];
}

/**
 * 插入缺失的网站设置默认值
 */
function insertDefaultSiteSettings($db) {
    $defaults = getDefaultSiteSettings();
    $stmt = $db->prepare("INSERT OR IGNORE INTO site_settings (setting_key, setting_value, setting_group) VALUES (?, ?, ?)");
    $upgradeStmt = $db->prepare("UPDATE site_settings
        SET setting_value = ?, setting_group = ?, updated_at = datetime('now')
        WHERE setting_key = ? AND setting_value = ?");
    $legacyDefaults = getLegacySiteSettingsDefaults();

    foreach ($defaults as $key => $value) {
        $group = 'general';
        if (strpos($key, 'frontend_') === 0 || $key === 'copyright_text') {
            $group = 'frontend';
        } elseif (strpos($key, 'login_') === 0) {
            $group = 'login';
        } elseif (strpos($key, 'admin_') === 0) {
            $group = 'admin';
        }
        $stmt->execute([$key, $value, $group]);

        if (array_key_exists($key, $legacyDefaults) && $legacyDefaults[$key] !== $value) {
            $upgradeStmt->execute([$value, $group, $key, $legacyDefaults[$key]]);
        }
    }
}

/**
 * 获取网站设置
 */
function getSiteSettings() {
    initDatabase();
    $db = getDB();

    $settings = getDefaultSiteSettings();
    $stmt = $db->query("SELECT setting_key, setting_value FROM site_settings");
    foreach ($stmt->fetchAll() as $row) {
        if (array_key_exists($row['setting_key'], $settings)) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }
    }

    return $settings;
}

/**
 * 更新网站设置
 */
function updateSiteSettings($settings) {
    $db = getDB();
    $defaults = getDefaultSiteSettings();
    $stmt = $db->prepare("INSERT INTO site_settings (setting_key, setting_value, setting_group, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            setting_group = excluded.setting_group,
            updated_at = datetime('now')");

    foreach ($defaults as $key => $_) {
        if (!array_key_exists($key, $settings)) {
            continue;
        }

        $value = is_string($settings[$key]) ? trim($settings[$key]) : '';
        $group = 'general';
        if (strpos($key, 'frontend_') === 0 || $key === 'copyright_text') {
            $group = 'frontend';
        } elseif (strpos($key, 'login_') === 0) {
            $group = 'login';
        } elseif (strpos($key, 'admin_') === 0) {
            $group = 'admin';
        }
        $stmt->execute([$key, $value, $group]);
    }

    return getSiteSettings();
}

/**
 * AI API默认轮换配置
 */
function getDefaultAIAPISettings() {
    return [
        'rotation_strategy' => 'failover',
        'last_api_id' => '0'
    ];
}

/**
 * 插入默认AI API配置
 */
function insertDefaultAIAPIConfigs($db) {
    $settings = getDefaultAIAPISettings();
    $stmt = $db->prepare("INSERT OR IGNORE INTO ai_api_settings (setting_key, setting_value) VALUES (?, ?)");
    foreach ($settings as $key => $value) {
        $stmt->execute([$key, $value]);
    }

    cleanupLegacySeededAPIConfigs($db);

    $stmt = $db->query("SELECT COUNT(*) as count FROM ai_api_configs");
    $result = $stmt->fetch();
    if ((int)$result['count'] > 0) {
        return;
    }

    if (!SEED_DEFAULT_API_CONFIGS) {
        return;
    }

    $stmt = $db->prepare("INSERT INTO ai_api_configs (
        name, api_url, api_key, model, api_type, status, priority,
        timeout_seconds, connect_timeout_seconds, max_tokens, temperature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $defaultAPIs = [
        ['主API', TUZI_API_URL, TUZI_API_KEY, TUZI_MODEL, 'messages', 10],
        ['备用API', TUZI_BACKUP_API_URL, TUZI_BACKUP_API_KEY, TUZI_BACKUP_MODEL, 'chat_completions', 20],
    ];

    foreach ($defaultAPIs as [$name, $url, $key, $model, $type, $priority]) {
        if (trim($url) === '' || trim($key) === '' || trim($model) === '') {
            continue;
        }

        $stmt->execute([
            $name,
            $url,
            $key,
            $model,
            $type,
            'active',
            $priority,
            API_TOTAL_TIMEOUT,
            API_CONNECT_TIMEOUT,
            API_MAX_TOKENS,
            API_TEMPERATURE
        ]);
    }
}

/**
 * 清理早期版本无条件初始化的默认 API。只移除空 key 的历史种子记录，
 * 避免误删管理员已经填写过密钥的配置。
 */
function cleanupLegacySeededAPIConfigs($db) {
    $stmt = $db->prepare("DELETE FROM ai_api_configs
        WHERE name IN ('主API', '备用API')
          AND api_type IN ('messages', 'chat_completions')
          AND priority IN (10, 20)
          AND TRIM(COALESCE(api_key, '')) = ''");
    $stmt->execute();
}

/**
 * 获取AI API轮换设置
 */
function getAIAPISettings() {
    initDatabase();
    $db = getDB();

    $settings = getDefaultAIAPISettings();
    $stmt = $db->query("SELECT setting_key, setting_value FROM ai_api_settings");
    foreach ($stmt->fetchAll() as $row) {
        if (array_key_exists($row['setting_key'], $settings)) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }
    }

    return $settings;
}

/**
 * 更新AI API轮换设置
 */
function updateAIAPISettings($settings) {
    $db = getDB();
    $allowedStrategies = ['failover', 'round_robin', 'random'];
    $strategy = $settings['rotation_strategy'] ?? 'failover';
    if (!in_array($strategy, $allowedStrategies, true)) {
        $strategy = 'failover';
    }

    $stmt = $db->prepare("INSERT INTO ai_api_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = datetime('now')");
    $stmt->execute(['rotation_strategy', $strategy]);

    return getAIAPISettings();
}

/**
 * 获取启用的AI API配置
 */
function getEnabledAIAPIConfigs() {
    initDatabase();
    $db = getDB();

    $stmt = $db->query("SELECT * FROM ai_api_configs
        WHERE status = 'active' AND api_type IN ('messages', 'chat_completions')
        ORDER BY priority ASC, id ASC");
    return $stmt->fetchAll();
}

/**
 * 更新轮询状态
 */
function updateAILastAPIId($apiId) {
    $db = getDB();
    $stmt = $db->prepare("INSERT INTO ai_api_settings (setting_key, setting_value, updated_at)
        VALUES ('last_api_id', ?, datetime('now'))
        ON CONFLICT(setting_key) DO UPDATE SET
            setting_value = excluded.setting_value,
            updated_at = datetime('now')");
    $stmt->execute([(string)$apiId]);
}

/**
 * 插入默认Prompt配置
 */
function insertDefaultPrompts($db) {
    $prompts = [
        [
            'name' => 'qa_system',
            'description' => '问答模式系统提示词',
            'prompt_content' => '你是一个专业的GEO（生成式引擎优化）销售支持助手。你的职责是：
1. 回答销售人员关于GEO技术、产品功能、竞品对比等问题
2. 提供专业、准确、有说服力的回答
3. 如果有知识库内容可参考，请优先使用知识库中的信息

回答要求：
- 简洁专业，适合销售场景
- 如有引用知识库，请标注来源
- 回答结束后，必须生成3个与当前话题相关的追问建议

你必须用以下JSON格式返回，不要输出其他内容：
{
    "answer": "你的回答内容（支持Markdown格式）",
    "suggestions": ["推荐问题1", "推荐问题2", "推荐问题3"]
}'
        ],
        [
            'name' => 'learn_system',
            'description' => '学习模式系统提示词',
            'prompt_content' => '你是一个专业的销售培训导师，正在以个性化学习的方式教授用户关于GEO和销售技巧的知识。

你需要：
1. 根据当前学习步骤，讲解核心知识点
2. 用通俗易懂的语言和实际案例说明
3. 提出一个引导性问题让用户思考
4. 生成2-3个快捷回复按钮供用户选择（按钮文案要简洁、口语化）

你必须用以下JSON格式返回：
{
    "content": "教学内容（支持Markdown格式，可以包含要点列表、示例等）",
    "question": "引导用户思考的问题",
    "quick_buttons": [
        {"id": "btn_1", "label": "我理解了，继续"},
        {"id": "btn_2", "label": "能举个例子吗？"},
        {"id": "btn_3", "label": "这部分有点难，再解释一下"}
    ]
}'
        ],
        [
            'name' => 'outline_generator',
            'description' => '学习大纲生成提示词',
            'prompt_content' => '你是一个专业的销售培训课程设计师。用户想要学习一个主题，请为他设计一个结构化的学习大纲。

要求：
1. 大纲包含5-7个学习步骤
2. 从基础概念到实战应用，循序渐进
3. 每个步骤有清晰的标题和简短描述

你必须用以下JSON格式返回：
{
    "topic": "学习主题",
    "estimated_time": "预计学习时间（如：15分钟）",
    "outline": [
        {"step": 1, "title": "步骤标题", "description": "简短描述这一步要学什么"},
        {"step": 2, "title": "步骤标题", "description": "简短描述"},
        ...
    ]
}'
        ],
        [
            'name' => 'learn_evaluation',
            'description' => '学习回答评估提示词',
            'prompt_content' => '你是一个耐心的销售培训导师。用户刚刚回答了一个问题，请评估他的回答并给出反馈。

评估要求：
1. 肯定用户回答中正确的部分
2. 温和地指出不足之处
3. 给出补充说明或正确答案
4. 鼓励用户继续学习

你必须用以下JSON格式返回：
{
    "feedback": "对用户回答的评价和补充",
    "is_correct": true或false,
    "encouragement": "鼓励的话",
    "ready_for_next": true或false
}'
        ]
    ];

    $stmt = $db->prepare("INSERT INTO prompt_configs (name, description, prompt_content) VALUES (?, ?, ?)");

    foreach ($prompts as $prompt) {
        $stmt->execute([$prompt['name'], $prompt['description'], $prompt['prompt_content']]);
    }

    // 插入默认的探索建议数据
    $stmt = $db->query("SELECT COUNT(*) as count FROM explore_suggestions");
    $result = $stmt->fetch();

    if ($result['count'] == 0) {
        $suggestions = [
            ['type' => 'hot_search', 'title' => 'GEO ROI 计算公式', 'subtitle' => '如何向客户证明投资回报率？', 'content' => 'GEO 相比传统 SEO 的 ROI 怎么计算？请给出可用于销售沟通的表达。', 'icon' => 'fas fa-calculator', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => 'SaaS 行业应用案例', 'subtitle' => '用行业案例增强客户信任', 'content' => '请整理 SaaS 行业采用 GEO 的典型应用场景、实施路径和可量化收益。', 'icon' => 'fas fa-chart-line', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '竞品对比分析', 'subtitle' => '把 GEO 与传统 SEO 讲清楚', 'content' => '请对比 GEO 与传统 SEO 的差异、优势和适用客户，并给出销售话术。', 'icon' => 'fas fa-scale-balanced', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'hot_search', 'title' => '客户异议处理', 'subtitle' => '应对预算、效果和安全疑虑', 'content' => '客户担心 GEO 效果不确定、预算高、数据安全风险，我该如何回应？', 'icon' => 'fas fa-handshake-angle', 'color_class' => 'text-blue-700', 'sort_order' => 4],
            ['type' => 'skill_learning', 'title' => 'GEO 技术原理深度解析', 'subtitle' => '掌握LLM如何引用内容的底层逻辑。', 'content' => 'GEO技术原理深度解析', 'icon' => 'fas fa-brain', 'color_class' => 'from-blue-50 to-sky-50 border-blue-100 text-blue-600', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '面对CTO的销售话术', 'subtitle' => '如何用技术语言搞定技术决策人。', 'content' => '面对CTO的销售话术', 'icon' => 'fas fa-user-tie', 'color_class' => 'from-green-50 to-emerald-50 border-green-100 text-green-600', 'sort_order' => 2]
        ];

        $stmt = $db->prepare("INSERT INTO explore_suggestions (type, title, subtitle, content, icon, color_class, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
        foreach ($suggestions as $suggestion) {
            $stmt->execute([$suggestion['type'], $suggestion['title'], $suggestion['subtitle'], $suggestion['content'], $suggestion['icon'], $suggestion['color_class'], $suggestion['sort_order']]);
        }
    }
}

/**
 * 默认Prompt应用场景。
 */
function getDefaultPromptScenarios() {
    return [
        [
            'slug' => 'general',
            'name' => '通用助手',
            'description' => '适用于任何行业的通用问答、学习和知识整理场景。',
            'icon' => 'fas fa-globe',
            'color_class' => 'bg-blue-50 text-blue-700 border-blue-100',
            'sort_order' => 10,
            'role' => '通用智能助手',
            'focus' => '理解用户问题、给出清晰答案、拆解任务、总结信息，并适配不同业务场景',
            'tone' => '清晰、稳重、直接、可执行'
        ],
        [
            'slug' => 'sales',
            'name' => '销售助手',
            'description' => '面向销售团队，侧重客户沟通、方案说明、异议处理和成交推进。',
            'icon' => 'fas fa-handshake',
            'color_class' => 'bg-emerald-50 text-emerald-700 border-emerald-100',
            'sort_order' => 20,
            'role' => '专业销售支持助手',
            'focus' => '客户需求分析、产品价值表达、竞品对比、异议处理、成交推进和销售话术优化',
            'tone' => '专业、有说服力、贴近业务、不过度承诺'
        ],
        [
            'slug' => 'learning_method',
            'name' => '学习方法导师',
            'description' => '面向学习系统，侧重学习计划、听课习惯、复盘反馈和能力提升。',
            'icon' => 'fas fa-graduation-cap',
            'color_class' => 'bg-sky-50 text-sky-700 border-sky-100',
            'sort_order' => 30,
            'role' => '学习方法与能力提升导师',
            'focus' => '学习目标拆解、听课习惯、知识复盘、刻意练习、反馈评估和学习动力维护',
            'tone' => '耐心、结构化、鼓励但不空泛'
        ],
        [
            'slug' => 'customer_support',
            'name' => '客服支持',
            'description' => '面向客服和售后场景，侧重问题诊断、用户安抚和解决路径。',
            'icon' => 'fas fa-headset',
            'color_class' => 'bg-amber-50 text-amber-700 border-amber-100',
            'sort_order' => 40,
            'role' => '专业客服支持助手',
            'focus' => '识别用户问题、安抚情绪、收集关键信息、给出操作步骤、必要时建议转人工或升级处理',
            'tone' => '礼貌、耐心、明确、以解决问题为中心'
        ],
        [
            'slug' => 'knowledge_expert',
            'name' => '知识库专家',
            'description' => '面向企业知识库问答，侧重事实准确、引用来源和边界说明。',
            'icon' => 'fas fa-book-open',
            'color_class' => 'bg-slate-50 text-slate-700 border-slate-200',
            'sort_order' => 50,
            'role' => '企业知识库问答专家',
            'focus' => '基于知识库进行准确检索、摘要、解释、引用和风险提示，不凭空编造未知内容',
            'tone' => '严谨、客观、可追溯、边界清楚'
        ]
    ];
}

function buildScenarioPromptContent($scenario, $promptName) {
    $role = $scenario['role'];
    $focus = $scenario['focus'];
    $tone = $scenario['tone'];
    $sceneName = $scenario['name'];

    switch ($promptName) {
        case 'qa_system':
            return "你是{$role}。\n\n【应用场景】{$sceneName}\n【核心能力】{$focus}\n【表达风格】{$tone}\n\n你的职责：\n1. 准确理解用户问题，优先结合已有知识库和上下文回答。\n2. 对复杂问题先拆解，再给出可执行的步骤或建议。\n3. 不确定的信息要明确说明边界，不要编造事实。\n4. 回答要适合当前应用场景，不要混用其他场景的口吻。\n5. 回答结束后，生成3个与当前话题相关的追问建议。\n\n你必须用以下JSON格式返回，不要输出其他内容：\n{\n  \"answer\": \"你的回答内容（支持Markdown格式）\",\n  \"suggestions\": [\"推荐问题1\", \"推荐问题2\", \"推荐问题3\"]\n}";

        case 'learn_system':
            return "你是{$role}，正在以个性化学习方式帮助用户掌握一个主题。\n\n【应用场景】{$sceneName}\n【教学重点】{$focus}\n【表达风格】{$tone}\n\n你需要：\n1. 围绕当前学习步骤讲清楚核心知识点。\n2. 用通俗解释、实际例子和必要的对比帮助用户理解。\n3. 每次只推进一个学习重点，避免一次灌输过多内容。\n4. 提出一个引导性问题，帮助用户主动思考或练习。\n5. 生成2-3个快捷回复按钮，按钮文案要短、自然、适合继续学习。\n\n你必须用以下JSON格式返回，不要输出其他内容：\n{\n  \"content\": \"教学内容（支持Markdown格式，可以包含要点、示例、步骤）\",\n  \"question\": \"引导用户思考的问题\",\n  \"quick_buttons\": [\n    {\"id\": \"btn_1\", \"label\": \"我理解了，继续\"},\n    {\"id\": \"btn_2\", \"label\": \"能举个例子吗？\"},\n    {\"id\": \"btn_3\", \"label\": \"再解释一下\"}\n  ]\n}";

        case 'outline_generator':
            return "你是{$role}，需要为用户设计一个结构化学习大纲。\n\n【应用场景】{$sceneName}\n【课程方向】{$focus}\n【设计风格】{$tone}\n\n要求：\n1. 大纲包含5-7个学习步骤。\n2. 从基础认知到实践应用循序渐进。\n3. 每个步骤要有清晰标题和简短描述。\n4. 适配当前应用场景，不要生成无关行业或无关角色的大纲。\n5. 预计学习时间要合理，适合碎片化学习。\n\n你必须用以下JSON格式返回，不要输出其他内容：\n{\n  \"topic\": \"学习主题\",\n  \"estimated_time\": \"预计学习时间（如：15分钟）\",\n  \"outline\": [\n    {\"step\": 1, \"title\": \"步骤标题\", \"description\": \"简短描述这一步要学什么\"},\n    {\"step\": 2, \"title\": \"步骤标题\", \"description\": \"简短描述\"}\n  ]\n}";

        case 'learn_evaluation':
            return "你是{$role}，需要评估用户刚刚提交的学习回答。\n\n【应用场景】{$sceneName}\n【评估重点】{$focus}\n【反馈风格】{$tone}\n\n评估要求：\n1. 先肯定用户回答中正确或有价值的部分。\n2. 温和指出不足，说明为什么需要修正。\n3. 给出更好的表达、补充说明或正确答案。\n4. 判断用户是否已经适合进入下一步学习。\n5. 反馈要具体，不要只说“不错”“继续努力”。\n\n你必须用以下JSON格式返回，不要输出其他内容：\n{\n  \"feedback\": \"对用户回答的评价和补充\",\n  \"is_correct\": true或false,\n  \"encouragement\": \"鼓励的话\",\n  \"ready_for_next\": true或false\n}";

        default:
            return '';
    }
}

function getScenarioPromptTemplates($scenario) {
    $descriptions = [
        'qa_system' => $scenario['name'] . ' - 问答模式系统提示词',
        'learn_system' => $scenario['name'] . ' - 学习模式系统提示词',
        'outline_generator' => $scenario['name'] . ' - 学习大纲生成提示词',
        'learn_evaluation' => $scenario['name'] . ' - 学习回答评估提示词'
    ];

    $templates = [];
    foreach ($descriptions as $promptName => $description) {
        $templates[] = [
            'prompt_name' => $promptName,
            'description' => $description,
            'prompt_content' => buildScenarioPromptContent($scenario, $promptName)
        ];
    }

    return $templates;
}

function insertDefaultPromptScenarios($db) {
    $scenarios = getDefaultPromptScenarios();
    $scenarioSlugs = array_column($scenarios, 'slug');
    $expectedTemplateCount = 0;
    foreach ($scenarios as $scenario) {
        $expectedTemplateCount += count(getScenarioPromptTemplates($scenario));
    }

    $placeholders = implode(',', array_fill(0, count($scenarioSlugs), '?'));
    $scenarioCountStmt = $db->prepare("SELECT COUNT(*) FROM prompt_scenarios WHERE slug IN ($placeholders)");
    $scenarioCountStmt->execute($scenarioSlugs);
    $scenarioCount = (int)$scenarioCountStmt->fetchColumn();

    $templateCountStmt = $db->prepare("SELECT COUNT(*) FROM prompt_scenario_templates WHERE scenario_slug IN ($placeholders)");
    $templateCountStmt->execute($scenarioSlugs);
    $templateCount = (int)$templateCountStmt->fetchColumn();

    if ($scenarioCount < count($scenarios) || $templateCount < $expectedTemplateCount) {
        $scenarioStmt = $db->prepare("INSERT INTO prompt_scenarios
            (slug, name, description, icon, color_class, sort_order, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(slug) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                icon = excluded.icon,
                color_class = excluded.color_class,
                sort_order = excluded.sort_order,
                updated_at = datetime('now')");

        $templateStmt = $db->prepare("INSERT INTO prompt_scenario_templates
            (scenario_slug, prompt_name, description, prompt_content, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(scenario_slug, prompt_name) DO UPDATE SET
                description = excluded.description,
                prompt_content = excluded.prompt_content,
                updated_at = datetime('now')");

        foreach ($scenarios as $scenario) {
            $scenarioStmt->execute([
                $scenario['slug'],
                $scenario['name'],
                $scenario['description'],
                $scenario['icon'],
                $scenario['color_class'],
                $scenario['sort_order']
            ]);

            foreach (getScenarioPromptTemplates($scenario) as $template) {
                $templateStmt->execute([
                    $scenario['slug'],
                    $template['prompt_name'],
                    $template['description'],
                    $template['prompt_content']
                ]);
            }
        }
    }

    $activeCount = (int)$db->query("SELECT COUNT(*) FROM prompt_scenarios WHERE is_active = 1")->fetchColumn();
    if ($activeCount === 0) {
        $stmt = $db->prepare("UPDATE prompt_scenarios SET is_active = CASE WHEN slug = ? THEN 1 ELSE 0 END, updated_at = datetime('now')");
        $stmt->execute(['sales']);
    }
}

function applyPromptScenario($slug, $userId = 1) {
    $db = getDB();

    $stmt = $db->prepare("SELECT * FROM prompt_scenarios WHERE slug = ?");
    $stmt->execute([$slug]);
    $scenario = $stmt->fetch();
    if (!$scenario) {
        throw new InvalidArgumentException('应用场景不存在');
    }

    $stmt = $db->prepare("SELECT * FROM prompt_scenario_templates WHERE scenario_slug = ? ORDER BY prompt_name ASC");
    $stmt->execute([$slug]);
    $templates = $stmt->fetchAll();
    if (count($templates) === 0) {
        throw new RuntimeException('应用场景缺少Prompt模板');
    }

    $db->beginTransaction();
    try {
        $db->exec("UPDATE prompt_scenarios SET is_active = 0, updated_at = datetime('now')");
        $activateStmt = $db->prepare("UPDATE prompt_scenarios SET is_active = 1, updated_at = datetime('now') WHERE slug = ?");
        $activateStmt->execute([$slug]);

        $upsertStmt = $db->prepare("INSERT INTO prompt_configs
            (name, description, prompt_content, is_active, updated_by, updated_at)
            VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
                description = excluded.description,
                prompt_content = excluded.prompt_content,
                is_active = 1,
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP");

        foreach ($templates as $template) {
            $upsertStmt->execute([
                $template['prompt_name'],
                $template['description'],
                $template['prompt_content'],
                $userId
            ]);
        }

        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }

    return $scenario;
}

function getActivePromptScenario($db = null) {
    if ($db === null) {
        initDatabase();
        $db = getDB();
    }

    $stmt = $db->query("SELECT * FROM prompt_scenarios WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 1");
    $scenario = $stmt->fetch();
    if ($scenario) {
        return $scenario;
    }

    $stmt = $db->prepare("SELECT * FROM prompt_scenarios WHERE slug = ?");
    $stmt->execute(['sales']);
    return $stmt->fetch() ?: [
        'slug' => 'sales',
        'name' => '销售助手',
        'description' => '面向销售团队，侧重客户沟通、方案说明、异议处理和成交推进。',
        'icon' => 'fas fa-handshake',
        'color_class' => 'bg-emerald-50 text-emerald-700 border-emerald-100'
    ];
}

function getFrontendWelcomeProfile($db = null) {
    $scenario = getActivePromptScenario($db);
    $slug = $scenario['slug'] ?? 'sales';

    $profiles = [
        'general' => [
            'role_name' => '通用智能助手',
            'icon' => 'fas fa-globe',
            'icon_box_class' => 'w-10 h-10 rounded bg-blue-600 flex items-center justify-center text-white shadow-sm',
            'accent_class' => 'text-blue-600 text-sm mt-3 font-medium',
            'subtitles' => [
                '我是你的通用智能助手，可以帮你拆解问题、整理信息，并给出清晰可执行的建议。',
                '无论是问答、学习还是资料梳理，我都会先理解目标，再给你一条清楚的行动路径。',
                '你可以把问题直接交给我，我会帮你抓重点、列步骤、补充必要提醒。'
            ],
            'learn_subtitles' => [
                '我们可以把任何主题拆成易理解的小步骤，从目标、方法到练习逐步推进。',
                '输入你想学习的主题，我会帮你整理学习路径、关键概念和练习方式。'
            ],
            'encouragements' => [
                '{user}，先把目标说清楚，我们就能更快找到解法。',
                '{user}，复杂问题可以一步步来，我会帮你把思路理顺。',
                '{user}，今天从一个具体问题开始，效率会更高。'
            ]
        ],
        'sales' => [
            'role_name' => '智能销售 Copilot',
            'icon' => 'fas fa-handshake',
            'icon_box_class' => 'w-10 h-10 rounded bg-emerald-600 flex items-center justify-center text-white shadow-sm',
            'accent_class' => 'text-emerald-600 text-sm mt-3 font-medium',
            'subtitles' => [
                '我是你的智能销售 Copilot，可以帮你解答 GEO 技术问题、打磨话术和梳理客户方案。',
                '把客户问题、异议或行业背景告诉我，我会帮你整理更有说服力的表达。',
                '无论是技术答疑、案例准备还是成交推进，我都会站在销售现场帮你补齐思路。'
            ],
            'learn_subtitles' => [
                '输入一个销售主题，我会帮你拆成可练习、可复盘、可落地的学习步骤。',
                '我们可以围绕产品价值、客户异议和成交路径做一次结构化学习。'
            ],
            'encouragements' => [
                '{user}，把客户真正关心的问题抓住，表达就会更有力量。',
                '{user}，每一次准备充分的沟通，都会让成交更近一步。',
                '{user}，今天我们把话术、案例和方案一起打磨得更稳。'
            ]
        ],
        'learning_method' => [
            'role_name' => '学习方法导师',
            'icon' => 'fas fa-graduation-cap',
            'icon_box_class' => 'w-10 h-10 rounded bg-sky-600 flex items-center justify-center text-white shadow-sm',
            'accent_class' => 'text-sky-600 text-sm mt-3 font-medium',
            'subtitles' => [
                '我是你的学习方法导师，会用老师的口吻陪家长和学生一起拆目标、找方法、稳住学习节奏。',
                '你可以告诉我孩子当前的年级、学科和困难点，我会帮你整理更温和、更可执行的学习建议。',
                '我会面向学生讲清方法，也帮助家长理解如何陪伴、反馈和鼓励。'
            ],
            'learn_subtitles' => [
                '输入想提升的学科或能力，我会像老师一样把学习目标拆成清楚的小步骤。',
                '我们可以从听课习惯、错题复盘、时间安排和练习反馈开始，慢慢建立有效学习方法。'
            ],
            'encouragements' => [
                '{user}，学习不是一次冲刺，我们先找到适合孩子的节奏。',
                '{user}，每个孩子都有可以进步的入口，关键是把方法变得具体。',
                '{user}，先别着急下结论，我们一起把问题拆小，再一步步改善。'
            ]
        ],
        'customer_support' => [
            'role_name' => '客服支持助手',
            'icon' => 'fas fa-headset',
            'icon_box_class' => 'w-10 h-10 rounded bg-amber-500 flex items-center justify-center text-white shadow-sm',
            'accent_class' => 'text-amber-600 text-sm mt-3 font-medium',
            'subtitles' => [
                '我是你的客服支持助手，可以帮你判断问题、安抚用户，并整理清晰的处理步骤。',
                '把用户反馈、问题现象和已尝试操作告诉我，我会帮你梳理下一步怎么回应。',
                '我会尽量用礼貌、明确、可执行的方式，帮你把沟通压力降下来。'
            ],
            'learn_subtitles' => [
                '输入一个客服场景，我会帮你练习诊断问题、组织话术和设计处理流程。',
                '我们可以一起学习高压沟通、问题定位和服务 SOP。'
            ],
            'encouragements' => [
                '{user}，先稳住情绪，再抓住关键信息，问题就会清晰很多。',
                '{user}，好的客服不是急着解释，而是先让用户感到被理解。',
                '{user}，我们把现象、原因和下一步动作说清楚，沟通就会更顺。'
            ]
        ],
        'knowledge_expert' => [
            'role_name' => '知识库问答专家',
            'icon' => 'fas fa-book-open',
            'icon_box_class' => 'w-10 h-10 rounded bg-slate-700 flex items-center justify-center text-white shadow-sm',
            'accent_class' => 'text-slate-700 text-sm mt-3 font-medium',
            'subtitles' => [
                '我是你的知识库问答专家，会优先基于已有资料回答，并尽量说明依据和边界。',
                '你可以直接提问，也可以让我帮你从知识库中提炼要点、总结内容和定位资料。',
                '我会把已知信息讲清楚，对不确定的部分明确标注，避免凭空编造。'
            ],
            'learn_subtitles' => [
                '输入一个知识主题，我会帮你从资料中整理学习路径和关键概念。',
                '我们可以围绕知识库内容做一次循序渐进的学习和复盘。'
            ],
            'encouragements' => [
                '{user}，先把问题范围说清楚，我会帮你更准确地检索和总结。',
                '{user}，资料越复杂，越需要清晰的结构和边界。',
                '{user}，我们先从可信依据开始，再整理可执行结论。'
            ]
        ]
    ];

    $profile = $profiles[$slug] ?? $profiles['general'];
    $profile['scenario'] = [
        'slug' => $slug,
        'name' => $scenario['name'] ?? $profile['role_name'],
        'description' => $scenario['description'] ?? '',
        'icon' => $scenario['icon'] ?? $profile['icon']
    ];

    return $profile;
}

/**
 * 默认探索建议模板，场景与 Prompt 场景保持一致。
 */
function getDefaultExploreSuggestionTemplates() {
    return [
        'general' => [
            ['type' => 'hot_search', 'title' => '高效提问模板', 'subtitle' => '如何把问题描述清楚？', 'content' => '请帮我把这个问题拆成背景、目标、约束和期望输出。', 'icon' => 'fas fa-comments', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => '方案对比分析', 'subtitle' => '快速判断两个方案哪个更适合', 'content' => '请从优点、风险、成本和适用条件四个维度对比这两个方案。', 'icon' => 'fas fa-balance-scale', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '行动计划生成', 'subtitle' => '把想法拆成可执行步骤', 'content' => '请把这个目标拆成一份可执行计划，并标出优先级和注意事项。', 'icon' => 'fas fa-list-check', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'skill_learning', 'title' => '结构化思考入门', 'subtitle' => '学会拆问题、定目标、列路径。', 'content' => '结构化思考入门', 'icon' => 'fas fa-sitemap', 'color_class' => 'from-blue-50 to-sky-50 border-blue-100 text-blue-600', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '高质量提问训练', 'subtitle' => '掌握让 AI 更准确回答的方法。', 'content' => '高质量提问训练', 'icon' => 'fas fa-circle-question', 'color_class' => 'from-slate-50 to-blue-50 border-slate-100 text-slate-700', 'sort_order' => 2]
        ],
        'sales' => [
            ['type' => 'hot_search', 'title' => 'GEO ROI 计算公式', 'subtitle' => '如何向客户证明投资回报率？', 'content' => 'GEO 相比传统 SEO 的 ROI 怎么计算？请给出可用于销售沟通的表达。', 'icon' => 'fas fa-calculator', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => 'SaaS 行业应用案例', 'subtitle' => '用行业案例增强客户信任', 'content' => '请整理 SaaS 行业采用 GEO 的典型应用场景、实施路径和可量化收益。', 'icon' => 'fas fa-chart-line', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '竞品对比分析', 'subtitle' => '把 GEO 与传统 SEO 讲清楚', 'content' => '请对比 GEO 与传统 SEO 的差异、优势和适用客户，并给出销售话术。', 'icon' => 'fas fa-scale-balanced', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'hot_search', 'title' => '客户异议处理', 'subtitle' => '应对预算、效果和安全疑虑', 'content' => '客户担心 GEO 效果不确定、预算高、数据安全风险，我该如何回应？', 'icon' => 'fas fa-handshake-angle', 'color_class' => 'text-blue-700', 'sort_order' => 4],
            ['type' => 'skill_learning', 'title' => 'GEO 技术原理深度解析', 'subtitle' => '掌握 LLM 如何引用内容的底层逻辑。', 'content' => 'GEO 技术原理深度解析', 'icon' => 'fas fa-brain', 'color_class' => 'from-blue-50 to-sky-50 border-blue-100 text-blue-600', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '面对 CTO 的销售话术', 'subtitle' => '如何用技术语言搞定技术决策人。', 'content' => '面对 CTO 的销售话术', 'icon' => 'fas fa-user-tie', 'color_class' => 'from-green-50 to-emerald-50 border-green-100 text-green-600', 'sort_order' => 2]
        ],
        'learning_method' => [
            ['type' => 'hot_search', 'title' => '高效听课方法', 'subtitle' => '听课时怎么抓重点？', 'content' => '请给我一套高效听课方法，包含课前准备、课中记录和课后复盘。', 'icon' => 'fas fa-headphones', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => '课后复盘模板', 'subtitle' => '把学过的内容真正吸收', 'content' => '请给我一个课后复盘模板，帮助我总结重点、发现疑问并安排练习。', 'icon' => 'fas fa-clipboard-check', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '学习计划制定', 'subtitle' => '为一个主题设计学习路径', 'content' => '我想学习这个主题，请帮我制定一个分阶段学习计划和每天的练习安排。', 'icon' => 'fas fa-calendar-days', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'skill_learning', 'title' => '费曼学习法练习', 'subtitle' => '用讲给别人听的方式检验理解。', 'content' => '费曼学习法练习', 'icon' => 'fas fa-chalkboard-user', 'color_class' => 'from-sky-50 to-blue-50 border-sky-100 text-sky-700', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '错题与薄弱点复盘', 'subtitle' => '把错误转化为下一次进步。', 'content' => '错题与薄弱点复盘', 'icon' => 'fas fa-rotate-left', 'color_class' => 'from-indigo-50 to-sky-50 border-indigo-100 text-indigo-700', 'sort_order' => 2]
        ],
        'customer_support' => [
            ['type' => 'hot_search', 'title' => '用户投诉处理', 'subtitle' => '先安抚情绪，再解决问题', 'content' => '用户投诉产品不好用且情绪激动，请帮我写一段客服回应和处理流程。', 'icon' => 'fas fa-heart-circle-check', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => '常见问题排查', 'subtitle' => '快速定位用户遇到的问题', 'content' => '请帮我把这个用户问题拆成排查步骤，并列出需要追问的关键信息。', 'icon' => 'fas fa-screwdriver-wrench', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '升级工单判断', 'subtitle' => '什么时候需要转人工或技术处理', 'content' => '这个问题是否需要升级工单？请给出判断标准、所需信息和转交说明。', 'icon' => 'fas fa-arrow-up-right-dots', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'skill_learning', 'title' => '客服沟通 SOP', 'subtitle' => '建立稳定、礼貌、有效的服务流程。', 'content' => '客服沟通 SOP', 'icon' => 'fas fa-headset', 'color_class' => 'from-amber-50 to-orange-50 border-amber-100 text-amber-700', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '情绪安抚话术', 'subtitle' => '在高压对话中保持清晰和克制。', 'content' => '情绪安抚话术', 'icon' => 'fas fa-face-smile', 'color_class' => 'from-rose-50 to-amber-50 border-rose-100 text-rose-700', 'sort_order' => 2]
        ],
        'knowledge_expert' => [
            ['type' => 'hot_search', 'title' => '快速查知识库', 'subtitle' => '用更准确的问题找到答案', 'content' => '请帮我把这个需求改写成适合知识库检索的关键词和问题列表。', 'icon' => 'fas fa-magnifying-glass', 'color_class' => 'text-blue-700', 'sort_order' => 1],
            ['type' => 'hot_search', 'title' => '文档摘要生成', 'subtitle' => '从长文档提炼要点和风险', 'content' => '请根据知识库内容总结这份文档的核心结论、关键证据和待确认事项。', 'icon' => 'fas fa-file-lines', 'color_class' => 'text-blue-700', 'sort_order' => 2],
            ['type' => 'hot_search', 'title' => '资料可信度判断', 'subtitle' => '避免把不确定内容当成事实', 'content' => '请判断这段资料的可信度，并标出明确事实、推断内容和需要补证的地方。', 'icon' => 'fas fa-shield-halved', 'color_class' => 'text-blue-700', 'sort_order' => 3],
            ['type' => 'skill_learning', 'title' => '知识库检索技巧', 'subtitle' => '学会用关键词、上下文和边界提问。', 'content' => '知识库检索技巧', 'icon' => 'fas fa-book-open', 'color_class' => 'from-slate-50 to-blue-50 border-slate-200 text-slate-700', 'sort_order' => 1],
            ['type' => 'skill_learning', 'title' => '知识沉淀方法', 'subtitle' => '把零散信息整理成可复用资产。', 'content' => '知识沉淀方法', 'icon' => 'fas fa-folder-tree', 'color_class' => 'from-emerald-50 to-slate-50 border-emerald-100 text-emerald-700', 'sort_order' => 2]
        ]
    ];
}

function insertDefaultExploreSuggestionTemplates($db) {
    $defaultTemplates = getDefaultExploreSuggestionTemplates();
    $scenarioSlugs = array_keys($defaultTemplates);
    $expectedTemplateCount = 0;
    foreach ($defaultTemplates as $templates) {
        $expectedTemplateCount += count($templates);
    }

    $placeholders = implode(',', array_fill(0, count($scenarioSlugs), '?'));
    $templateCountStmt = $db->prepare("SELECT COUNT(*) FROM explore_suggestion_templates WHERE scenario_slug IN ($placeholders)");
    $templateCountStmt->execute($scenarioSlugs);
    $templateCount = (int)$templateCountStmt->fetchColumn();

    if ($templateCount < $expectedTemplateCount) {
        $templateStmt = $db->prepare("INSERT INTO explore_suggestion_templates
            (scenario_slug, type, title, subtitle, content, icon, color_class, sort_order, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(scenario_slug, type, sort_order) DO UPDATE SET
                title = excluded.title,
                subtitle = excluded.subtitle,
                content = excluded.content,
                icon = excluded.icon,
                color_class = excluded.color_class,
                updated_at = datetime('now')");

        foreach ($defaultTemplates as $scenarioSlug => $templates) {
            foreach ($templates as $template) {
                $templateStmt->execute([
                    $scenarioSlug,
                    $template['type'],
                    $template['title'],
                    $template['subtitle'],
                    $template['content'],
                    $template['icon'],
                    $template['color_class'],
                    $template['sort_order']
                ]);
            }
        }
    }

    $activeCount = (int)$db->query("SELECT COUNT(*) FROM explore_suggestion_settings WHERE setting_key = 'active_scenario_slug'")->fetchColumn();
    if ($activeCount === 0) {
        $stmt = $db->prepare("INSERT INTO explore_suggestion_settings (setting_key, setting_value, updated_at)
            VALUES ('active_scenario_slug', ?, datetime('now'))");
        $stmt->execute(['sales']);
    }

    $suggestionCount = (int)$db->query("SELECT COUNT(*) FROM explore_suggestions")->fetchColumn();
    if ($suggestionCount === 0) {
        applyExploreSuggestionScenario('sales', $db);
    }
}

function getActiveExploreSuggestionScenarioSlug($db = null) {
    $db = $db ?: getDB();
    $stmt = $db->prepare("SELECT setting_value FROM explore_suggestion_settings WHERE setting_key = 'active_scenario_slug'");
    $stmt->execute();
    return $stmt->fetchColumn() ?: 'sales';
}

function applyExploreSuggestionScenario($slug, $db = null) {
    $db = $db ?: getDB();

    $stmt = $db->prepare("SELECT * FROM prompt_scenarios WHERE slug = ?");
    $stmt->execute([$slug]);
    $scenario = $stmt->fetch();
    if (!$scenario) {
        throw new InvalidArgumentException('探索建议场景不存在');
    }

    $stmt = $db->prepare("SELECT * FROM explore_suggestion_templates WHERE scenario_slug = ? ORDER BY type ASC, sort_order ASC, id ASC");
    $stmt->execute([$slug]);
    $templates = $stmt->fetchAll();
    if (count($templates) === 0) {
        throw new RuntimeException('探索建议场景缺少模板');
    }

    $db->beginTransaction();
    try {
        $db->exec("DELETE FROM explore_suggestions");

        $insertStmt = $db->prepare("INSERT INTO explore_suggestions
            (type, title, subtitle, content, icon, color_class, sort_order, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))");

        foreach ($templates as $template) {
            $insertStmt->execute([
                $template['type'],
                $template['title'],
                $template['subtitle'],
                $template['content'],
                $template['icon'],
                $template['color_class'],
                $template['sort_order']
            ]);
        }

        $settingStmt = $db->prepare("INSERT INTO explore_suggestion_settings (setting_key, setting_value, updated_at)
            VALUES ('active_scenario_slug', ?, datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET
                setting_value = excluded.setting_value,
                updated_at = datetime('now')");
        $settingStmt->execute([$slug]);

        $db->commit();
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }

    return $scenario;
}

// 如果直接访问此文件，执行数据库初始化
if (basename($_SERVER['PHP_SELF']) === 'db.php') {
    try {
        initDatabase();
        echo json_encode(['success' => true, 'message' => '数据库初始化成功']);
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}
