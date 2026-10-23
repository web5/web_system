# D3 实现一致性评审 · 账号连通性检测（probe）

- 日期：2026-10-24
- 关联原型：`docs/ui/prototypes/admin-media-ops.html` p11（Proto: d0931b35，本轮原型无改动）
- 页面规格：`docs/ui/page-specs/content-accounts-v1.md`（连通性列 + 检测动作）
- 后端：content-hub `POST /api/content/accounts/:id/test`
- 前端：admin `apps/admin/src/views/Content/ContentAccounts.vue` + `api/content.ts`

## 1. 需求回顾

账号页「检测」按钮是死按钮（点击只弹「待后端接口落地」）。本轮把它接通：
解密凭据 → 换 stable_token 实测 → 结论 ok/warn/err + 人话原因 → 回填 last_check_*。

## 2. 交互与原型对照

| 原型（p11） | 实现 | 一致性 |
|---|---|---|
| 「测试连通性」按钮（需 admin 角色） | 行内「检测」按钮，`canManage`（content:manage）可见，loading 态 | ✅ |
| 检测提示「权限不足会在这里提前暴露（如 48001）」 | warn 档承接 40164（IP 白名单）等「凭据对但受限」；结论以 message 弹出 | ✅ |
| 连通性列：正常 / 异常 / 未检测 | ok=正常（绿）/ warn=权限不足（橙）/ err=失败（红）/ null=未检测 | ✅（warn 档比原型细一档，超出但不冲突） |
| 检测时间展示 | tag 下方 `MM-DD HH:mm` | ✅ |

## 3. 设计决议（含为什么）

1. **只探活不写平台**：仅调 `stable_token`（+尽力 `getaccountbasicinfo` 回填昵称），
   不调用任何改变公众号数据的接口——检测必须是零副作用动作。
2. **warn ≠ err**：40164 = 凭据正确但本机 IP 不在白名单 → warn，运营该去加白名单而不是重录凭据；
   40013/40125 = 凭据错 → err。语义映射进 `last_check_status`（列定义早已有 warn 档）。
3. **失败也落库**：err 同样写 `last_checked_at/last_check_status`，列表「未检测/失败」才有据可查。
4. **凭据零暴露**：接口只回 status/message/latency/checked_at；message 不含密文与 secret；
   解密失败信息照透（如「未配置 ACCOUNT_CRED_KEY_FILE」）但不含密文。
5. **超时**：token 8s / basicinfo 5s（AbortController），探活不能挂死管理页。
6. **昵称回填尽力而为**：未认证号可能拿不到 basicinfo，失败静默——昵称是锦上添花。

## 4. 阻塞项

无。

## 5. 验证

- 单测 8 条全过（service 层：ok/40125/40164/无凭据/非微信平台/解密失败/404/basicinfo 挂）；content-hub 全量 101/101 绿。
- admin 本地 vue-tsc/build 因本机内存限制未跑完——编译由 dev 机发布流水线构建门兜底（历史同一模式）。
- 真实链路：dev/prod 发布后点「检测」按钮看结论（大橙子社区应为 ok，因 dev/prod 出网 IP 不同若 warn 则是白名单问题，属预期路径）。
