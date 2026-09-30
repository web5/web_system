-- ===========================================================
-- P1-2: 数据迁移 —— 现有 environment.host 下沉为默认 serverName + 默认路由
-- 1) 每个环境创建一条默认服务器记录（serverName = <env>-default）
-- 2) 每个环境 × 每个 backend 模块创建一条默认路由（服务名 → <env>-default）
-- 幂等：NOT EXISTS 保证可重复执行
-- ===========================================================

-- 1) 默认服务器
INSERT INTO deploy_servers (id, server_name, host, ssh_user, ssh_key_path, remote_dir)
SELECT UUID(), CONCAT(e.id, '-default'), e.host, e.ssh_user, e.ssh_key_path, e.remote_dir
FROM deploy_environments e
WHERE NOT EXISTS (
  SELECT 1 FROM deploy_servers s WHERE s.server_name = CONCAT(e.id, '-default')
);

-- 2) 默认环境服务路由
INSERT INTO deploy_env_service_routes (id, env_id, service_name, server_name)
SELECT UUID(), e.id, m.`key`, CONCAT(e.id, '-default')
FROM deploy_environments e
CROSS JOIN deploy_modules m
WHERE m.type = 'backend'
  AND NOT EXISTS (
    SELECT 1 FROM deploy_env_service_routes r
    WHERE r.env_id = e.id AND r.service_name = m.`key`
  );
