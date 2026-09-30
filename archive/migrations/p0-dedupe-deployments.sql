-- ===========================================================
-- P0-1: deploy_deployments 去重 + 唯一约束
-- 目标：每个 (env_id, module_key) 只保留一条当前版本指针
-- 安全：删除前备份被删行到 deploy_deployments_dedup_backup（可回滚）
-- 说明：备份用 ROW_NUMBER 窗口函数精确识别「每组非最新」的行，避免 JOIN 笛卡尔积
-- ===========================================================

-- 1) 备份被删除的重复行（每组按 deployed_at DESC, id ASC 排序，rn>1 即非最新）
DROP TABLE IF EXISTS deploy_deployments_dedup_backup;
CREATE TABLE deploy_deployments_dedup_backup AS
SELECT id, env_id, module_key, current_version, status, deployed_at, deployed_by, task_id, created_at, updated_at
FROM (
  SELECT *,
         ROW_NUMBER() OVER (PARTITION BY env_id, module_key ORDER BY deployed_at DESC, id ASC) AS rn
  FROM deploy_deployments
) t
WHERE rn > 1;

-- 2) 删除重复行（保留每组 deployed_at 最新一条）
DELETE t1
FROM deploy_deployments t1
JOIN (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY env_id, module_key ORDER BY deployed_at DESC, id ASC) AS rn
  FROM deploy_deployments
) t2 ON t1.id = t2.id
WHERE t2.rn > 1;

-- 3) 加唯一约束
ALTER TABLE deploy_deployments ADD UNIQUE KEY uk_env_module (env_id, module_key);
