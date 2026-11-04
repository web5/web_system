# 发布评审报告：小程序 CI 预览脚本改造

> 对象：`apps/kedou-ai-minigram/scripts/preview.js`、`apps/kedou-ai-minigram/scripts/upload.js`、`.gitignore`
> 日期：2026-10-10 ｜ 分支：`chore/minigram-ci-preview`

```
阻塞: 0
重要: 1
```

## 变更面说明

本次改动作用域是**微信小程序 CI 出码脚本**（运行在开发者本机或 CI 机器，直连微信后台），**不参与服务端发布链路**：不构建 pm2 服务、不写业务库、不动微前端产物。

因此清单 A/B/C/D 绝大部分对本改动不生效，逐条判定如下（N/A 项统一说明理由，避免"看着像该检查"的歧义）。

## A. 运行面

| 判据 | 判定 | 说明 |
|---|---|---|
| A1/A2 发布目录构建 | N/A | 无服务端构建产物，脚本由执行者在仓库目录直接运行 |
| A3 workspace 包 build | N/A | 未改动 `packages/*` |
| A4 端口占用 | N/A | 不启进程，脚本跑完即退 |
| A5 ecosystem 登记 | N/A | 非常驻服务 |

## B. 配置面

| 判据 | 判定 | 说明 |
|---|---|---|
| B1 pm2 update-env | N/A | 不涉及进程重启 |
| B2 跨服务密钥一致 | N/A | 未新增跨服务调用 |
| B3 关键依赖配置非缺失 | N/A | 无服务端依赖注入 |
| **B4 占位符密钥** | ✅ 通过 | CI 私钥 `private.key` **不在本次提交内容内**。核验：`.gitignore` 双保险（显式路径 + `*.key`）、`git status --porcelain` 无该文件、`git log --all -- apps/kedou-ai-minigram/private.key` 为空（历史从未入库） |
| B5 配置源唯一 | ✅ 通过 | 配置项全部走环境变量与已有文件，未新增第二配置源 |

## C. 数据面

C1–C6 全部 N/A：无迁移脚本、无 SQL、无字典/权限码绑定。

## D. 前端面

| 判据 | 判定 | 说明 |
|---|---|---|
| D1–D3 微前端三步 / 版本指针 | N/A | 小程序走 CI 上传通道，不经过 gateway 静态目录与 `deploy_app_env_versions` |
| **D 产出物独立** | ✅ 通过 | 二维码产出目录 `.ci-output/` 已加 `.gitignore`（本次随改动一块提交），不会被当作源产物投递 |

## E. 特殊通道

| 判据 | 判定 | 说明 |
|---|---|---|
| E1 deploy-console | N/A | 与 console 发布无关 |
| E2 后端重启 | N/A | 无后端变更 |
| **E3 变更后有验证动作** | ✅ 通过（有证据） | 两处脚本改动后**实跑出码成功**：<br>① 本地：编译 136 文件 / zip 294KB 上传成功，二维码落盘成功<br>② 远端固定机器：同脚本复跑，编译上传成功、二维码落盘成功<br>即"改了之后真的能出码"，不是只跑语法检查 |
| **E4 PR 自动合入 + merge commit** | 待办 | 合并后按 E4 用 `gh pr view --json autoMergeRequest,mergeCommit` 对账；未挂则 `gh pr merge --auto --merge` |

## 安全与去敏（公开仓库约束）

`web5/web_system` 为 PUBLIC 仓库。已核：本次改动的脚本注释、报告、gitignore **均未出现**服务器 IP、SSH 用户名、绝对路径，示例路径统一用 `~/mp-ci` 这类通用写法。

## 重要项（非阻塞）

**【重要】`MINIPROGRAM_CI_PATH` 未显式设置时，在完整 monorepo 安装环境仍会踩依赖提升冲突。**

- 情形：直接 `node scripts/preview.js` → 实际 `_lruCache is not a constructor`，期望：正常出码
- 根因：仓库是 pnpm monorepo，根提升的 `@babel/helper-compilation-targets` 与 `miniprogram-ci` 的编译链不兼容（**本次改动前已存在**，非本次引入）
- 本次处理：脚本顶部改为按 `MINIPROGRAM_CI_PATH` 从隔离安装的依赖加载，并写明原因与环境准备命令
- 为什么不算阻塞：不设置时行为与改动前一致（同样失败、同样有清晰报错），且 commit 说明与脚本注释已给出解法
- 后续收敛：① 补 `docs/miniprogram/release-runbook.md` 固化用法；② 抽离进 console 发布流水线时，由流水线统一注入该变量，执行者无需感知

## 结论

阻塞 0，同意放行，trailer 用 `Release: docs/reviews/release-review-2026-10-10-minigram-ci.md`。
