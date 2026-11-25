-- @database web_system
-- 0030 · 每日美句池扩展到 NCE3/NCE4（s33）：跨册唯一键补 source_book
--
-- 背景（163 稿 E10）：三册课号都从 1 起，(lessonId,lineIndex) 在 2922 个唯一键中有 2091 处跨册碰撞。
-- 0029 的唯一键 uk_daily_quotes_version_source(pool_version,source_lesson_id,source_line_index)
-- 不含 source_book：v2 三册合池后，NCE2 L1:0 与 NCE3 L1:0 会被判同一行 → seed 覆盖 / service 误判重复。
-- 本迁移把该唯一键改为 (pool_version,source_book,source_lesson_id,source_line_index)，三册同号行可共存。
--
-- 兼容 / 回滚：uk_daily_quotes_version_ordinal 不变；新键在仅含 NCE2 的 v1 数据上与旧键等价，
-- 故 v1(136) 行保留、可回滚（回滚只需把代码常量回 1/136/旧 sha + 重启，本迁移可不回退）。
-- 顺序：先上本迁移，再跑新 seed（scripts/seed-daily-quotes.mjs --dry-run 先校验）。
-- 具名唯一键与 entity @Index 同名同列，避免 synchronize 抖动（prod 已关 synchronize，dev 仍需一致）。

ALTER TABLE `daily_quotes`
  DROP INDEX `uk_daily_quotes_version_source`,
  ADD UNIQUE KEY `uk_daily_quotes_version_source`
    (`pool_version`, `source_book`, `source_lesson_id`, `source_line_index`);
