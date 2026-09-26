# 小程序账号能力 · 待办与跟进清单

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **来源**：2026-09-24 会话（小程序退出登录 / 绑定手机号 / 绑定邮箱 / 账号合并 / 邮件服务 / INTERNAL_API_KEY 治理）
> **用途**：把本次会话的**未决事项、待验证项、顺手发现的问题**集中成一处逐项跟进；结论性内容不重复，只给入口。
> **状态快照**：2026-09-24
> **分支**：`feature/mp-account`（基于 master，已推送，PR 由 auto-pr 自动建）

| 项 | 值 |
|---|---|
| 需求 spec | `specs/kedou-ai-minigram/requirements-mp-account.md` |
| 产品方案 | `specs/kedou-ai-minigram/design-mp-account.md`（含 §5.7 合并、§5.9 邮件服务） |
| 页面规格 | `specs/kedou-ai-minigram/page-spec-mp-account.md` |
| D2 / D3 评审 | `docs/ui/reviews/mp-account-20260924.md`、`mp-account-d3-20260924.md`（均 `阻塞: 0`） |
| 密钥治理 | `docs/development/internal-api-key-runbook.md`、`specs/service-config-delivery/internal-key-delivery-design.md` |

---

## 0. 待办总表（一页速览）

| # | 事项 | 状态 | 阻塞 / 前置 | 归属 |
|---|---|---|---|---|
| **F1** | 本地发布验证（release 目录跑通四个冒烟） | ⬜ 等你另一会话 release 验证完 | 需切分支 + 构建 + 重启 | 研发 |
| **F2** | 真机验证（退出 → 登录墙 → 绑手机号 → 合并 → 绑邮箱） | ⬜ | F1 + 微信开发者工具 | 研发 |
| **F3** | 合并链路双账号实测（13 张表 + 三张唯一键去重 + 凭证重签） | ⬜ | F1，需在 staging 造两个账号 | 研发（最复杂，优先实测） |
| **F4** | 控制台登记 `INTERNAL_API_KEY`（按 env，dev/prod **不同值**，`is_secret=1`） | ⬜ | 无 | 运维 |
| **F5** | `fetch-config.sh` 挂载到流水线 restart（**数据变更**，非代码） | ⬜ | 需按环境改 DB action 脚本 | 运维 |
| **F6** | 手机号资源包：确认额度，**用完前补购** | ⬜ | 运营在公众平台操作 | 运营 |
| **F7** | 小程序 request 合法域名（`dev.kedouai.com`）上线前登记 | ⬜ | 上线前 | 运营 |
| **F8** | 协议页文案：运营 / 法务回填 + 生效日期 | ⬜ | 无 | 运营 + 法务 |
| **F9** | Q2/Q3/Q4 退出细节（草稿缓存 / 免密恢复 / 打点） | ⬜ 待拍板 | 无 | 你 |
| **F10** | Q7/Q8 绑定细节（唯一性口径 / 更换是否验旧号） | ⬜ 待拍板 | 无 | 你 |
| **F11** | Q9 是否并行上 `unionid` 打通 | ⬜ 待拍板 | 需绑微信开放平台 | 你 |
| **F12** | Q10–Q12 注销账号（协议页已标注"开发中"） | ⬜ 未排期 | 合规口径 | 你 |
| **F13** | Q13 发版批次（随现批次 or 单开） | ⬜ 待拍板 | 无 | 你 |
| **F14** | `prod.env` 的 `MINI_PROGRAM_SECRET` 与 `OFFICIAL_ACCOUNT_SECRET` 同值 → **上线前核对** | ⬜ 发现未修 | 无 | 你 / 运维 |
| **F15** | internal 调用失败的错误细分（未配置 / 不匹配 / 对端未配置） | ⬜ 建议做 | 无 | 研发 |
| **F16** | admin 其它"假实现 / 死配置"排查（本次只修了 testEmail 与 SMTP 回退） | ⬜ | 无 | 研发 |
| **F17** | `env_config/web_system/README.md` 与 `deploy.sh` 行为漂移 | ⬜ | 无 | 运维 |
| **F18** | 展示层存量假数据（昵称 / UID / 加入时间 / 缓存大小 / 实名） | ⬜ 存量 | 无 | 研发 |
| **F19** | 退出时未清的其它缓存键（`conv_detail_*`、`LIST_CACHE`、`RESUME_CONV_KEY`、`kd_translate_params`） | ⬜ | 无 | 研发 |
| **F20** | 发布目录各服务 `.env` 无同步脚本（根本缺口） | ⬜ | 无 | 运维 |

---

