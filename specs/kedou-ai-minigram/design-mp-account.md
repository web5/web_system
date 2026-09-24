# 科豆 AI 小程序 · 账号能力产品方案（退出登录 / 绑定手机号）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：R1 退出登录、R2 绑定手机号的**怎么做**（状态机 / 流程 / 接口契约 / 数据模型 / 分期），需求判据见 `specs/kedou-ai-minigram/requirements-mp-account.md`
> 范围：`apps/kedou-ai-minigram` + `servers/auth-service` + `servers/user-service` + `servers/gateway` + `migrations/`
> 分支：`feature/kedou-ai-minigram`

---

## 1. 目标与非目标

### 目标
1. 让「退出登录」成为**真实生效**的动作：服务端凭证作废 + 本地清态 + 不被自动重登（已拍板：未登录 = 登录墙，**必须登录才可用**）。
2. 让「绑定手机号」可用：微信一键授权获取真实号码，服务端校验落库，前端正确展示与更换（已拍板：前期目标是**账号打通**）。
3. 顺带补齐账号域的信息架构（登录墙、手机号状态展示与更换），不引入短信供应商等新外部依赖（短信仅作二期兜底）。

### 非目标
- 不做多账号切换（同一微信 + 同一 appid 的 `wx.login` 恒返回同一 openid，物理上不可换号）。
- 不做账号合并 / unionid 多端打通（见待确认 Q9）。
- 不做会员、合同列表、对话记录等相邻占位（见需求文档 §6 清单，另排）。
- 不接短信验证码（当前无供应商；手机号走微信凭证校验）。

---

## 2. 现状缺口（改这两块前必须知道）

| 层 | 缺口 | 位置 |
|---|---|---|
| 前端 | 退出是 toast 占位；`clearToken()` 零调用 | `pages/mine/index/index.ts:78`、`pages/mine/settings/settings.ts:75-83` |
| 前端 | 401 / 无 token 会自动静默重登 → 退出会被自己登回 | `utils/request.ts:102-104,124-138`、`services/auth.ts:78-91` |
| 前端 | 手机号是硬编码假数据 + toast 占位 | `pages/mine/index/index.ts:19`、`pages/mine/profile/profile.ts:14,20` |
| 前端 | 无未登录态 UI、无登录入口（因为从没未登录过） | `pages/welcome/index/index.wxml` 无登录元素 |
| 后端 | logout 只拉黑 access token，refresh 仍可续期 | `auth.service.ts:245-259` |
| 后端 | 黑名单只有 auth-service 自己查；gateway 代理控制器整体 `@Public`、user-service Guard 不查黑名单 | `servers/gateway/src/proxy/proxy.controller.ts:22-24`、`auth.guard.ts:14-44` |
| 后端 | 无手机号绑定接口、无微信手机号换号实现、无短信能力 | 全仓 `getPhoneNumber` 零命中 |
| 后端 | `PUT /api/users/me` 的 `phone` 无格式/唯一/凭证校验（安全洞） | `dto/update-user.dto.ts:30-33` |
| 数据 | `users.phone` 可空、无唯一索引；无 `unionid` 列 | `migrations/0007_baseline_tables.sql:436-458` |

---

## 3. 总体设计：登录态状态机（本方案的核心决策）

小程序当前只有「已登录」一态（静默登录后永久在线）。已拍板「必须登录才可用」，故未登录态是一个**登录墙**，不是可浏览的游客态：

```
    ┌────────── 用户点「微信一键登录」（wx.login 静默，无授权弹窗） ──────────┐
    ▼                                                                         │
 [未登录态 = 登录墙]                                                      [已登录态]
    │  对话 / 发现 / 我的 三个 tab 均只渲染登录引导卡                          │
    │  不发起任何业务接口请求                                                  │ 点「退出登录」+ 确认
    └─────────────────────────────────────────────────────────────────────► [退出中] → 清态 → 登录墙
```

**关键约束（决定实现可行性）**：
- 未登录态由**本地标志位** `account_logged_out`（storage）表达，服务端无此概念（服务端只知道 token 是否作废）。
- `ensureLogin()` 与 `request.ts` 的自动登录分支**必须**先读该标志位，否则退出形同无效（需求判据第 5 条）。
- 未登录态**只清本地，不动服务端数据**；重新登录回到同一账号（同 openid），历史数据自然回来。
- 登录是 `wx.login` 静默换取，**没有授权弹窗、没有验证码**，所以「登录引导卡 → 一键登录」是一步完成的轻操作，登录墙不会带来明显体验损失。
- 登录墙要覆盖三条不走 `request.ts` 的并行通道：`services/agent-stream.ts`（SSE）、`services/ocr-api.ts`、`services/tts.ts`。

---

## 4. R1 退出登录方案

### 4.1 时序

```
用户点「退出登录」
  → wx.showModal 二次确认（「退出后需要重新登录才能继续使用」）
  → 确认：
      1) POST /api/auth/logout  (silent=true，失败不阻塞)
      2) clearToken()           清 access_token / refresh_token
      3) setLoggedOut(true)     写 storage: account_logged_out=1
      4) 清内存态：app.globalData.userInfo、welcome_recent_cache、口味/偏好缓存、生词本缓存、页面内存中的会话列表
      5) 当前页 setData 刷新为登录墙（不跳页，留在「我的」页）；同时置全局登录态事件，已加载的对话/发现页随之切到登录墙
```

> 说明：退出后**不跳欢迎页**。欢迎页是启动页且无登录 UI，跳过去等于把用户扔在无出口的页面；登录入口应留在「我的」页原地。
> 说明：已拍板「必须登录才可用」，故退出后对话 / 发现 / 我的三个 tab 全部切为登录墙（无内容可浏览）。

### 4.2 前端改造点（文件级）

