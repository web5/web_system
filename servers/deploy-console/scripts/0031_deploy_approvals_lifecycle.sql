-- 0031_deploy_approvals_lifecycle.sql
-- 审批单鉴权时效收口（2026-11-06）：deploy_approvals 增加 wecom_session_count / expires_at。
-- 对应实体：servers/deploy-console/src/entities/deploy-approval.entity.ts
-- 设计契约：specs/deploy-console/tech-design-wecom-approval-lifecycle.md
-- 需求来源：30-任务产物/2026-11-05-console企微审批开工/14-票据兑换整合进审批流-技术产品方案.md §十一
--
-- 🔴🔴 适用范围：**仅 deploy-console 自己的 MYSQL_DB 所指库（发布平台库）**。
--   ❌ 不要在 web_system 业务主库执行（0028 才是主库脚本）。
--   ❌ 不要在 shadow / 备份库执行。
--   执行前自检：SELECT DATABASE();
--                SHOW TABLES LIKE 'deploy_approvals';  -- 必须有一行
--
-- 🔴 为什么手工执行：生产 NODE_ENV=production → synchronize=false，实体会加列但库不会。
--    发布顺序：**迁移先于服务重启**；否则新代码 SELECT 该列会直接报 Unknown column。
--
-- 两列各自的作用：
--   1) wecom_session_count：企微「票据换平台会话」从**一次性**放开为 **≤3 次**。
--      拦滥用靠 DB 原子更新 `WHERE wecom_session_count < 3`，不靠先查后写。
--      历史已换过会话的单必须回填成 1，否则上线瞬间它们白捡 3 次。
--   2) expires_at：审批单超时作废时刻（毫秒）。**不回填历史行** ——
--      回填会把一批在途 pending 单在上线瞬间按「已过期」清掉。
--      NULL = 不过期，定时扫描（ApprovalExpiryService）不会选中它。
--
-- 幂等：先判 information_schema，已存在则跳过；可重复执行。

SET @db = DATABASE();

-- ── 1. deploy_approvals.wecom_session_count ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
    AND COLUMN_NAME = 'wecom_session_count'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `wecom_session_count` int NOT NULL DEFAULT 0 COMMENT '企微换平台会话已用次数（上限 3）'",
  "SELECT 'deploy_approvals.wecom_session_count already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 回填：已换过会话的历史单算 1 次（不是 0 次），避免上线白捡配额。
-- 幂等：只补 count=0 且有 issued_at 的行；重复执行影响 0 行。
UPDATE `deploy_approvals`
   SET `wecom_session_count` = 1
 WHERE `wecom_session_issued_at` IS NOT NULL
   AND `wecom_session_count` = 0;

-- ── 2. deploy_approvals.expires_at ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
    AND COLUMN_NAME = 'expires_at'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `expires_at` bigint NULL COMMENT '审批单超时作废时刻（毫秒；NULL=不过期）'",
  "SELECT 'deploy_approvals.expires_at already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 🔴 刻意不回填 expires_at。
--    历史单保持 NULL = 不过期，行为与升级前完全一致；
--    需要清理的历史孤单走既有「作废」入口（ApprovalService.cancel，含原因与审计）。

-- ── 3. 索引：扫描条件 status='pending' AND expires_at <= now ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
    AND INDEX_NAME = 'IDX_deploy_approvals_expires_at'
);
SET @sql = IF(
  @exists = 0,
  "CREATE INDEX `IDX_deploy_approvals_expires_at` ON `deploy_approvals` (`expires_at`)",
  "SELECT 'IDX_deploy_approvals_expires_at already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 校验：应输出 2 行
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
  AND COLUMN_NAME IN ('wecom_session_count', 'expires_at')
ORDER BY COLUMN_NAME;

-- 校验：已换过会话的单不应有 count=0（应为 0 行）
SELECT COUNT(*) AS bad_rows
FROM `deploy_approvals`
WHERE `wecom_session_issued_at` IS NOT NULL AND `wecom_session_count` = 0;
