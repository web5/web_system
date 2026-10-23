-- 0016 · 自媒体三方平台账号登记表 content_accounts
--
-- 背景：公众号等平台的凭据此前散落在环境变量里（prod 的 AppSecret 曾被 pm2 env 完整打出），
-- 既无账号维度的可见性，也无法"一平台多号"。本表把账号收成**注册表**：
-- 凭据以 AES-256-GCM 密文入库（credentials_enc），对外只给掩码（credentials_mask），
-- 解密钥由 ACCOUNT_CRED_KEY_FILE 指向的 0600 文件提供，不进环境变量。
--
-- 适用：dev / prod 都手跑一遍（NODE_ENV=production 时 TypeORM synchronize 关闭）。
-- 幂等：先判表是否存在，存在则跳过建表。

SET @db = DATABASE();
SET @exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_accounts'
);

SET @sql = IF(
  @exists = 0,
  "CREATE TABLE `content_accounts` (
     `id` bigint NOT NULL AUTO_INCREMENT,
     `platform` varchar(32) NOT NULL COMMENT '平台标识 wechat_mp',
     `code` varchar(64) NOT NULL COMMENT '账号编码（同平台内唯一）',
     `name` varchar(128) NOT NULL COMMENT '显示名',
     `identity` varchar(255) DEFAULT NULL COMMENT '平台侧主体标识（检测后回填）',
     `credentials_enc` text COMMENT '凭据密文 AES-256-GCM（base64：iv+tag+ct）',
     `credentials_mask` varchar(64) DEFAULT NULL COMMENT '凭据掩码（列表展示）',
     `capabilities` json DEFAULT NULL COMMENT '账号能力清单（检测后回填）',
     `last_checked_at` datetime(6) DEFAULT NULL COMMENT '最近一次连通性检测时间',
     `last_check_status` varchar(16) DEFAULT NULL COMMENT '检测结果 ok | warn | err',
     `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
     `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
     `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
     `deleted_at` datetime(6) DEFAULT NULL COMMENT '软删除时间',
     PRIMARY KEY (`id`),
     UNIQUE KEY `uk_content_accounts_platform_code` (`platform`, `code`),
     KEY `idx_content_accounts_deleted` (`deleted_at`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='自媒体三方平台账号登记表'",
  "SELECT 'content_accounts already exists' AS skipped"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
