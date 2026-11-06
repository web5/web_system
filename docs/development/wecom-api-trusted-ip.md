> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：**任何**后端调企业微信接口（应用消息 / OAuth / 审批 / 客户联系 / 通讯录）时的出站安全规范 —— 可信域名 vs 可信IP 的机制、60020 排查、固定出口与本地借道。

# 企业微信 API 安全 · 可信域名 vs 可信IP 规范

> 适用：console / 任意后端服务调 `qyapi.weixin.qq.com` 的场景（发布流水线审批、应用消息通知、客户联系、通讯录同步等）
> 依据：企业微信官方全局错误码 60020 + 应用详情「企业可信IP」机制
> 首个应用场景：deploy-console 企微审批 → [`specs/deploy-console-wecom-approval/design.md`](../../specs/deploy-console-wecom-approval/design.md) §5.8

---

## 一、一句话

> **可信域名管"企微来找你"（入站），可信IP 管"你去找企微"（出站）。二者正交、不能互替。**
> 新自建应用调 API 强制要可信IP；把出站收敛成"一个固定 EIP"，白名单就是零维护项。

---

## 二、两个机制的正交关系

| 机制 | 管哪一侧 | 解决什么 | 典型场景 |
|---|---|---|---|
| **可信域名** | **入站**（企微 / 浏览器主动找你） | 网页授权回调、JS-SDK 安全域名、接收消息服务器 URL 归属校验 | OAuth 免登 H5、卡片回调、扫码登录 |
| **可信IP**（企业可信IP） | **出站**（你的服务器用 secret 调企微） | 限制"谁能拿这个应用 secret 调接口"的来源 IP | 应用消息推送、拉取待办、任何 `qyapi.weixin.qq.com` 调用 |

🔴 **常见误解**：以为"配了可信域名 = 安全了 / 不用配可信IP"。错。可信域名只保证"这个域名是我的"，管不了"调用接口的来源 IP"。

🔴 **更隐蔽的一处**：OAuth 免登看起来"只是浏览器跳转"，但 `code → userid` 的 `getuserinfo` 是**服务端出站调用**，同样受可信IP 约束。别以为"入站配好就够了"。

---

## 三、60020 触发条件与排查

**错误**：`errcode=60020, errmsg=not allow to access from your ip`（不安全的访问IP）

**触发条件**（任一）：

1. 新创建的自建应用（2022-06-28 后）**未配置「企业可信IP」** → 该应用**无法调用任何企微接口**（强制项，非可选）。
2. 调用来源 IP **不在**该应用的「企业可信IP」列表。
3. **配错应用**：用 A 应用 secret 调接口，却把 IP 配到 B 应用（如误用通讯录同步助手 secret）。

**排查三步**：

1. 看报错里的 `from ip: x.x.x.x` —— 这就是企微看到的**出口公网 IP**，拿它去配。
2. 用企微官方 **access_token 权限查询**工具（`developer.work.weixin.qq.com/devtool/query`）确认这个 token 属于**哪个应用**。
3. 到**那个应用**详情页 →「企业可信IP」→ 把 `from ip` 加进去，**1 分钟后生效**。

> ⚠️ 生效有延迟：刚加完立刻重试仍 60020 属正常，别重复添加 / 怀疑别的问题。

---

## 四、架构原则（固定出口 + 单点白名单）

| # | 原则 | 说明 |
|---|---|---|
| P1 | **出站收敛成单一固定 IP** | 绑 **EIP（弹性公网 IP）** 或走 **NAT 网关固定出口**；白名单只填这一个，永不因动态 IP 变更而失效 |
| P2 | **前端 / 浏览器不直连企微** | 浏览器只调自有后端（内部 API）；企微 API 调用统一由后端出站 |
| P3 | **一套运行环境一个应用** | 当前 dev 既是开发环境也是正式运行平台 → 白名单 = dev 固定 EIP 一个即可；仅当未来另起独立 prod 才需拆应用与白名单，互不串 |
| P4 | **可信IP 是纵深之一，不是命门** | secret 才是命门：secret 泄露 + 白名单内任意机器可调全部接口。secret 只经配置中心注入 `process.env`、不进代码库、日志不打印 |

