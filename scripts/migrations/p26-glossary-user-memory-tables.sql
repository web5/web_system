-- @database web_system

-- p26：生词本/收藏（glossary_entries）+ 用户记忆（user_memories）两张新表。
--
-- 背景（2026-09-22）：收藏与用户记忆为新增能力，落 user-service（跟用户走）。
-- 生产 NODE_ENV=production 关闭 TypeORM synchronize，故新表靠本迁移建表（幂等）。
--
-- 关于音乐口味并入（user_taste_profiles）：
--   实测本地 ai-agent 与 user-service 的 .env 均配置 DB_DATABASE=web_system（同一实例同库），
--   user_taste_profiles 表早已在 web_system 库（由 ai-agent synchronize 创建，含 deleted_at 列）。
--   因此「口味并入」无需跨库搬数据——表与数据天然就在目标库，只是读写方从 ai-agent 切到 user-service。
--   生产 dev/prod 各服务同样共用同一个 web_system 库（见 docs 环境说明），结论一致。

-- 生词本 / 收藏（幂等）
CREATE TABLE IF NOT EXISTS glossary_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'ID',
  user_id VARCHAR(64) NOT NULL COMMENT '所属用户 id',
  content_hash VARCHAR(64) NOT NULL COMMENT 'enMain 归一化 sha256 截 64',
  source_type VARCHAR(16) NOT NULL COMMENT '来源 chat/translate',
  source_text TEXT NULL COMMENT '中文原文',
  en_main TEXT NOT NULL COMMENT '英文译文主文',
  note TEXT NULL COMMENT '注解 / 直译对照 / 委婉版',
  meta JSON NULL COMMENT '语气 / 风格 / 方向 meta',
  conversation_id VARCHAR(64) NULL COMMENT '关联会话 id',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_glossary_user (user_id),
  UNIQUE KEY idx_glossary_user_hash (user_id, content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户记忆（幂等）
CREATE TABLE IF NOT EXISTS user_memories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'ID',
  user_id VARCHAR(64) NOT NULL COMMENT '所属用户 id',
  category VARCHAR(32) NOT NULL COMMENT '记忆分类 preference/fact/habit',
  content TEXT NOT NULL COMMENT '记忆内容',
  content_hash VARCHAR(64) NOT NULL COMMENT 'content 归一化 sha256 截 64',
  confidence DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT '置信度 0~1',
  source_conversation_id VARCHAR(64) NULL COMMENT '来源会话 id',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_user_memories_user (user_id),
  UNIQUE KEY idx_user_memories_user_cat_hash (user_id, category, content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