## 1. 验证类（F1–F3）

### F1 · 本地发布验证（按顺序，能最快定位）

1. `git -C ~/web_system_release branch --show-current` —— 确认没被流水线切回 master
2. fetch + `checkout feature/mp-account` + `--ff-only` merge
3. **`cd packages/shared && npm run build`** —— 不能省（本次踩过：dist 旧产物缺 `Public` 导出 → auth/user-service 报假错）
4. 构建三个服务，重启 `web-auth` / `web-user` / `web-gateway`，按孤儿进程铁律核对 `lsof -ti tcp:<port>` 持有者 == `pm2 list` 的 pid
5. 四连冒烟：
   - `POST /api/auth/logout`（带 token）→ 用**同一** token 打 `GET /api/users/me` 应 401（黑名单跨服务生效，≤5s）
   - 旧 refresh token 打 `POST /api/auth/refresh` 应 401
   - `POST /api/users/email/code` 应返回发送成功（SMTP 已配）
   - 直连 6101 打 `POST /internal/auth/token-status` 应返回 `{valid:...}`

> ⚠️ 验证前先 `ls ~/web_system_release/servers/*/.env.generated`：有残留会**盖过 `.env`**（本次已让 11 个服务优先加载 generated），删掉即回退。

### F2 · 真机验证路径

我的页 → 退出登录（弹窗）→ 对话/发现/我的三 tab 均只显示登录引导卡 → 一键登录恢复 → 我的 → 个人信息 → 手机号「未绑定」→ 授权 → 冲突 → 确认合并 → 显示脱敏号；邮箱走绑定页（收码）。

### F3 · 合并必须双账号实测

合并是本次风险最高的一块（Q15=c）：13 张表迁移、三张有 `(user_id, …)` 唯一键的表需先去重、`merged_to` 留痕、凭证重签。
**建议在 staging 造两个账号（一个有手机号、一个匿名有数据）跑一遍**，核对：合并后数据出现在目标账号、旧 token 401、无重复行、再用同一微信登录落到目标账号。

---

## 2. 配置与运维（F4–F8）

| # | 具体动作 |
|---|---|
| F4 | 控制台 → 配置中心：新增 `INTERNAL_API_KEY`（`is_secret=1`），**dev 与 prod 用不同值**。注：deploy-console 自身不生效（它只能读自己的 `.env`，是下发链的根） |
| F5 | 在 restart 阶段的 action 脚本里、**重启命令之前**加一行 `bash <RELEASE_DIR>/scripts/pipeline/fetch-config.sh`（脚本已就绪并实测）。变量由平台注入：`CONSOLE_API` / `CONSOLE_TOKEN` / `DEPLOY_ENV_ID` / `RELEASE_DIR` / `MODULE_KEY` |
| F6 | 公众平台 → 付费管理：确认手机号资源包额度。1000 次体验额度是**开发版/体验版/正式版共用**，联调别刷；额度耗尽会导致线上直接不可绑 |
| F7 | 上线前把 `dev.kedouai.com` 加入小程序 request 合法域名 |
| F8 | 协议页（`pages/mine/agreement/agreement.wxml`）三段文案待运营/法务确认，页脚生效日期为占位 |

---

## 3. 待你拍板（F9–F13）

| # | 问题 | 现状默认值 |
|---|---|---|
| F9 | 退出后本地草稿/最近会话是否清；是否要"7 天内免密恢复"；是否打点 | 清本地态、不免密、不打点 |
| F10 | 手机号/邮箱唯一性口径；更换时是否验证旧号 | 唯一 + 冲突合并；更换只需重新授权 |
| F11 | 是否并行上 `unionid` 打通（微信生态内免绑号） | 未做 |
| F12 | 注销账号是否做、做哪种形态 | 未做，协议页已标注"开发中" |
| F13 | 本批随现批次还是单开一期 | 未定 |

---

## 4. 顺手发现但未修（F14–F20）

