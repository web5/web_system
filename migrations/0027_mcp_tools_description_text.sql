-- 0027 · mcp_tools.description 列型 varchar(255) → text
--
-- 来源：PR #539（fix/content-hub-env-injection）的 migrations/0022_mcp_tools_description_text.sql。
--       #539 已过期关闭不合并，本脚本是其中仍有价值部分的抢救。
-- 重编号原因：master 已存在 0021 / 0023 / 0024，0025 被在途 0025_nce_lessons.sql 占用，
--       故顺延到 0027（配套 0026）。原稿内容未改，仅改编号与来源说明。
--
-- 背景：新 dist 实体 mcp-tool.entity 把 description 定为 type:'text'（commit 5caf332f），
-- 新工具声明（verify_release 等）描述远超 255 字符，STRICT_TRANS_TABLES 下 seed
-- 必炸 ER_DATA_TOO_LONG（errno 1406）。mcp-gateway 新 dist 重启即挂。
--
-- 🔴 适用范围（2026-11-05 补充，勿删）：**仅允许在 `web_system` 业务主库执行**
--   （mcp-gateway 的 DB_DATABASE 默认值），dev / prod 的主库各手跑一遍。
--   ❌ 禁止在 `web_system_deploy` / `web_system_deploy_shadow` 执行：这两库里的 `mcp_tools`
--   是整库复制遗留的 0 行空壳表（description varchar(255)、无外键、无服务读写），
--   2026-11-05 已 DROP 清理；没有任何代码往这两库写工具声明，把它们改成 text 没有收益。
--   真正的 255 溢出风险在主库（新工具声明实测最长 391 字符），主库已改为 text。
--   执行前自检：SELECT DATABASE();  -- 必须返回 web_system
--
-- 幂等：查 COLUMN_TYPE，已是 text/mediumtext/longtext 则跳过。

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
