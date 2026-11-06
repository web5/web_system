-- 0030_deploy_approvals_wecom_session.sql
-- 企微通道「票据换平台会话」（SSO 打通）：deploy_approvals 增加 wecom_session_issued_at。
-- 对应实体：servers/deploy-console/src/entities/deploy-approval.entity.ts
-- 需求来源：30-任务产物/2026-11-05-console企微审批开工/12-S3自动化验收与登录打通诊断.md §4.3 方案 C
--
-- 🔴🔴 适用范围：**仅 deploy-console 自己的 MYSQL_DB 所指库（发布平台库）**。
--   ❌ 不要在 web_system 业务主库执行（0028 才是主库脚本）。
--   ❌ 不要在 shadow / 备份库执行。
--   执行前自检：SELECT DATABASE();
--                SHOW TABLES LIKE 'deploy_approvals';  -- 必须有一行
--   dev / prod 各手工执行一次（本功能仅在 dev 联调开关下有行为，prod 未开通道时可先不建列）。
--
-- 🔴 为什么手工执行：生产 NODE_ENV=production → synchronize=false，实体会加列但库不会。
--    发布顺序：**迁移先于服务重启**；否则新代码 SELECT 该列会直接报 Unknown column。
--
-- 语义：非空 = 该审批单的平台会话已发出过一次。一次性靠
--   UPDATE ... WHERE wecom_session_issued_at IS NULL 的 affectedRows 判定，不靠先查后写。
--
-- 幂等：先判 information_schema，已存在则跳过；可重复执行。
-- 历史行：NULL（= 从未换过会话），向后兼容。

SET @db = DATABASE();

-- ── deploy_approvals.wecom_session_issued_at ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
    AND COLUMN_NAME = 'wecom_session_issued_at'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `deploy_approvals` ADD COLUMN `wecom_session_issued_at` bigint NULL COMMENT '企微换平台会话时间（毫秒，一次性）'",
  "SELECT 'deploy_approvals.wecom_session_issued_at already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 校验：应输出 1 行
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'deploy_approvals'
  AND COLUMN_NAME = 'wecom_session_issued_at';
