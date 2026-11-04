# 发布评审报告 · pm2 清单拆域（应用域 / console 域）

> 阻塞: 0 / 重要: 2
> 判据源：`docs/development/release-review-checklist.md`（A 运行 / B 配置 / C 数据 / D 前端 / E 特殊通道）
> 评审对象：`ecosystem.config.cjs`（改）、`ecosystem.apps.cjs`（新）、`ecosystem.console.cjs`（新）
> 评审日期：2026-10-11 · 评审角色：release-reviewer（独立第三方，不执行发布、不改码）

## 变更性质

把原来「一份清单装 12 个服务」拆成两个管理域，`ecosystem.config.cjs` 退化为合并入口：

| 文件 | 内容 | 服务数 |
|---|---|---|
| `ecosystem.apps.cjs` | 应用域（业务服务，不含 console） | 11 |
| `ecosystem.console.cjs` | console 域（deploy-console :6200） | 1 |
| `ecosystem.config.cjs` | 全量入口 = `require` 两域后合并 `apps` | 12 |

动机：deploy-console 是发布工具自身，会「发布自己」并重启自身进程；与应用共用一份清单时，一次全量 restart 会把业务服务一起重启，发布影响面不可控。

## A 运行面

| 判据 | 结论 | 证据 |
|---|---|---|
| A1 端口不漂移 | ✅ | `node -e "require('./ecosystem.config.cjs')"` 实测 12 项端口：gateway 6000 / auth 6101 / user 6002 / ai 6003 / ai-agent 6010 / system 6004 / todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008 / knowledge 6011 / deploy-console 6200 —— 与拆分前逐项一致 |
| A2 服务无遗漏 | ✅ | 拆分前 12 项 = 应用域 11 + console 域 1，逐名对拍无缺（含 2026-09-11 补登记的 knowledge 6011） |
| A3 既有命令不被破坏 | ✅ | `scripts/local-up.sh:71` `pm2 startOrRestart ecosystem.config.cjs` 走全量入口，行为等价；`scripts/bootstrap.sh:86` `require('$ROOT/ecosystem.config.cjs').apps` 仍能拿到全量 12 项 |
| A4 进程名 / cwd / 内存上限不变 | ✅ | 拆分前后逐字段一致（`web-*`、`servers/<svc>`、`dist/main.js`、`512M`） |
| A5 不被加载的目录 | ✅ | 三个文件同在仓库根，`require('./ecosystem.<域>.cjs')` 相对 `__dirname`，pm2 以文件所在目录加载，不依赖 cwd |
| A6 回滚路径 | ✅ | 删除两个域文件 + 还原 `ecosystem.config.cjs` 即回到单清单；无数据面改动、无破坏性变更 |

## B 配置面

| 判据 | 结论 | 说明 |
|---|---|---|
| B1 未注入新 env 值 | ✅ | `env` 仅 `PORT`，与原一致；未新增密钥/路径 |
| B2 服务器侧配置未受影响 | ✅ | `scripts/deploy-dev.sh` / `deploy-prod.sh` 同步的是 `ecosystem.config.js`（另一份、服务器用），本次未改动 |
| B3 无 `pm2 restart --update-env` 引入 | ✅ | 未涉及启停命令改动 |

## C 数据面
不涉及（无迁移、无 DB 改动）。

## D 前端面
不涉及。

## E 特殊通道

| 判据 | 结论 | 说明 |
|---|---|---|
| E1 console 自发布 | ✅ 改善 | console 自有清单后，`scripts/publish-deploy-console.sh` 只操作 console 域，不再牵连应用 |
| E2 孤儿进程风险 | ✅ | 注释已同步为「不在域清单中的服务 = 下一个孤儿进程」 |

## 重要（非阻塞，建议后续清理）

1. `scripts/local-up.sh:15` 注释仍写「10 个 web-* 服务」，与实际 12 不符 → 建议改为「11 应用 + 1 console，见 `ecosystem.apps.cjs` / `ecosystem.console.cjs`」。
2. `scripts/self-knowledge/corpgen.mjs:172` 及其产物 `scripts/self-knowledge/out/architecture.md:437` 仍把 `ecosystem.config.js` 称为「部署事实源」，未提本机 `.cjs` 域清单 → 建议补一句指向域文件。

## 结论

阻塞项 0，可放行；commit 带 `Release: pass`。
