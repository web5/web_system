-- =============================================================================
-- 0007_baseline_tables.sql —— 存量业务表基线（补齐迁移链缺口）
--
-- 背景：0001 仅为 ALTER 标准化，0002/0003/0004/0006 只覆盖 upload/gateway/
--       content-hub/mcp-jobs/dict 等部分表；以下 27 张表此前只靠各服务
--       TypeORM synchronize（NODE_ENV != production 时）隐式创建，导致
--       NODE_ENV=production 的环境（dev/prod 服务器）升级代码后大量表缺失、
--       服务启动即崩（QueryFailedError: Table 'xxx' doesn't exist）。
--
-- 本文件把这些表固化为显式 DDL（来源：本机已同步的库结构），
-- 全部 CREATE TABLE IF NOT EXISTS，可重复执行。
--
-- 用法：由 scripts/apply-migrations.sh 按序应用；目标库 web_system。
-- =============================================================================

SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE IF NOT EXISTS `agent_conversations` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属用户 id',
  `summary` text COLLATE utf8mb4_unicode_ci COMMENT '对话历史摘要',
  `summarized_count` int NOT NULL DEFAULT '0' COMMENT '已压缩的消息条数',
  `messages` json NOT NULL COMMENT '近期消息列表',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对话标题',
  `report` json DEFAULT NULL COMMENT '合同分析报告快照',
  `meta` json DEFAULT NULL COMMENT '对话卡片元信息',
  PRIMARY KEY (`id`),
  KEY `idx_agent_conversations_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `agent_definition_versions` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `agent_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'agent id',
  `version` int NOT NULL COMMENT '版本号',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent 名称',
  `system_prompt` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'systemPrompt',
  `model` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型 id',
  `tools` json NOT NULL COMMENT '工具名数组',
  `max_steps` int NOT NULL DEFAULT '10' COMMENT '最大步数',
  `temperature` float DEFAULT NULL COMMENT '采样温度',
  `memory` json NOT NULL COMMENT '记忆配置',
  `change_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '变更说明',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发布人',
  `capabilities` json DEFAULT NULL COMMENT '能力数组快照',
  `skills` json DEFAULT NULL COMMENT '技能摘要目录快照',
  `streaming` tinyint NOT NULL DEFAULT '1' COMMENT '是否流式输出',
  PRIMARY KEY (`id`),
  KEY `idx_agent_def_ver_agent` (`agent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `agent_definitions` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'agent id',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent 名称',
  `system_prompt` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'systemPrompt',
  `model` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型 id',
  `tools` json NOT NULL COMMENT '工具名数组',
  `max_steps` int NOT NULL DEFAULT '10' COMMENT '最大步数',
  `temperature` float DEFAULT NULL COMMENT '采样温度',
  `memory` json NOT NULL COMMENT '记忆配置',
  `version` int NOT NULL DEFAULT '1' COMMENT '当前版本号',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT '状态：published/draft',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  `published_at` datetime(6) DEFAULT NULL COMMENT '最近发布时间',
  `updated_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '更新人',
  `capabilities` json DEFAULT NULL COMMENT '能力数组（tool/mcp/skill）',
  `skills` json DEFAULT NULL COMMENT '可挂载技能摘要目录',
  `streaming` tinyint NOT NULL DEFAULT '1' COMMENT '是否流式输出',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `agent_runs` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `agent_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent id',
  `agent_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Agent 名称',
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '调用方用户 id',
  `conversation_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话 id',
  `user_input` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户输入原文',
  `system_prompt` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'systemPrompt 原文快照',
  `tools` json DEFAULT NULL COMMENT 'Agent 工具声明',
  `model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型 id',
  `steps` json NOT NULL COMMENT '完整步骤流水',
  `final_answer` mediumtext COLLATE utf8mb4_unicode_ci COMMENT 'AI 最终输出',
  `error` text COLLATE utf8mb4_unicode_ci COMMENT '错误信息',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ok' COMMENT '运行状态',
  `duration_ms` int DEFAULT NULL COMMENT '总耗时 ms',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ai-service' COMMENT '来源服务',
  `agent_version` int DEFAULT NULL COMMENT 'Agent 定义版本快照',
  `prompt_tokens` int DEFAULT NULL COMMENT 'prompt tokens',
  `completion_tokens` int DEFAULT NULL COMMENT 'completion tokens',
  `total_tokens` int DEFAULT NULL COMMENT 'total tokens',
  `cost` decimal(12,6) DEFAULT NULL COMMENT '成本 CNY',
  PRIMARY KEY (`id`),
  KEY `idx_agent_runs_created` (`created_at`),
  KEY `idx_agent_runs_conversation` (`conversation_id`),
  KEY `idx_agent_runs_user` (`user_id`),
  KEY `idx_agent_runs_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `agent_skills` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '技能 code',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '技能名',
  `description` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '技能摘要（on-demand 注入 system）',
  `version` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1.0.0' COMMENT '版本',
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SKILL.md 正文',
  `required_tools` json DEFAULT NULL COMMENT '依赖工具名数组',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_9a56bfeae66f1ef704571b08ab` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `artworks` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '作品 ID',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '作品标题/描述',
  `prompt` text COLLATE utf8mb4_unicode_ci COMMENT '生成提示词',
  `metadata` json DEFAULT NULL COMMENT '额外元数据',
  `image_url` text COLLATE utf8mb4_unicode_ci COMMENT '生成图片地址',
  `original_image_url` text COLLATE utf8mb4_unicode_ci COMMENT '原始图片地址',
  `source_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源类型 bianbian/draw-ai/design/ai-art',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `user_id` bigint unsigned NOT NULL COMMENT '用户 ID，关联 users.id',
  PRIMARY KEY (`id`),
  KEY `IDX_f2c7db7209a8eee4076eb9aae2` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `bianbian_materials` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '素材 ID',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '素材名称',
  `tags` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '标签（逗号分隔）',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分类 sticker/shape/animal/nature/face/bg',
  `content` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '内容 emoji/svg/color',
  `type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'emoji' COMMENT '类型 emoji/svg/color',
  `icon` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'default' COMMENT '展示图标',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '来源 system/custom',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '描述',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序序号',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `IDX_decad0b1a816ada1f7e36166cc` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `bianbian_records` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '记录 ID',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户描述',
  `style` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pixar-3d' COMMENT '风格',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '状态 pending/processing/success/failed',
  `original_image` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原画（base64 data URL）',
  `ai_image` text COLLATE utf8mb4_unicode_ci COMMENT 'AI 生成结果图',
  `output_size` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1024x1024' COMMENT '输出尺寸',
  `error_msg` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败原因',
  `ai_request_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI API 请求 ID',
  `processing_time_ms` int DEFAULT NULL COMMENT '处理耗时（毫秒）',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `user_id` bigint unsigned NOT NULL COMMENT '用户 ID，关联 users.id',
  PRIMARY KEY (`id`),
  KEY `IDX_8e334789fa97531e96e3bf3d98` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对话 ID',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对话标题',
  `messages` json NOT NULL COMMENT '消息列表（轻量对话）',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `user_id` bigint unsigned NOT NULL COMMENT '用户 ID，关联 users.id',
  `summary` text COLLATE utf8mb4_unicode_ci COMMENT '对话历史摘要（Agent 摘要压缩）',
  `summarized_count` int NOT NULL DEFAULT '0' COMMENT '已摘要覆盖的消息条数',
  `recent_messages` json DEFAULT NULL COMMENT 'Agent 近期原始消息',
  PRIMARY KEY (`id`),
  KEY `IDX_3a9ae579e61e81cc0e989afeb4` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `deploy_deployments` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `env_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '环境 ID',
  `module_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块 key',
  `current_version` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '当前版本标签',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'deployed' COMMENT '状态',
  `deployed_at` datetime(6) DEFAULT NULL COMMENT '最近部署时间',
  PRIMARY KEY (`id`),
  KEY `IDX_298d2dfea6dd753970d667d9c8` (`env_id`),
  KEY `IDX_114f96e2b318974949550a1bae` (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finnews_entities` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '实体 ID',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '实体类型',
  `aliases` json DEFAULT NULL COMMENT '别名列表',
  `stock_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sector` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '板块',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '描述',
  `mention_count_7d` int NOT NULL DEFAULT '0' COMMENT '近 7 日提及次数',
  `mention_count_30d` int NOT NULL DEFAULT '0' COMMENT '近 30 日提及次数',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `IDX_9d42b1e1ee7c34b46bbf8db1bb` (`name`),
  KEY `IDX_7aa54ded65bfb7cb4860ae3cc7` (`stock_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finnews_news` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '新闻 ID',
  `topic_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '所属话题 ID',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '正文',
  `summary` text COLLATE utf8mb4_unicode_ci COMMENT '摘要',
  `source_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_url` text COLLATE utf8mb4_unicode_ci COMMENT '来源 URL',
  `source_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源类型',
  `simhash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '去重 simhash',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类',
  `publish_date` datetime DEFAULT NULL,
  `is_processed` tinyint NOT NULL DEFAULT '0' COMMENT '是否已处理',
  `is_aggregated` tinyint NOT NULL DEFAULT '0' COMMENT '是否已聚合到话题',
  `crawled_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '采集时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `IDX_da37823d98cabfa32352a7ef99` (`topic_id`),
  KEY `IDX_7607178819da5aab064d25a4e5` (`source_name`),
  KEY `IDX_c59cd64e53692919e0751d8658` (`simhash`),
  KEY `IDX_578e78dee829da772ba2e00e05` (`publish_date`),
  KEY `IDX_83238f0a1ee69d05967974f482` (`source_name`,`publish_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finnews_subscriptions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订阅 ID',
  `sub_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '订阅类型',
  `sub_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '订阅值',
  `push_enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否推送',
  `push_channels` json DEFAULT NULL COMMENT '推送渠道列表',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '是否生效',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  `user_id` bigint unsigned NOT NULL COMMENT '用户 ID，关联 users.id',
  PRIMARY KEY (`id`),
  KEY `IDX_4703c403b8ad1ff4b35f7a327d` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `finnews_topics` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '话题 ID',
  `title` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `summary` text COLLATE utf8mb4_unicode_ci COMMENT '摘要',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类',
  `sentiment` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '情感倾向',
  `sentiment_score` float DEFAULT NULL COMMENT '情感得分',
  `news_count` int NOT NULL DEFAULT '1' COMMENT '关联新闻数',
  `source_names` json DEFAULT NULL COMMENT '来源名称列表',
  `source_urls` json DEFAULT NULL COMMENT '来源链接列表',
  `entities` json DEFAULT NULL COMMENT '实体列表',
  `related_topic_ids` json DEFAULT NULL COMMENT '关联话题 ID 列表',
  `parent_topic_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '父话题 ID',
  `embedding_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '向量 ID',
  `publish_date` datetime DEFAULT NULL,
  `is_hot` tinyint NOT NULL DEFAULT '0' COMMENT '是否热门',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '是否删除',
  `first_seen` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '首次出现时间',
  `last_updated` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最近更新时间',
  PRIMARY KEY (`id`),
  KEY `IDX_2e7845ba49274e03bcdfffb3a0` (`title`),
  KEY `IDX_88dca81ce6bceddf86bad3ab60` (`category`),
  KEY `IDX_d5271ed3135702d483ecf6aab6` (`publish_date`),
  KEY `IDX_949d8d56d9f4e4f321e93d222c` (`is_hot`,`publish_date`),
  KEY `IDX_04b1e5bed45262c2f326727e9b` (`category`,`publish_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `mcp_api_keys` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮箱',
  `name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '名称',
  `owner_id` bigint unsigned DEFAULT NULL COMMENT '绑定用户ID，null=邮箱自助',
  `key_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SHA-256(plaintext)',
  `key_prefix` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '明文前 12 位脱敏',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '状态 active/revoked',
  `expires_at` timestamp NULL DEFAULT NULL COMMENT '过期时间，null=永久有效',
  `last_used_at` timestamp NULL DEFAULT NULL COMMENT '最近使用时间',
  `owner_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'apply' COMMENT '来源 apply/admin',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `revoked_at` timestamp NULL DEFAULT NULL COMMENT '吊销时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `IDX_0fb54ed775693a60667eaa2b7b` (`email`),
  KEY `IDX_6e5347944b938e85f0ca1913d7` (`owner_id`),
  KEY `IDX_1e8757214c3ab98bac6c951fcb` (`key_hash`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `mcp_key_codes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邮箱',
  `code_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SHA-256(code)',
  `expires_at` timestamp NOT NULL COMMENT '过期时间',
  `attempts` int NOT NULL DEFAULT '0' COMMENT '尝试次数',
  `last_sent_at` timestamp NULL DEFAULT NULL COMMENT '最近发送时间',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `IDX_3443aacdff1ed9b32d143d3690` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `mcp_modules` (
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '模块描述',
  `base_url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台服务地址',
  `timeout` int NOT NULL DEFAULT '30' COMMENT '超时秒数',
  `auth_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bearer' COMMENT '鉴权类型 bearer/basic/header',
  `auth_config` json DEFAULT NULL COMMENT '鉴权配置',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `module_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'http' COMMENT '模块类型 http=声明式HTTP code=代码内置',
  `code_key` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '代码模块标识（如 finnews）',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '模块 ID',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_5ee9043ecec74651a7c93237eb` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `mcp_tools` (
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工具名',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '工具描述',
  `method` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'GET' COMMENT 'HTTP 方法',
  `path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '/' COMMENT '请求路径（支持 {xxx} 占位）',
  `params` json DEFAULT NULL COMMENT '参数定义数组',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '工具 ID',
  `module_id` bigint unsigned NOT NULL COMMENT '所属模块 ID',
  PRIMARY KEY (`id`),
  KEY `FK_fdb6015713f76825513a1a9c89b` (`module_id`),
  CONSTRAINT `FK_fdb6015713f76825513a1a9c89b` FOREIGN KEY (`module_id`) REFERENCES `mcp_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `model_pricing` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型提供方（hy3 / tokenhub）',
  `model` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型 id（如 deepseek-v4-flash）',
  `input_price_per1k` decimal(12,6) NOT NULL COMMENT '输入每 1K token 价格',
  `output_price_per1k` decimal(12,6) NOT NULL COMMENT '输出每 1K token 价格',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CNY' COMMENT '币种',
  `updated_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '更新人',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_model_pricing_provider_model` (`provider`,`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `operation_logs` (
  `operator` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作人',
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型',
  `target` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作对象',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IP',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '日志 ID',
  PRIMARY KEY (`id`),
  KEY `IDX_c1fd6d1b5856cc0958b2add833` (`operator`),
  KEY `IDX_87c93e63c78801efadf37d2e01` (`type`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `permissions` (
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限点 code',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限名',
  `grp` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限分组',
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'action' COMMENT '权限类型 menu/action/api',
  `sort` int NOT NULL DEFAULT '0' COMMENT '排序',
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色 code',
  `permission_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限点 code',
  PRIMARY KEY (`role_code`,`permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `roles` (
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色 code',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色名',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
  `is_system` tinyint NOT NULL DEFAULT '0' COMMENT '内置角色不可删',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `run_metrics` (
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `agent_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent id',
  `model` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型 id',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源服务（ai-agent / ai-service）',
  `date` date NOT NULL COMMENT '业务日（本地）',
  `run_count` int NOT NULL DEFAULT '0' COMMENT 'run 总数',
  `ok_count` int NOT NULL DEFAULT '0' COMMENT '成功数',
  `error_count` int NOT NULL DEFAULT '0' COMMENT '失败数',
  `total_tokens` bigint NOT NULL DEFAULT '0' COMMENT 'token 总量',
  `total_cost` decimal(14,6) NOT NULL DEFAULT '0.000000' COMMENT '成本合计 CNY',
  `total_duration_ms` int NOT NULL DEFAULT '0' COMMENT '累计耗时 ms（平均耗时 = totalDurationMs / runCount）',
  PRIMARY KEY (`id`),
  KEY `idx_run_metrics_date` (`date`),
  KEY `idx_run_metrics_agent_date` (`agent_id`,`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `system_configs` (
  `key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置键',
  `value` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置值',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '说明',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `todo_tasks` (
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '描述',
  `due_date` datetime DEFAULT NULL COMMENT '截止时间',
  `completed_at` datetime DEFAULT NULL COMMENT '完成时间',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '任务 ID',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '状态 pending/in_progress/completed/overdue/cancelled',
  `priority` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'medium' COMMENT '优先级 low/medium/high',
  `category` json DEFAULT NULL COMMENT '分类列表',
  `user_id` bigint unsigned NOT NULL COMMENT '用户 ID，关联 users.id',
  PRIMARY KEY (`id`),
  KEY `IDX_7769f24fe377a1ad0070dc927e` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `users` (
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录用户名',
  `password` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '密码哈希（NULL 表示未设置）',
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮箱',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `nickname` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '昵称',
  `avatar` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像 URL',
  `gender` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown' COMMENT '性别 male/female/unknown',
  `mp_openid` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '微信小程序 openid',
  `oa_openid` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '微信公众号 openid',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '状态 active/inactive/banned',
  `roles` json DEFAULT NULL COMMENT '角色列表',
  `daily_transform_limit` int DEFAULT NULL COMMENT '每日变身次数上限，NULL=全局默认',
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '用户 ID',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_fe0bb3f6520ee0469504521e71` (`username`),
  UNIQUE KEY `IDX_97672ac88f789774dd47f7c8be` (`email`),
  KEY `IDX_d5c51dbbe16d9451ac9a524161` (`mp_openid`),
  KEY `IDX_71bf34fb26055dcb76c0614eb4` (`oa_openid`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=1;
