-- 0005 小程序模块改名：mini-app → mini-contract（合同翻译官）
--
-- 背景：apps/mini-app 重命名为 apps/mini-contract（业务属性命名，后续新小程序沿用 apps/mini-<业务>）。
-- 同步：scripts/modules.json 中模块 key / name / dir 一并改；发布平台的「模块类型」枚举仍为 mini-app（未改）。
--
-- 目标库：发布平台库（deploy-console 的 MYSQL_DB，本地默认 web_system_deploy，不是 web_system）
-- 执行：mysql -u root -p web_system_deploy < migrations/0005_rename_mini_app_to_mini_contract.sql
-- 执行后：restart deploy-console（web-deploy-console）、gateway（web-gateway）以清内存缓存。
-- 建议先备份：mysqldump -u root -p web_system_deploy > /tmp/web_system_deploy_before_0005.sql

-- 0) 前置确认：应看到 1 行 key='mini-app'
-- SELECT `key`, name, dir FROM deploy_modules WHERE `key` = 'mini-app';

-- 1) 模块注册表（种子来源 scripts/modules.json）
UPDATE deploy_modules
SET `key` = 'mini-contract',
    name  = '合同翻译官小程序',
    dir   = 'mini-contract'
WHERE `key` = 'mini-app';

-- 2) 关联表：module_key
UPDATE deploy_deployments            SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_module_stage_commands  SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_pipelines              SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_pipeline_templates     SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_canary_rules           SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_approvals              SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE deploy_release_events         SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE notification_logs             SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE config_snapshots              SET module_key = 'mini-contract' WHERE module_key = 'mini-app';
UPDATE config_items                  SET module_key = 'mini-contract' WHERE module_key = 'mini-app';

-- 3) 用 component 记模块的两张表
UPDATE deploy_versions SET component = 'mini-contract' WHERE component = 'mini-app';
UPDATE deploy_tasks    SET component = 'mini-contract' WHERE component = 'mini-app';

-- 4) 发布锁 lock_key 形如 'mini-app@dev'
UPDATE deploy_release_locks
SET lock_key = REPLACE(lock_key, 'mini-app@', 'mini-contract@')
WHERE lock_key LIKE 'mini-app@%';

-- 5) 环境 ports（JSON：{ moduleKey: 'host:port' }）里若以模块 key 为键
UPDATE deploy_environments
SET ports = REPLACE(ports, '"mini-app"', '"mini-contract"')
WHERE ports LIKE '%"mini-app"%';

-- 6) 校验：均应返回 0 行 / 0 计数
-- SELECT `key`, name, dir FROM deploy_modules WHERE `key` = 'mini-app';
-- SELECT 'deploy_deployments' AS t, COUNT(*) AS leftover FROM deploy_deployments WHERE module_key = 'mini-app'
-- UNION ALL SELECT 'deploy_module_stage_commands', COUNT(*) FROM deploy_module_stage_commands WHERE module_key = 'mini-app'
-- UNION ALL SELECT 'deploy_pipelines', COUNT(*) FROM deploy_pipelines WHERE module_key = 'mini-app'
-- UNION ALL SELECT 'deploy_versions', COUNT(*) FROM deploy_versions WHERE component = 'mini-app'
-- UNION ALL SELECT 'deploy_modules(new)', COUNT(*) FROM deploy_modules WHERE `key` = 'mini-contract';
