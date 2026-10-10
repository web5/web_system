// web_system 本机 pm2 清单 · **console 域**（仅 deploy-console :6200）
//
// 为什么独立成域（2026-10-09）：console 是发布工具自身，它「发布自己」时会重启自身
// 进程。与应用域共用一份清单时，一次 `pm2 restart ecosystem.config.cjs` 会把应用也
// 一起重启 —— 发布影响面不可控。拆域后：
//   - 启停/自发布 console：只操作本文件（或 scripts/publish-deploy-console.sh）
//   - 应用发布：只操作 ecosystem.apps.cjs
//   两边互不影响。
//
//   pm2 start ecosystem.console.cjs         # 只启 console
//   pm2 restart web-deploy-console          # 只重启 console
//
// ⚠️ 启停铁律（细节见 scripts/publish-deploy-console.sh）：
//   1) 6200 占用者必须 == pm2 当前 pid（console 只 app.listen()、无优雅退出，
//      restart 后旧进程不释放端口 → 新进程 EADDRINUSE 反复崩溃，对外仍是旧孤儿）；
//   2) 干净 env 启动：`env -i PATH=... HOME=...`（@nestjs/config 不覆盖已存在的
//      process.env，会话里残留的 PORT 会把 .env 的 6200 顶掉）；
//   3) 禁 `pm2 restart --update-env`（把执行会话变量固化进 pm2_env）；
//   4) 主密钥只注入**文件路径** CONFIG_MASTER_KEY_FILE，不注入值（防 ps e / dump 泄露）。
//
// 可选进程表级隔离（比清单隔离更彻底）：
//   PM2_HOME=~/.pm2-console pm2 start ecosystem.console.cjs
//   这样 console 拥有独立 daemon 与进程表，与应用的 pm2 完全不相干；
//   代价是运维要记住切换 PM2_HOME，故默认不启用（清单隔离已满足「互不影响」）。

const ROOT = __dirname;

module.exports = {
  apps: [
    { name: 'web-deploy-console', cwd: ROOT + '/servers/deploy-console', script: 'dist/main.js', max_memory_restart: '512M', env: { PORT: 6200 } },
  ],
};
