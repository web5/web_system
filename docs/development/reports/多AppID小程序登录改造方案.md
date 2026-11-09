# 多 AppID 小程序登录改造方案

## 背景

现有小程序登录后端只支持单一 AppID：`getMpConfig()` 固定从环境变量读取
`MINI_PROGRAM_APP_ID` / `MINI_PROGRAM_SECRET`，无法支撑多个小程序（如「大橙子」
主体下多个小程序）共用同一 auth-service 的诉求。小程序端已可携带自身 `appId`，
但后端忽略该字段，导致非默认小程序调用 `jscode2session` 时 appid/secret 不匹配而失败。

## 根因

`miniprogramLogin()` 在换取 session 时未根据请求方 AppID 选择对应的 secret，
始终使用全局唯一的默认配置，缺失「AppID → secret」的多实例映射与按请求解析能力。

## 方案

在 auth-service 内新增按 AppID 解析 secret 的能力，具体三处改动：

1. 新增私有方法 `getMpSecretMap(): Record<string, string>`：
   读取 `this.configService.get('MINI_PROGRAM_APP_SECRETS', '{}')`，`JSON.parse`
   失败或解析结果非对象时返回 `{}`。
2. `getMpConfig()` 改为 `getMpConfig(appId?: string)`：
   - `resolvedAppId = appId || configService.get('MINI_PROGRAM_APP_ID', '')`
   - `secret = getMpSecretMap()[resolvedAppId] || configService.get('MINI_PROGRAM_SECRET', '')`
   - 返回 `{ appId: resolvedAppId, secret }`
3. `miniprogramLogin()` 将 `const mpConfig = this.getMpConfig();`
   改为 `const mpConfig = this.getMpConfig(mpDto.appId);`。

`bindMpOpenid()` 仍调用无参 `getMpConfig()`，沿用默认 AppID，行为保持不变。

## 契约变更

- 入参：`MiniprogramLoginRequest` 新增可选字段 `appId?: string`（`packages/types` 已完成）。
- 配置：新增可选环境变量 `MINI_PROGRAM_APP_SECRETS`，JSON 字符串形式，形如
  `{"wx1234567890":"secret-a","wx0987654321":"secret-b"}`。
- 出参：无变更。

## 向后兼容性

- 未配置 `MINI_PROGRAM_APP_SECRETS` 或解析失败 → `getMpSecretMap()` 返回 `{}`，
  回退到 `MINI_PROGRAM_SECRET`，行为与改造前一致。
- 请求未携带 `appId` → 回退 `MINI_PROGRAM_APP_ID`，行为与改造前一致。

## 验证方式

1. 类型检查：`cd servers/auth-service && npx tsc --noEmit` 退出码为 0。
2. 静态断言：`grep -nE "getMpSecretMap|getMpConfig\(appId|mpDto.appId|MINI_PROGRAM_APP_SECRETS" src/auth/auth.service.ts` 命中 ≥ 4 处。
