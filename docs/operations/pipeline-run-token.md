# 流水线脚本凭据：run 短期令牌

> 2026-10-13 · 替代「把长期 `INTERNAL_API_KEY` 注入脚本 env」的做法
> 相关：`servers/deploy-console/src/common/run-token.ts`、`common/internal-key.ts`、`pipeline/pipeline.service.ts`

## 1. 为什么改

此前 `resolveStageVars()` 把控制台的 `INTERNAL_API_KEY` 原样注入为 `CONSOLE_TOKEN`，
动作脚本用它调 `/api/internal/release/*`（写版本、切指针）。问题有三：

| 问题 | 说明 |
| --- | --- |
| 权限过大 | 这一个 key 对 prod 是「任意模块切任意版本」，而一次发布只需要「改这一个模块、这一次 run」的权限 |
| 生命周期过长 | key 是静态配置，改一次要动 `.env` + 重启；脚本日志或一句 `set -x` 泄露一次就永久有效 |
| 无法归因 | 审计只记 `pipeline-script`，事后追不出「是哪次发布把 prod 切成了什么」 |

现在：**每次 run 的每次变量组装现签一枚短期令牌**，随脚本 env 下发；run 结束即撤销。

## 2. 两种凭据（并存）

| | run 短期令牌（推荐） | 静态 `INTERNAL_API_KEY` |
| --- | --- | --- |
| 形态 | `rt1_`（HS256 JWT） | 任意字符串 |
| 何时注入 | 流水线脚本，**默认** | 存量脚本、运维脚本、服务间调用 |
| 有效期 | 默认 2h（`RUN_TOKEN_TTL_SEC`） | 永久，直到人工改 |
| 失效 | run 结束立即撤销 / 过期 | 改配置 + 重启 |
| 审计 | `pipeline:run:<runId>` + `run <id> · <module> @ <env>` | `pipeline-script` |

**脚本侧零改造**：两种都走同一个头 `x-internal-key: $CONSOLE_TOKEN`，
服务端按前缀判定（`common/internal-key.ts`）。静态 key 不会被移除。

## 3. 令牌内容

```jsonc
{
  "jti": "<uuid>",          // 撤销的最小单位
  "runId": "<run id>",      // 与脚本 env 的 RUN_ID 同源
  "env": "prod",
  "moduleKey": "portal",
  "iat": 0, "exp": 0,
  "scope": ["pointer:write", "version:write", "config:read"]  // 本期只留痕不校验
}
```

签名：`HMAC-SHA256`。密钥取值链（高 → 低）
`RUN_TOKEN_SECRET` → `CONFIG_MASTER_KEY` → `JWT_SECRET`。
**故意不回落 `INTERNAL_API_KEY`** —— 否则「签令牌的密钥」和「被替代的静态 key」
是同一个值，等于把静态 key 换个形式继续在脚本里传。

## 4. 配置项

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `RUN_TOKEN_ENABLED` | `true` | 置 `false` → 完全回落到静态 key（应急开关） |
| `RUN_TOKEN_TTL_SEC` | `7200`（2h） | 令牌有效期。覆盖一次发布最长耗时即可，别调大 |
| `RUN_TOKEN_SECRET` | 回落链 | 生产建议显式配置，与登录态密钥分离 |

## 5. 撤销时机

`PipelineService.run()` 的 `finally` → `revokeScriptTokens(runId)`，覆盖
**成功 / 失败 / 取消 / 挂起等审批**四种终态。挂起后批准恢复会重新签发新令牌，不受影响。

## 6. 排障：401 文案对照

| 报错 | 含义 | 处理 |
| --- | --- | --- |
| run 令牌已过期（超过 RUN_TOKEN_TTL_SEC） | 脚本跑太久，或令牌属于上一次 run | 重跑发布；持续超时则查脚本卡点 |
| run 令牌已被撤销（所属 run 已结束） | 脚本在 run 结束后才回调平台 | 检查脚本是否异步遗留了回调 |
| run 令牌签名校验失败 | 控制台签名密钥变了 | 重跑发布；多实例需保证密钥一致 |
| run 令牌格式非法 | 令牌被截断或改写 | 检查脚本对变量做了截断/转义 |
| x-internal-key 不正确 | 静态 key 路径不匹配 | 比对控制台 `INTERNAL_API_KEY` |

`fetch-config.sh` 已按此口径提示：先看令牌是不是 `rt1_` 开头。

## 7. 已知边界（别当银弹）

1. **不降权**：拿到令牌依然能切指针。本期收益是「作用域到单次 run + 短命 + 可撤销 +
   可归因」，真正的降权要等 `scope` 校验落地（与动作类型联动，下一期）；
2. **撤销表在进程内存**：console 重启后未过期的令牌会「复活」，故 TTL 只有 2h。
   deploy-console 是 pm2 **单实例**；将来多实例部署需把撤销表挪到 DB/Redis；
3. **回落路径必须保留**：取不到签名密钥时回落静态 key 且只告警一次 ——
   凭据改造不该成为发布的新故障点。

## 8. 回滚

`RUN_TOKEN_ENABLED=false` → 行为与改造前完全一致（脚本仍用静态 key），
改完重启 deploy-console 即可，无需改脚本、无需改数据库。
