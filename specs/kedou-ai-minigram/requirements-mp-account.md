# 科豆 AI 小程序 · 账号能力需求 spec（退出登录 / 绑定手机号）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：把小程序「退出登录」「绑定手机号」及相邻账号占位功能，转成可验证的需求 spec（验收判据 / 反例 / 待确认），供方案设计与开发、测试质疑。
> 范围：`apps/kedou-ai-minigram`（前端）+ `servers/auth-service` / `servers/user-service`（后端）+ `migrations/`
> 上游：本文件只定义「做成什么」；「怎么做」见 `specs/kedou-ai-minigram/design-mp-account.md`

---

## 0. 现状事实（代码为真相源，供读文档时核对）

| 事实 | 位置 |
|---|---|
| 登录是 `wx.login` 静默换取 token，全程无感、无登录页、无未登录态 UI | `apps/kedou-ai-minigram/services/auth.ts:24-70`、`app.ts:20-51` |
| token 存 storage `access_token` / `refresh_token`；`clearToken()` 已实现但零业务调用 | `apps/kedou-ai-minigram/utils/request.ts:8-9, 44-65` |
| 无 token / 401 时会自动静默重登（`ensureLogin`），即「退出」后任何请求都会把自己登回来 | `utils/request.ts:102-104, 124-138`、`services/auth.ts:78-91` |
| 「退出登录」两处入口均为占位：`showToast('退出登录开发中')` / 弹窗确认后只 `showToast('已退出')` | `pages/mine/index/index.ts:78`、`pages/mine/settings/settings.ts:75-83` |
| 后端 `POST /api/auth/logout` 已存在（access token 进 Redis 黑名单），但 refresh token 不受影响、黑名单不被 user-service / gateway Guard 校验 | `servers/auth-service/src/auth/auth.controller.ts:62-71`、`auth.service.ts:245-273` |
| 手机号完全空白：`phone: '138****6688'` 硬编码假数据，`editPhone()` 是 toast 占位 | `pages/mine/index/index.ts:19`、`pages/mine/profile/profile.ts:14,20` |
| 后端无手机号绑定接口、无微信 `getPhoneNumber` 换号实现、无短信验证码能力；唯一可改 phone 的口子是 `PUT /api/users/me`（无格式/唯一/凭证校验） | `servers/user-service/src/user/user.controller.ts:41-48`、`dto/update-user.dto.ts:30-33` |
| `users.phone` 可空、无唯一索引；`users` 表无 `unionid` 列 | `migrations/0007_baseline_tables.sql:436-458` |
| 小程序 appid 已配：`wxe7635bce95e7cff0` | `apps/kedou-ai-minigram/project.config.json:65` |

---

## 1. 需求全景与优先级

| ID | 需求 | 一句话做成定义 | 优先级 | 依赖 |
|---|---|---|---|---|
| R1 | 退出登录 | 用户点「退出登录」→ 二次确认 → 服务端 token 作废 + 本地登录态清空 → 进入未登录（游客）态，且**不会**被自动重登回来 | P0 | 后端 logout 补齐 refresh 失效 + 黑名单校验下沉 |
| R2 | 绑定手机号 | 用户在小程序内经微信手机号授权（一键获取）完成手机号绑定，绑定后「我的」/「个人信息」显示脱敏号码，未绑定显示「去绑定」 | P0 | 后端新增 `bind-phone`；微信能力开通 |
| R3 | 账号资料完善（昵称 / 头像 / 邮箱） | 同 R2 的形态补齐，供 R1/R2 一起构成完整「账号与安全」域 | P1 | 后端同 R2 的凭证校验范式 |
| R4 | 账号注销 | 提供注销入口（平台规范要求，见 §5 待确认） | P2 | 待拍板 |
| R5 | 其余「开发中」占位收口 | 见 §6 清单，按 P1/P2 分批 | P1/P2 | — |

> 本 spec 只对 **R1、R2** 给出完整验收判据；R3 沿用 R2 判据模板，R4/R5 只列待确认与清单，不臆造判据。

---

## 2. R1 需求 spec：退出登录

### 做成定义（一句话可验证）

> 用户在「我的」页或「小程序设置」页点击退出登录并二次确认后，系统立即作废其登录凭证、清空本地登录态与内存态用户数据，并呈现未登录（游客）态；在用户主动点击「微信一键登录」之前，系统不自动恢复登录。

### 验收判据（EARS，可机器核对）

