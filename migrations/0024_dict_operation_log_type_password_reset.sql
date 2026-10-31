-- 0024_dict_operation_log_type_password_reset.sql
-- 为 operation_log_type 字典补充「重置密码」项（admin 用户管理重置密码时写入的日志 type）。
-- 对应源码：servers/system-service/src/dict/dict.service.ts 的 BUILTIN_DICTS seedItems。
-- 背景：seedItems 只在「该字典一条 item 都没有」时插入一次（不覆盖人工改动），
--       存量环境已有 login/logout 等项，故需本迁移幂等补齐新增项。

INSERT INTO dict_items (id, type_code, value, label, attrs, remark, enabled, sort)
SELECT UUID(), 'operation_log_type', 'user_password_reset', '重置密码', NULL, NULL, 1, 60
WHERE NOT EXISTS (
  SELECT 1 FROM dict_items WHERE type_code = 'operation_log_type' AND value = 'user_password_reset'
);
