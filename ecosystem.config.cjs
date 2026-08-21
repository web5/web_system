// web_system 本地后端服务 pm2 统一托管配置
// 用法:
//   pm2 start ecosystem.config.cjs            # 启动全部
//   pm2 status                                # 查看状态
//   pm2 restart web-gateway                   # 重启单个
//   pm2 save                                  # 保存进程列表(配合 pm2 startup 开机自启)
// 注意: auth-service 用 6101 端口, 因 6001 被 ~/workspace/erp_web_site/modules/auth 占用
module.exports = {
  apps: [
    { name: 'web-gateway',       cwd: __dirname + '/servers/gateway',       script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-auth',          cwd: __dirname + '/servers/auth-service',  script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-user',          cwd: __dirname + '/servers/user-service',  script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-ai',            cwd: __dirname + '/servers/ai-service',    script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-system',        cwd: __dirname + '/servers/system-service', script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-todo',          cwd: __dirname + '/servers/todo-service',  script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-mcp-gateway',   cwd: __dirname + '/servers/mcp-gateway',   script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-content-hub',   cwd: __dirname + '/servers/content-hub',   script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-upload',        cwd: __dirname + '/servers/upload-service', script: 'dist/main.js', max_memory_restart: '512M' },
    { name: 'web-deploy-console', cwd: __dirname + '/servers/deploy-console', script: 'dist/main.js', max_memory_restart: '512M' },
  ],
};
