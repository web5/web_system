-- =============================================================================
-- 业务数据表规范化迁移（MySQL / web_system 库）
-- 目标状态：物理表/列统一 snake_case、补齐 created_at/updated_at/deleted_at、
--          用户外键统一 BIGINT、JSON 用原生 JSON 类型、布尔统一 tinyint(1)、统一注释。
-- 适用：生产库（synchronize:false，须手动执行）。开发库可直接删表后由 sync 重建。
-- 重要：本文件为“目标结构”的 ALTER 集合，执行前务必在从库/备份上演练。
--       标记 [破坏性] 的步骤会改主键/外键类型，需按“数据回填”说明处理。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1) users（共享唯一来源：@web-system/shared）
--    - id int -> BIGINT UNSIGNED 自增 [破坏性，需无外键引用 users.id 时执行]
--    - createdAt/updatedAt 重命名为 created_at/updated_at
--    - 增加 deleted_at（软删）
--    - roles simple-json(text) -> JSON
-- -----------------------------------------------------------------------------
ALTER TABLE `users`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `users`
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `users`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;
ALTER TABLE `users`
  MODIFY `roles` JSON NULL;

-- -----------------------------------------------------------------------------
-- 2) todo_tasks
--    - user_id int -> BIGINT UNSIGNED（关联 users.id）
--    - category simple-json(text) -> JSON
--    - 列名已是 snake_case，无需重命名
-- -----------------------------------------------------------------------------
ALTER TABLE `todo_tasks`
  MODIFY `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `todo_tasks`
  MODIFY `category` JSON NULL;

-- -----------------------------------------------------------------------------
-- 3) bianbian_records（日志类，uuid 主键保留）
--    - userId varchar(255) -> BIGINT UNSIGNED [破坏性：需把原 userId 字符串映射为数字 id]
--    - createdAt/updatedAt -> created_at/updated_at
--    - 增加 deleted_at
--    数据回填：UPDATE bianbian_records br JOIN users u ON br.userId = u.xxx ...
--              （按业务实际 userId 映射；若原为 openid/邮箱，需先解析为 users.id）
-- -----------------------------------------------------------------------------
ALTER TABLE `bianbian_records`
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `bianbian_records`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 4) artworks（内容表，uuid 主键保留）
--    - userId int -> BIGINT UNSIGNED
--    - createdAt/updatedAt -> created_at/updated_at；增加 deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `artworks`
  MODIFY `userId` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `artworks`
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `artworks`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 5) conversations（对话类，uuid 主键保留）
--    - userId varchar(255) -> BIGINT UNSIGNED [破坏性，同 bianbian_records 回填]
--    - createdAt/updatedAt -> created_at/updated_at；增加 deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `conversations`
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `conversations`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 6) finnews_entities（uuid 主键，列已 snake_case，基本无需改动）
--    确认 aliases 为 JSON（原即为 json）
-- -----------------------------------------------------------------------------
-- ALTER TABLE finnews_entities MODIFY aliases JSON NULL;  -- 如已是 JSON 可跳过

-- -----------------------------------------------------------------------------
-- 7) finnews_news（uuid 主键）
--    - 增加 updated_at、deleted_at（crawled_at 保留）
-- -----------------------------------------------------------------------------
ALTER TABLE `finnews_news`
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `crawled_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 8) finnews_topics（uuid 主键）
--    - 软删保留 is_deleted（与全局 deleted_at 约定不一致，作为已知例外；
--      后续统一时可：ALTER ADD deleted_at ...; UPDATE SET deleted_at=NOW() WHERE is_deleted=1; DROP is_deleted; 并改查询）
--    - first_seen/last_updated 已是 snake，不动
-- -----------------------------------------------------------------------------
-- （无需变更，is_deleted 例外保留）

-- -----------------------------------------------------------------------------
-- 9) finnews_subscriptions（uuid 主键）
--    - user_id varchar(100) -> BIGINT UNSIGNED [破坏性，需把字符串 userId 解析为数字 id]
--    - 增加 updated_at、deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `finnews_subscriptions`
  MODIFY `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `finnews_subscriptions`
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 10) mcp_modules（int -> BIGINT 自增）
--     - enabled 已是 tinyint(1) 保持；base_url/auth_type/module_type/code_key 已 snake
--     - 增加 deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `mcp_modules`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `mcp_modules`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 11) mcp_tools（int -> BIGINT 自增）
--     - 增加 created_at、updated_at、deleted_at（原表无时间戳）
-- -----------------------------------------------------------------------------
ALTER TABLE `mcp_tools`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `mcp_tools`
  ADD `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `module_id`,
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 12) mcp_api_keys（int -> BIGINT 自增）
--     - keyHash/keyPrefix 等列已 snake（原 name 覆盖）；created_at 已存在
--     - 增加 updated_at、deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `mcp_api_keys`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `mcp_api_keys`
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `revoked_at`;

-- -----------------------------------------------------------------------------
-- 13) mcp_key_codes（int -> BIGINT 自增）
--     - created_at 已存在；增加 updated_at、deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `mcp_key_codes`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `mcp_key_codes`
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 14) bianbian_materials（内容表，uuid 主键保留）
--     - 列 camelCase -> snake：sortOrder->sort_order、createdAt->created_at、updatedAt->updated_at
--     - 增加 deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `bianbian_materials`
  CHANGE `sortOrder` `sort_order` INT NOT NULL DEFAULT 0,
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `bianbian_materials`
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 15) operation_logs（int -> BIGINT 自增）
--     - createdAt -> created_at；增加 updated_at、deleted_at
-- -----------------------------------------------------------------------------
ALTER TABLE `operation_logs`
  MODIFY `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;
ALTER TABLE `operation_logs`
  CHANGE `createdAt` `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `operation_logs`
  ADD `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

-- -----------------------------------------------------------------------------
-- 16) system_configs（字符串主键，无 created_at）
--     - 增加 created_at、deleted_at；updatedAt -> updated_at
-- -----------------------------------------------------------------------------
ALTER TABLE `system_configs`
  CHANGE `updatedAt` `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `system_configs`
  ADD `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `description`,
  ADD `deleted_at` DATETIME(3) NULL AFTER `updated_at`;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 数据回填说明（破坏性步骤）
-- -----------------------------------------------------------------------------
-- A. user_id 字符串 -> BIGINT（bianbian_records / conversations / finnews_subscriptions）
--    这三张表原 userId 存的是 varchar（可能是 openid/邮箱/uuid），需先映射到 users.id。
--    若是 user-service 的数字 id 字符串：UPDATE t SET user_id = CAST(user_id AS UNSIGNED)
--    若是 openid/邮箱：先 JOIN users 解析，例如
--      UPDATE bianbian_records br
--      JOIN users u ON br.userId = u.mp_openid
--      SET br.userId = u.id WHERE u.mp_openid IS NOT NULL;
--    执行前务必确认映射口径，避免脏写。
--
-- B. uuid 主键表（artworks / bianbian_materials）
--    本次保留 uuid 主键不变（属内容/资产表），仅做列名 snake_case 化与软删补齐；
--    若后续要统一为 BIGINT，再按下方重排：先备份，清空自增并重排 id，
--    并同步通知前端失效缓存（无入向外键引用这两张表主键）。
-- =============================================================================
