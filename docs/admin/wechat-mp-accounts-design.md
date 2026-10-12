# 公众号账号 admin 管理方案

> 状态：待评审 · 2026-10-12
> 目标：把公众号发布账号从「`.env` 手工维护」迁移到「admin 后台管理」，支持可视化增删改、启用禁用、连接测试与审计。

---

## 一、现状

### 1.1 多账号能力（已上线）

PR #324 已合入 master，content-hub 支持 `account` 字段按账号取凭据：

```jsonc
POST /api/content/wechat/publish
{ "title": "...", "html": "...", "thumb_media_id": "...", "account": "kedouai" }
```

- 不传 `account` → 默认号（大橙子社区 `default`）
- 传白名单外的账号 → 报错「未注册，可用账号：default / kedouai」

### 1.2 凭据的实际存放方式

凭据**只存在于 `servers/content-hub/.env`**（dev），没有后台界面：

| 配置项 | 作用 |
|---|---|
| `WECHAT_MP_APP_ID` / `_APP_SECRET` | 默认号凭据 |
| `WECHAT_MP_ACCOUNTS=default,kedouai` | 账号白名单 |
| `WECHAT_MP_KEDOUAI_APP_ID` / `_APP_SECRET` / `_GH_ID` | 科豆AI 号凭据 |

### 1.3 现有问题

| 问题 | 影响 |
|---|---|
| 无界面、无审计 | 改 secret 只能 SSH 上机 + `pm2 restart`，谁改的、何时改的无记录 |
| 键名不一致 | `~/env_config/wechat-mp.env` 用 `APPID`，服务读 `APP_ID`，易静默失败 |
| prod 未配置 | 只在 dev 配了，prod 无法发布 |
| `GH_ID` 是死配置 | 已写入但代码未读取，纯占位 |
| 扩容靠改文件 | 加第三个号需改 `.env` + 重启服务 |

---

## 二、目标与非目标

**目标**

1. admin 后台可视化管理公众号账号（增删改查、启用禁用）
2. 凭据加密存储，列表接口不返回明文
3. 新增/修改后无需重启服务即可生效
4. 所有写操作进操作日志
5. 平滑迁移：迁移期 `.env` 仍可用，不影响存量账号

**非目标**

- 不做公众号菜单、素材库、粉丝管理
- 不做发文内容编排（属 content-hub 现有职责）
- 不改 `account` 字段的调用契约

---

## 三、方案选型

| 维度 | 方案 A：复用 `system_configs` KV | **方案 B：独立表 + 专用接口（推荐）** |
|---|---|---|
| 改动量 | 小，直接用现有 `/admin/settings` | 中，需新建模块与页面 |
| **凭据安全** | ❌ `GET /admin/settings` 全量返回所有配置，任何 `settings:view` 的人都能拿到明文 secret | ✅ 独立接口，secret 强制掩码 + 加密存储 |
| 列表管理 | ❌ KV 表难表达"账号列表"，启用/禁用需拼 key | ✅ 天然结构化 |
| 连接测试 | ❌ 无处挂 | ✅ 可存 `last_checked_at` / `last_check_result` |
| 后续扩展 | 差 | 好 |

**选方案 B。** 决定性理由是安全：`GET /admin/settings` 会一次性返回全部配置项，把公众号 AppSecret 塞进去等于对只读管理员明文暴露。

### 关键前提（已验证）

content-hub 与 system-service **连的是同一个库**（`DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_TYPE` 四项完全一致），且 content-hub 已具备 TypeORM + mysql2 能力。

> 因此 content-hub 可**直接读同一张表**，不需要 system-service 暴露内部接口，也不需要跨服务调用。这是本方案能保持简洁的关键。

### 与现有范式的差异（需要拍板）

仓内已有 SMTP 的「env 优先 → `system_configs` 回退 → 60s 缓存」范式（`user-service/src/api-key/mail.service.ts`）。本方案**反过来**：

| | SMTP 范式 | 本方案 |
|---|---|---|
| 优先级 | env 优先，DB 回退 | **DB（admin）优先，env 兜底** |
| 理由 | SMTP 是运维配置项 | 一旦 admin 有记录就必须以 admin 为准，否则"后台改了不生效"会引发困惑 |

env 兜底的意义：**它同时就是回滚路径**——删掉 DB 记录即自动回退到 env。

---

## 四、数据模型

新增表 `wechat_mp_accounts`（migration 文件：`migrations/00XX_wechat_mp_accounts.sql`）：

```sql
CREATE TABLE IF NOT EXISTS `wechat_mp_accounts` (
  `id`                bigint unsigned NOT NULL AUTO_INCREMENT,
  `account_key`       varchar(32)  NOT NULL                COMMENT '账号标识 default/kedouai，接口 account 字段取值',
  `name`              varchar(64)  NOT NULL                COMMENT '显示名，如 大橙子社区 / 科豆AI',
  `app_id`            varchar(64)  NOT NULL                COMMENT 'AppID',
  `app_secret_enc`    text         NOT NULL                COMMENT 'AppSecret（AES-256-GCM 加密）',
  `gh_id`             varchar(64)  DEFAULT NULL            COMMENT '公众号原始ID gh_xxx',
  `enabled`           tinyint(1)   NOT NULL DEFAULT 1      COMMENT '是否启用',
  `is_default`        tinyint(1)   NOT NULL DEFAULT 0      COMMENT '是否默认号（不传 account 时用它）',
  `remark`            varchar(255) DEFAULT NULL            COMMENT '备注',
  `last_checked_at`   datetime     DEFAULT NULL            COMMENT '上次连接测试时间',
  `last_check_result` varchar(255) DEFAULT NULL            COMMENT '上次连接测试结果',
  `created_at`        datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`        datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `deleted_at`        datetime(6)  DEFAULT NULL            COMMENT '软删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_account_key` (`account_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公众号发布账号';