---

## 五、本地临时联调（不把动态 IP 加白）

| 方式 | 做法 | 企微看到的出口 | 建议 |
|---|---|---|---|
| **SSH 隧道 / SOCKS** | `ssh -D 1080 -N dev-host`；本地 `HTTPS_PROXY=socks5://127.0.0.1:1080` | dev EIP（已白名单） | ✅ 首选 |
| **dev 联调代理** | dev 暴露受鉴权 `/internal/wecom-proxy/*`，本地调它转发 | dev EIP | ✅ 团队化首选 |
| **本地 mock** | nock / msw / fixture 假响应 | 无 | ✅ 单测 / 集成测默认 |
| **临时加白本地 IP** | 查本地公网 IP，临时加白，用完删 | 本地动态 IP | ⚠️ 仅应急，必删 |

🔴 **关键限制**：本地经隧道只能测**出站调用**；**回调 / OAuth 回调收不到**（企微只推给可信域名指向的服务器）。本地验回调逻辑用 **mock**，或到 dev 联调。

---

## 六、落地检查清单

- [ ] 确认应用是"新建自建应用"（则可信IP 强制）还是 2022-06-28 前的旧应用（可能无此入口）
- [ ] 调用机绑 EIP / NAT 固定出口；记录该 IP
- [ ] 应用详情 →「企业可信IP」填入该 IP；等 1 分钟
- [ ] 应用详情 →「网页授权及JS-SDK」可信域名 + `WW_verify_xxx.txt` 放站点根目录（入站那一半）
- [ ] 用 `access_token 权限查询`确认 token 属于该应用（防"配错应用"）
- [ ] 一套运行环境只对应一个应用与一组白名单（未来拆 prod 时再分离）
- [ ] 本地联调走隧道 / 代理 / mock，不把动态 IP 加白
- [ ] secret 只经配置中心注入，日志不打印
- [ ] 季度审计白名单，清 stale；临时加白项必删
- [ ] 给依赖企微 API 的自动化加失败告警（防 60020 静默）

---

## 七、常见坑

| # | 坑 | 后果 | 规避 |
|---|---|---|---|
| 1 | 只配了可信域名，没配可信IP | 应用消息 / 换 userid 全 60020 | 两件都配 |
| 2 | 以为 OAuth 免登是"纯入站" | 配了可信域名，`getuserinfo` 仍 60020 | 记住 `code→userid` 是服务端出站 |
| 3 | 动态家庭 / 办公宽带 IP 加白 | 隔几天失效，60020 突发 | 用 EIP，不加动态 IP |
| 4 | 把 IP 配到错误的应用 | 配了也 60020 | 用权限查询工具定位应用 |
| 5 | 加完立即重试 | 误判"没配上" | 等 1 分钟 |
| 6 | 白名单只增不删 | 审计债，离职 / 下线 IP 仍可调 | 季度审计 |
| 7 | 误以为本地能测回调 | 本地测不到入库 / 续跑 | mock 或 dev 联调 |

---

## 八、关联真源

| 内容 | 路径 |
|---|---|
| 企微审批方案（出站安全 §5.8） | [`specs/deploy-console-wecom-approval/design.md`](../../specs/deploy-console-wecom-approval/design.md) |
| 网络流程图 + 时序图 | [`specs/deploy-console-wecom-approval/tech-design-network-and-sequence.md`](../../specs/deploy-console-wecom-approval/tech-design-network-and-sequence.md) |
| 决策依据（D8 出站安全 / D9 本地联调） | [`specs/deploy-console-wecom-approval/decision.md`](../../specs/deploy-console-wecom-approval/decision.md) |
| 企微通道接口契约 | [`docs/development/wecom-approval-channel-contract.md`](./wecom-approval-channel-contract.md) |
| 外部身份层契约 | [`docs/development/wecom-approval-identity-contract.md`](./wecom-approval-identity-contract.md) |
| 官方错误码 | 企业微信全局错误码 60020 |
