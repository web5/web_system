-- 0020 · content_pipelines 增加公众号封面素材 media_id
--
-- 背景（issue-5）：日报成文是纯文本无图，发布器取不到正文首图 → 兜底到内置
-- 「大橙子社区通用封面」（图上写「AI 资讯日报」），论文管线也用这张，主题不符。
-- 按管线配 cover_media_id 后，发布时作为显式 thumb_media_id 传给发布器（优先级最高）。
-- 留空 = 维持现有兜底行为。
--
-- 🔴 dev 与 prod 都必须手跑！dev 机 content-hub 的 .env 里 NODE_ENV=production，
-- synchronize 同样关闭（2026-10-26 实测：漏跑迁移 → Unknown column → runtime 激活失败回滚）。
-- 重复执行安全（先判列是否存在）。0015 注释里「dev 由 synchronize 自动加列」已过时，勿信。

SET @db = DATABASE();
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'content_pipelines'
    AND COLUMN_NAME = 'cover_media_id'
);

SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_pipelines` ADD COLUMN `cover_media_id` varchar(128) NULL DEFAULT NULL COMMENT '公众号封面素材 media_id，留空用默认通用封面' AFTER `tencent_folder`",
  "SELECT 'cover_media_id already exists' AS skipped"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
