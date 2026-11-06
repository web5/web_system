-- 0029_deploy_approvals_wecom_channel.sql
-- console 企微审批通道（卡②）：deploy_approvals 增加 channel / identity_external_id / source_ip。
-- 对应实体：servers/deploy-console/src/entities/deploy-approval.entity.ts
-- 契约真源：docs/development/wecom-approval-channel-contract.md §六
-- 需求真源：30-任务产物/2026-11-04-console企微端手动审批/01-需求spec与技术方案.md §5.3.2
--
-- 🔴🔴 适用范围：**仅 deploy-console 自己的 MYSQL_DB 所指库（发布平台库）**。
--   ❌ 绝对不要在 `web_system` 业务主库执行 —— 0028（users 加列）才是主库脚本，
--      两者库不同、实体不同、服务不同，混跑会制造 schema 分叉。
--   ❌ 也不要在 shadow / 备份库执行。
--   执行前自检：SELECT DATABASE();  且与 deploy-console 的 MYSQL_DB 一致
--                SHOW TABLES LIKE 'deploy_approvals';  -- 必须有一行
--   dev / prod 各手工执行一次。
--
-- 🔴 为什么必须手工执行：生产 NODE_ENV=production → synchronize=false，
--    实体加了列线上不会自动建；本机 development synchronize=true，
--    若只改实体不写本迁移，会被按实体元数据反向 DROP 抖动。
--    发布顺序：迁移先于服务重启。
--
-- 幂等：逐列判断 information_schema，已存在则跳过；可重复执行。
-- 历史行：channel 由 DEFAULT 'console' 回填，另两列 NULL（向后兼容）。

SET @db = DATABASE();

-- 保险丝：本库若无 deploy_approvals 表，下面的 ALTER 会直接报错并终止整个脚本。
-- 看到 "Table 'xxx.deploy_approvals' doesn't exist" 请立即停止，说明跑错库了。

-- ── deploy_approvals.channel ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals' AND COLUMN_NAME = 'channel'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `channel` varchar(16) NOT NULL DEFAULT 'console' COMMENT '审批来源通道 console/mcp/wecom'",
  "SELECT 'deploy_approvals.channel already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── deploy_approvals.identity_external_id ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals' AND COLUMN_NAME = 'identity_external_id'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `identity_external_id` varchar(64) DEFAULT NULL COMMENT '审批人外部身份 ID（企微 userid）'",
  "SELECT 'deploy_approvals.identity_external_id already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── deploy_approvals.source_ip ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals' AND COLUMN_NAME = 'source_ip'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `source_ip` varchar(64) DEFAULT NULL COMMENT '审批来源 IP'",
  "SELECT 'deploy_approvals.source_ip already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 验收（手工执行后跑一次）：
-- SHOW COLUMNS FROM deploy_approvals LIKE 'channel';
-- SHOW COLUMNS FROM deploy_approvals LIKE 'identity_external_id';
-- SHOW COLUMNS FROM deploy_approvals LIKE 'source_ip';
-- SELECT channel, COUNT(*) FROM deploy_approvals GROUP BY channel;  -- 历史行应为 console