- [ ] WHEN 用户在「我的」页点击「退出登录」 THE SYSTEM SHALL 弹出二次确认弹窗（标题「退出登录」、含「取消 / 确认」两按钮），且确认前不改变任何登录态
- [ ] WHEN 用户在弹窗中点击「确认」 THE SYSTEM SHALL 以当前 access token 调 `POST /api/auth/logout`，且在响应返回（或 3s 超时）后清空 storage 中 `access_token` 与 `refresh_token`
- [ ] WHEN 退出完成 THE SYSTEM SHALL 清空内存态用户数据（`app.globalData.userInfo`、最近会话缓存 `welcome_recent_cache`、口味/偏好本地缓存、生词本本地缓存），并跳转至「我的」页顶部（非 tabBar 跳转的欢迎页）
- [ ] WHEN 处于未登录态 THE SYSTEM SHALL 在「我的」页展示「未登录 / 微信一键登录」态（头像为默认占位、隐藏手机号与实名信息、隐藏「退出登录」入口）
- [ ] WHEN 处于未登录态且用户发起任意需要账号的请求 THE SYSTEM SHALL **不**自动触发 `wx.login`，且该请求以「请先登录」提示结束（不再走 401 自动重登分支）
- [ ] WHEN 处于未登录态 THE SYSTEM SHALL 拦截全部功能入口（对话 / 发现 / 我的数据 / 偏好 / 生词本 等），展示登录引导卡（说明 + 「微信一键登录」按钮），**不允许**在未登录状态下使用任何业务功能
- [ ] WHEN 处于未登录态且用户访问「对话」或「发现」tab THE SYSTEM SHALL 只渲染登录引导卡，不发起任何业务接口请求
- [ ] WHEN 用户在登录引导卡点击「微信一键登录」 THE SYSTEM SHALL 完成登录后自动刷新当前页内容（无需用户手动再点一次入口）
- [ ] WHEN 用户在未登录态点击「微信一键登录」 THE SYSTEM SHALL 走 `wx.login` → `miniprogram-login` 恢复登录，并保留原有账号（同一微信同一 appid 回到同一 openid 账号）
- [ ] IF 退出时 `logout` 接口返回 401 / 网络失败 THEN THE SYSTEM SHALL 仍然完成本地清态并进入未登录态（本地退出优先，服务端失败不阻塞）
- [ ] IF 用户点「取消」 THEN THE SYSTEM SHALL 关闭弹窗且保持登录态、不做任何清理
- [ ] WHEN 退出后服务端收到已退出的 access token THE SYSTEM SHALL 在 `GET /api/auth/verify` 上判定为无效（黑名单命中）
- [ ] WHEN 退出后服务端收到该用户的 refresh token 调 `POST /api/auth/refresh` THE SYSTEM SHALL 拒绝（refresh 一并失效）
- [ ] WHEN 退出后服务端收到已退出的 access token 调 `GET /api/users/me` 或 `PUT /api/users/me` THE SYSTEM SHALL 返回 401（黑名单校验覆盖 auth-service 之外的服务），且自登出成功起 **≤5s** 内即生效（gateway 侧黑名单查询允许 5s 缓存窗口）

### 边界 / 反例（不算做成）

- 反例1：点了退出，页面跳走/显示「已退出」，但 token 仍在 storage 里 → 不算做成（必须有 `clearToken()` 落库验证）
- 反例2：退出后几秒内用户刷新页面/切 tab，被 `ensureLogin()` 静默登回 → 不算做成（自动重登必须被未登录态拦住）
- 反例3：退出后旧 token 仍能调通 `/api/users/me` → 不算做成（黑名单未下沉）
- 反例4：退出后旧 refresh token 仍能换出新 access token → 不算做成
- 反例5：退出把用户服务端数据删了（会话、生词本） → 属超范围破坏；退出只清本地态，不动服务端数据
- 反例6：「退出」实际做成「切换微信账号」 → 不成立（同一微信 + 同一 appid 的 `wx.login` 恒返回同一 openid，无换号能力），此类诉求应走 R4 注销
- 反例7：退出后页面白屏、或强制跳欢迎页且无登录入口 → 不算做成（未登录态必须有明确登录入口）
- 反例8：退出后仍能浏览对话/发现页内容（哪怕只读）→ 不算做成（已拍板：必须登录才可用）

### 必然失败清单

