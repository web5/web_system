-- 0023_users_token_version.sql
-- 为 users 表增加令牌版本号列，用于「改密后作废旧会话」（admin 修改密码双入口）。
-- 对应实体：packages/shared/src/entities/user.entity.ts 的 User.tokenVersion。
-- 生产环境 synchronize=false，需在目标库手工执行本迁移。

ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0 COMMENT '令牌版本（改密+1，作废旧会话）';