| 文件 | 改动 |
|---|---|
| `services/auth.ts` | 新增 `logout()`（调接口 + 清态）、`isLoggedOut()` / `setLoggedOut()`；`ensureLogin()` 开头判断：已主动退出则直接返回失败，不调 `wx.login` |
| `utils/request.ts` | L102 自动登录分支加 `!isLoggedOut()` 条件；401 分支（L124-138）在已退出态下**不** reLaunch 欢迎页、不 toast「登录已过期」，改为上层以「请先登录」处理 |
| 新增 `components/login-gate/`（或 `pages/mine/index/index` 内聚） | **登录引导卡**：品牌占位图 + 一句说明（「登录后继续使用 AI 对话、翻译与合翻」）+ 主按钮「微信一键登录」（`--brand-txt`）。对话页 / 发现页 / 我的页共用同一组件，保证三处口径一致 |
| `pages/mine/index/index.ts/.wxml/.wxss` | `logout()` 接真实逻辑；未登录态渲染登录卡（隐藏头像/昵称/手机号/退出入口） |
| `pages/chat/index/index.ts/.wxml` | 未登录态整页渲染登录卡，**不**发起会话列表请求；`reloginAndRetry`（L557-588）加 `isLoggedOut()` 判断，已退出时不再自动重登 |
| `pages/discover/index/index.ts/.wxml` | 未登录态整页渲染登录卡（发现页当前是静态卡，也一并拦截） |
| `pages/mine/settings/settings.ts` | 复用同一 `logout()`；确认弹窗文案对齐 |
| `app.ts` | `onLaunch` 的 `autoLogin()` 尊重已退出标志；`onShow` 不再无条件补登；提供全局登录态事件供各页订阅 |
| `services/agent-stream.ts`、`services/ocr-api.ts`、`services/tts.ts` | 入口统一检查 `isLoggedOut()`，未登录直接以「请先登录」失败，不发请求 |

### 4.3 后端改造点

**B1 · token 增加 `sid`（会话标识），一次登出同时作废 access + refresh**
- `auth.service.ts:278-318` 的 `generateToken`：生成 `sid = uuid()`，写入 access 与 refresh 的 payload。
- 黑名单 key 由 `bl:<sha256(access)>` 改为 `bl:sid:<sid>`，TTL 取 refresh 的剩余有效期（覆盖最长的那个）。
- `verifyToken`（`:206-243`）与 `refresh`（`:183-199`）都改为查 `bl:sid:<sid>`；refresh 命中黑名单 → 401。
- 兼容期：旧 token 无 `sid` → 退化为按 token hash 拉黑，两者都查（`bl:<hash>` 与 `bl:sid:<sid>` 任一命中即失效）。

**B2 · 黑名单校验统一由 auth-service 提供，gateway 在转发前调用（已拍板 Q14 = 统一到 auth-service）**
- 背景：`servers/gateway/src/proxy/proxy.controller.ts:22-24` 整个 `@Public`，`servers/gateway/src/auth/auth.guard.ts` 只做 JWT 验签，所以 user-service 等拿到已登出 token 仍放行。**不再**给 gateway 接 Redis，黑名单的读写权收归 auth-service 一处。
- 新增内部端点（auth-service，路径不挂 `/api/auth` 前缀，不对外暴露）：

  `POST /internal/auth/token-status`

  | 项 | 内容 |
  |---|---|
  | 入参 | `{ token: string }`（原始 access token，不带 `Bearer `） |
  | 200 | `{ valid: true }` / `{ valid: false, reason: 'blacklisted' \| 'expired' \| 'invalid' }` |
  | 调用方 | gateway（服务间直连 `AUTH_SERVICE_URL`，默认 `http://127.0.0.1:6101`）；其它后端服务后续需要时可直接复用同一端点 |

- gateway 侧：在 `proxy.controller.ts` 转发前对带 `Authorization` 的请求调用该端点，`valid=false` → 直接 401（不转发）。
- **缓存策略（决定「退出多久生效」）**：gateway 进程内缓存 —— 黑名单命中结果缓存 300s（已废的 token 恒废），未命中结果缓存 **5s**，故登出后旧 token **≤5s** 全局失效（需求判据已按此口径）。auth-service 不可用时按现状放行（与现有 Redis 不可用放行策略一致），并打点告警。
- 成本：每请求最多一次内部 HTTP（命中缓存则 0 次）。

**B3 · logout 健壮性**
- `auth.controller.ts:62-71` 当前手写解析 header、无 token 时静默成功 → 改为：无 Authorization 直接 401；解析失败 401。
- 返回体统一 `{ success: true }`，失败（Redis 不可用）仍返回成功语义（本地清态为主，服务端尽力而为）。

---

## 5. R2 绑定手机号方案

### 5.0 方案对比：微信手机号快速验证 vs 短信验证码

