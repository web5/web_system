-- 0028_users_wecom_identity.sql
-- 统一外部身份层（卡①）：users 增加企业微信 userid 与微信开放平台 unionid。
-- 对应实体：packages/shared/src/entities/user.entity.ts 的 User.wecomUserid / User.unionid。
-- 需求真源：docs/development/wecom-approval-identity-contract.md
--          （原始 spec：30-任务产物/2026-11-04-console企微端手动审批/01-需求spec与技术方案.md §5.3）
--
-- 🔴 适用范围：**仅 `web_system` 业务主库**（content-hub / user-service 的 DB_DATABASE 默认值）。
--   dev / prod 主库各手工执行一次。
--   ❌ 禁止在 `web_system_deploy` / `web_system_deploy_shadow` 执行：这两库是发布平台库与影子库，
--      2026-11-05 已定性为整库复制遗留（见 PR #539 诊断），跑本脚本会重新制造 schema 分叉。
--   执行前自检：SELECT DATABASE();  -- 必须返回 web_system
--   ⚠️ 幂等 ≠ 在任何库上都是 no-op：列不存在会 ADD。
--
-- 🔴 为什么必须手工执行：生产 `NODE_ENV=production` → synchronize=false，实体加了列线上不会自动建；
--    本机 development synchronize=true，若只改实体不写本迁移，会被按实体元数据反向 DROP 抖动。
--    加列顺序：先执行本迁移，再登记实体；发布顺序：迁移先于服务重启。
--
-- 索引具名原因：TypeORM synchronize 以实体元数据为准，匿名 `@Index()` 生成哈希名 IDX_xxx，
--    与手工 DDL 建的索引名不一致会反复 DROP/BUILD。实体已用同名 `@Index('idx_users_*')`。
--
-- 幂等：逐列/逐索引判断 information_schema，已存在则跳过；可重复执行。

SET @db = DATABASE();

-- ── users.wecom_userid ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'wecom_userid'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `users` ADD COLUMN `wecom_userid` varchar(64) DEFAULT NULL COMMENT '企业微信成员 userid'",
  "SELECT 'users.wecom_userid already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_wecom_userid'
);
SET @sql = IF(
  @idx = 0,
  "ALTER TABLE `users` ADD INDEX `idx_users_wecom_userid` (`wecom_userid`)",
  "SELECT 'idx_users_wecom_userid already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── users.unionid ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'unionid'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `users` ADD COLUMN `unionid` varchar(64) DEFAULT NULL COMMENT '微信开放平台 unionid'",
  "SELECT 'users.unionid already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_unionid'
);
SET @sql = IF(
  @idx = 0,
  "ALTER TABLE `users` ADD INDEX `idx_users_unionid` (`unionid`)",
  "SELECT 'idx_users_unionid already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 验收（手工执行后各跑一次，两列与两索引都要在）：
-- SHOW COLUMNS FROM users LIKE 'wecom_userid';
-- SHOW COLUMNS FROM users LIKE 'unionid';
-- SHOW INDEX FROM users WHERE Key_name IN ('idx_users_wecom_userid','idx_users_unionid');
