// web_system 本地后端服务 pm2 统一托管配置 · **全量入口**
//
// 自 2026-10-09 起拆成两个管理域（单一真相源在域文件里，本文件只做合并）：
//   ecosystem.apps.cjs     —— 应用域：11 个业务服务
//   ecosystem.console.cjs  —— console 域：deploy-console :6200（发布工具自身）
//
// 为什么拆域：console 会「发布自己」并重启自身进程，与应用共用一份清单时，
// 一次全量 restart 会把应用一起重启，发布影响面不可控。拆域后两者互不相干。
//
// 用法:
//   pm2 start ecosystem.config.cjs            # 启动全部（应用域 + console 域）
//   pm2 start ecosystem.apps.cjs              # 只启应用域
//   pm2 start ecosystem.console.cjs           # 只启 console 域
//   pm2 status                                # 查看状态
//   pm2 restart web-gateway                   # 重启单个（按 pm2 名）
//   pm2 save                                  # 保存进程列表(配合 pm2 startup 开机自启)
// 注意: auth-service 用 6101 端口, 因 6001 被 ~/workspace/erp_web_site/modules/auth 占用
//
// ⚠️ 端口写死（env.PORT）防漂移：
//   pm2 restart 会沿袭 pm2_env 里记录的旧 PORT（历史事故：web-ai-agent / web-todo 曾被误注入
//   6200），而 dotenv 默认不覆盖已存在的 process.env.PORT，导致服务启动抢错端口（EADDRINUSE）
//   或 gateway 上游 502。端口在各域文件中写死 env.PORT，保证恒为正确值。
//   端口表与 docs/development/local-release-runbook.md 对齐：
//   gateway 6000 / auth 6101 / user 6002 / ai-service 6003 / ai-agent 6010 / system 6004
//   todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008 / deploy-console 6200
//   knowledge 6011（2026-09-11 补登记：此前为手工 pm2 start，全量重启会漏管）
// ⚠️ 不在域清单中的服务 = 下一个孤儿进程：所有服务必须在域文件里登记，重启一律走
//   `pm2 delete <name> && pm2 start ecosystem.<域>.cjs --only <name>`。
const apps = require('./ecosystem.apps.cjs').apps;
const consoleApp = require('./ecosystem.console.cjs').apps;

module.exports = { apps: [...apps, ...consoleApp] };