| # | 问题 | 证据 / 说明 |
|---|---|---|
| F14 | ~~同值疑似填错~~ ✅ **已核对：确认同值（真错，待修）** | 2026-09-26 指纹比对（不明文）：`prod.env` 两值 sha256 前缀均为 `b3b176000412`、len=32 → 确为同一串。**上线前必须改成各自真实值**，否则小程序换号会用错密钥。详见下方「F14 核对记录」 |
| F21 | **新增（核对 F14 时发现）**：`dev.env` 的 `MINI_PROGRAM_SECRET` **为空**（len=0）；且 dev 与 prod 的 `OFFICIAL_ACCOUNT_SECRET` **同值**（未隔离） | `~/env_config/web_system/dev.env`。dev 小程序登录会因此失败；dev/prod 共用公众号密钥属环境隔离问题 |
| F15 | internal 调用失败只报 `internal forbidden`，分不清"本端未配置 / 值不匹配 / 对端未配置" | `InternalGuard`（各服务），排查成本最高的一环 |
| F16 | admin 可能存在其它"假实现 / 死配置"（本次修了「发送测试邮件」的 `message.info` 假实现与 SMTP 死配置） | 建议顺一遍 `apps/admin/src/views/Settings.vue` 的其它按钮 |
| F17 | `~/env_config/web_system/README.md:44-56` 描述 deploy.sh 会生成 `.env.production`，与当前 `scripts/deploy.sh` 实际行为不一致 | 文档漂移 |
| F18 | 展示层仍有存量假数据：昵称「橙子哥哥」、UID「100238」、加入时间「2026-03」、缓存「24.6MB」、实名「已认证」 | `pages/mine/profile/profile.ts`、`pages/mine/index/index.ts` |
| F19 | 退出只清了 `welcome_recent_cache`；`conv_detail_*`、`LIST_CACHE`、`RESUME_CONV_KEY`、`kd_translate_params` 未清 | `services/auth.ts` 的 `clearLocalAccountState()` |
| F20 | 发布目录各服务 `.env` 全靠人工同步，无脚本、无一致性校验 | 本次补 `INTERNAL_API_KEY` 时才暴露：8 个服务里有 2 个漏配 |

### F14 核对记录（2026-09-26）

> 方式：只比对 **sha256 前 12 位 + 长度**，不打印明文，避免密钥进终端历史与日志。

| 环境 | MINI_PROGRAM_SECRET | OFFICIAL_ACCOUNT_SECRET | 结论 |
|---|---|---|---|
| prod | `b3b176000412` / len=32 | `b3b176000412` / len=32 | ⚠️ **同值 —— 确认填错，待修** |
| dev | len=**0**（空） | `b3b176000412` / len=32 | ⚠️ 小程序密钥缺失；公众号密钥与 prod 未隔离 |

**待修动作（上线前）**：
1. prod：取小程序真实 `AppSecret` 填入 `MINI_PROGRAM_SECRET`（与公众号 `AppSecret` 天然不同）。
2. dev：补 `MINI_PROGRAM_SECRET`（可复用小程序测试号密钥）。
3. dev/prod 的公众号密钥分开（至少 dev 用测试号）。
4. 改完用同一指纹脚本复核：同一环境内不同键应不同，跨环境应不同。

---

## 5. 已完成清单（对照，避免重复劳动）

| 完成项 | 落地位置 |
|---|---|
| 需求 spec + 产品方案（含合并、邮件服务设计） | `specs/kedou-ai-minigram/{requirements,design}-mp-account.md` |
| 原型（登录引导卡 / 三态 / 合并确认 / 邮箱页 / 协议页） | `apps/kedou-ai-minigram/prototype/index.html` |
| 退出登录（登录墙 + 服务端凭证作废 + 不自动重登） | commit `9fb56ae`（小程序）、`9970f3d`（auth/gateway） |
| token 加 `sid`，一次登出作废 access + refresh；黑名单统一到 auth-service | `9970f3d` |
| 绑定手机号 / 邮箱 + 账号合并 + 邮件验证码服务 | `d99ba98`；迁移 `migrations/0014_mp_account_phone_email.sql`（已本地应用） |
| 小程序端绑定与合并、协议页 | `f361760` |
| 邮件配置回退读 `system_configs`（修复 admin 通知设置死配置） | `5d06702` 分支提交 `acf1f4e` |
| 「发送测试邮件」接真（此前是假提示） | `2d038e9` |
| `INTERNAL_API_KEY` 改为可走配置中心下发 + `fetch-config.sh` | `663aa2e` |
| 评审报告（D2 / D3 均 `阻塞: 0`） | `docs/ui/reviews/mp-account{,d3}-20260924.md` |

---

## 6. 下一步建议顺序

1. **F4（控制台登记密钥）+ F6（确认资源包额度）** —— 都不依赖代码，可并行先做
2. **F1 → F3** —— 本地发布验证，然后**优先实测合并链路**（风险最高）
3. **F2 真机** —— 走一遍完整路径
4. **F15（错误细分）** —— 验证期最容易被这个问题拖慢，建议验证前一并做掉
5. **F8 / F7** —— 上线前置（文案 + 域名）
6. **F9–F13** —— 找时间一次性拍板
7. **F14 / F16–F20** —— 按余力排；F14 上线前必查
