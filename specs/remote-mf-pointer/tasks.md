# 远端微前端入口接通 · 任务清单

> 依据：[design.md](./design.md)（方案 B、D1–D7、2026-09-24 拍板）
> 顺序原则：**先换能力、后换语义** —— 任何一步都不让 prod 出现「指向不存在的路径」。
> 阶段 A→E 串行；每阶段结束都要能独立回退。

## 阶段 A · prod gateway 换二进制（不改语义）

| # | 任务 | 落点 | 验收 |
|---|---|---|---|
| A1 | 核对现状：DB `deploy_apps.deployMode`、`deploy_app_env_versions`、`deploy_sites` 在 prod 的登记情况；确认 portal/admin/shell 各自是 env-dir 还是 legacy | 只读 SQL，结果记入本文末尾「现状快照」 | 能回答「升级后哪些 app 会进 `byEnv`」 |
| A2 | 在本地 + dev 预演升级：同步新版 gateway dist + 依赖（含 `.pnpm` 副本）、dry-run | dev 机器 | dev `__manifest__.source=new` 且 portal/admin 无回归 |
| A3 | **升级 prod gateway 二进制**，但保持 legacy 读取语义（`DEPLOY_LEGACY_READ=1` 或确保 env-dir 应用尚未登记） | prod 机器 | `/health`=200；`__manifest__` 与升级前一致（portal/admin 仍在）；站点可访问 |
| A4 | 重启按 `docs/operations/release-checklist.md`：**禁止 `env -i`**，用 `pm2 start ecosystem.config.js --only gateway`，核对 `NODE_ENV=production` 与端口在位 | prod 机器 | pm2 env 完整、端口占用者 == pm2 pid |

⚠️ A3 是「先升级 gateway」的安全前提：**升级不等于切语义**。若升级时 env-dir 应用已登记但 env 层产物尚未投递，manifest 会指向不存在的路径 → 白屏。

## 阶段 B · 投递加 env 层 + shell 登记

| # | 任务 | 落点 | 验收 |
|---|---|---|---|
| B1 | 改造远端投递：`REMOTE_MODULES_ROOT/<app>/<envId>/<version>/`（`remote-delivery.service.ts:57` 与库内脚本 `p20` DEV_SCRIPT 的 `PUBLISH_PATH`） | `servers/deploy-console` + 流水线脚本迁移 | 一次发布后在目标机可见 env 层版本目录 |
| B2 | 用**现有版本**对各 env-dir 应用重新投递一次（内容不变，只换目录层） | prod 机器 | `modules/<app>/prod/<version>/index.js` 可访问 200；旧的 flat 目录保留不动 |
| B3 | shell 登记为 env-dir 应用（`deploy_apps.deployMode='env-dir'`）+ 投递其 env 层产物 | DB + prod 机器 | shell 版本目录就位 |
| B4 | 不双写 flat：确认新的投递路径不再产出 `modules/<app>/<version>/` | 流水线 | 新发布只落 env 层 |

## 阶段 C · gateway 读取改直拼版本目录（D1，方案 B 本体）

| # | 任务 | 落点 | 验收 = V1/V2 |
|---|---|---|---|
| C1 | `index-html.service.ts:180-187` 的 entry 由「指针路径」改为「版本目录路径」：`/static/modules/<app>/<env>/<version>/index.js`；指针存在时兼容保留 | `servers/gateway` | 单元/手工验证两种拼法 |
| C2 | 本地 + dev 验证：manifest 指向版本目录且入口 200 | 本机 / dev | dev 页面加载正常、manifest `source=new` |
| C3 | prod 切到新语义（去掉 legacy 开关 / 登记生效）+ 灰度观察 | prod 机器 | **V1**：`source=new` 且 shell 出现在 `byEnv.prod`；**V2**：入口 URL 200 |

## 阶段 D · 部署动作加远端生效校验（D5）

| # | 任务 | 落点 | 验收 = V3/V4 |
|---|---|---|---|
| D1 | 部署/切版本动作在写库**之后**校验远端：curl 目标机 manifest 版本 == 目标版本 且 入口 200 | `apps.service.switchVersion` / `deploy.service.deployVersion` 远端分支 | **V3** 通过后返回含 verified 标记 |
| D2 | 校验失败 → 动作显式失败（不静默成功）；重试 2 次 + 明确超时 | 同上 | **V4**：指向未投递版本时动作失败，DB 当前版本**不变** |
| D3 | 「最新发布」仍只写记录，不自动切版本（Q6）；页面保持「发布 ≠ 指针」分离 | 不改动 | 与 `p27` 口径一致 |

## 阶段 E · 端到端验收与收口

| # | 任务 | 验收 |
|---|---|---|
| E1 | 跑 V1–V7（design.md §6）全量 | 全部通过 |
| E2 | portal/admin 回归（legacy 应用在切换期间无回归） | **V6** |
| E3 | 回滚演练：DB 版本回退 → 入口恢复（无需重新投递） | **V5** |
| E4 | 文档收口：本文标记完成、`specs/version-deploy/design.md §7` 指向结果、`specs/app-artifact-env-dir` 的 Q5 关闭、发布清单若需补充则补 | 文档一致 |

---

## 依赖与风险（执行前先看）

- **B 必须在 C3 之前**：env 层产物未就位就切新语义 = 白屏。
- **A3 必须先于 C3**，且 A3 期间保持 legacy 语义（否则等于把 B 提前了）。
- **A 阶段是唯一的线上停机点**，需窗口 + 通知；C3 是配置/登记切换，秒级可回滚。
- prod 发布一律走 `docs/operations/release-checklist.md`：备份 dist、同步 `.pnpm` 副本、dry-run、`pm2 start ecosystem.config.js`。
- 不在本次范围：pipeline-node-model 的 host+SSH 通道、自动切版本、flat 历史目录清理（P2）。

## 现状快照（A1 执行后填写）

| 应用 | deployMode | prod 当前版本来源 | 备注 |
|---|---|---|---|
| portal | 待填 | 待填 | |
| admin | 待填 | 待填 | |
| shell | 待填（B3 改为 env-dir） | 待填 | 当前不在 `byEnv` |