- 做法A（错）：只 toast「已退出」，不调接口、不清 token → 规避：验收判据第 2 条要求 storage 可验证为空，且 `GET /api/auth/verify` 判无效
- 做法B（错）：清了本地 token 但不拦自动重登 → 规避：`ensureLogin()` 与 `request.ts` 的无 token 自动登录分支必须检查「用户主动退出」标志位（落 storage），判据第 5 条
- 做法C（错）：把退出做成「跳到欢迎页」（欢迎页无登录 UI，且是启动页，语义错位）→ 规避：退出后停在「我的」页的未登录态，登录入口就在原地
- 做法D（错）：退出时把 `api_base`、小程序设置项一并清了 → 规避：只清登录态与用户态键，设置项独立维护

### 待确认项（交人拍板）

- [ ] Q2：退出后本地数据（草稿输入、最近会话缓存）是否一并清除？— 本 spec 默认清，用户草稿保留在页面内存不落库
- [ ] Q3：是否需要「退出后 7 天内免密恢复」这类柔性策略？（涉及后端 refresh 策略改造）
- [ ] Q4：退出行为是否要打点上报（登录态事件）？

---

## 3. R2 需求 spec：绑定手机号

### 做成定义（一句话可验证）

> 用户点击「绑定手机号」后，经微信手机号授权组件一键获取号码（用户不手输、不接验证码），服务端完成校验与落库；绑定成功后「我的」页与「个人信息」页显示脱敏手机号，未绑定显示「去绑定」，已绑定用户可「更换」并重新走同一授权流程。

### 验收判据（EARS，可机器核对）

- [ ] WHEN 用户点击「绑定手机号 / 去绑定」 THE SYSTEM SHALL 通过微信 `<button open-type="getPhoneNumber">` 发起手机号授权，不使用自行输入的手机号表单
- [ ] WHEN 用户在微信授权弹窗中允许 THE SYSTEM SHALL 用 `e.detail.code` 调 `POST /api/auth/bind-phone`（携带 access token），一次 code 只用一次
- [ ] WHEN 服务端收到有效 code THE SYSTEM SHALL 以小程序 access_token 调微信 `getuserphonenumber` 换取真实手机号，并把该号码写入当前用户 `phone` 字段（不落库明文到日志）
- [ ] WHEN 绑定成功 THE SYSTEM SHALL 返回脱敏手机号（格式 `138****6688`），前端立即刷新「我的」页与「个人信息」页展示
- [ ] IF 该手机号已被其他账号绑定 THEN THE SYSTEM SHALL 返回可识别冲突（409 `PHONE_ALREADY_BOUND` + `canMerge: true` + 脱敏号 + 说明文案），**在用户二次确认之前不得覆盖、不得换绑、不得合并**
- [ ] WHEN 用户在冲突提示中确认合并 THE SYSTEM SHALL 把当前匿名账号（A）的全部业务数据并入手机号所属账号（B）：会话 / 生词本 / 用户记忆 / 口味偏好等 13 张表的 `user_id`（`owner_id`）改写为 B，且归属字段（phone / email / nickname / avatar / roles / preferences）以 **B 为准**
- [ ] WHEN 合并发生 THE SYSTEM SHALL 对三张唯一键表（`glossary_entries` / `user_memories` / `user_taste_profiles`）先去重再迁移：冲突行保留 B 的、丢弃 A 的重复行，不得因撞键导致整批失败
- [ ] WHEN 合并成功 THE SYSTEM SHALL 重签登录凭证（新 access/refresh，`sub` = B），并使 A 的旧 token 立即失效；前端须更新 token 后再刷新身份展示
- [ ] WHEN 合并成功 THE SYSTEM SHALL 把 A 标记为已合并（`status='inactive'` + 软删除 + `merged_to=B.id`），并记录审计留痕（A/B id、时间、各表迁移行数）
- [ ] WHEN 合并完成后用户用同一微信再次 `wx.login` THE SYSTEM SHALL 落到账号 B（`mp_openid` 已挂到 B），不再新建匿名账号
- [ ] IF 合并过程中任一步失败 THEN THE SYSTEM SHALL 整事务回滚并返回明确错误「合并失败，你的数据未发生变更」，且保留已获取的手机号供重试（用户无需重新授权）
- [ ] IF 目标账号 B 已存在非空 `mp_openid` THEN THE SYSTEM SHALL 中止合并并提示联系客服（同一 openid 只能属于一个账号，出现即数据异常）
- [ ] IF 当前用户已绑定手机号 THEN THE SYSTEM SHALL 展示「更换手机号」入口，走同一授权流程并覆盖旧值（覆盖前需二次确认）
- [ ] IF 用户拒绝微信授权（`e.detail.errMsg` 含 deny） THEN THE SYSTEM SHALL 静默返回，不弹错误提示打扰用户
- [ ] IF code 无效 / 已使用 / 过期（>5min） THEN THE SYSTEM SHALL 返回可识别错误，前端提示「授权已失效，请重试」并可再次发起
- [ ] IF 请求未带有效 access token THEN THE SYSTEM SHALL 返回 401，不写库
- [ ] WHEN 手机号已绑定 THE SYSTEM SHALL 在「个人信息」页显示脱敏号，且与 `profile.wxml` 中「微信账号 已绑定」的文案口径一致
- [ ] WHEN 任何页面展示手机号 THE SYSTEM SHALL 只展示脱敏形式（明文手机号不出现在前端与日志）
- [ ] WHEN 用户处于未登录态点击绑定手机号 THE SYSTEM SHALL 先引导登录（复用 R1 的登录入口），不直接调接口