| 维度 | A · 微信手机号快速验证（推荐，一期） | B · 短信验证码（二期兜底） |
|---|---|---|
| 前端形态 | `<button open-type="getPhoneNumber">`，点一下 → 微信原生弹窗「允许/拒绝」 | 手机号输入框 + 验证码输入框 + 「获取验证码」按钮（60s 倒计时） |
| 用户操作 | **1 步**（点允许），约 2s，无需手输 | **3 步**（输号 → 收码 → 填码），约 20~40s，手输易错 |
| 号码来源 | 微信账号绑定的手机号，由微信侧返回，**实名号** | 用户填写的号，短信只能证明「当下能收到码」，弱于实名号 |
| 后端实现 | 小程序 access_token（缓存）→ `wxa/business/getuserphonenumber` → 落库。约 100 行 + 缓存 | 供应商 SDK 接入、签名/模板、验证码生成/校验/过期/错误次数、发送限频、防刷（图形/行为校验）、号码格式校验、IP 限流。约 400+ 行 + 新表 |
| 新增依赖 | 无（复用现有 `MINI_PROGRAM_APP_ID/SECRET`、`getMpConfig()`） | 短信供应商账号 + 应用依赖（腾讯云/阿里云 SDK）+ 新 env 密钥 |
| 新表 / 迁移 | 无（`users.phone` 加唯一索引，与方案无关） | 需新增 `sms_code` 表（可参照 `mcp_keys_tables.sql` 的验证码表结构）+ 限频记录 |
| 前置开通 | **非个人主体 + 已完成微信认证**（境外主体仅部分地区开放）；无需单独申请，满足条件即可用，但额度用尽需购买资源包 | 腾讯云账号 + **实名资质报备 → 签名 → 模板**三级审核（详见 §5.0.1） |
| 费用 | **0.03 元/次**（调用成功才扣费）；每账号 **1000 次体验额度**（开发版/体验版/正式版共用）；套餐见公众平台「付费管理」；政府/非营利组织、政务民生事业单位、公立医疗与学校类目免费 | 按条计费（约 0.03~0.05 元/条，以供应商报价为准）；一次成功绑定至少 1 条，重发另计 |
| 计费触发 | 成功调用计费；用户拒绝授权不产生 code，不计费 | 每次发送即计费（含用户填错号、重发） |
| 失败与边界 | code 5 分钟有效且一次性；用户微信未绑号则无法使用；组件欠费/未开通会直接报错 | 停机/携号转网/信号延迟/被拦截；需处理「收不到码」客服路径 |
| 与「账号打通」契合 | 用户主用号就是微信号，打通一致性最好 | 用户可能填另一个号，打通后账号对应关系更乱 |
| 合规 | 需在隐私政策说明「经你授权从微信获取手机号」 | 需说明「用于验证手机号归属」，且短信本身受通信合规约束 |
| 工期 | 后端 0.5~1 人日 + 前端 0.5 人日 | 后端 2~3 人日 + 供应商开通 1~3 工作日 + 前端 1 人日 |
| 主要风险 | 付费额度耗尽 / 主体资质不符 / 微信接口抖动 | 成本随量线性增长 + 防刷运维 + 报备周期 |

### 5.0.1 开通手续与材料清单（2026-09 核实）

**A · 微信手机号快速验证组件**（源：微信开放文档「手机号快速验证组件」）

| 项 | 内容 |
|---|---|
| 资质门槛 | **非个人开发者主体 + 已完成微信认证**（境外主体仅部分地区开放）。个人主体无法使用 |
| 是否需申请 | **无需单独申请**，满足条件即可调用；但额度用尽后需在公众平台「付费管理」购买资源包 |
| 计费 | 标准单价 **0.03 元/次**，在开发者拿到 `getPhoneNumber` success 回调（拿到 code）时扣费；用户拒绝授权不扣费 |
| 体验额度 | 每个小程序账号 **1000 次**，开发版 / 体验版 / 正式版**共用**；超额后连开发调试也计费 |
| 欠费表现 | 用户点击按钮时若额度不足 → `e.detail.errno === 1400001`，平台弹半屏提示「该功能使用次数已达当前小程序上限」；可用 `phoneNumberNoQuotaToast: false` 自行兼容 |
| 免费情形 | 微信认证主体为政府 / 非营利组织；事业单位且类目为政务民生；类目为公立医疗机构、学历教育（学校） |
| 合规红线 | 官方明确：不合理地强制索要手机号、中断正常使用流程 → 微信有权按《小程序平台运营管理规范》处理（含回收接口权限）。**本方案必须是「可选绑定」，不得做成不绑号不给用** |
| 技术要点 | 基础库 2.21.2+ 的新方式：`code → phonenumber.getPhoneNumber`，code 5 分钟有效、一次性，**无需**提前 `wx.login` |

> 材料/手续成本：**近乎为零**——不需要提交任何证件，只需公众平台后台点几下买资源包（前提是主体资质与认证已具备）。

**B · 短信验证码**（源：腾讯云短信《实名资质审核标准》2026-09-18 版）

| 项 | 内容 |
|---|---|
| 主体门槛 | 国内短信**仅支持中国大陆公司**；个人资质自 2025-09-18 起不再支持创建（个人只能走「他用资质」） |
| 流程顺序 | ① 实名资质报备 → ② 创建签名 → ③ 创建正文模板，三步都要审核 |
| 所需材料（企业自用） | ① 营业执照（或事业单位/社会组织等证件）**加盖公章**；② 法定代表人证件照 **加盖公章**；③ 短信业务管理员身份证照 + **手持身份证人像面照** + 本人手机号（会收到运营商人脸核验短信）；④ **合规使用承诺函** 加盖公章 |
| 他用资质（签名主体 ≠ 云账号主体） | 上述材料（盖签名归属方公章）+ **委托授权书**（双方盖章） |
| 审核时长 | 资质提交后约 **2 小时**出结果（周一至周五 9:00–21:00，周末 9:00–18:00，节假日顺延）；已通过资质再修改 → 约 **5 个工作日** |
| 易踩坑 | 同一人不能担任多家企业的短信业务管理员（「一人多企」会被运营商驳回）；管理员手机号填错或未完成人脸核验会导致签名报备失败 |

> 材料/手续成本：**需要营业执照 + 公章 + 法人证件 + 一名业务管理员手持证件照**，且需等审核；签名内容要与主体名称或品牌一致。

**结论与组合策略**
- 一期选 **A（微信一键获取）**：零新增依赖、体验最好、与账号打通目标最契合、工期最短。
- 二期保留 **B（短信）** 作为兜底：A 不可用的场景（用户微信未绑号、组件未开通/欠费、主体资质受限）走短信。
- **接口现在就留扩展位**：`POST /api/auth/bind-phone { code, channel }`，`channel: 'wechat' \| 'sms'`（一期只实现 `wechat`，缺省即 `wechat`）；二期再加 `POST /api/auth/phone-code`（发送验证码）。避免二期改前端调用面。

