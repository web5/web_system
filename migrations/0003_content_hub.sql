-- =============================================================================
-- 0003_content_hub.sql
-- 内容中枢：财经服务泛化改名 content-hub 后，新增「内容管道」数据域（论文 / AI 资讯）
-- 适用范围：web_system 库（MySQL 8，utf8mb4）。
-- 执行顺序：在 0001、0002 之后，于生产库按段执行；本脚本不自动运行。
-- 与 finnews_* 的关系：finnews_*（财经）三张表原样保留；本脚本新增 content_* 五张表。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 一、采集源（每类来源一条配置：arxiv / rss / hackernews / wechat_mp / douyin / xiaohongshu）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_sources` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                        COMMENT '采集源 ID',
  `code`        VARCHAR(64)     NOT NULL                                        COMMENT '源编码，如 arxiv/hn/rss/wechat_mp/douyin/xhs',
  `name`        VARCHAR(128)    NOT NULL                                        COMMENT '显示名，如 arXiv / Hacker News',
  `type`        VARCHAR(32)     NOT NULL                                        COMMENT '采集器类型 arxiv/rss/hackernews/wechat_mp/douyin/xiaohongshu',
  `config`      JSON            NULL    DEFAULT NULL                           COMMENT '各源私有配置（url/账号/凭证引用等）',
  `category`    VARCHAR(64)     NULL    DEFAULT NULL                           COMMENT '内容领域，如 AI/论文',
  `enabled`     TINYINT(1)      NOT NULL DEFAULT 1                              COMMENT '是否启用',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP              COMMENT '创建时间',
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`  DATETIME(3)     NULL    DEFAULT NULL                           COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_content_sources_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容管道采集源配置';

-- -----------------------------------------------------------------------------
-- 二、管线（paper / ai-news 各一条，可扩展）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_pipelines` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                     COMMENT '管线 ID',
  `code`            VARCHAR(64)     NOT NULL                                    COMMENT '管线编码，如 daily_paper/ai_news',
  `type`            VARCHAR(32)     NOT NULL                                    COMMENT '管线类型 paper | ai-news',
  `title_template`  VARCHAR(255)    NULL    DEFAULT NULL                        COMMENT '日报标题模板',
  `cron`            VARCHAR(64)     NOT NULL                                    COMMENT 'cron 表达式，如 0 9 * * *',
  `llm_prompt`      TEXT            NULL    DEFAULT NULL                        COMMENT '摘要/选题 prompt 模板',
  `publish_targets` JSON            NULL    DEFAULT NULL                        COMMENT '发布目标 ["tencent_docs","wechat_mp"]',
  `tencent_folder`  VARCHAR(255)    NULL    DEFAULT NULL                        COMMENT '腾讯文档目标目录',
  `enabled`         TINYINT(1)      NOT NULL DEFAULT 1                          COMMENT '是否启用',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP          COMMENT '创建时间',
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`      DATETIME(3)     NULL    DEFAULT NULL                        COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_content_pipelines_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容管道配置（论文/AI资讯）';

-- -----------------------------------------------------------------------------
-- 三、采集条目（核心表，带状态机与去重指纹）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_items` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                        COMMENT '条目 ID',
  `pipeline_id`  BIGINT UNSIGNED NULL    DEFAULT NULL                           COMMENT '所属管线 ID',
  `source_id`    BIGINT UNSIGNED NULL    DEFAULT NULL                           COMMENT '来源 ID',
  `external_id`  VARCHAR(128)    NULL    DEFAULT NULL                           COMMENT '源内唯一 id（arXiv id / url hash）',
  `title`        VARCHAR(500)    NOT NULL                                       COMMENT '标题',
  `url`          VARCHAR(1024)   NULL    DEFAULT NULL                           COMMENT '原文链接',
  `content`      MEDIUMTEXT      NULL    DEFAULT NULL                           COMMENT '原始正文',
  `summary`      TEXT            NULL    DEFAULT NULL                           COMMENT 'LLM 摘要',
  `category`     VARCHAR(64)     NULL    DEFAULT NULL                           COMMENT '分类（AI 细分）',
  `tags`         JSON            NULL    DEFAULT NULL                           COMMENT '标签',
  `simhash`      VARCHAR(64)     NULL    DEFAULT NULL                           COMMENT '去重 SimHash 指纹',
  `source_name`  VARCHAR(128)    NULL    DEFAULT NULL                           COMMENT '来源名称',
  `publish_date` DATETIME        NULL    DEFAULT NULL                           COMMENT '原始发布时间',
  `status`       VARCHAR(24)     NOT NULL DEFAULT 'pending'                     COMMENT 'pending/collected/processed/rendered/published/failed',
  `error`        VARCHAR(512)    NULL    DEFAULT NULL                           COMMENT '最近一次错误信息',
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP             COMMENT '创建时间',
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`   DATETIME(3)     NULL    DEFAULT NULL                           COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_items_pipeline_external` (`pipeline_id`, `external_id`),
  KEY `idx_items_pipeline_status` (`pipeline_id`, `status`),
  KEY `idx_items_simhash` (`simhash`),
  KEY `idx_items_publish_date` (`publish_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容管道采集条目';

