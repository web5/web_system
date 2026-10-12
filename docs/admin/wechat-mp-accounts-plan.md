# 公众号账号 admin 管理 · 实施计划

> 方案详见：[wechat-mp-accounts-design.md](./wechat-mp-accounts-design.md)
> 建立：2026-10-12 · 负责人：文追
> 图例：⬜ 未开始 ｜ 🟡 进行中 ｜ ✅ 完成 ｜ ⛔ 阻塞

---

## 一、任务清单

### T0 · 方案评审与合入 ⬜

| 项 | 说明 |
|---|---|
| 产出 | PR #325（`docs/admin/wechat-mp-accounts-design.md`） |
| 卡点 | design 第十一节 3 项待确认：`CONFIG_ENC_KEY` 由谁生成/如何分发、是否支持多服务共享、`GH_ID` 是启用还是移除 |
| 验收 | PR 合入 master |

### T1 · P0 存储与读取（0.5 天）⬜

| # | 动作 | 落点 |
|---|---|---|
| 1 | 建表 migration `migrations/00XX_wechat_mp_accounts.sql`，dev + prod 各执行一次 | content-hub |
| 2 | 生成 `CONFIG_ENC_KEY`（32 字节），写入 content-hub / system-service 的 `.env`，备份到 `~/env_config/` | dev + prod |
| 3 | 新增 `WechatMpAccount` entity + repository | content-hub |
| 4 | 改造 `wechat-mp.publisher.ts` 的 `getClient()`：DB 优先 → env 兜底 → 抛错「未注册」；60s 缓存 | content-hub |
| 5 | 验证表为空时行为与现状完全一致（两个号仍走 env 正常发布） | dev |

- **验收**：表空时 `default` / `kedouai` 发布零改动通过；写入一条 DB 记录后优先命中 DB
- **回滚**：删掉 DB 记录即自动回退 env，无需改代码/回滚版本

### T2 · P1 admin 化（1.5 天）⬜

| # | 动作 | 落点 |
|---|---|---|
| 1 | 新建 `WechatMpAccountModule`（entity / service / controller / dto） | system-service |
| 2 | 5 个接口挂 `/admin/settings/wechat-mp/*`，复用 `settings:view` / `settings:edit` | system-service |
| 3 | AppSecret AES-256-GCM 加密写入，列表只返回掩码 | system-service |
| 4 | 写操作全部进操作日志，`type: 'update_setting'` | system-service |
| 5 | `Settings.vue` 加第四个 Tab「公众号账号」：列表 / 弹窗 / 启用 / 设为默认 / 删除 / 测试 | apps/admin |

- **验收**：后台新增一个号后列表可见且 Secret 为 `●●●●●●●●`；抓包确认接口不返回明文

### T3 · P2 收尾（0.5 天）⬜

| # | 动作 |
|---|---|
| 1 | 连接测试打通：取 access_token → `getaccountbasicinfo` 拿昵称，写 `last_checked_at` / `last_check_result`，能识别 errcode 40164（IP 白名单） |
| 2 | dev `.env` 里两个号导入 DB 并验证发布 |
| 3 | prod 同步：建表 + `CONFIG_ENC_KEY` + 导入账号 |
| 4 | 清理 env 冗余项（`WECHAT_MP_ACCOUNTS` 保留，仅作兜底白名单） |
| 5 | 统一 `~/env_config/wechat-mp.env` 键名：`APPID` → `APP_ID`（当前不一致，易静默失败） |

### T4 · 关联：PR #324 多账号上生产 ⬜（与 T1 无依赖，可并行）

| 项 | 说明 |
|---|---|
| 现状 | PR #324 已合 master，**只在 dev 生效，prod 未部署** |
| 动作 | prod pull + build + `pm2 restart`；prod `.env` 配 `WECHAT_MP_ACCOUNTS` 与两个号凭据 |
| ⚠️ | 微信后台 IP 白名单需加 prod 出口 IP（`106.52.176.246`），否则报 40164 |

---

## 二、依赖顺序

```
T0 ──> T1 ──> T2 ──> T3     （严格串行，T1 是地基）
T4 ──────────────────────    （独立，随时可做）
```

---

## 三、总验收（对应 design 第九节）

- [ ] admin 新增一个号 → 60s 内 `account=<key>` 发布成功
- [ ] 禁用某号 → 发布返回「账号未启用或未注册」
- [ ] 列表接口不返回 AppSecret 明文（抓包验证）
- [ ] 每个写操作在操作日志有记录
- [ ] 清空 `.env` 某号凭据后，仅靠 DB 仍能发布
- [ ] 回归：`default`（大橙子社区）链路不受影响
- [ ] 连接测试能识别 IP 白名单问题（40164）

---

## 四、当前阻塞

1. **PR #325 未合入** —— 方案未拍板，T1 不开工
2. **prod 未部署多账号** —— 科豆AI 号在 prod 完全不可用（T4）