### 5.0.2 开工前准备清单（A 方案）

**运营侧**
1. 公众平台 → 付费管理 → 购买手机号资源包（先用 1000 次体验额度，**额度耗尽前补购**，否则线上会直接不可绑）。
2. 隐私政策页上线并在其中写明「经你授权，我们从微信获取你的手机号用于账号打通」（M4，M3 的合规前置）。

**开发侧**
1. 基础库：新方式要求 ≥ **2.21.2** —— 当前 `project.config.json` libVersion `3.3.4`、本地 `3.16.0`，均满足。
2. 后端凭证：`servers/auth-service/.env` 的 `MINI_PROGRAM_APP_ID` / `MINI_PROGRAM_SECRET` 需为真实值（当前仓库只有 `.env.example` 占位，需确认发布目录实际配置）。
3. 出网：后端需能访问 `api.weixin.qq.com`（dev 与堡垒机在腾讯云，开工前 curl 实测一次）。
4. 缓存：小程序 access_token 缓存 7200s + 并发去重，避免每次绑定都换新 token。
5. 额度控制：开发版 / 体验版 / 正式版**共用**体验额度 —— 联调不要反复刷真实绑定；`errno 1400001` 必须有兜底文案，不能静默失败。
6. 前端域名白名单不涉及（微信接口由后端调用）。

### 5.1 时序（微信新版「手机号快速验证」，不使用 session_key 解密）

```
前端 <button open-type="getPhoneNumber" bindgetphonenumber>
  → 用户允许 → 拿到 e.detail.code（一次性，5 分钟有效）
  → 用户拒绝 → e.detail.errMsg 含 deny，静默返回，不提示
  → 额度不足 → e.detail.errno === 1400001，提示「服务暂不可用，请稍后再试」（不可静默）
  → POST /api/auth/bind-phone { code }   (Bearer)
     后端：
       1) 取小程序 access_token（Redis/内存缓存 7200s，并发去重；凭证 getMpConfig() 已有）
       2) POST https://api.weixin.qq.com/wxa/business/getuserphonenumber { code }
       3) 取 phone_info.phoneNumber
       4) 查重 users.phone（唯一约束 + 应用层预检）
       5) 命中已有账号 → 暂存号码 + 409 冲突 → 前端二次确认 → confirmMerge 走合并（§5.7）
       6) 未冲突：写入当前用户 phone
       7) 返回 { phone: '138****6688'（脱敏）, boundAt }；合并场景另返回新 token 与 merged:true
  → 前端更新「我的」/「个人信息」页展示
```

> 为什么不用旧版 `encryptedData + iv + session_key` AES 解密：`auth.service.ts:158` 登录时把 `session_key` 直接丢弃、从不落库，走旧方案要先补 session_key 持久化（多一处敏感信息存储）。新版 code 换号无此负担。

### 5.2 接口契约（新增）

`POST /api/auth/bind-phone`

| 项 | 内容 |
|---|---|
| 鉴权 | `Authorization: Bearer <access_token>`（无 / 失效 → 401） |
| 入参 | `{ code?: string, channel?: 'wechat' \| 'sms', confirmMerge?: boolean }` —— 一期仅 `wechat`；`code` 为微信手机号授权码（一次性、5 分钟有效）；`confirmMerge` 用于冲突后确认合并（复用暂存号码，见 §5.7.4） |
| 成功 200 | `{ phone: '138****6688', boundAt: '2026-09-24T10:00:00.000Z', phoneBound: true }`（**只回脱敏号**）；若走了合并则额外返回 `{ merged: true, accessToken, refreshToken }`（**新 token，sub = 目标账号**，前端必须 `setToken()`） |
| 400 `INVALID_CODE` | code 缺失 / 已使用 / 过期 → 「授权已失效，请重试」 |
| 409 `PHONE_ALREADY_BOUND` | 该号码已绑其他账号 → `{ conflict: true, canMerge: true, maskedPhone, hint }`，**不覆盖、不合并、不静默换绑**；前端弹二次确认后带 `confirmMerge: true` 重发（§5.7） |
| 409 `MERGE_ABORTED` | 目标账号已有非空 `mp_openid`（数据异常）→ 中止合并，提示联系客服 |
| 500 `MERGE_FAILED` | 合并事务回滚 → 「合并失败，你的数据未发生变更」，保留暂存号码可重试 |
| 401 `UNAUTHORIZED` | 未登录 → 引导登录 |
| 502 `WECHAT_UPSTREAM_ERROR` | 微信接口失败 → 「绑定失败，请稍后重试」 |

配套：
- `GET /api/auth/verify`（已有）返回体已带 `phone`，前端可在登录/恢复态时直接取；建议一并返回 `phoneBound: boolean` 与脱敏号，前端无需再拼脱敏。
- `PUT /api/users/me`（已有）**收紧**：`phone` 字段改为不接受（手机号只能经 `bind-phone` 写），DTO 侧移除或加守卫，堵住「任意用户改任意手机号」的洞。

### 5.3 前端改造点（文件级）

| 文件 | 改动 |
|---|---|
| `pages/mine/profile/profile.ts/.wxml` | 手机号行改为状态化：未绑定 → 「去绑定」+ `open-type="getPhoneNumber"` 按钮；已绑定 → 脱敏号 +「更换」（二次确认后重新授权）；移除 `phone: '138****6688'` 假数据 |
| `pages/mine/index/index.ts/.wxml` | profile 卡的 `{{realName}} · {{phone}}` 改为真实脱敏号；未绑定显示「未绑定手机号」 |
| `services/auth.ts` 或新增 `services/account.ts` | `bindPhone(code)` 封装；错误码 → 文案映射（可复用 `utils/agent-error.ts` 的映射风格） |
| `app.wxss` / token | 绑定入口用 `--brand-txt`（#EA580C），不新增裸 hex |

### 5.4 数据模型变更