```

**加密**：新增环境变量 `CONFIG_ENC_KEY`（32 字节）。system-service 负责加密写入，content-hub 用同一密钥解密读取。密钥缺失时服务启动报错并给出明确提示（不静默降级为明文）。

---

## 五、读取链路（content-hub）

```
getClient(account)
  ├─ 1. 查 DB wechat_mp_accounts（enabled=1，命中即返回；60s 缓存）
  ├─ 2. 未命中 → 回退 env：WECHAT_MP_<KEY>_APP_ID / _APP_SECRET
  └─ 3. 都没有 → 抛错「公众号账号「x」未注册」
```

- 缓存 60s（`Map<accountKey, {client, expireAt}>`），改完配置最多 60s 生效，页面需提示这一点
- `WECHAT_MP_ACCOUNTS` 白名单保留，仅在走 env 兜底路径时生效；DB 有记录时由表自身承担白名单职责
- **迁移期行为不变**：表为空时完全走 env，现有两个号不受任何影响

---

## 六、接口设计（system-service）

新增 `WechatMpAccountModule`，挂载在 `admin/settings` 下，复用现有 `settings:view` / `settings:edit` 权限点：

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/settings/wechat-mp/accounts` | `settings:view` | 列表，`app_secret` **只返回掩码** |
| POST | `/admin/settings/wechat-mp/accounts` | `settings:edit` | 新增 |
| PUT | `/admin/settings/wechat-mp/accounts/:key` | `settings:edit` | 修改（secret 留空 = 不修改） |
| DELETE | `/admin/settings/wechat-mp/accounts/:key` | `settings:edit` | 软删除 |
| POST | `/admin/settings/wechat-mp/accounts/:key/test` | `settings:edit` | 连接测试 |

**连接测试**：用该号凭据取 `access_token` → 调 `getaccountbasicinfo` → 返回公众号昵称，并写入 `last_checked_at` / `last_check_result`。失败时把微信返回的 errcode 原文存下来（便于排查 IP 白名单类问题）。

**审计**：所有写操作调用 `OperationLogsService.log()`，`type: 'update_setting'`，`target` 写明具体账号与动作。

---

## 七、admin 页面设计

`apps/admin/src/views/Settings.vue` 增加第四个 Tab「公众号账号」：

| 列 | 内容 |
|---|---|
| 账号标识 | `default` / `kedouai`（不可编辑） |
| 显示名 | 大橙子社区 / 科豆AI |
| AppID | 掩码：`wx1b5b52…fdb8dd9e` |
| AppSecret | 固定显示 `●●●●●●●●` |
| 原始ID | `gh_xxx` |
| 状态 | 启用开关 |
| 默认号 | 标记 + 「设为默认」按钮 |
| 上次测试 | 时间 + 结果 |
| 操作 | 编辑 / 测试连接 / 删除 |

**新增/编辑弹窗字段**：账号标识（新增必填，小写英文，新增后不可改）、显示名、AppID、AppSecret（编辑时留空表示不改）、原始 ID、启用、设为默认。

页面顶部固定提示：

> 修改后最多 60 秒生效。AppSecret 只写入不回显。

---

## 八、实施步骤

| 阶段 | 内容 | 工作量 |
|---|---|---|
| **P0 存储与读取** | migration 建表；`CONFIG_ENC_KEY` 配置；content-hub 新增 entity + 读取链路（DB 优先/env 兜底/60s 缓存）；保留现有白名单行为 | 0.5 天 |
| **P1 admin 化** | system-service 模块 + 5 个接口 + 权限 + 审计；admin 页面 Tab、列表、弹窗、启用/默认/删除 | 1.5 天 |
| **P2 收尾** | 连接测试；把现有 `.env` 两个号导入 DB 并验证；清理 env 冗余项；统一 `env_config` 键名；prod 配置同步 | 0.5 天 |

总量约 **2.5 天**。

---

## 九、验收标准

1. admin 新增一个号 → 60s 内用 `account=<key>` 发布成功
2. admin 禁用某号 → 发布返回「账号未启用或未注册」
3. 列表接口**不返回** AppSecret 明文（抓包验证）
4. 每个写操作在操作日志里有记录
5. 清空 `.env` 中某号凭据后，仅靠 DB 配置仍能发布
6. 回归：`default` 号（大橙子社区）发布链路不受影响
7. 连接测试能正确识别 IP 白名单问题（errcode 40164）

---

## 十、风险与回滚

| 风险 | 应对 |
|---|---|
| `CONFIG_ENC_KEY` 丢失 | 无法解密已存 secret。需在部署文档写明密钥必须备份，丢失后只能重新填入 secret |
| 60s 缓存导致改完不即时生效 | 页面明确提示；必要时提供手动刷新缓存接口 |
| `.env` 与 DB 双份配置并存造成困惑 | P2 完成导入后清理 env，只保留 DB |
| **回滚路径** | **删除 DB 中的账号记录 → 自动回退到 env**，无需改代码、无需回滚版本 |

---

## 十一、待确认

1. `CONFIG_ENC_KEY` 由谁生成、如何在 dev/prod 分发
2. 是否需要支持「同一账号多服务共享」（目前只有 content-hub 用）
3. 是否要把 `WECHAT_MP_GH_ID` 真正用起来（当前未使用），还是从方案中移除