-- -----------------------------------------------------------------------------
-- 四、发布记录（每次发布动作一条，支持失败重发）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_publications` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                         COMMENT '发布记录 ID',
  `item_id`     BIGINT UNSIGNED NOT NULL                                        COMMENT '条目 ID',
  `pipeline_id` BIGINT UNSIGNED NULL    DEFAULT NULL                            COMMENT '管线 ID',
  `target`      VARCHAR(32)     NOT NULL                                        COMMENT '发布目标 tencent_docs | wechat_mp',
  `status`      VARCHAR(24)     NOT NULL                                        COMMENT 'submitted/success/failed',
  `external_id` VARCHAR(128)    NULL    DEFAULT NULL                            COMMENT '外部 ID（腾讯文档 doc id / 公众号 media_id 或 publish id）',
  `detail`      JSON            NULL    DEFAULT NULL                            COMMENT '错误信息/回调结果',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP              COMMENT '创建时间',
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_pub_item` (`item_id`),
  KEY `idx_pub_pipeline_target` (`pipeline_id`, `target`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='内容管道发布记录';

-- -----------------------------------------------------------------------------
-- 五、公众号永久素材（封面图等，缓存 thumb_media_id 避免重复上传）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `content_media` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                          COMMENT '素材 ID',
  `media_type` VARCHAR(16)     NOT NULL                                         COMMENT 'image/thumb',
  `file_url`   VARCHAR(512)    NULL    DEFAULT NULL                             COMMENT '源文件 URL',
  `media_id`   VARCHAR(128)    NULL    DEFAULT NULL                             COMMENT '微信返回 media_id / thumb_media_id',
  `url`        VARCHAR(512)    NULL    DEFAULT NULL                             COMMENT '微信 CDN url',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP               COMMENT '创建时间',
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_media_type` (`media_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公众号永久素材缓存';

-- -----------------------------------------------------------------------------
-- 六、gateway_routes：财经行 target_service 改名 + 新增内容管道路由
-- 说明：gateway_routes 是外置路由配置（与 proxy.service.ts 硬编码路由对齐），
--       财经通道前缀 /api/finnews 保持不变（不破坏 MCP 调用链）。
-- -----------------------------------------------------------------------------
UPDATE `gateway_routes`
SET `target_service` = 'content-hub'
WHERE `route_code` = 'finnews' AND `target_service` = 'finnews';

INSERT INTO `gateway_routes`
  (`route_code`, `path_prefix`, `target_service`, `strip_prefix`, `rewrite_to`, `timeout_ms`, `auth_mode`, `enabled`, `priority`, `description`)
VALUES
  ('content-hub', '/api/content-hub', 'content-hub', '^/api/content-hub', '', 30000, 'service_key', 1, 100, '内容管道（论文/AI资讯，网关校验 CONTENT_HUB_SERVICE_KEY）')
ON DUPLICATE KEY UPDATE
  `path_prefix`    = VALUES(`path_prefix`),
  `target_service` = VALUES(`target_service`),
  `strip_prefix`   = VALUES(`strip_prefix`),
  `rewrite_to`     = VALUES(`rewrite_to`),
  `timeout_ms`     = VALUES(`timeout_ms`),
  `auth_mode`      = VALUES(`auth_mode`),
  `enabled`        = VALUES(`enabled`),
  `priority`       = VALUES(`priority`),
  `description`    = VALUES(`description`);