新增迁移文件 `migrations/00XX_mp_account_phone.sql`（注意：必须放仓库根 `migrations/`，`scripts/migrations/` 是 .mjs 脚本目录、不会被 apply-migrations.sh 扫到）：

```sql
-- @database web_system
-- 1) 手机号唯一约束（加前先查重，历史脏数据需先清理）—— 合并的前置条件
ALTER TABLE `users` ADD UNIQUE KEY `uk_users_phone` (`phone`);

-- 2) 合并留痕：被合并账号指向合并后的目标账号（Q15 = c 必需）
ALTER TABLE `users` ADD COLUMN `merged_to` BIGINT UNSIGNED NULL COMMENT '合并到的目标账号 id' AFTER `status`;
```

可选（待拍板后再加）：`phone_bound_at datetime`（绑定时间）、`unionid varchar(100)`（跨端打通，见 Q9）。

### 5.5 安全与隐私口径

- 手机号明文**只**存在于服务端落库与微信响应，接口一律回脱敏；日志只记「绑定成功 + 脱敏号」。
- 前端 storage 不存明文手机号。
- 收集手机号前，隐私政策必须已上线并覆盖该条款 → **「用户协议与隐私政策」页从 P2 提到 P0**（需求文档 §6）。
- `appsecret` 只在服务端 env（`MINI_PROGRAM_SECRET`），不进日志、不下发前端。

### 5.6 账号打通（本功能的前期主要目标）

已拍板：手机号**前期主要用于账号打通**（客服触达 / 实名是后续目标）。这直接改变了「冲突怎么办」的答案 —— 简单拒绝等于不打通。

**打通的两种技术路径（需一起权衡）**

| 路径 | 机制 | 优点 | 代价 |
|---|---|---|---|
| **手机号维度**（本批 R2） | 手机号唯一 → 同一号码即同一账号 | 跨端通用（PC portal / 小程序 / 未来 App 都能用） | 用户需主动授权一次；冲突需处理（Q15）；付费组件 |
| **unionid 维度**（建议并行评估） | 小程序绑到微信开放平台后 `jscode2session` 直接返回 `unionid` → 落库 → 公众号/小程序天然同一账号 | 用户零操作、免费、无冲突 | 只覆盖微信生态；PC 端仍需手机号/其它登录方式；需加 `users.unionid` 列并在登录时保存（当前 `auth.service.ts:158` 未取 unionid） |

**一期最小打通（手机号维度）**
1. `users.phone` 唯一 → 号码即身份键。
2. 冲突时按 Q15：默认选项 b（把当前小程序的 `mp_openid` 挂到已有账号上，当前匿名 openid 账号弃用）。
3. 若匿名账号在绑定前已产生数据（会话 / 生词本 / 用户记忆 / 口味），需先盘点所有带 `user_id` 的业务表，再决定「迁移到目标账号」还是「保留孤岛」—— 该盘点与迁移策略是 Q15 的一部分。
4. PC 端 `PUT /api/users/me` 的 phone 需同步收紧（否则打通键可被任意改写）。

**风险提示**：打通是不可逆的账号关系变更，一期若只做「拒绝」，手机号就退化成一个无用的展示字段。建议 Q15 与「是否并行上 unionid」一起拍板。

---

### 5.7 账号合并方案（Q15 已拍板 = c 合并账号）

### 5.7.1 触发与前置

- 触发：小程序匿名账号 A（有 `mp_openid`、无 `phone`）绑定手机号 → 该号码已属于账号 B（通常来自 PC portal 注册）→ 用户二次确认后执行合并。
- 前置：① `users.phone` 唯一索引已建立（§5.4）；② 已盘点迁移表清单并**代码化集中维护**（禁止散落在各服务里 UPDATE）。

### 5.7.2 合并规则

| 对象 | 规则 |
|---|---|
| 归属字段 | 全部以 **B 为准**（`phone` / `email` / `nickname` / `avatar` / `roles` / `preferences` / `systems`）；A 的同名字段不覆盖 B |
| 微信身份 | B.`mp_openid` = A.`mp_openid`；**若 B 已有非空 `mp_openid` → 中止合并并报错**（同一 openid 只能属于一个账号，出现即数据异常） |
| 业务数据 | A 的 13 张业务表记录改写 `user_id`/`owner_id` 为 B（清单见 §5.7.3） |
| 唯一键冲突 | `glossary_entries (user_id, content_hash)`、`user_memories (user_id, category, content_hash)`、`user_taste_profiles (user_id, namespace)` 三张有唯一键 → 冲突行**保留 B 的，丢弃 A 的重复行**（去重后再 UPDATE，避免撞键导致整批失败） |
| A 账号处置 | `status='inactive'` + 软删除 `deleted_at` + 新增列 `merged_to = B.id`（需迁移）。`username`（`wx_`+openid 前 10 位）保留不动，避免占用唯一键问题 |
| **token** | **必须重签**：合并后当前 token 的 `sub` 仍是 A.id，但 A 已弃用 → 合并成功返回**新 access/refresh（sub=B.id）**，前端 `setToken()` 并刷新身份；同时把 A 当前 `sid` 加入黑名单（旧 token 立即失效） |
| 跨库数据 | 一期**只合并 web_system 库**；`knowledge_collections.created_by`、`deploy_*` 的 `*_by`、`audit_logs.user` 属审计/创建人记录，**不迁**（不影响业务可用性，且跨库无法与 web_system 同事务） |
| JSON 内嵌 | `deploy_canary_rules.matchRule.userIds` 里的 userId 数组**不处理**（发布域灰度名单，与 C 端账号无关） |

### 5.7.3 迁移表清单（web_system 库，A → B）

