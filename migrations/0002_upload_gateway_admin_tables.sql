-- =============================================================================
-- 0002_upload_gateway_admin_tables.sql
-- 数据域补全：文件上传 / API 网关 / 管理台
-- 配套《数据表设计规范.md》第 5 节「数据域全景」。
-- 适用范围：web_system 库（MySQL 8，utf8mb4）。
-- 执行顺序：在备份/从库演练后，于生产库按段执行；本脚本不自动运行。
-- 与 0001 的关系：0001 规范了 7 个原始服务的 16 张表；
--                 0002 新增上传/网关/管理台三块，并把管理台 3 张旧表补齐规范字段。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 一、upload-service：上传文件记录表
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `upload_files` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                              COMMENT '文件记录 ID',
  `user_id`       BIGINT UNSIGNED NULL    DEFAULT NULL                                COMMENT '上传用户 ID，关联 users.id；匿名上传为 NULL',
  `category`      VARCHAR(32)    NOT NULL                                               COMMENT '上传分类 avatar/drawing/bianbian/general',
  `original_name` VARCHAR(255)   NOT NULL                                               COMMENT '原始文件名',
  `storage_name`  VARCHAR(255)   NOT NULL                                               COMMENT '存储文件名，如 avatar-<ts>-<rand>.png',
  `storage_path`  VARCHAR(512)   NOT NULL                                               COMMENT '磁盘相对路径，如 uploads/avatar/<storageName>',
  `url`           VARCHAR(512)   NOT NULL                                               COMMENT '访问 URL，如 /api/uploads/avatar/<storageName>',
  `mime_type`     VARCHAR(128)   NOT NULL                                               COMMENT 'MIME 类型',
  `size_bytes`    INT UNSIGNED    NOT NULL                                               COMMENT '文件大小（字节）',
  `extension`     VARCHAR(16)    NULL    DEFAULT NULL                                   COMMENT '扩展名（含点），如 .png',
  `checksum`      VARCHAR(64)    NULL    DEFAULT NULL                                   COMMENT '文件 MD5 校验值',
  `status`        VARCHAR(16)    NOT NULL DEFAULT 'uploaded'                           COMMENT '状态 uploaded/deleted',
  `created_at`    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP                     COMMENT '创建时间',
  `updated_at`    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`    DATETIME(3)    NULL    DEFAULT NULL                                   COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  KEY `idx_upload_files_user_id` (`user_id`),
  KEY `idx_upload_files_category` (`category`),
  KEY `idx_upload_files_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上传文件记录（元数据，文件本体在磁盘）';