### 边界 / 反例（不算做成）

- 反例1：做一个输入手机号 + 短信验证码的表单（当前无短信供应商能力）→ 不算做成，且引入新依赖
- 反例2：把手机号写进 `PUT /api/users/me` 而不做凭证校验（任何用户可把 phone 改成任意字符串）→ 不算做成
- 反例3：前端拿到明文手机号自己拼脱敏再调后端存 → 不算做成（号码必须由服务端从微信换取，前端不可信）
- 反例4：绑定成功后「我的」页仍显示硬编码 `138****6688` → 不算做成
- 反例5：同一手机号绑到两个账号上 → 不算做成（须有唯一约束 + 冲突拒绝）
- 反例6：日志/接口响应里出现完整手机号 → 违反隐私口径，不算做成
- 反例7：把「绑定手机号」做成注册/登录前置强拦（不绑号不给用）→ 超出本需求（合规上非必要服务不得强制授权）

### 必然失败清单

- 做法A（错）：沿用旧的 `encryptedData + iv` 用 `session_key` AES 解密 → 规避：现有登录流程 `auth.service.ts:158` 直接丢弃 `session_key`，未持久化，走旧方案得先补 session_key 存储；统一走新版 code → `getuserphonenumber`
- 做法B（错）：每次绑定都去微信换新 access_token → 规避：小程序 access_token 需缓存（有效 7200s），加内存/Redis 缓存 + 并发去重
- 做法C（错）：把 `appsecret` 或微信返回的明文手机号打进日志 → 规避：日志只记脱敏号与 code 是否有效
- 做法D（错）：前端保存手机号明文到 storage 当缓存 → 规避：只存脱敏串，真值以服务端返回为准

### 待确认项（交人拍板）

- [ ] Q7：是否强制唯一（一个手机号只能一个账号）？本 spec 默认唯一 + 冲突拒绝；若未来要做「多端账号合并」需另立需求
- [ ] Q8：已绑定用户「更换」是否需要旧号验证？（微信一键获取无旧号验证，只能覆盖）— 本 spec 默认仅二次确认
- [ ] Q9：手机号是否要补 `unionid` 打通公众号/小程序账号？（`users` 表当前无 `unionid` 列）

---

## 4. R3 需求 spec：账号资料完善（昵称 / 头像 / 邮箱）— P1，模板级

- 做成定义：用户可在「个人信息」页修改昵称、头像（走 `wx.getUserProfile` / 头像填写能力）与绑定邮箱（走邮箱验证码，复用 user-service 已有 mail 能力）。
- 判据沿用 R2 结构：授权获取 → 服务端校验落库 → 前端即时刷新 → 未绑定显示「去绑定」→ 未登录引导登录。
- 反例：`editNickname()` / `bindEmail()` 继续留 toast 占位算未完成（`pages/mine/profile/profile.ts:19,21`）。
- 待确认：邮箱验证码是否复用 `servers/user-service/src/api-key/mail.service.ts` 的 SMTP 能力（当前是给 MCP API Key 用的，需抽象）。

---

## 5. R4 需求 spec：账号注销 — P2，待拍板