| # | 表 | 列 | 类型 |
|---|---|---|---|
| 1 | `agent_conversations` | `user_id` | VARCHAR(64) |
| 2 | `agent_runs` | `user_id` | VARCHAR(64) |
| 3 | `conversations` | `user_id` | BIGINT |
| 4 | `glossary_entries` | `user_id` | VARCHAR(64)（唯一键，需去重） |
| 5 | `user_memories` | `user_id` | VARCHAR(64)（唯一键，需去重） |
| 6 | `user_taste_profiles` | `user_id` | VARCHAR(64)（唯一键，需去重） |
| 7 | `upload_files` | `user_id` | BIGINT（可空） |
| 8 | `mcp_api_keys` | `owner_id` | BIGINT（可空） |
| 9 | `artworks` | `user_id` | BIGINT |
| 10 | `bianbian_records` | `user_id` | BIGINT |
| 11 | `todo_tasks` | `user_id` | BIGINT |
| 12 | `finnews_subscriptions` | `user_id` | BIGINT |
| 13 | `gateway_access_logs` | `user_id` | VARCHAR(64)（可空） |

> ⚠️ **全仓无物理外键**（唯一 FOREIGN KEY 是 `mcp_tools.module_id`，与用户无关）→ UPDATE 不会级联、也不报错，但**漏一张表就是静默数据丢失**。因此清单必须代码化集中一处常量，并配一条「按清单逐表 count 校验」的自检脚本。
> ⚠️ 历史遗留：部分 VARCHAR 列（如 `0001_standardize_business_tables.sql:193-199` 记载）混存过 openid/邮箱/uuid，**合并前须先确认 A 在这些列里的实际值形态**（是 `users.id` 的字符串还是别的），不能直接假设。

### 5.7.4 两次请求与 code 复用（易踩坑）

微信 `code` 一次性且 5 分钟有效：第一次 `bind-phone` 消费 code 换到手机号后才发现冲突 → 用户确认合并时 code 已废，不能让用户再授权一次。

解法：后端首次换到手机号后，把号码**暂存** Redis `bind_pending:<userId>`（TTL 10min，只存脱敏之外的真值且加密/短 TTL），二次请求带 `confirmMerge: true` 时直接取用，无需重新授权。

```
1) POST /api/auth/bind-phone { code }
   → 换号成功 + 命中 B → 409 { conflict: true, canMerge: true, maskedPhone: '138****6688',
                               hint: '该手机号已注册科豆账号，绑定后将把当前小程序的数据合并到该账号' }
2) 前端弹二次确认（不可逆提示） → 用户确认
3) POST /api/auth/bind-phone { confirmMerge: true }   （复用暂存的号码）
   → 200 { phone: '138****6688', merged: true, accessToken, refreshToken }   ← 新 token
4) 前端 setToken() + 刷新「我的」/「个人信息」页身份
```

### 5.7.5 事务、幂等与失败

- 幂等：A.`merged_to` 非空 → 直接返回已合并结果，不重复执行。
- 事务：合并主流程（users 更新 + 13 张表 UPDATE + A 软删）在同一事务内；跨库项不参与。
- 并发：合并期间对 A 加行锁；合并完成后立即拉黑 A 的 `sid`，禁止并发写入 A。
- 失败：任一步失败 → 整事务回滚，返回 500 + 明确文案「合并失败，你的数据未发生变更」，保留 pending 号码供重试。
- 留痕：合并写审计记录（操作人 = A.userId、目标 = B.id、时间、涉及表行数），便于事后追溯。

### 5.7.6 验收要点

- A 的会话 / 生词本 / 记忆 / 口味在合并后出现在 B 名下（用 B 登录 PC portal 与小程序均可见）。
- 合并后旧 token 立即 401；新 token 的 `sub` = B.id，且 `/api/auth/verify` 返回 B 的手机号/邮箱。
- 重复内容不产生重复行（三张唯一键表无报错、无重复）。
- A 账号 `status=inactive` 且 `merged_to=B.id`，再用同一微信 `wx.login` 登录落到 B（因 `mp_openid` 已挂在 B 上）。
- 邮箱来源的合并（`bindSource='email'`）与手机号走同一套：同样重签凭证、同样留痕。

### 5.8 R3 绑定邮箱（与手机号同批）

邮箱与手机号**同为账号打通键**，因此复用同一套合并流程，只换「凭证获取方式」：手机号靠微信组件，邮箱靠验证码。

#### 5.8.1 时序

```
个人信息页 邮箱「去绑定」→ 进入自绘绑定页 p-bind-email（非 wx.showModal：原生弹窗无输入框）
  1) 输入邮箱 → 点「获取验证码」
       → POST /api/users/email-code { email }   (user-service，复用 MailService.sendCode)
          生成 6 位码 → 存 hash + 有效期 → 发送邮件 → 60s 重发倒计时
  2) 输入 6 位验证码 → 提交
       → POST /api/auth/bind-email { email, code }   (auth-service，Bearer)
          校验 hash + 有效期 + 错误次数 → 查重 users.email
          → 未冲突：写入 email，返回脱敏邮箱
          → 冲突：409 EMAIL_ALREADY_BOUND → 二次确认 → confirmMerge 走 §5.7 合并（bindSource='email'）
```

#### 5.8.2 接口契约

`POST /api/users/email-code`（user-service，需登录）

| 项 | 内容 |
|---|---|
| 入参 | `{ email: string }` |
| 200 | `{ sent: true, resendIn: 60 }` |
| 400 `INVALID_EMAIL` | 格式错误（字段级提示） |
| 429 `RATE_LIMITED` | 60s 内重发 / 单日超限 |
| 503 `SMTP_NOT_CONFIGURED` | SMTP 未配置或发送失败 → 「邮件服务暂不可用，请稍后再试」 |

`POST /api/auth/bind-email`（auth-service，Bearer）

