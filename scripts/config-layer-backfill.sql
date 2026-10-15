-- 配置项 layer 存量回填（2026-10-10 设计 P0-1 的数据侧）。
--
-- 由来：`config_items.layer` 列由 synchronize 新增，存量行一律被填成默认值 `app`，
-- 其中混着 `MYSQL_*` / `CONSOLE_TOKEN` 这类**必须永不下发**的键。代码侧有
-- `RESERVED_LOCAL_KEYS` 名单兜底（`config.service.ts` `isRowDeliverable` 双保险），
-- 所以不会泄露 —— 但「新增能力只落一条带 layer 的配置行即可」的扩展性没兑现。
-- 本脚本把这部分真相从代码搬到数据里。
--
-- ⚠️ 本文件的键名/前缀必须与 `RESERVED_LOCAL_KEYS` 保持一致。
--    一致性由 `src/config/config-layer-backfill.spec.ts` 断言（解析本文件 → 比对），
--    改了代码忘了改这里会 CI 红。这是防止「层判定两份真相」漂移的唯一手段。
--
-- 幂等：只动 `layer='app'` 的行（即 synchronize 填出来的默认值），
--       已显式分层的不覆盖 —— 允许人工修正后不被回填冲掉。
--
-- 用法：
--   mysql web_system_deploy < scripts/config-layer-backfill.sql
-- 执行前建议先确认影响面：
--   SELECT `key`, layer FROM config_items WHERE layer='app'
--     AND ( `key`='CONFIG_MASTER_KEY' OR `key` LIKE 'MYSQL\_%' OR `key` LIKE 'REDIS\_%'
--        OR `key` IN ('PATH','HOME','CONSOLE_API','CONSOLE_TOKEN') OR `key` LIKE 'PM2\_%' );

-- 引导层：鸡生蛋 —— 读配置中心之前它就得在进程里，永不下发。
UPDATE config_items
SET layer = 'bootstrap',
    deliverable = 0,
    updated_by = 'config-layer-backfill'
WHERE layer = 'app'
  AND (
    `key` = 'CONFIG_MASTER_KEY'
    OR `key` LIKE 'MYSQL\_%'
    OR `key` LIKE 'REDIS\_%'
  );

-- 平台层：平台自身行为与推导信息，服务进程不该看到，永不下发。
UPDATE config_items
SET layer = 'platform',
    deliverable = 0,
    updated_by = 'config-layer-backfill'
WHERE layer = 'app'
  AND (
    `key` IN ('PATH', 'HOME', 'CONSOLE_API', 'CONSOLE_TOKEN')
    OR `key` LIKE 'PM2\_%'
  );
