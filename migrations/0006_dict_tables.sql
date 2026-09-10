-- 0006 字典 / 维表模块建表（system-service）
--
-- 背景：字典（dict_types / dict_fields / dict_items）承载可维护的维表数据，
--       首个字典为 llm_models（大模型清单），替代只能改 .env 的形态。
-- 说明：本地/测试由 TypeORM synchronize 自动建表，本文件用于**生产**（synchronize 关闭）。
--       库为 system-service 的 DB_DATABASE（与其业务数据同库）。
--
-- ---------- MySQL 8+ ----------
CREATE TABLE IF NOT EXISTS `dict_types` (
  `id` char(36) NOT NULL,
  `code` varchar(64) NOT NULL COMMENT '字典编码',
  `name` varchar(128) NOT NULL COMMENT '字典名称',
  `description` varchar(255) DEFAULT NULL COMMENT '字典描述',
  `builtin` tinyint(1) NOT NULL DEFAULT 0 COMMENT '内置字典不可删除',
  `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `sort` int NOT NULL DEFAULT 0 COMMENT '排序（小的在前）',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dict_types_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='字典类型';

CREATE TABLE IF NOT EXISTS `dict_fields` (
  `id` char(36) NOT NULL,
  `type_code` varchar(64) NOT NULL COMMENT '字典编码',
  `name` varchar(64) NOT NULL COMMENT '字段名（attrs 的 key）',
  `label` varchar(128) NOT NULL COMMENT '展示标签',
  `type` varchar(16) NOT NULL COMMENT 'string/text/number/boolean/enum/date',
  `length` int DEFAULT NULL COMMENT '长度上限（应用层强校验）',
  `required` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否必填',
  `default_value` varchar(255) DEFAULT NULL COMMENT '默认值',
  `options` json DEFAULT NULL COMMENT '枚举候选值',
  `sort` int NOT NULL DEFAULT 0 COMMENT '排序',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dict_fields_type_name` (`type_code`, `name`),
  KEY `idx_dict_fields_type_sort` (`type_code`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='字典字段定义';

CREATE TABLE IF NOT EXISTS `dict_items` (
  `id` char(36) NOT NULL,
  `type_code` varchar(64) NOT NULL COMMENT '字典编码',
  `value` varchar(128) NOT NULL COMMENT '字典项值（业务侧消费的原值）',
  `label` varchar(255) NOT NULL COMMENT '字典项标签',
  `attrs` json DEFAULT NULL COMMENT '自定义字段值',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  `enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `sort` int NOT NULL DEFAULT 0 COMMENT '排序',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dict_items_type_value` (`type_code`, `value`),
  KEY `idx_dict_items_type_sort` (`type_code`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='字典项';

-- 内置字典（只补结构，不塞数据行）
INSERT INTO `dict_types` (`id`, `code`, `name`, `description`, `builtin`, `enabled`, `sort`)
SELECT UUID(), 'llm_models', '大模型清单', 'AI Agent 可用模型。value = 网关 model id（如 hy4-preview）', 1, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM `dict_types` WHERE `code` = 'llm_models');

-- ---------- PostgreSQL（生产若为 PG，用下面这段） ----------
-- CREATE TABLE IF NOT EXISTS dict_types (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   code varchar(64) NOT NULL UNIQUE,
--   name varchar(128) NOT NULL,
--   description varchar(255),
--   builtin boolean NOT NULL DEFAULT false,
--   enabled boolean NOT NULL DEFAULT true,
--   sort int NOT NULL DEFAULT 0,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   updated_at timestamptz NOT NULL DEFAULT now(),
--   deleted_at timestamptz
-- );
-- CREATE TABLE IF NOT EXISTS dict_fields (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   type_code varchar(64) NOT NULL,
--   name varchar(64) NOT NULL,
--   label varchar(128) NOT NULL,
--   type varchar(16) NOT NULL,
--   length int,
--   required boolean NOT NULL DEFAULT false,
--   default_value varchar(255),
--   options jsonb,
--   sort int NOT NULL DEFAULT 0,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   updated_at timestamptz NOT NULL DEFAULT now(),
--   deleted_at timestamptz,
--   UNIQUE (type_code, name)
-- );
-- CREATE INDEX IF NOT EXISTS idx_dict_fields_type_sort ON dict_fields (type_code, sort);
-- CREATE TABLE IF NOT EXISTS dict_items (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   type_code varchar(64) NOT NULL,
--   value varchar(128) NOT NULL,
--   label varchar(255) NOT NULL,
--   attrs jsonb,
--   remark varchar(255),
--   enabled boolean NOT NULL DEFAULT true,
--   sort int NOT NULL DEFAULT 0,
--   created_at timestamptz NOT NULL DEFAULT now(),
--   updated_at timestamptz NOT NULL DEFAULT now(),
--   deleted_at timestamptz,
--   UNIQUE (type_code, value)
-- );
-- CREATE INDEX IF NOT EXISTS idx_dict_items_type_sort ON dict_items (type_code, sort);
-- INSERT INTO dict_types (code, name, description, builtin, enabled, sort)
-- SELECT 'llm_models', '大模型清单', 'AI Agent 可用模型', true, true, 10
-- WHERE NOT EXISTS (SELECT 1 FROM dict_types WHERE code = 'llm_models');