| 项 | 内容 |
|---|---|
| 入参 | `{ email: string, code: string, confirmMerge?: boolean }` |
| 200 | `{ email: 'a***@example.com', boundAt }`；合并场景额外 `{ merged: true, accessToken, refreshToken }` |
| 400 `INVALID_CODE` / `CODE_EXPIRED` / `TOO_MANY_ATTEMPTS` | 验证码错误 / 过期 / 连续错误超限（该码作废，需重取） |
| 409 `EMAIL_ALREADY_BOUND` | 命中其他账号 → `{ conflict: true, canMerge: true, maskedEmail, hint }`，走 §5.7 合并 |
| 401 `UNAUTHORIZED` | 未登录 → 引导登录 |

#### 5.8.3 数据模型与复用

- 新表 `email_verification_codes`（web_system 库）：`email` / `code_hash` / `expires_at` / `attempts` / `used` / `user_id` / `created_at` —— 结构参照 `mcp-key-code.entity.ts`，但独立建表（用途与生命周期不同）。
- 验证码复用 `servers/user-service/src/api-key/api-key.service.ts:108-131` 的生成/过期/次数校验逻辑（抽象成公共方法，不复制）。
- 邮件发送复用 `MailService.sendCode`（`SMTP_HOST/PORT/USER/PASS/FROM`，未配置则 503）。
- `users.email` **已有 UNIQUE 索引**（`migrations/0007_baseline_tables.sql:455`），无需新建；冲突即走合并。

#### 5.8.4 合并流程统一

- 合并能力抽成公共逻辑，入参带 `bindSource: 'phone' | 'email'`；迁移表清单（§5.7.3）、去重策略、凭证重签、`merged_to` 留痕全部复用，**不为邮箱写第二套**。
- 冲突弹窗文案随来源变化：手机号显示脱敏号，邮箱显示脱敏邮箱。

---

## 6. 分期与工作量

| 期 | 内容 | 估时 | 依赖 / 阻塞 |
|---|---|---|---|
| M1 | 退出登录：前端接线（状态机 + **登录墙** UI）+ 后端 B1/B3 | 1.5~2 人日（登录墙比游客态多 0.5 天：三 tab 拦截 + 三通道兜底） | Q1 已拍板；Q2 待定 |
| M2 | 黑名单统一到 auth-service：`POST /internal/auth/token-status` + gateway 调用与缓存 | 0.5~1 人日 | Q14 已拍板（方案 B）；需给 gateway 配 `AUTH_SERVICE_URL` |
| M3a | 绑定手机号（无冲突路径）：后端 `bind-phone` + 前端授权/展示/更换 + 迁移（phone 唯一索引） | 1.5~2 人日 | 微信手机号组件开通（运营，Q16 已满足） |
| M3b | **账号合并**（Q15=c）：13 张表迁移 + 唯一键去重 + 新 token 重签 + `merged_to` 列 + 自检脚本 | +1.5~2 人日 | 依赖 M3a；需先做表清单代码化与值形态核验 |
| M4 | 协议与隐私政策页（合规前置） | 0.5 人日 | 文案（运营/法务） |
| M5 | 资料完善（R3）/ 注销（R4）/ unionid 打通 | 待定 | Q9/Q10~Q12 拍板后再估 |

> M4 是 M3 的合规前置：**先有隐私政策，再收手机号**。
> M1 与 M2 可并行（不同服务）；M3 依赖 M4 与 Q6/Q15。

---

## 7. UI 动作门（改 UI 源码前不可跳）

本次涉及 `apps/kedou-ai-minigram` 的 `pages/mine/index/*`、`pages/mine/profile/*`、`pages/mine/settings/*`、`pages/chat/index/*`、`pages/discover/index/*` 及新增协议页（WXML/WXSS/TS），按 `@brand-interface` 规则顺序：

1. 先改**整体原型稿** `apps/kedou-ai-minigram/prototype/index.html` 的对应屏（一个不能少，都是同一份稿里的屏）：
   - **登录引导卡**（对话页 / 发现页 / 我的页，三处同一组件）
   - 我的页：已登录态 + 退出入口
   - 个人信息页：手机号**未绑定 / 已绑定 / 更换**三态
   - 小程序设置页：退出确认弹窗
   - **绑定手机号冲突弹窗**（合并二次确认：文案须含「当前小程序的数据将合并到该手机号账号，合并后不可撤销」）
   - **用户协议与隐私政策页**（M4，收手机号的合规前置）
   同步本目录页面规格（新建 `page-spec-mp-account.md`）。
2. 过 `ux-prototype-designer` 的独立交互质检。
3. D2 设计评审（判据 `docs/ui/design-system.md` 品牌端分区），报告落 `docs/ui/reviews/mp-account-<YYYYMMDD>.md`，阻塞项清零。
4. **用户确认原型** ← 人审节点。
5. 原型/规格单独 commit，记 sha；UI commit message 带 `Proto: <sha>` 与 `Design: pass`。
6. 落码 → D3 实现一致性评审。

---

## 8. 验收对照（需求判据 → 验证手段）

| 判据 | 验证手段 |
|---|---|
| 退出后 token 清空 | 开发者工具 Storage 面板查 `access_token` / `refresh_token` 为空 |
| 退出后不被自动重登 | 退出后切 tab / 冷启动，`GET /api/auth/verify`（silent）仍 401，且页面保持登录墙 |
| 登录墙覆盖全部入口 | 退出后分别点对话 / 发现 tab → 只见登录卡；抓包确认无业务接口请求；SSE/OCR/TTS 入口不发请求 |
| 旧 access token 失效 | 退出前复制 token，curl `GET /api/auth/verify` → 401 |
| refresh 一并失效 | 退出前复制 refresh token，curl `POST /api/auth/refresh` → 401 |
| 黑名单跨服务生效 | 用已登出 token curl `GET /api/users/me` → 401（M2 后），且登出后 **≤5s** 起生效 |
| 一键登录可恢复 | 登录卡点「微信一键登录」→ 当前页自动刷新出内容，账号与原账号一致（同 openid） |
| 绑定成功 | 授权后「我的」/「个人信息」显示脱敏号；DB `users.phone` 有真值 |
| 重复绑定被拒 | 用第二个账号绑同一号 → 409 + 明确文案，DB 不被覆盖 |
| 拒绝授权不打扰 | 微信弹窗点拒绝 → 无错误 toast |
| 无明文泄漏 | 抓包 + 日志检索完整手机号 → 0 命中 |

