-- 0021 · schema 漂移转正：publish_mode 默认值 + content_publications 归属列
--
-- 背景：#331 真实管线复验时发现两处 schema 缺口，当时手工 ALTER 修掉：
--   1. content_pipelines.publish_mode —— TypeORM 实体有此列，prod synchronize 关闭时缺列
--      （0015 已建列，但 DEFAULT 'publish' 与实体期望的 'manual' 不一致，此处修正默认值）
--   2. content_publications.account_code / account_type —— pipeline.service 写入时引用，
--      表缺列导致 Unknown column 'account_code'（0018 已建列，但 account_type 为 varchar(16)，
--      实际需要 varchar(32)；此处对齐）
--
-- 适用：dev / prod 都手跑一遍。幂等：逐列判断 information_schema，已存在则跳过。
-- 本地库已手工加过列，本脚本在本地跑会识别「已存在跳过」。

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
-- 已存在但长度不够时 MODIFY，不存在时 ADD。
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_publications' AND COLUMN_NAME = 'account_type'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_publications`
     ADD COLUMN `account_type` varchar(32) DEFAULT NULL COMMENT '发布时账号主体类型快照 personal | enterprise'",
  "SELECT 'content_publications.account_type already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
