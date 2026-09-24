-- =============================================================================
-- 0014_deploy_host_scope.sql —— 主机管理新增「形态 scope」与「归属控制台 managed_by」
--
-- 背景（2026-09-24，见 docs/development/console-monitor-followups.md）：
--   1) 监控页的可管环境必须以「基础设施 → 主机管理」为真相源：主机可以是真实云服务器、
--      也可以是容器服务器 → 用 scope 表达形态（local / cloud / container）。
--   2) `local-default`（127.0.0.1，编排者本机）在 dev 控制台上会出现且必然取数失败
--      （它 SSH 127.0.0.1 用的是 geekwen 用户，dev 机上不存在）→ 用 managed_by 表达
--      「这台主机归哪份控制台管」：NULL = 所有控制台可见，非 NULL = 仅该实例可见。
--
-- 目标库：web_system_deploy（deploy-console / gateway 发布库）
-- 命名：deploy-console 用 SnakeNamingStrategy，物理列一律 snake_case。
--
-- 幂等性：MySQL 无 ADD COLUMN IF NOT EXISTS，先查 information_schema 再 PREPARE 执行；
--         UPDATE 回填本身幂等（重复执行结果一致）。
-- 执行： mysql -h <host> -u <user> -p web_system_deploy < migrations/0014_deploy_host_scope.sql
-- 注意：**本机库（编排者）与 dev/prod 云库都要应用**；执行前先备份 deploy_hosts。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1) deploy_hosts 增加 scope 列（local / cloud / container，默认 cloud）
-- -----------------------------------------------------------------------------
SET @db := DATABASE();
SET @has_scope := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_hosts' AND COLUMN_NAME = 'scope'
);
SET @ddl := IF(@has_scope = 0,
  'ALTER TABLE `deploy_hosts` ADD COLUMN `scope` varchar(16) NOT NULL DEFAULT ''cloud'' COMMENT ''主机形态：local=本机形态 / cloud=云服务器 / container=容器服务器''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2) deploy_hosts 增加 managed_by 列（NULL = 所有控制台可见）
-- -----------------------------------------------------------------------------
SET @has_managed_by := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_hosts' AND COLUMN_NAME = 'managed_by'
);
SET @ddl := IF(@has_managed_by = 0,
  'ALTER TABLE `deploy_hosts` ADD COLUMN `managed_by` varchar(64) DEFAULT NULL COMMENT ''归属控制台实例（CONSOLE_INSTANCE）；NULL=所有控制台可见''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(@has_managed_by = 0,
  'ALTER TABLE `deploy_hosts` ADD KEY `idx_host_managed_by` (`managed_by`)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 3) 回填现有三行
--    · local-default（127.0.0.1）→ scope=local，只归编排者本机控制台（orchestrator）
--    · dev-default / prod-default → scope=cloud，所有控制台可见（managed_by = NULL）
-- -----------------------------------------------------------------------------
UPDATE `deploy_hosts`
   SET `scope` = 'local', `managed_by` = 'orchestrator'
 WHERE `name` = 'local-default';

UPDATE `deploy_hosts`
   SET `scope` = 'cloud'
 WHERE `name` IN ('dev-default', 'prod-default');

-- 兜底：其余历史行（如将来迁移遗留）默认 cloud，不动 managed_by
UPDATE `deploy_hosts`
   SET `scope` = 'cloud'
 WHERE `scope` IS NULL OR `scope` = '';

SET FOREIGN_KEY_CHECKS = 1;
