-- @database web_system_deploy
-- 0010：流水线任务级执行状态落库（specs/pipeline-task-status/design.md §1）
-- 适用：synchronize 关闭的环境（prod）。本地/dev 由 TypeORM synchronize 自动建列。
-- deploy_pipeline_runs 新增 task_states JSON 列：
--   key   = `${step.id}/${task.id}`（orchestration 快照内稳定标识）
--   value = running | succeeded | failed | skipped | awaiting | cancelled
--   null  = 未记录（改动前的实例 / 旧链路实例）

-- 幂等性：MySQL 无 ADD COLUMN IF NOT EXISTS。原写法是裸 ALTER，已建过列的环境（
--   synchronize: true 无环境判定，deploy-console 启动即自动加列）会 ERROR 1060 并中止整个
--   文件 → 记账写不进去 → 每次执行都红。改为先查 information_schema 再 PREPARE 执行。
SET @db := DATABASE();
SET @has_task_states := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_pipeline_runs' AND COLUMN_NAME = 'task_states'
);
SET @ddl := IF(@has_task_states = 0,
  'ALTER TABLE `deploy_pipeline_runs` ADD COLUMN `task_states` json NULL COMMENT ''任务级执行状态（key=stepId/taskId；null=未记录）''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 逆操作（需回滚时，先 dump 备份）：ALTER TABLE `deploy_pipeline_runs` DROP COLUMN `task_states`;
