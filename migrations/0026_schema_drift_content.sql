-- 0026 · schema 漂移转正：publish_mode 默认值 + content_publications 归属列
--
-- 来源：PR #539（fix/content-hub-env-injection）的 migrations/0021_schema_drift_content.sql。
--       #539 已过期关闭不合并，本脚本是其中仍有价值部分的抢救。
-- 重编号原因：master 已存在 0021_pipeline_trigger_source.sql / 0023_users_token_version.sql /
--       0024_dict_operation_log_type_password_reset.sql；0025 已被在途的 0025_nce_lessons.sql
--       占用，故顺延到 0026（配套 0027）。幂等，dev / prod 各手跑一遍。
--
-- 背景：#331 真实管线复验时发现两处 schema 缺口，当时手工 ALTER 修掉：
--   1. content_pipelines.publish_mode —— TypeORM 实体有此列，prod synchronize 关闭时缺列
--      （0015 已建列，但 DEFAULT 'publish' 与实体期望的 'manual' 不一致，此处修正默认值）
--   2. content_publications.account_code / account_type —— pipeline.service 写入时引用，
--      表缺列导致 Unknown column 'account_code'（0018 已建列，但 account_type 为 varchar(16)，
--      实际需要 varchar(32)；此处对齐）
--
-- ⚠️ 与 #539 原稿的差异（修正原稿缺陷）：原稿注释写「已存在但长度不够时 MODIFY」，
--    但 SQL 只在 @exists = 0 时 ADD、否则一律 skip，account_type 从 varchar(16) 到
--    varchar(32) 的对齐从未生效。本版改查 COLUMN_TYPE，长度不足才 MODIFY。
--
-- 🔴 适用范围（2026-11-05 补充，勿删）：**仅允许在 `web_system` 业务主库执行**
--   （content-hub / mcp-gateway 的 DB_DATABASE 默认值），dev / prod 的主库各手跑一遍。
--   ❌ 禁止在 `web_system_deploy` / `web_system_deploy_shadow` 执行：这两库是发布平台库与
--   影子库，2026-09 整库复制 + 2026-10-26 synchronize 误连时曾混入一套字段不同的空壳
--   content_* 表（0 行、无服务读写），2026-11-05 已 DROP 清理。本脚本若在列不存在的库上
--   跑会 ADD 出新列，重新制造 schema 分叉。
--   执行前自检：SELECT DATABASE();  -- 必须返回 web_system
--   ⚠️ 幂等 ≠ 在任何库上都是 no-op：列不存在会 ADD、列型不符会 MODIFY。
--
-- 幂等：逐列判断 information_schema，已存在则跳过。
-- 本地主库已手工加过列，本脚本在本地跑会识别「已存在跳过」。

SET @db = DATABASE();

-- ── content_pipelines.publish_mode 默认值修正 ──
-- 0015 建列时 DEFAULT 'publish'，实体定义 default: 'manual'。
-- 不改已有行的值（只改列默认值），新行默认 'manual'。
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_pipelines' AND COLUMN_NAME = 'publish_mode'
);
SET @sql = IF(
  @exists > 0,
  "ALTER TABLE `content_pipelines` ALTER COLUMN `publish_mode` SET DEFAULT 'manual'",
  "SELECT 'content_pipelines.publish_mode does not exist, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── content_publications.account_code ──
-- 0018 已建列（varchar(64) NULL），如已存在则跳过。
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_publications' AND COLUMN_NAME = 'account_code'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_publications`
     ADD COLUMN `account_code` varchar(64) DEFAULT NULL COMMENT '发布所用账号编码'",
  "SELECT 'content_publications.account_code already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── content_publications.account_type ──
-- 0018 建的是 varchar(16)，pipeline.service 实际写入值可能超长 → 统一到 varchar(32)。
-- 已存在但长度不足时 MODIFY；不存在时 ADD；已经足够时跳过。
SET @coltype = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_publications' AND COLUMN_NAME = 'account_type'
);
SET @sql = IF(
  @coltype IS NULL,
  "ALTER TABLE `content_publications`
     ADD COLUMN `account_type` varchar(32) DEFAULT NULL COMMENT '发布时账号主体类型快照 personal | enterprise'",
  IF(
    @coltype = 'varchar(16)',
    "ALTER TABLE `content_publications`
       MODIFY COLUMN `account_type` varchar(32) DEFAULT NULL COMMENT '发布时账号主体类型快照 personal | enterprise'",
    "SELECT 'content_publications.account_type already wide enough, skip'"
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
