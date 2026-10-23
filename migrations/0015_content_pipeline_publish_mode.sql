-- 0015 · content_pipelines 增加发布模式（draft | publish）
--
-- 背景：公众号资质不足（未认证个人号 → 48001）时，「建草稿 + freepublish」必然失败，
-- 定时管线每天产出 drafted 记录，看着像故障。把「只进草稿箱」做成管线的合法配置后，
-- 草稿是预期结果而不是失败降级。
--
-- 适用：prod（NODE_ENV=production，TypeORM synchronize 关闭，必须手跑）。
-- dev 由 synchronize 自动加列，重复执行本脚本也安全（先判列是否存在）。

SET @db = DATABASE();
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'content_pipelines'
    AND COLUMN_NAME = 'publish_mode'
);

SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_pipelines` ADD COLUMN `publish_mode` varchar(16) NOT NULL DEFAULT 'publish' COMMENT '发布模式 publish | draft'",
  "SELECT 'publish_mode already exists' AS skipped"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
