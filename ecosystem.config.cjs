// web_system 本地后端服务 pm2 统一托管配置
// 用法:
//   pm2 start ecosystem.config.cjs            # 启动全部
//   pm2 status                                # 查看状态
//   pm2 restart web-gateway                   # 重启单个
//   pm2 save                                  # 保存进程列表(配合 pm2 startup 开机自启)
// 注意: auth-service 用 6101 端口, 因 6001 被 ~/workspace/erp_web_site/modules/auth 占用
//
// ⚠️ 端口写死（env.PORT）防漂移：
//   pm2 restart 会沿袭 pm2_env 里记录的旧 PORT（历史事故：web-ai-agent / web-todo 曾被误注入
//   6200），而 dotenv 默认不覆盖已存在的 process.env.PORT，导致服务启动抢错端口（EADDRINUSE）
//   或 gateway 上游 502。统一在此写死 env.PORT，保证 pm2 注入的 PORT 恒为正确值。
//   端口表与 docs/development/local-release-runbook.md 对齐：
//   gateway 6000 / auth 6101 / user 6002 / ai-service 6003 / ai-agent 6010 / system 6004
//   todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008 / deploy-console 6200
//   knowledge 6011（2026-09-11 补登记：此前为手工 pm2 start，全量重启会漏管）
// ⚠️ 不在本清单中的服务 = 下一个孤儿进程：所有服务必须在此登记，重启一律走
//   `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>`。
module.exports = {
  apps: [
    { name: 'web-gateway',        cwd: __dirname + '/servers/gateway',        script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6000 } },
    { name: 'web-auth',           cwd: __dirname + '/servers/auth-service',   script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6101 } },
    { name: 'web-user',           cwd: __dirname + '/servers/user-service',   script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6002 } },
    { name: 'web-ai',             cwd: __dirname + '/servers/ai-service',     script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6003 } },
    { name: 'web-ai-agent',       cwd: __dirname + '/servers/ai-agent',       script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6010 } },
    { name: 'web-system',         cwd: __dirname + '/servers/system-service', script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6004 } },
    { name: 'web-todo',           cwd: __dirname + '/servers/todo-service',   script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6005 } },
    { name: 'web-mcp-gateway',    cwd: __dirname + '/servers/mcp-gateway',    script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6006 } },
    { name: 'web-content-hub',    cwd: __dirname + '/servers/content-hub',    script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6007 } },
    { name: 'web-upload',         cwd: __dirname + '/servers/upload-service', script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6008 } },
    { name: 'web-deploy-console', cwd: __dirname + '/servers/deploy-console', script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6200 } },
    { name: 'web-knowledge',      cwd: __dirname + '/servers/knowledge-service', script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6011 } },
  ],
};
