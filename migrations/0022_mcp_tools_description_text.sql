-- 0022 · mcp_tools.description 列型 varchar(255) → text
--
-- 背景：新 dist 实体 mcp-tool.entity 把 description 定为 type:'text'（commit 5caf332f），
-- 新工具声明（verify_release 等）描述远超 255 字符，STRICT_TRANS_TABLES 下 seed
-- 必炸 ER_DATA_TOO_LONG（errno 1406）。mcp-gateway 新 dist 重启即挂。
--
-- 适用：dev / prod 都手跑一遍。幂等：查 COLUMN_TYPE，已是 text/mediumtext/longtext 则跳过。

SET @db = DATABASE();

SET @coltype = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'mcp_tools'
    AND COLUMN_NAME = 'description'
);

SET @sql = IF(
  @coltype IS NULL,
  "SELECT 'mcp_tools.description column not found, skip'",
  IF(
    @coltype IN ('text', 'mediumtext', 'longtext'),
    "SELECT 'mcp_tools.description already text-family, skip'",
    "ALTER TABLE `mcp_tools` MODIFY COLUMN `description` text COMMENT '工具描述（原 varchar(255) 不够新工具声明长度）'"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
