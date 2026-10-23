-- 0018 · 账号主体类型 + 成文记录归属账号
--
-- 背景：公众号分个人主体与企业主体，两者的发布能力不同——
--   · 个人主体（未认证订阅号）：没有 freepublish 权限，草稿就是终点。
--     微信侧返回 48001 时我们已降级成 drafted，但界面上仍标「待发布」，
--     让人以为还差一步、白白去点「正式发布」再撞一次失败。
--   · 企业主体：有 freepublish 权限，草稿之后还能真的发出去。
-- 所以账号要带主体类型，成文状态按类型分流：
--   个人 → drafted 显示「草稿」（终态，无发布按钮）
--   企业 → drafted 显示「待发布」+ 发布按钮，发布后「已发布」
--
-- 成文记录**落库时快照**账号类型（account_code / account_type），而不是显示时现查：
-- 账号类型以后若调整，历史成文的状态语义不该跟着漂移。
--
-- 适用：dev / prod 都手跑一遍（NODE_ENV=production 时 TypeORM synchronize 关闭）。
-- 幂等：逐列判断 information_schema，已存在则跳过。

SET @db = DATABASE();

-- ── content_accounts.account_type ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_accounts' AND COLUMN_NAME = 'account_type'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_accounts`
     ADD COLUMN `account_type` varchar(16) NOT NULL DEFAULT 'personal'
     COMMENT '账号主体类型 personal 个人 | enterprise 企业'",
  "SELECT 'content_accounts.account_type already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── content_publications.account_code ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_publications' AND COLUMN_NAME = 'account_code'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_publications`
     ADD COLUMN `account_code` varchar(64) DEFAULT NULL COMMENT '发布所用账号编码'",
  "SELECT 'content_publications.account_code already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── content_publications.account_type ──
SET @exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_publications' AND COLUMN_NAME = 'account_type'
);
SET @sql = IF(
  @exists = 0,
  "ALTER TABLE `content_publications`
     ADD COLUMN `account_type` varchar(16) DEFAULT NULL COMMENT '发布时账号主体类型快照 personal | enterprise'",
  "SELECT 'content_publications.account_type already exists, skip'"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
