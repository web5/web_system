-- 0010：流水线任务级执行状态落库（specs/pipeline-task-status/design.md §1）
-- 适用：synchronize 关闭的环境（prod）。本地/dev 由 TypeORM synchronize 自动建列。
-- deploy_pipeline_runs 新增 task_states JSON 列：
--   key   = `${step.id}/${task.id}`（orchestration 快照内稳定标识）
--   value = running | succeeded | failed | skipped | awaiting | cancelled
--   null  = 未记录（改动前的实例 / 旧链路实例）

ALTER TABLE deploy_pipeline_runs
  ADD COLUMN task_states json NULL COMMENT '任务级执行状态（key=stepId/taskId；null=未记录）';