---

## 9. 风险与合规

| 风险 | 影响 | 规避 |
|---|---|---|
| 微信手机号组件付费（**0.03 元/次**，1000 次体验额度三版本共用） | 成本与额度耗尽 | 已接受（Q6/Q16）：运营在额度耗尽前补购资源包；`errno 1400001` 必须有兜底文案，不可静默失败 |
| 把手机号做成「不绑不给用」 | 违反微信运营规范，最重可回收该接口权限 | 绑定设计为**可选**；登录与功能可用性不依赖手机号（§5.0.1 合规红线） |
| **合并漏表**（全仓无物理外键，UPDATE 不报错） | 静默丢失用户数据 | 迁移清单代码化集中维护（§5.7.3）+ 合并后逐表 count 自检脚本；上线前用双账号在 staging 实测 |
| **合并撞唯一键**（`glossary_entries` / `user_memories` / `user_taste_profiles`） | 整批 UPDATE 失败、事务回滚 | 迁移前先去重（冲突行保 B 弃 A），再 UPDATE |
| **合并后旧 token 仍指向已弃用账号 A** | 用户看到"我的数据没了" | 合并成功即重签 token（sub=B）+ 拉黑 A 的 sid，前端 `setToken()` |
| 合并不可逆且无留痕 | 客诉无法追溯 | 写审计记录（A/B id、时间、各表行数）；`users.merged_to` 留指向 |
| VARCHAR 外键列历史混存 openid/邮箱/uuid | 按 `users.id` 改写出错或漏改 | 合并前先抽样核验各表实际值形态（见 `0001_standardize_business_tables.sql:193-199`） |
| 未上线隐私政策先收手机号 | 合规风险 | M4 提前为 M3 前置 |
| `users.phone` 历史脏数据（重复/非法格式） | 加唯一索引失败 | 迁移前先跑查重脚本，脏数据清理后再加索引 |
| 加 `sid` 后旧 token 无 sid | 登出旧 token 仍有效 | 兼容期双查（`bl:<hash>` + `bl:sid:<sid>`），旧 token 7 天后自然过期 |
| gateway 每请求多一次内部 HTTP（黑名单校验） | 延迟与 auth-service 负载 | gateway 侧两级缓存（命中 300s / 未命中 5s）；auth-service 不可用时放行并告警 |
| 退出态标志位被多处绕过（SSE / OCR / TTS 不走 `request.ts`） | 退出后仍可发请求 | 这些通道统一在入口检查 `isLoggedOut()`；`services/agent-stream.ts`、`services/ocr-api.ts`、`services/tts.ts` 需同步处理 |
| 迁移文件放错目录 | 静默不生效 | 必须放仓库根 `migrations/`（不是 `scripts/migrations/`）；执行 `MYSQL_PWD=... bash scripts/apply-migrations.sh local` |

---

## 10. 拍板记录与待确认

### 已拍板（2026-09-24）

| # | 问题 | 结论 | 落地影响 |
|---|---|---|---|
| Q1 | 未登录态边界 | **必须登录才可用** | §3 状态机改为登录墙；对话/发现/我的三 tab 全拦截；M1 +0.5 人日 |
| Q5 | 手机号用途 | **账号打通**（前期主要目标） | 冲突策略不能是简单拒绝 → 新增 Q15；§5.6 |
| Q14 | 黑名单下沉方式 | **统一到 auth-service**（gateway 调用内部端点，不接 Redis） | §4.3 B2 定方案 B；新增 `POST /internal/auth/token-status` |
| Q16 | 小程序主体与认证 | **企业主体 + 已完成微信认证 + 同意购买资源包** | A 方案（微信快速验证）资质门槛满足，可开工 |
| Q15 | 手机号命中已有账号 | **c 合并账号**：A 的数据并入 B，A 软删并记 `merged_to` | §5.7 全套合并规则；接口加 `confirmMerge`；新增 `users.merged_to` 列 |
| Q6 | 付费组件 | **接受**（0.03 元/次，先用 1000 次体验额度） | §5.0 定选 A；短信降级为二期兜底 |

### 待拍板（不阻塞开工，但影响细节）

- [ ] Q9 是否并行上 `unionid` 打通（微信生态内免绑号，见 §5.6）
- [ ] Q2/Q3/Q4 退出细节；Q7/Q8 绑定细节；Q10~Q12 注销是否做；Q13 发版批次

> 完整待确认清单见 `specs/kedou-ai-minigram/requirements-mp-account.md` §2/§3/§7。

---

## 11. FAQ

- **Q：能不能不改后端，前端清 token 就算退出？**
  A：不行。清 token 后旧 token 在有效期内仍可被调用（尤其 refresh 能续期），且 user-service 不查黑名单 → 退出只是"本机假装退出"。至少要做 B1（refresh 失效）。
- **Q：黑名单校验为什么统一到 auth-service，而不是让 gateway 直连 Redis？**
  A：黑名单的 key 结构、TTL 规则、sid 语义都是 auth-service 的私有实现，让 gateway 或其它服务直连同一 Redis 等于把这份数据契约外泄——将来改一次 key 结构要同步改多处。统一成一个内部端点后规则只有一处，其它服务要加校验直接复用；代价是每请求一次内部 HTTP，用 5s/300s 两级缓存压掉。
- **Q：手机号能不能存明文给客服用？**
  A：可以库内存明文（业务需要），但接口与日志只出脱敏；客服侧如需查看应另立受控接口（不在本批范围）。
