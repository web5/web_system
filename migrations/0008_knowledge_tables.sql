-- =============================================================================
-- 0008_knowledge_tables.sql —— knowledge-service 独立库表
--
-- 目标库：web_system_knowledge（与主库同实例、不同库名；由 ecosystem.config.js
--        KNOWLEDGE_DB_DATABASE / DB_DATABASE_KNOWLEDGE 指定）
-- 说明：knowledge-service 的 NODE_ENV=production 时 synchronize 关闭，
--       新库需显式建表。全部 CREATE TABLE IF NOT EXISTS，可重复执行。
--
-- @database web_system_knowledge
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS `knowledge_chunks` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属文档 id',
  `collection_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属集合 id',
  `seq` int NOT NULL COMMENT '文档内分块序号',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分块文本',
  `embedding` json DEFAULT NULL COMMENT 'embedding 向量(float[])',
  `meta` json DEFAULT NULL COMMENT '分块扩展元数据',
  PRIMARY KEY (`id`),
  KEY `idx_knowledge_chunks_collection` (`collection_id`),
  KEY `idx_knowledge_chunks_doc` (`doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `knowledge_collections` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '集合名称',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '集合描述',
  `embed_model` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tokenhub' COMMENT 'embedding 提供方',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '启用：停用后所有 knowledge 调用返回明确错误',
  `meta` json DEFAULT NULL COMMENT '扩展元数据',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人 user id',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `knowledge_docs` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `collection_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属集合 id',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文档标题',
  `source` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源（调用方）',
  `raw_text` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原始文本',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'parsing' COMMENT '解析状态',
  `checksum` char(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '内容校验和（幂等去重）',
  `chunk_count` int NOT NULL DEFAULT '0' COMMENT '分块数',
  `error` text COLLATE utf8mb4_unicode_ci COMMENT '失败原因',
  `doc_meta` json DEFAULT NULL COMMENT '文档扩展元数据',
  PRIMARY KEY (`id`),
  KEY `idx_knowledge_docs_checksum` (`collection_id`,`checksum`),
  KEY `idx_knowledge_docs_collection` (`collection_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
