-- 0006 小程序模块改名：mini-contract → kedou-ai-minigram（科豆 AI 小程序）
--
-- 背景：apps/mini-contract 更名为 apps/kedou-ai-minigram（产品定位从「合同翻译官」扩展为「科豆 AI」多能力小程序：
--       翻译 / 合同评估 / 对话 三 Tab）。发布平台按「key 与目录同名」约定同步改名。
-- 同步：scripts/modules.json 的 key / name / dir 已改（kedou-ai-minigram / 科豆 AI 小程序 / kedou-ai-minigram）。
-- 前置：0005 已执行（当前模块 key 为 'mini-contract'）。
--
-- 目标库：发布平台库（deploy-console 的 DB_NAME，本地默认 web_system_deploy；
--         dev/堡垒机已迁到同一份云 MySQL 的 web_system_deploy，不是业务库 web_system）
-- 执行：mysql -u <user> -p web_system_deploy < migrations/0006_rename_mini_contract_to_kedou_ai_minigram.sql
-- 执行后：restart deploy-console（web-deploy-console）、gateway（web-gateway）以清内存缓存。
-- 建议先备份：mysqldump -u <user> -p web_system_deploy > /tmp/web_system_deploy_before_0006.sql
--
-- 注意：该模块当前处于停用状态（构建命令 `node scripts/upload.js` 需小程序私钥，缺凭据），
--       故本次改名不涉及线上发布中断；改名后模块仍保持停用，由配置侧决定是否启用。

-- 0) 前置确认：应看到 1 行 key='mini-contract'
-- SELECT `key`, name, dir FROM deploy_modules WHERE `key` = 'mini-contract';

-- 1) 模块注册表（种子来源 scripts/modules.json）
UPDATE deploy_modules
SET `key` = 'kedou-ai-minigram',
    name  = '科豆 AI 小程序',
    dir   = 'kedou-ai-minigram'
WHERE `key` = 'mini-contract';

-- 2) 关联表：module_key
UPDATE deploy_deployments            SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_module_stage_commands  SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_pipelines              SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_pipeline_templates     SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_canary_rules           SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_approvals              SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE deploy_release_events         SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE notification_logs             SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE config_snapshots              SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';
UPDATE config_items                  SET module_key = 'kedou-ai-minigram' WHERE module_key = 'mini-contract';

-- 3) 用 component 记模块的两张表
UPDATE deploy_versions SET component = 'kedou-ai-minigram' WHERE component = 'mini-contract';
UPDATE deploy_tasks    SET component = 'kedou-ai-minigram' WHERE component = 'mini-contract';

-- 4) 发布锁 lock_key 形如 'mini-contract@dev'
UPDATE deploy_release_locks
SET lock_key = REPLACE(lock_key, 'mini-contract@', 'kedou-ai-minigram@')
WHERE lock_key LIKE 'mini-contract@%';

-- 5) 环境 ports（JSON：{ moduleKey: 'host:port' }）里若以模块 key 为键
UPDATE deploy_environments
SET ports = REPLACE(ports, '"mini-contract"', '"kedou-ai-minigram"')
WHERE ports LIKE '%"mini-contract"%';

-- 6) 校验：均应返回 0 行 / 0 计数
-- SELECT `key`, name, dir FROM deploy_modules WHERE `key` = 'mini-contract';
-- SELECT 'deploy_deployments' AS t, COUNT(*) AS leftover FROM deploy_deployments WHERE module_key = 'mini-contract'
-- UNION ALL SELECT 'deploy_module_stage_commands', COUNT(*) FROM deploy_module_stage_commands WHERE module_key = 'mini-contract'
-- UNION ALL SELECT 'deploy_pipelines', COUNT(*) FROM deploy_pipelines WHERE module_key = 'mini-contract'
-- UNION ALL SELECT 'deploy_versions', COUNT(*) FROM deploy_versions WHERE component = 'mini-contract'
-- UNION ALL SELECT 'deploy_modules(new)', COUNT(*) FROM deploy_modules WHERE `key` = 'kedou-ai-minigram';
