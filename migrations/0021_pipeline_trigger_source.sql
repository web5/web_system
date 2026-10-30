-- @database web_system_deploy
-- 0021：流水线触发来源落库（2026-10-27 防再犯 · S1）
--
-- 背景：两轮非预期 PROD 批量发布经 MCP Key 通道提交 + 自动审批触发，
--   operator=1 无法区分「谁的会话/哪把 Key/哪个脚本」。
--   见 docs/development/reports/2026-10-27-PROD发布触发源归因-批量MCP脚本.md
-- deploy_pipeline_runs 新增 trigger_source VARCHAR(128) 列：
--   `ui` / `ui:page-releases` / `mcp:ai-ops-automation` / `web|sess-1|mcp:key` / `ci:release.yml`
--   NULL = 历史数据（列加入前的运行记录）
--
-- ⚠️ 三库口径（2026-10-27 勘误：原「双库」遗漏 dev 机本机库）——凡是存在
--   deploy_pipeline_runs 表的库都要执行本脚本：
--   ① dev 机本机 MySQL（127.0.0.1 web_system_deploy）— 执行真相库；
--      synchronize=true 时启动会自动加列，本脚本幂等、重复执行无害
--   ② 云端 MySQL（DEPLOY_CLOUD_DB_*，键名 …_NAME）— synchronize=false，**必须手动跑**
--   ③ Mac 本机 MySQL（~/env_config/web_system/local-mysql.env）— local console 用，按需
--
-- 执行方式（每个库各跑一次）：
--   mysql -h<host> -u<user> -p <database> < migrations/0021_pipeline_trigger_source.sql
--
-- 幂等性：MySQL 无 ADD COLUMN IF NOT EXISTS。先查 information_schema 再 PREPARE 执行
--   （与 0010_pipeline_task_states.sql 同一模式；裸 ALTER 在已建列的环境会 ERROR 1060
--    并中止整个文件 → 记账写不进去 → 每次执行都红）。

SET @db := DATABASE();
SET @has_trigger_source := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_pipeline_runs' AND COLUMN_NAME = 'trigger_source'
);
SET @ddl := IF(@has_trigger_source = 0,
  'ALTER TABLE `deploy_pipeline_runs` ADD COLUMN `trigger_source` varchar(128) NULL COMMENT ''触发来源 ui/mcp:<keyName>/ci:<source>'' AFTER `operator`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 逆操作（需回滚时，先 dump 备份）：
--   mysqldump <凭据> <database> deploy_pipeline_runs > /tmp/runs.bak.sql
--   ALTER TABLE `deploy_pipeline_runs` DROP COLUMN `trigger_source`;
