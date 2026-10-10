// web_system 本机 pm2 清单 · **应用域**（11 个业务服务，不含 deploy-console）
//
// 为什么拆成两个域（2026-10-09）：deploy-console 是发布工具自身，它的启停/自发布
// 不应与应用服务互相牵连 —— 拆域后，「重启 console」与「重启应用」是两条互不相干的
// pm2 操作，发布影响面可控，架构上也更纯粹（运维平台 vs 被管应用）。
//
//   pm2 start ecosystem.apps.cjs            # 只启应用域
//   pm2 restart ecosystem.apps.cjs --only web-gateway
//   pm2 start ecosystem.config.cjs          # 全量（= 应用域 + console 域）
//
// ⚠️ 端口写死（env.PORT）防漂移：pm2 restart 会沿袭 pm2_env 里的旧 PORT，
//   而 dotenv 默认不覆盖已存在的 process.env.PORT → 服务会抢错端口（EADDRINUSE）
//   或让 gateway 上游 502。统一在此写死，保证 pm2 注入的 PORT 恒为正确值。
//   端口表与 docs/development/local-release-runbook.md 对齐：
//   gateway 6000 / auth 6101（6001 被 erp_web_site 占用）/ user 6002 / ai-service 6003
//   system 6004 / todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008
//   ai-agent 6010 / knowledge 6011
// ⚠️ 不在本清单中的服务 = 下一个孤儿进程：所有应用服务必须在此登记。

const ROOT = __dirname;

module.exports = {
  apps: [
    { name: 'web-gateway',        cwd: ROOT + '/servers/gateway',             script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6000 } },
    { name: 'web-auth',           cwd: ROOT + '/servers/auth-service',        script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6101 } },
    { name: 'web-user',           cwd: ROOT + '/servers/user-service',        script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6002 } },
    { name: 'web-ai',             cwd: ROOT + '/servers/ai-service',          script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6003 } },
    { name: 'web-ai-agent',       cwd: ROOT + '/servers/ai-agent',            script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6010 } },
    { name: 'web-system',         cwd: ROOT + '/servers/system-service',      script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6004 } },
    { name: 'web-todo',           cwd: ROOT + '/servers/todo-service',        script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6005 } },
    { name: 'web-mcp-gateway',    cwd: ROOT + '/servers/mcp-gateway',         script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6006 } },
    { name: 'web-content-hub',    cwd: ROOT + '/servers/content-hub',         script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6007 } },
    { name: 'web-upload',         cwd: ROOT + '/servers/upload-service',      script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6008 } },
    { name: 'web-knowledge',      cwd: ROOT + '/servers/knowledge-service',   script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6011 } },
  ],
};
