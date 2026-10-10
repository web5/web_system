-- ═══════════════════════════════════════════════════════════════════
-- 配置中心底座（P0-1/2/3）：层（layer）维度 + 变更历史 + 下发记录
--
-- 背景：deploy-console 库当前靠 TypeORM `synchronize` 出结构
--       （见 servers/deploy-console/src/config/db-synchronize.ts 与 src/migrations/README.md），
--       本文件**不是 TypeORM migration**，是给下面两类场景用的**手工幂等脚本**：
--
--   §1 加列 / 建表：仅在 `DB_SYNCHRONIZE=false` 的环境需要（dev 默认 true，启动会自动建）
--   §2 存量 layer 回填：**任何环境都必须跑一次**（synchronize 不会帮你回填历史数据）
--
-- 执行方式：
--   mysql -uroot -p web_system_deploy < servers/deploy-console/scripts/config-center-base.sql
-- 幂等：重复执行不会报错也不会重复修改数据。
-- ═══════════════════════════════════════════════════════════════════

-- ── §1 结构（幂等；已有则跳过）──────────────────────────────────────

SET @db = DATABASE();

-- config_items 新增列
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='layer') = 0,
  "ALTER TABLE config_items ADD COLUMN layer VARCHAR(16) NOT NULL DEFAULT 'app' COMMENT '层 bootstrap/infra/app/platform' AFTER enabled",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='layer') > 0
   AND (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND INDEX_NAME='IDX_config_items_layer') = 0,
  'CREATE INDEX IDX_config_items_layer ON config_items (layer)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='value_type') = 0,
  "ALTER TABLE config_items ADD COLUMN value_type VARCHAR(16) NOT NULL DEFAULT 'string' COMMENT '值类型 string/number/bool/json/port/path' AFTER layer",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='apply_mode') = 0,
  "ALTER TABLE config_items ADD COLUMN apply_mode VARCHAR(16) NOT NULL DEFAULT 'restart' COMMENT '生效方式 restart/immediate/manual' AFTER value_type",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='deliverable') = 0,
  "ALTER TABLE config_items ADD COLUMN deliverable TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否可下发（0=仅进程内/人工消费）' AFTER apply_mode",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='validators') = 0,
  "ALTER TABLE config_items ADD COLUMN validators JSON NULL COMMENT '校验规则 {pattern?,enum?,min?,max?}' AFTER deliverable",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db AND TABLE_NAME='config_items' AND COLUMN_NAME='key_version') = 0,
  'ALTER TABLE config_items ADD COLUMN key_version INT NOT NULL DEFAULT 1 COMMENT "主密钥代次（密钥轮换用）" AFTER validators',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- config_revisions：配置变更历史（单键流水，与版本维度的 config_snapshots 互补）
CREATE TABLE IF NOT EXISTS config_revisions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  item_id VARCHAR(64) NOT NULL COMMENT '关联 config_items.id（无外键，删后仍需可查）',
  scope VARCHAR(16) NOT NULL COMMENT '作用域 global/env/module',
  env_id VARCHAR(64) NOT NULL DEFAULT '',
  module_key VARCHAR(64) NOT NULL DEFAULT '',
  `key` VARCHAR(128) NOT NULL COMMENT '配置键',
  action VARCHAR(16) NOT NULL COMMENT '变更类型 create/update/delete',
  before_value TEXT NULL COMMENT '变更前的值（密钥为密文，明文永不入表）',
  after_value TEXT NULL COMMENT '变更后的值（密钥为密文）',
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  before_fingerprint VARCHAR(16) NULL COMMENT '变更前值指纹 sha256 前 12 位',
  after_fingerprint VARCHAR(16) NULL COMMENT '变更后值指纹 sha256 前 12 位',
  reason VARCHAR(255) NULL COMMENT '变更原因',
  approval_id VARCHAR(64) NULL COMMENT '关联审批单 id',
  changed_by VARCHAR(64) NULL COMMENT '操作人',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '变更时间',
  INDEX IDX_config_revisions_item (item_id),
  INDEX IDX_config_revisions_target (scope, env_id, module_key, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- config_deliveries：配置下发记录 + 目标机回执（漂移检测数据源）
CREATE TABLE IF NOT EXISTS config_deliveries (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  env_id VARCHAR(64) NOT NULL COMMENT '环境 ID',
  module_key VARCHAR(64) NOT NULL COMMENT '模块 / 服务 key',
  host VARCHAR(64) NULL COMMENT '来源 IP',
  key_count INT NOT NULL DEFAULT 0 COMMENT '下发的键数量',
  content_hash VARCHAR(64) NULL COMMENT '下发内容 sha256',
  result VARCHAR(16) NOT NULL COMMENT '结果 delivered/empty',
  empty_reason VARCHAR(32) NULL COMMENT '空下发原因 no-module-scope/no-deliverable-key',
  run_id VARCHAR(64) NULL COMMENT '关联发布运行 id',
  dispatched_by VARCHAR(64) NULL COMMENT '取配置方标识',
  reported_hash VARCHAR(64) NULL COMMENT '目标机上报的实际内容 sha256',
  reported_at DATETIME(6) NULL COMMENT '目标机上回报时间',
  drift TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否漂移（实际 hash ≠ 下发 hash）',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '下发时间',
  INDEX IDX_config_deliveries_env (env_id),
  INDEX IDX_config_deliveries_target (env_id, module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── §2 存量 layer 回填（必做）───────────────────────────────────────
--
-- 为什么必须这一步：`layer` 列加默认值 'app'，而存量行里混着 MYSQL_* / REDIS_* /
-- CONFIG_MASTER_KEY / CONSOLE_* 这些**永不可下发**的键。只认 layer 的话，
-- 它们会被当成普通 app 层配置写进服务的 .env.generated（= DB 连接信息落盘扩散）。
--
-- 兜底存在两层，这是第一层（数据）；第二层是代码里的 isReservedLocalKey()
-- （见 config.service.ts 的 isRowDeliverable 注释），保证即便本脚本没跑也安全。
--
-- 幂等：只改仍处在默认层（'app' 或空）的行，已经手工调过的层不动。

UPDATE config_items
SET layer = 'bootstrap', deliverable = 0
WHERE (layer IS NULL OR layer = '' OR layer = 'app')
  AND (
       `key` IN ('CONFIG_MASTER_KEY', 'PATH', 'HOME', 'CONSOLE_API', 'CONSOLE_TOKEN')
    OR `key` LIKE 'MYSQL@_%' ESCAPE '@'
    OR `key` LIKE 'REDIS@_%' ESCAPE '@'
    OR `key` LIKE 'PM2@_%'    ESCAPE '@'
  );

-- 平台自身行为键：只由 console 进程内消费，不落任何服务的 .env.generated
UPDATE config_items
SET layer = 'platform', deliverable = 0
WHERE (layer IS NULL OR layer = '' OR layer = 'app')
  AND `key` LIKE 'PLATFORM@_%' ESCAPE '@';

-- 自检：跑完后本查询应返回 0 行（= 没有"默认层却命中保留键名单"的漏网之行）
-- SELECT id, scope, `key`, layer FROM config_items
-- WHERE layer = 'app' AND (
--        `key` IN ('CONFIG_MASTER_KEY','PATH','HOME','CONSOLE_API','CONSOLE_TOKEN')
--     OR `key` LIKE 'MYSQL@_%' ESCAPE '@'
--     OR `key` LIKE 'REDIS@_%' ESCAPE '@'
--     OR `key` LIKE 'PM2@_%'    ESCAPE '@');
