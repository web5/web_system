-- @database web_system
-- 0029 · NCE 每日美句冻结池（s27）
-- 一行对应 servers/content-hub/data/daily-quotes.json 的 items[] 一项；pool_version 与资产 version 对齐。
-- 写入仅由 scripts/seed-daily-quotes.mjs 运维显式执行；对外只读，无写接口。
-- 金额/时间以外的文本逐字冻结：cn/en VARCHAR(512) utf8mb4 足够，索引只落在版本/序号/来源锚点。
-- 幂等：CREATE TABLE IF NOT EXISTS + 具名唯一键与实体 @Index 一致（避免 synchronize 抖动）。
CREATE TABLE IF NOT EXISTS `daily_quotes` (
  `id`                INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `pool_version`      INT UNSIGNED  NOT NULL DEFAULT 1     COMMENT '冻结池版本（资产 version）',
  `ordinal`           INT UNSIGNED  NOT NULL                COMMENT '资产 items[] 原序 1..136',
  `cn`                VARCHAR(512)  NOT NULL                COMMENT '冻结中文（逐字）',
  `en`                VARCHAR(512)  NOT NULL                COMMENT '冻结英文（逐字）',
  `source_book`       VARCHAR(16)   NOT NULL                COMMENT '来源册别（恒 NCE2）',
  `source_lesson_id`  INT UNSIGNED  NOT NULL                COMMENT '来源课号',
  `source_title`      VARCHAR(255)  NOT NULL                COMMENT '来源英文标题',
  `source_line_index` INT UNSIGNED  NOT NULL                COMMENT '来源行号',
  `created_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_daily_quotes_version_ordinal` (`pool_version`, `ordinal`),
  UNIQUE KEY `uk_daily_quotes_version_source` (`pool_version`, `source_lesson_id`, `source_line_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='NCE 每日美句冻结池（只读，seed 写入）';