- 现状：无任何注销入口；平台侧对提供账号服务的小程序通常要求提供注销入口（具体条款以《微信小程序平台运营规范》现行版为准，需法务/运营确认）。
- 两种形态待选：**A 注销账号**（服务端匿名化/删除用户数据与会话，不可恢复）／**B 解绑微信**（仅解除 mpOpenid 绑定）。
- 待确认项：
  - [ ] Q10：一期是否要做注销？做 A 还是 B？
  - [ ] Q11：注销是否需要「冷静期 + 二次确认 + 数据导出」？
  - [ ] Q12：注销后同一微信再次登录是「新建账号」还是「恢复」？

---

## 6. R5 · 其余「开发中」占位清单（代码实测，供排期）

| 位置 | 占位内容 | 建议优先级 | 备注 |
|---|---|---|---|
| `pages/mine/index/index.ts:72` | 会员功能（专业版） | P2 | 依赖商业化方案，先定会员体系 |
| `pages/mine/index/index.ts:73` | 我的合同 | P1 | 后端已有合同链路，接列表接口即可 |
| `pages/mine/index/index.ts:74` | 对话记录 | P1 | 已有 `pages/chat/history/history` 可复用 |
| `pages/mine/index/index.ts:76` | 用户协议与隐私政策 | **P0（合规）** | 与 R2 手机号授权强相关：隐私政策必须覆盖「收集手机号」条款 |
| `pages/mine/profile/profile.ts:19` | 修改昵称 | P1 | 归 R3 |
| `pages/mine/profile/profile.ts:21` | 绑定邮箱 | P2 | 归 R3 |
| `pages/mine/settings/settings.ts:61` | 隐私设置 | P1 | 与手机号/注销的隐私口径联动 |
| `packageAssess/pages/assess/settings/settings.ts:37` | 风险点配置 | P2 | 业务侧自定义 |
| `packageTranslate/pages/translate/index/index.ts:86,90` | 图片翻译 / 语音翻译 | P2 | 依赖 OCR / ASR 能力 |
| `packageTranslate/pages/translate/settings/settings.ts:42` | 术语库 | P1 | 后端已有术语表（p26 迁移） |
| `pages/discover/index/index.ts:39` | 能力卡「敬请期待」 | P2 | 等后端 agent 清单接口 |

---

## 7. 拍板记录与待确认汇总

### 已拍板（2026-09-24）

| # | 问题 | 结论 | 影响 |
|---|---|---|---|
| Q1 | 未登录态边界 | **必须登录才可用**（非「可浏览」） | R1 判据第 6~8 条：所有功能入口在未登录态拦截并展示登录引导卡 |
| Q5 | 手机号用途 | **账号打通**（前期主要目标；客服触达 / 实名后续） | R2 冲突策略不再是简单拒绝，见 Q15 |
| Q14 | 黑名单下沉方式 | **统一到 auth-service**（gateway 不接 Redis，改调 auth-service 内部校验端点） | 方案文档 §4.3 B2 定方案 B |
| Q6 | 付费手机号组件 | **接受**：0.03 元/次，先用 1000 次体验额度 | 定选微信快速验证；短信降为二期兜底 |
| Q16 | 小程序主体资质 | **企业主体 + 已完成微信认证 + 同意购资源包** | 资质门槛满足，M3 可开工 |
| Q15 | 手机号命中已有账号 | **c 合并账号**：A 的数据并入 B，A 软删并记 `merged_to`，凭证重签 | §3 新增 8 条合并判据；方案见 `design-mp-account.md` §5.7 |

### 待确认（阻塞项优先）

- [ ] Q2/Q3/Q4 退出细节　- [ ] Q7/Q8/Q9 绑定细节　- [ ] Q10/Q11/Q12 注销是否做
- [ ] Q13：本批（R1+R2）是否随 `feature/kedou-ai-minigram` 现有批次一起发，还是单开一期？

---

## 8. FAQ

- **Q：退出登录在「静默登录」体系下有意义吗？**
  A：有，但语义必须重定义：退出 = 主动交出登录态 + 不再自动重登，而不是「换个账号」。若不拦自动重登，退出按钮点了等于没点（判据第 5 条）。
- **Q：手机号能不能直接让用户手输？**
  A：不建议。无短信能力 → 手输无校验等于可伪造（现状 `PUT /api/users/me` 就是这个洞）；微信一键获取既能校验真号又零额外成本（除组件计费）。
- **Q：为什么绑定手机号不走 user-service？**
  A：微信凭证校验（access_token / getuserphonenumber）与 mpOpenid 绑定范式都在 auth-service（已有 `bind-miniprogram`），放同一处可复用 `getMpConfig()`；user-service 只保留已校验字段的落库口。详见方案文档 §4。
