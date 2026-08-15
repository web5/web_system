-- 科豆财经资讯 MCP：每用户 API Key 相关表
-- 生产环境 synchronize:false，需手动执行本文件建表。
-- 适配 MySQL（web_system 库）。如使用 PostgreSQL，请将 DATETIME/TIMESTAMP 与 AUTO_INCREMENT 相应调整。

-- 1) 每用户 API Key（明文仅返回一次，存储 SHA-256）
CREATE TABLE IF NOT EXISTS `mcp_api_keys` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `email`         VARCHAR(255) NOT NULL,
  `name`          VARCHAR(120) NULL,
  `key_hash`      VARCHAR(64)  NOT NULL COMMENT 'SHA-256(plaintext)',
  `key_prefix`    VARCHAR(16)  NOT NULL COMMENT '明文前 12 位，列表脱敏展示',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active | revoked',
  `expires_at`    DATETIME     NULL COMMENT 'null 表示永久有效',
  `last_used_at`  DATETIME     NULL,
  `owner_type`    VARCHAR(16)  NOT NULL DEFAULT 'apply' COMMENT 'apply | admin',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at`    DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_key_email` (`email`),
  KEY `idx_key_hash` (`key_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='MCP 每用户 API Key';

-- 2) 申请验证码（邮箱验证码，带过期与尝试次数限制）
CREATE TABLE IF NOT EXISTS `mcp_key_codes` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `email`       VARCHAR(255) NOT NULL,
  `code_hash`   VARCHAR(64)  NOT NULL COMMENT 'SHA-256(code)',
  `expires_at`  DATETIME     NOT NULL,
  `attempts`    INT          NOT NULL DEFAULT 0,
  `last_sent_at` DATETIME    NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_code_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='MCP Key 申请验证码';
