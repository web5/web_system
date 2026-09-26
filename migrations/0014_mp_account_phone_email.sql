-- @database web_system
-- 小程序账号能力：绑定手机号 / 邮箱 + 账号合并（需求与方案见 specs/kedou-ai-minigram/）
--
-- ⚠️ 执行通道（2026-09-26 评审 F1）：只允许经 scripts/apply-migrations.sh 执行，
--    禁止手工 `mysql < file` / `source`。原因：本文件的守卫用 `SET @db := DATABASE()` 取
--    「会话当前库」，手工执行若连到别的库，守卫会全部降级成 SELECT 1、表却建在错误库，
--    且记账照写、退出码 0 —— 零报错的假成功。走脚本时目标库由首行注解决定（migration_db()
--    解析，注解优先），恒为 web_system。
--
-- 前置检查（加唯一索引前必须跑，dev/prod 各跑一次）：
--   SELECT phone, COUNT(*) c, GROUP_CONCAT(id) FROM users
--   WHERE phone IS NOT NULL AND phone<>'' GROUP BY phone HAVING c>1;
-- 有重复或非法格式要先清理，否则本文件的唯一索引会失败（ERROR 1062，响亮失败、不记账）。
--
-- 幂等性（2026-09-26 改造）：MySQL 无 ADD UNIQUE KEY IF NOT EXISTS / ADD COLUMN IF NOT EXISTS。
-- 原写法是裸 ALTER，已执行过的环境会 ERROR 1061（Duplicate key）/ 1060（Duplicate column）
-- 并中止整个文件 → 记账写不进去 → 每次执行都红。改为先查 information_schema 再 PREPARE 执行。
-- 与 0009 / 0010 属同类坑（第三例），新增迁移请照此写。
--
-- 版本要求：PREPARE 执行 ALTER TABLE 需 MySQL 8.x（dev 8.0.30 / 本机 8.4 实测通过）。
-- 不做 5.7 兼容——若确需 5.7，须改用别的幂等写法（去掉 PREPARE），勿只去掉 COLLATE 了事。

SET @db := DATABASE();

-- 1) 手机号唯一：号码即账号打通的身份键
--    不守卫 users 表是否存在：表缺失时 ALTER 会以 ERROR 1146 响亮失败且不记账，
--    好过「降级 SELECT 1 却照常记账」——后者会让脚本此后永久跳过本文件，
--    缺失要到运行时才以 Unknown column 'merged_to'（1054）爆出来。
SET @has_uk_phone := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND INDEX_NAME = 'uk_users_phone'
);
SET @ddl := IF(@has_uk_phone = 0,
  'ALTER TABLE `users` ADD UNIQUE KEY `uk_users_phone` (`phone`)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 合并留痕：被合并（弃用）的账号指向合并后的目标账号
--    （Q15 = c 合并账号；规则见 specs/kedou-ai-minigram/design-mp-account.md §5.7.2）
--    ⚠️ merged_to 目前不在任何实体里（auth-service 用裸 SQL 读写），故任何
--    synchronize=true（NODE_ENV != production）的实例连到本库会把该列反向 DROP 掉。
SET @has_merged_to := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'merged_to'
);
SET @ddl := IF(@has_merged_to = 0,
  'ALTER TABLE `users` ADD COLUMN `merged_to` bigint unsigned DEFAULT NULL COMMENT ''合并到的目标账号 id（非空表示该账号已被合并弃用）'' AFTER `status`',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 邮箱验证码：绑定邮箱用（R3）。
--    形制与 mcp_key_codes 一致，但独立成表：用途、限频与归属都不同。
--    建表本身幂等（CREATE TABLE IF NOT EXISTS）。
--    不显式写 COLLATE（项目规则 8.3：DDL 不指定 COLLATE，避免 5.7 不认 0900）。
--    事实口径：不写 COLLATE 时取**字符集**的默认排序规则（MySQL 8 恒为 utf8mb4_0900_ai_ci，
--    受 default_collation_for_utf8mb4 影响），不是「库的默认排序规则」——两者别混淆。
--    存量事实：users 表是 utf8mb4_unicode_ci，与本表不同；当前无跨表 JOIN/等值比较故不报错，
--    日后若写 `JOIN ... ON users.email = evc.email` 会触发 1267 Illegal mix of collations。
CREATE TABLE IF NOT EXISTS `email_verification_codes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(100) NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL COMMENT '申请人；未登录为 NULL',
  `code_hash` char(64) NOT NULL COMMENT '验证码 SHA-256，不存明文',
  `purpose` varchar(20) NOT NULL DEFAULT 'bind' COMMENT 'bind / change',
  `expires_at` datetime NOT NULL,
  `attempts` tinyint unsigned NOT NULL DEFAULT 0 COMMENT '已校验次数',
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email_verification_codes_email` (`email`),
  KEY `idx_email_verification_codes_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='邮箱验证码';

-- 逆操作（需回滚时先 dump 备份）：
--   ALTER TABLE `users` DROP INDEX `uk_users_phone`;
--   ALTER TABLE `users` DROP COLUMN `merged_to`;
--   DROP TABLE IF EXISTS `email_verification_codes`;
--   DELETE FROM schema_migrations WHERE name='0014_mp_account_phone_email.sql';  -- 让它可被重跑
