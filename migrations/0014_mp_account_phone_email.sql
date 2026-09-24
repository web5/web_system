-- @database web_system
-- 小程序账号能力：绑定手机号 / 邮箱 + 账号合并（需求与方案见 specs/kedou-ai-minigram/）
--
-- 前置检查（加唯一索引前必须跑，dev/prod 各跑一次）：
--   SELECT phone, COUNT(*) c, GROUP_CONCAT(id) FROM users
--   WHERE phone IS NOT NULL AND phone<>'' GROUP BY phone HAVING c>1;
-- 有重复或非法格式要先清理，否则本文件的唯一索引会失败。

-- 1) 手机号唯一：号码即账号打通的身份键
ALTER TABLE `users` ADD UNIQUE KEY `uk_users_phone` (`phone`);

-- 2) 合并留痕：被合并（弃用）的账号指向合并后的目标账号
--    （Q15 = c 合并账号；规则见 specs/kedou-ai-minigram/design-mp-account.md §5.7.2）
ALTER TABLE `users`
  ADD COLUMN `merged_to` bigint unsigned DEFAULT NULL COMMENT '合并到的目标账号 id（非空表示该账号已被合并弃用）'
  AFTER `status`;

-- 3) 邮箱验证码：绑定邮箱用（R3）。
--    形制与 mcp_key_codes 一致，但独立成表：用途、限频与归属都不同。
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邮箱验证码';