-- -----------------------------------------------------------------------------
-- 二、gateway：路由配置表（将 proxy.service.ts 硬编码路由外置）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `gateway_routes` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                              COMMENT '路由 ID',
  `route_code`   VARCHAR(64)    NOT NULL                                               COMMENT '路由内部编码 auth/users/ai/mcp/finnews ...',
  `path_prefix`  VARCHAR(64)    NOT NULL                                               COMMENT '匹配路径前缀，如 /api/auth',
  `target_service` VARCHAR(32)  NOT NULL                                               COMMENT '上游服务 auth/user/ai/system/todo/upload/mcp/finnews',
  `target_url`   VARCHAR(255)   NULL    DEFAULT NULL                                   COMMENT '显式上游 URL，NULL=使用 *_SERVICE_URL 环境变量',
  `strip_prefix` VARCHAR(64)    NULL    DEFAULT NULL                                   COMMENT 'pathRewrite 剥离前缀，如 ^/api',
  `rewrite_to`   VARCHAR(64)    NULL    DEFAULT NULL                                   COMMENT '重写目标前缀，如 /api',
  `timeout_ms`   INT UNSIGNED    NOT NULL DEFAULT 30000                               COMMENT '代理超时（毫秒）',
  `auth_mode`    VARCHAR(16)    NOT NULL DEFAULT 'passthrough'                        COMMENT '网关鉴权模式 passthrough/service_key',
  `enabled`      TINYINT(1)     NOT NULL DEFAULT 1                                     COMMENT '是否启用该路由',
  `priority`     INT            NOT NULL DEFAULT 0                                    COMMENT '匹配优先级，数值小优先',
  `description`  VARCHAR(255)   NULL    DEFAULT NULL                                   COMMENT '备注',
  `created_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP                     COMMENT '创建时间',
  `updated_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`   DATETIME(3)    NULL    DEFAULT NULL                                   COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gateway_routes_route_code` (`route_code`),
  KEY `idx_gateway_routes_enabled` (`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='网关路由配置（替代 proxy.service.ts 硬编码路由）';

-- 种子数据：对齐当前 proxy.service.ts 的硬编码路由（幂等，依赖 route_code 唯一）
INSERT INTO `gateway_routes` (`route_code`, `path_prefix`, `target_service`, `strip_prefix`, `rewrite_to`, `timeout_ms`, `auth_mode`, `enabled`, `priority`, `description`) VALUES
  ('auth',        '/api/auth',     'auth',   '^/api', NULL,        30000, 'passthrough', 1, 100, '认证服务'),
  ('users',       '/api/users',    'user',   '^/api', NULL,        30000, 'passthrough', 1, 100, '用户服务'),
  ('ai',          '/api/ai',       'ai',     '^/api', NULL,        120000,'passthrough', 1, 100, 'AI 任务（含 SSE/TTS 特例）'),
  ('bianbian',    '/api/bianbian', 'ai',     '^/api', NULL,        120000,'passthrough', 1, 100, '变变（ai-service 内）'),
  ('todos',       '/api/todos',    'todo',   '^/api', NULL,        30000, 'passthrough', 1, 100, '待办服务'),
  ('upload',      '/api/upload',   'user',   '^/api', NULL,        30000, 'passthrough', 1, 100, '上传 API（指向 user-service）'),
  ('upload_static','/api/uploads', 'user',   '^/api', NULL,        10000, 'passthrough', 1, 90,  '上传文件静态访问'),
  ('bianbian_static','/api/uploads/bianbian','ai','^/api', NULL,   10000, 'passthrough', 1, 80,  '变变图片静态访问（优先级高于 upload_static）'),
  ('admin',       '/api/admin',    'system', '^/api', NULL,        30000, 'passthrough', 1, 100, '系统管理（system-service）'),
  ('mcp',         '/api/mcp',      'mcp',    '^/api/mcp', '/api',  30000, 'passthrough', 1, 100, 'MCP 网关管理接口'),
  ('finnews',     '/api/finnews',  'finnews','^/api/finnews', '',  30000, 'service_key', 1, 100, '财经资讯（网关校验 FINNEWS_SERVICE_KEY）')
ON DUPLICATE KEY UPDATE
  `path_prefix` = VALUES(`path_prefix`),
  `target_service` = VALUES(`target_service`),
  `strip_prefix` = VALUES(`strip_prefix`),
  `rewrite_to` = VALUES(`rewrite_to`),
  `timeout_ms` = VALUES(`timeout_ms`),
  `auth_mode` = VALUES(`auth_mode`),
  `enabled` = VALUES(`enabled`),
  `priority` = VALUES(`priority`),
  `description` = VALUES(`description`);

-- -----------------------------------------------------------------------------
-- 三、gateway：访问日志表（网关入口可观测性，高写入量、只追加）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `gateway_access_logs` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                          COMMENT '访问日志 ID',
  `trace_id`       VARCHAR(64)    NULL    DEFAULT NULL                             COMMENT '链路追踪 ID',
  `method`         VARCHAR(8)     NOT NULL                                          COMMENT 'HTTP 方法',
  `path`           VARCHAR(512)   NOT NULL                                          COMMENT '请求路径',
  `route_code`     VARCHAR(64)    NULL    DEFAULT NULL                             COMMENT '命中的路由编码',
  `client_ip`      VARCHAR(64)    NULL    DEFAULT NULL                             COMMENT '客户端 IP',
  `user_id`        VARCHAR(64)    NULL    DEFAULT NULL                             COMMENT '用户 ID（JWT sub），匿名为 NULL',
  `upstream_status` INT           NULL    DEFAULT NULL                             COMMENT '上游服务返回的 HTTP 状态',
  `gateway_status` INT           NOT NULL                                          COMMENT '网关最终返回的 HTTP 状态',
  `latency_ms`     INT UNSIGNED    NOT NULL                                         COMMENT '请求耗时（毫秒）',
  `request_at`     DATETIME(3)    NOT NULL                                         COMMENT '请求接收时间',
  `created_at`     DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP              COMMENT '创建时间',
  `updated_at`     DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`     DATETIME(3)    NULL    DEFAULT NULL                             COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  KEY `idx_gal_trace_id` (`trace_id`),
  KEY `idx_gal_path` (`path`(191)),
  KEY `idx_gal_route_code` (`route_code`),
  KEY `idx_gal_user_id` (`user_id`),
  KEY `idx_gal_request_at` (`request_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='网关访问日志（建议异步落库、定期归档）';

-- -----------------------------------------------------------------------------
-- 四、deploy-console：归一化已有 3 张表 + 新增配置变更日志表
-- 注意：deploy-console 开发环境 synchronize:true，加载新实体时会自动 ADD 时间戳列；
--      但 camelCase 列（startTime/endTime/versionTag...）在 synchronize 下会被 DROP 重建（丢数据），
--       生产请严格用本段 ALTER 做 RENAME（保留数据）。
-- -----------------------------------------------------------------------------

-- 4.1 audit_logs：id 长度 64 -> 36；补三时间戳
ALTER TABLE `audit_logs`
  MODIFY `id` VARCHAR(36) NOT NULL COMMENT '审计日志 ID（uuid）';
ALTER TABLE `audit_logs`
  ADD `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  ADD `deleted_at` DATETIME(3) NULL DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除';

-- 4.2 deploy_tasks：补三时间戳；camelCase 业务列改名 snake（RENAME 保留数据）
ALTER TABLE `deploy_tasks`
  ADD `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  ADD `deleted_at` DATETIME(3) NULL DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除';
ALTER TABLE `deploy_tasks`
  CHANGE `startTime` `start_time` BIGINT NOT NULL COMMENT '开始时间（毫秒时间戳）',
  CHANGE `endTime`   `end_time`   BIGINT NULL  DEFAULT NULL COMMENT '结束时间（毫秒时间戳）';

-- 4.3 deploy_versions：补三时间戳；camelCase 列改名 snake
ALTER TABLE `deploy_versions`
  ADD `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  ADD `deleted_at` DATETIME(3) NULL DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除';
ALTER TABLE `deploy_versions`
  CHANGE `versionTag` `version_tag` VARCHAR(128) NOT NULL COMMENT '版本标签',
  CHANGE `releasedAt` `released_at` DATETIME(3) NOT NULL COMMENT '发布时间',
  CHANGE `releasedBy` `released_by` VARCHAR(64) NULL DEFAULT NULL COMMENT '发布人',
  CHANGE `taskId`     `task_id`     VARCHAR(64) NULL DEFAULT NULL COMMENT '关联任务 ID',
  CHANGE `gitCommit`  `git_commit`  VARCHAR(64) NULL DEFAULT NULL COMMENT 'Git 提交短哈希',
  CHANGE `gitBranch`  `git_branch`  VARCHAR(64) NULL DEFAULT NULL COMMENT 'Git 分支';

-- 4.4 config_change_logs：新增（管理台改 .env 的审计留痕）
CREATE TABLE IF NOT EXISTS `config_change_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                          COMMENT '变更日志 ID',
  `env`          VARCHAR(16)    NOT NULL                                          COMMENT '环境 dev/prod/common',
  `file_name`    VARCHAR(255)   NOT NULL                                          COMMENT '配置文件名，如 servers.env / prod.env',
  `change_type`  VARCHAR(16)    NOT NULL                                          COMMENT '变更类型 created/updated/deleted',
  `operator`     VARCHAR(64)    NULL    DEFAULT NULL                             COMMENT '操作人',
  `old_content`  TEXT           NULL    DEFAULT NULL                             COMMENT '修改前内容（全量，便于回滚）',
  `new_content`  TEXT           NULL    DEFAULT NULL                             COMMENT '修改后内容（全量）',
  `diff_summary` VARCHAR(512)   NULL    DEFAULT NULL                             COMMENT '差异摘要',
  `created_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP              COMMENT '创建时间',
  `updated_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at`   DATETIME(3)    NULL    DEFAULT NULL                             COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  KEY `idx_ccl_env` (`env`),
  KEY `idx_ccl_file_name` (`file_name`(191)),
  KEY `idx_ccl_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='配置变更日志（管理台改 .env 留痕）';
