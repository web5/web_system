-- @database web_system_deploy
-- =============================================================================
-- 0009_pipeline_vars_and_template_env.sql —— 流水线变量表 + 流水线归属环境
--
-- 背景：发布平台「流水线节点模型」P0 之后的收尾改动（2026-09-15）：
--   1) 变量改为**跟着流水线走**（不再复用配置中心 config_items）→ 新增 deploy_pipeline_vars
--   2) 一个模块默认 3 条流水线（local / dev / prod）→ deploy_pipeline_templates 增加 env 列
--
-- 目标库：web_system_deploy（deploy-console / gateway 发布库）
-- 命名：deploy-console 使用 SnakeNamingStrategy（`app.module.ts`），
--       故物理列一律 snake_case（pipeline_id / is_secret / created_at …）。
--
-- 适用：NODE_ENV=production（TypeORM synchronize 关闭）的环境必须手动执行；
--       开发/测试库若开了 synchronize 会在启动时自动建，本文件可重复执行（幂等）。
--
-- 幂等性：CREATE TABLE 用 IF NOT EXISTS；加列/加索引先查 information_schema 再 PREPARE
--         执行（MySQL 没有 ADD COLUMN IF NOT EXISTS），重复执行不会报错。
-- 执行： mysql -h <host> -u <user> -p web_system_deploy < migrations/0009_pipeline_vars_and_template_env.sql
-- 注意：执行前先备份（或至少在从库演练）。deploy_pipeline_templates 通常几十行，加列秒级完成。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1) deploy_pipeline_vars —— 流水线变量（属于某条流水线）
--    注入优先级：内置 → 配置中心 → 流水线变量 → 节点内联；脚本用 ${KEY} 引用
--    唯一约束 (pipeline_id, key)：同一条流水线不能有重名变量
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `deploy_pipeline_vars` (
  `id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '变量 ID（pvar-<ts>-<rand>）',
  `pipeline_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属流水线 ID',
  `key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '变量键',
  `value` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '变量值（密钥存明文，对外掩码）',
  `is_secret` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否密钥（列表不回显明文）',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '说明',
  `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用（停用后不注入）',
  `updated_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '更新人',
  `created_at` bigint NOT NULL COMMENT '创建时间（毫秒）',
  `updated_at` bigint NOT NULL COMMENT '更新时间（毫秒）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pipeline_var` (`pipeline_id`, `key`),
  KEY `idx_var_pipeline` (`pipeline_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流水线变量（属于某条流水线）';

-- -----------------------------------------------------------------------------
-- 2) deploy_pipeline_templates 增加 env 列（幂等）
--    null = 全局模板/不限环境；非 null = 该流水线归属某环境（local / dev / prod …）
-- -----------------------------------------------------------------------------
SET @db := DATABASE();
-- ⚠️ 改名事实：deploy_pipeline_templates 已由 scripts/migrations/p9-rename-pipeline-tables.mjs
--    RENAME 成 deploy_pipelines（2026-09-17，晚于本文件）。若硬写旧表名会 ERROR 1146，
--    mysql 批量模式遇错即中止 → 记账写不进去 → **每次执行都红且永不自愈**。
--    故此处按「新名优先」动态选存在的那张表；两张都不在则整段降级为 SELECT 1（幂等通过）。
SET @tpl_table := (
  SELECT TABLE_NAME FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db
     AND TABLE_NAME IN ('deploy_pipelines', 'deploy_pipeline_templates')
   ORDER BY FIELD(TABLE_NAME, 'deploy_pipelines', 'deploy_pipeline_templates') LIMIT 1
);
SET @has_env := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tpl_table AND COLUMN_NAME = 'env'
);
SET @ddl := IF(@tpl_table IS NULL OR @has_env > 0, 'SELECT 1',
  CONCAT('ALTER TABLE `', @tpl_table, '` ADD COLUMN `env` varchar(16) DEFAULT NULL COMMENT ''归属环境（null=全局模板，不限环境）'''));
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_env_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = @tpl_table AND INDEX_NAME = 'idx_tpl_env'
);
SET @ddl := IF(@tpl_table IS NULL OR @has_env_idx > 0, 'SELECT 1',
  CONCAT('ALTER TABLE `', @tpl_table, '` ADD KEY `idx_tpl_env` (`env`)'));
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 存量数据：既有模板 env 一律为 NULL（= 不限环境），这是安全的默认，
-- 不会改变它们原先"任何环境都能用"的行为。需要按模块拆三条时，在页面上新建即可。
-- 如需批量回填（示例：按名称里的环境关键字推断），确认后再执行：
-- UPDATE `deploy_pipeline_templates`
--    SET `env` = CASE
--      WHEN `name` LIKE '%prod%' OR `name` LIKE '%生产%' THEN 'prod'
--      WHEN `name` LIKE '%dev%'  OR `name` LIKE '%测试%' THEN 'dev'
--      WHEN `name` LIKE '%local%' OR `name` LIKE '%本地%' THEN 'local'
--      ELSE NULL END
--  WHERE `env` IS NULL;

-- -----------------------------------------------------------------------------
-- 3) 【可选】发布脚本去掉写死的默认值（配合"改变量要生效"）
--    背景：库里的 publish 脚本有 `PUBLISH_HOST="${PUBLISH_HOST:-175.27.189.123}"`
--          这类兜底默认值 —— 变量没配时脚本仍能跑，但改变量不会生效（历史坑）。
--    做法：兜底改成必填变量（缺变量即失败），并把原值搬进 deploy_pipeline_vars。
--    ⚠️ 生产 IP/路径与开发不同，**替换值与变量值都要按目标环境确认后再执行**。
-- -----------------------------------------------------------------------------
-- UPDATE `deploy_pipeline_step_commands`
--    SET `command` = REPLACE(`command`,
--      'PUBLISH_HOST="${PUBLISH_HOST:-175.27.189.123}"',
--      'PUBLISH_HOST="${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST}"')
--  WHERE `command` LIKE '%PUBLISH_HOST%';
--
-- UPDATE `deploy_pipeline_step_commands`
--    SET `command` = REPLACE(`command`,
--      'PUBLISH_PATH="${PUBLISH_PATH:-/data/web_system/servers/gateway/public/static/modules/admin}"',
--      'PUBLISH_PATH="${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"')
--  WHERE `command` LIKE '%PUBLISH_PATH%';
--
-- INSERT INTO `deploy_pipeline_vars`
--   (`id`,`pipeline_id`,`key`,`value`,`is_secret`,`description`,`enabled`,`updated_by`,`created_at`,`updated_at`)
-- VALUES
--   (CONCAT('pvar-', UNIX_TIMESTAMP(), '-', SUBSTRING(MD5(RAND()) FROM 1 FOR 6)),
--    '<template_id>', 'PUBLISH_HOST', '<目标机 IP>', 0, '发布目标机', 1, 'migration',
--    UNIX_TIMESTAMP()*1000, UNIX_TIMESTAMP()*1000);

-- -----------------------------------------------------------------------------
-- 4) 回滚（出问题时）
--    DROP TABLE IF EXISTS `deploy_pipeline_vars`;
--    ALTER TABLE `deploy_pipeline_templates` DROP INDEX `idx_tpl_env`;
--    ALTER TABLE `deploy_pipeline_templates` DROP COLUMN `env`;
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 1;
